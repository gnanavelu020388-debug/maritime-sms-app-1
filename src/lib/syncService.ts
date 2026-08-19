import type { SmsDocRow, TenantRow } from './supabase';
import {
  getLocalSmsVersion,
  setLocalSmsVersion,
  getLocalDocuments,
  cacheAllDocuments,
  isCacheSeeded,
  setLastSyncAt,
  getLastSyncAt,
  setPendingUpdate,
  broadcastSmsUpdate,
  type PendingUpdate,
} from './localVesselDb';
import type { SyncModuleKey } from './syncTypes';
import * as api from './api';

/**
 * Unified Satellite Sync Service — vessel-side background worker.
 *
 * Reads the sync interval from tenant_sync_config via the API.
 * Polls for version changes and pushes/pulls updates between the vessel's
 * local server and the Cloud Run backend at the configured interval.
 */

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** How a sync check-in was triggered — recorded alongside the vessel's sync state purely as delivery-method evidence. It never changes who authored a document; see enqueueSyncEntry / SmsLibrarySplitView for that. */
export type SyncMethod = 'manual' | 'automatic';

export interface SyncResult {
  applied: boolean;
  fromVersion: string | null;
  toVersion: string | null;
  error: string | null;
}

/**
 * Real top-down pull: fetches every SMS document + the tenant's current
 * sms_version from the backend and replaces the local cache with it. This
 * is a full-refresh "delta" rather than a true incremental one, but it's
 * real — the vessel's local cache genuinely reflects shore's current state
 * afterward, which it previously never did.
 */
async function pullFromShore(tenantId: string): Promise<string | null> {
  const [tenant, docs] = await Promise.all([
    api.apiGetTenant<TenantRow>(tenantId),
    api.apiGetSmsDocuments<SmsDocRow>(tenantId),
  ]);
  await cacheAllDocuments(tenantId, docs);
  await setLocalSmsVersion(tenantId, tenant.sms_version);
  return tenant.sms_version;
}

/** Seed the local cache from the real backend on first login. */
export async function seedLocalCache(tenantId: string): Promise<void> {
  if (await isCacheSeeded(tenantId)) return;
  await pullFromShore(tenantId);
}

/** Drains a vessel's real pending outbox via the unified sync engine's check-in endpoint. Returns how many entries were synced (0 if there's no vessel to drain for). */
export async function drainSyncOutbox(
  tenantId: string,
  vesselId: string | undefined,
  syncMethod: SyncMethod = 'manual',
): Promise<number> {
  if (!vesselId) return 0;
  try {
    const result = await api.apiCheckInVessel(vesselId, tenantId, syncMethod);
    return result.synced;
  } catch {
    return 0;
  }
}

export async function performSyncCheckIn(
  tenantId: string,
  vesselId?: string,
  syncMethod: SyncMethod = 'manual',
): Promise<SyncResult> {
  const localVersion = await getLocalSmsVersion(tenantId);

  // Bottom-up: drain this vessel's real pending outbox as part of the same
  // check-in. drainSyncOutbox() never throws (it swallows its own errors),
  // so this can't break the top-down SMS version pull below.
  await drainSyncOutbox(tenantId, vesselId, syncMethod);

  if (!localVersion) {
    try {
      const seededVersion = await pullFromShore(tenantId);
      await setLastSyncAt(tenantId, new Date().toISOString());
      return { applied: true, fromVersion: null, toVersion: seededVersion, error: null };
    } catch (err) {
      return { applied: false, fromVersion: null, toVersion: null, error: (err as Error).message };
    }
  }

  // Top-down: pull fresh documents whenever shore's version has actually
  // moved on. Cheap to check every cycle — apiGetTenant is a lightweight
  // single-row fetch, and a real pull only happens when it's warranted.
  try {
    const tenant = await api.apiGetTenant<TenantRow>(tenantId);
    const syncTime = new Date().toISOString();
    if (tenant.sms_version !== localVersion) {
      await pullFromShore(tenantId);
      await setLastSyncAt(tenantId, syncTime);
      return { applied: true, fromVersion: localVersion, toVersion: tenant.sms_version, error: null };
    }
    await setLastSyncAt(tenantId, syncTime);
    return { applied: false, fromVersion: localVersion, toVersion: localVersion, error: null };
  } catch (err) {
    return { applied: false, fromVersion: localVersion, toVersion: localVersion, error: (err as Error).message };
  }
}

export function startSyncLoop(
  tenantId: string,
  onSync?: (result: SyncResult) => void,
  intervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
  vesselId?: string,
): () => void {
  // intervalMs === 0 is the "Always" preset — it deliberately falls through
  // to the same 30s floor as any other interval below the minimum, giving
  // continuous sync without needing separate always-on logic.
  const safeInterval = Math.min(Math.max(intervalMs, 30_000), 24 * 60 * 60 * 1000);
  const intervalLabel = intervalMs === 0 ? 'always (30s)' : `${(safeInterval / (60 * 60 * 1000)).toFixed(1)}h`;

  console.log(
    `[syncService] startSyncLoop tenant=${tenantId} vessel=${vesselId ?? 'N/A'} interval=${intervalLabel} (${safeInterval}ms)`,
  );

  const initialTimeout = setTimeout(() => {
    console.log(`[syncService] initial sync tick tenant=${tenantId}`);
    performSyncCheckIn(tenantId, vesselId, 'automatic')
      .then((result) => {
        console.log(`[syncService] sync result tenant=${tenantId} applied=${result.applied} version=${result.toVersion ?? 'none'}`);
        onSync?.(result);
      })
      .catch((err) => console.error(`[syncService] sync error tenant=${tenantId}`, err));
  }, 3000);

  const interval = setInterval(() => {
    const next = new Date(Date.now() + safeInterval).toISOString();
    console.log(`[syncService] scheduled sync tick tenant=${tenantId} next=${next}`);
    performSyncCheckIn(tenantId, vesselId, 'automatic')
      .then((result) => {
        console.log(`[syncService] sync result tenant=${tenantId} applied=${result.applied} version=${result.toVersion ?? 'none'}`);
        onSync?.(result);
      })
      .catch((err) => console.error(`[syncService] sync error tenant=${tenantId}`, err));
  }, safeInterval);

  return () => {
    console.log(`[syncService] stopping sync loop tenant=${tenantId}`);
    clearTimeout(initialTimeout);
    clearInterval(interval);
  };
}

export async function replicateToShoreNow(
  tenantId: string,
  vesselId?: string,
): Promise<SyncResult> {
  return performSyncCheckIn(tenantId, vesselId, 'manual');
}

export async function getSyncStatus(tenantId: string): Promise<{
  localVersion: string | null;
  lastSyncAt: string | null;
}> {
  const [localVersion, lastSyncAt] = await Promise.all([
    getLocalSmsVersion(tenantId),
    getLastSyncAt(tenantId),
  ]);
  return { localVersion, lastSyncAt };
}

export async function hasLocalDocs(tenantId: string, treeKind: string): Promise<boolean> {
  const docs = await getLocalDocuments(tenantId, treeKind);
  return docs.length > 0;
}

/** Enqueues a real bottom-up outbox entry. Never throws — a failed enqueue must not break the caller's save flow, so it just reports false. */
export async function enqueueSyncEntry(
  tenantId: string,
  vesselId: string,
  moduleKey: SyncModuleKey,
  entityType: string,
  entityId: string,
  payload: Record<string, unknown>,
  operation: 'upsert' | 'delete' | 'batch_upsert' = 'upsert',
  priority = 0,
): Promise<boolean> {
  try {
    await api.apiEnqueueSyncEntry({
      tenant_id: tenantId,
      vessel_id: vesselId,
      module_key: moduleKey,
      entity_type: entityType,
      entity_id: entityId,
      payload,
      operation,
      priority,
    });
    return true;
  } catch {
    return false;
  }
}

export async function getVesselSyncState(
  tenantId: string,
  vesselId: string,
): Promise<{
  pendingOutbox: number;
  failedOutbox: number;
  lastSyncAt: string | null;
  connectionMode: string;
} | null> {
  try {
    const state = await api.apiGetVesselSyncStateOne<{
      pending_outbox_count: number;
      failed_outbox_count: number;
      last_sync_at: string | null;
      connection_mode: string;
    }>(vesselId, tenantId);
    if (!state) {
      return { pendingOutbox: 0, failedOutbox: 0, lastSyncAt: null, connectionMode: 'VESSEL_SERVER_LAN' };
    }
    return {
      pendingOutbox: state.pending_outbox_count,
      failedOutbox: state.failed_outbox_count,
      lastSyncAt: state.last_sync_at,
      connectionMode: state.connection_mode,
    };
  } catch {
    return { pendingOutbox: 0, failedOutbox: 0, lastSyncAt: null, connectionMode: 'VESSEL_SERVER_LAN' };
  }
}

// Re-export for convenience
export { setPendingUpdate, broadcastSmsUpdate };
export type { PendingUpdate };
