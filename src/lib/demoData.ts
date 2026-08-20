/**
 * Data Service — production data access layer.
 *
 * All reads go through the in-memory dataCache (populated from the API on startup).
 * All writes call the backend API and refresh the cache.
 * No localStorage, no hardcoded arrays, no demo mode.
 */

import type {
  TenantRow,
  TenantUserRow,
  VesselRow,
  CrewAssignmentRow,
  SmsDocRow,
  AuditLogRow,
} from './supabase';
import * as api from './api';
import * as dataCache from './dataCache';
import type { HydratedTenantRow } from '../store';

export type DemoTenantId = string;

// ── Tenant getters ──────────────────────────────────────────

export function getDemoTenant(id: string): TenantRow {
  return dataCache.getCachedTenants().find((t) => t.id === id) ?? {
    id, company: 'Unknown', contact_email: '', plan: 'Standard', status: 'active', vessels_max: 0, seats_max: 0, storage_gb_max: 0, monthly_revenue: 0, mfa_enforced: false, modules: [], sms_version: '1.0.0', created_at: '', contract_expires: '', updated_at: '',
    workspace_frozen: false, max_subfolder_depth: 4, max_upload_size_mb: 50, auto_backup_interval_hours: null, last_auto_backup_at: null,
  };
}

export function getEffectiveDemoTenants(): TenantRow[] {
  return dataCache.getCachedTenants();
}

// Refetches every tenant from the backend and dispatches TENANTS_HYDRATE —
// the full sequence needed to bring the store's tenant list back in sync
// with the DB (e.g. after a plan-tier rename cascades to every tenant on
// that plan). Shared by the initial app-shell hydration, the Tenant
// Ledger's own refresh, and anywhere else that needs authoritative tenant
// state rather than a manually patched local copy.
export async function hydrateAllTenants(
  dispatch: (action: { type: 'TENANTS_HYDRATE'; rows: HydratedTenantRow[] }) => void,
): Promise<void> {
  await dataCache.refreshAllTenants();
  const rows = getEffectiveDemoTenants();
  await Promise.all(rows.map((r) => dataCache.refreshTenantData(r.id)));
  const hydrated: HydratedTenantRow[] = rows.map((r) => ({
    ...r,
    seatsUsed: getEffectiveDemoUsers(r.id).length,
    vesselsUsed: getEffectiveDemoVessels(r.id).length,
  }));
  dispatch({ type: 'TENANTS_HYDRATE', rows: hydrated });
}

export async function demoCreateTenant(
  data: { company: string; contact_email: string; plan: string; vessels_max: number; seats_max: number; storage_gb_max?: number; monthly_revenue?: number },
): Promise<string> {
  const t = await api.apiCreateTenant<TenantRow>({
    company: data.company,
    contact_email: data.contact_email,
    plan: data.plan,
    vessels_max: data.vessels_max,
    seats_max: data.seats_max,
    storage_gb_max: data.storage_gb_max ?? 50,
    monthly_revenue: data.monthly_revenue ?? 0,
    mfa_enforced: false,
    modules: ['sms_documentation'],
    sms_version: '1.0.0',
    status: 'active',
  });
  dataCache.upsertCachedTenant(t);
  return t.id;
}

export async function demoUpdateTenantSmsVersion(tenantId: string, smsVersion: string): Promise<void> {
  const t = await api.apiUpdateTenant<TenantRow>(tenantId, { sms_version: smsVersion });
  dataCache.upsertCachedTenant(t);
}

// ── Workspace freeze / guardrails ───────────────────────────
// Real per-tenant state (tenants.workspace_frozen / max_subfolder_depth /
// max_upload_size_mb), enforced for real server-side in
// server/routes/smsDocuments.js and server/routes/files.js — not just a
// UI-only flag. Reads come from the same tenant cache TENANTS_HYDRATE
// uses; writes go through the real tenant-update endpoint.

export function demoGetWorkspaceFrozen(tenantId: string): boolean {
  return !!dataCache.getCachedTenants().find((t) => t.id === tenantId)?.workspace_frozen;
}

export async function demoSetWorkspaceFrozen(tenantId: string, frozen: boolean): Promise<void> {
  const t = await api.apiUpdateTenant<TenantRow>(tenantId, { workspace_frozen: frozen });
  dataCache.upsertCachedTenant(t);
}

export interface DemoGuardrails {
  maxSubfolderDepth: number;
  maxUploadSizeMb: number;
}

export function demoGetGuardrails(tenantId: string): DemoGuardrails | null {
  const t = dataCache.getCachedTenants().find((x) => x.id === tenantId);
  if (!t) return null;
  return { maxSubfolderDepth: t.max_subfolder_depth, maxUploadSizeMb: t.max_upload_size_mb };
}

export async function demoSetGuardrails(tenantId: string, guardrails: DemoGuardrails): Promise<void> {
  const t = await api.apiUpdateTenant<TenantRow>(tenantId, { max_subfolder_depth: guardrails.maxSubfolderDepth, max_upload_size_mb: guardrails.maxUploadSizeMb });
  dataCache.upsertCachedTenant(t);
}

// ── Feature flags ───────────────────────────────────────────

export interface DemoFeatureFlagEntry {
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

const featureFlagCache = new Map<string, Map<string, boolean>>();

// Reads the persisted per-tenant overrides from the backend on first access
// per tenant, then serves subsequent reads from the in-memory cache — a
// cache miss must never be treated as "no overrides exist" (which silently
// defaulted every module back to enabled) since the actual DB state for
// tenants not yet toggled this session was never fetched.
export async function getDemoFeatureFlagsForTenant(tenantId: string): Promise<Map<string, boolean>> {
  const cached = featureFlagCache.get(tenantId);
  if (cached) return cached;
  const rows = await api.apiGetFeatureFlags<{ feature_key: string; enabled: boolean }>(tenantId).catch(() => []);
  const map = new Map<string, boolean>();
  for (const r of rows) map.set(r.feature_key, !!r.enabled);
  featureFlagCache.set(tenantId, map);
  return map;
}

export function getDemoFeatureFlags(): DemoFeatureFlagEntry[] {
  const entries: DemoFeatureFlagEntry[] = [];
  for (const t of dataCache.getCachedTenants()) {
    const flags = featureFlagCache.get(t.id) ?? new Map();
    for (const [key, enabled] of flags) {
      entries.push({ tenant_id: t.id, feature_key: key, enabled, updated_by: null, updated_at: '' });
    }
  }
  return entries;
}

export function demoSetFeatureFlag(
  tenantId: string,
  featureKey: string,
  enabled: boolean,
): void {
  // The write itself already happened in setFeatureFlag (featureFlags.ts) —
  // this only mirrors the result into the local cache so subsequent reads
  // (same session) don't need a round trip. A second write here would be
  // redundant and, being unawaited by the caller, a source of races.
  const flags = featureFlagCache.get(tenantId) ?? new Map();
  flags.set(featureKey, enabled);
  featureFlagCache.set(tenantId, flags);
}

// ── Sync config ─────────────────────────────────────────────

export interface DemoSyncConfigEntry {
  tenant_id: string;
  auto_sync_interval_hours: number;
  manual_replicate_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

const syncConfigCache = new Map<string, DemoSyncConfigEntry>();

// Same pattern as getDemoFeatureFlagsForTenant: a cache miss must trigger a
// real fetch from the backend, not be treated as "no config exists" — a
// tenant whose sync interval was set in an earlier session still has that
// value persisted server-side even though this session's cache is empty.
export async function getDemoSyncConfigForTenant(tenantId: string): Promise<DemoSyncConfigEntry | null> {
  const cached = syncConfigCache.get(tenantId);
  if (cached) return cached;
  try {
    const row = await api.apiGetSyncConfig<{
      auto_sync_interval_hours: number;
      manual_replicate_enabled: boolean;
      updated_by: string | null;
      updated_at: string;
    }>(tenantId);
    const entry: DemoSyncConfigEntry = {
      tenant_id: tenantId,
      auto_sync_interval_hours: row.auto_sync_interval_hours,
      manual_replicate_enabled: row.manual_replicate_enabled,
      updated_by: row.updated_by ?? null,
      updated_at: row.updated_at ?? new Date().toISOString(),
    };
    syncConfigCache.set(tenantId, entry);
    return entry;
  } catch {
    return null;
  }
}

export function getDemoSyncConfigs(): DemoSyncConfigEntry[] {
  return Array.from(syncConfigCache.values());
}

export async function demoSetSyncConfig(
  tenantId: string,
  autoSyncIntervalHours: number,
  manualReplicateEnabled: boolean,
  updatedBy: string | null,
): Promise<void> {
  const entry: DemoSyncConfigEntry = {
    tenant_id: tenantId,
    auto_sync_interval_hours: autoSyncIntervalHours,
    manual_replicate_enabled: manualReplicateEnabled,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };
  syncConfigCache.set(tenantId, entry);
}

// Module display-name overrides now live in the real module_definitions
// table — see apiGetAllModuleDefs/apiUpdateModuleDef in api.ts, consumed
// directly by fetchModuleDefinitions/setModuleDisplayName in featureFlags.ts.

// ── User getters ────────────────────────────────────────────

export function getEffectiveDemoUsers(tenantId: string): TenantUserRow[] {
  return dataCache.getCachedUsers(tenantId);
}

export async function demoCreateUser(
  tenantId: string,
  data: { name: string; email: string; password?: string; employee_id: string | null; passport_number: string | null; seaman_book_number: string | null; nationality: string | null; rank: TenantUserRow['rank']; role: TenantUserRow['role']; status?: string; fleet_scope?: 'global' | 'specific'; assigned_vessel_ids?: string[]; assigned_fleet_profile_ids?: string[] },
): Promise<string> {
  const u = await api.apiCreateUser<TenantUserRow>(tenantId, {
    name: data.name, email: data.email, password: data.password, employee_id: data.employee_id,
    passport_number: data.passport_number, seaman_book_number: data.seaman_book_number,
    nationality: data.nationality, rank: data.rank, role: data.role,
    status: data.status ?? 'invited', fleet_scope: data.fleet_scope ?? 'global',
    assigned_vessel_ids: data.assigned_vessel_ids ?? [], assigned_fleet_profile_ids: data.assigned_fleet_profile_ids ?? [],
  });
  dataCache.upsertCachedUser(tenantId, u);
  return u.id;
}

export async function demoDeleteUser(tenantId: string, userId: string): Promise<void> {
  // The route signs off this user's active assignment then hard-deletes the
  // tenant_users row, which cascades to ALL of their crew_assignments rows
  // (ON DELETE CASCADE on user_id) — removeCachedUser mirrors that.
  await api.apiDeleteUser(tenantId, userId);
  dataCache.removeCachedUser(tenantId, userId);
}

export async function demoSetUserStatus(tenantId: string, userId: string, status: string): Promise<void> {
  const u = await api.apiUpdateUser<TenantUserRow>(tenantId, userId, { status });
  dataCache.upsertCachedUser(tenantId, u);
}

export async function demoUpdateUserProfile(tenantId: string, userId: string, data: { name?: string; email?: string; employee_id?: string | null; rank?: string; status?: string }): Promise<void> {
  const u = await api.apiUpdateUser<TenantUserRow>(tenantId, userId, data);
  dataCache.upsertCachedUser(tenantId, u);
}

export async function demoDeactivateUser(tenantId: string, userId: string): Promise<void> {
  // /deactivate only returns {success}, not the row, and it also signs off
  // this user's active assignment server-side — replay both effects locally.
  await api.apiDeactivateUser(tenantId, userId);
  dataCache.patchCachedUser(tenantId, userId, { status: 'inactive' });
  dataCache.signOffCachedAssignmentsForUser(tenantId, userId);
}

// ── Vessel getters ──────────────────────────────────────────

export function getEffectiveDemoVessels(tenantId: string): VesselRow[] {
  return dataCache.getCachedVessels(tenantId);
}

export async function demoCreateVessel(
  tenantId: string,
  data: { name: string; imo_number: string; call_sign: string | null; flag_state: string | null; port_of_registry: string | null; gross_tonnage: number | null; kw_power: number | null; vessel_type: string | null; class_society: string | null; satellite_provider?: string | null },
  _smsVersion: string,
): Promise<string> {
  const v = await api.apiCreateVessel<VesselRow>(tenantId, {
    name: data.name, imo_number: data.imo_number, call_sign: data.call_sign,
    flag_state: data.flag_state, port_of_registry: data.port_of_registry,
    gross_tonnage: data.gross_tonnage, kw_power: data.kw_power,
    vessel_type: data.vessel_type, class_society: data.class_society,
    satellite_provider: data.satellite_provider ?? null,
  });
  dataCache.upsertCachedVessel(tenantId, v);
  return v.id;
}

export async function demoDeleteVessel(tenantId: string, vesselId: string): Promise<void> {
  // ON DELETE CASCADE removes this vessel's crew_assignments server-side —
  // removeCachedVessel mirrors that so manning views don't show ghost rows.
  await api.apiDeleteVessel(tenantId, vesselId);
  dataCache.removeCachedVessel(tenantId, vesselId);
}

export async function demoUpdateVesselSync(tenantId: string, vesselId: string, smsVersion: string): Promise<void> {
  // MySQL TIMESTAMP columns reject ISO-8601 ('T'/'Z'/milliseconds) string
  // literals — format as 'YYYY-MM-DD HH:MM:SS' (UTC) instead.
  const lastSyncAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const v = await api.apiUpdateVessel<VesselRow>(tenantId, vesselId, { sms_active_version: smsVersion, last_sync_at: lastSyncAt });
  dataCache.upsertCachedVessel(tenantId, v);
}

export async function demoUpdateVessel(tenantId: string, vesselId: string, updates: Partial<Omit<VesselRow, 'id' | 'tenant_id' | 'created_at'>>): Promise<void> {
  const v = await api.apiUpdateVessel<VesselRow>(tenantId, vesselId, updates);
  dataCache.upsertCachedVessel(tenantId, v);
}

// ── Crew assignments ────────────────────────────────────────

export function getEffectiveDemoAssignments(tenantId: string): CrewAssignmentRow[] {
  return dataCache.getCachedAssignments(tenantId);
}

export async function demoSignOn(tenantId: string, userId: string, vesselId: string, rank: string): Promise<string> {
  const a = await api.apiCreateAssignment<CrewAssignmentRow>(tenantId, {
    vessel_id: vesselId, user_id: userId, rank,
  });
  dataCache.upsertCachedAssignment(tenantId, a);
  return a.id;
}

export async function demoSignOff(tenantId: string, assignmentId: string): Promise<void> {
  const a = await api.apiSignOffAssignment<CrewAssignmentRow>(tenantId, assignmentId);
  dataCache.upsertCachedAssignment(tenantId, a);
}

// ── SMS documents ───────────────────────────────────────────

export function getEffectiveDemoSmsDocs(tenantId: string, treeKind?: string, profileId?: string | null): SmsDocRow[] {
  let docs = dataCache.getCachedSmsDocs(tenantId);
  if (treeKind) docs = docs.filter((d) => d.tree_kind === treeKind);
  if (profileId !== undefined) {
    if (profileId === null) {
      docs = docs.filter((d) => d.profile_id === null);
    } else {
      docs = docs.filter((d) => d.profile_id === profileId || d.profile_id === null);
    }
  }
  return docs;
}

export async function demoCreateSmsDoc(
  tenantId: string,
  data: { parent_id: string | null; tree_kind: string; label: string; node_kind: 'folder' | 'document'; content_kind: 'rich_text' | 'pdf' | null; content: string | null; file_size_bytes?: number | null; profile_id?: string | null; author_name?: string | null; author_role?: string | null; author_origin?: string | null },
): Promise<string> {
  const siblings = getEffectiveDemoSmsDocs(tenantId, data.tree_kind).filter((d) => d.parent_id === data.parent_id);
  const maxSort = siblings.reduce((mx, d) => Math.max(mx, d.sort_order), 0);
  const d = await api.apiCreateSmsDoc<SmsDocRow>(tenantId, {
    parent_id: data.parent_id, tree_kind: data.tree_kind, label: data.label,
    node_kind: data.node_kind, content_kind: data.content_kind, content: data.content,
    file_size_bytes: data.file_size_bytes ?? null,
    approval_state: 'pending_dpa', sort_order: maxSort + 1, profile_id: data.profile_id ?? null,
    author_name: data.author_name ?? null, author_role: data.author_role ?? null, author_origin: data.author_origin ?? null,
  });
  dataCache.upsertCachedSmsDoc(tenantId, d);
  return d.id;
}

export async function demoRenameSmsDoc(tenantId: string, docId: string, newLabel: string): Promise<void> {
  const d = await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, { label: newLabel });
  dataCache.upsertCachedSmsDoc(tenantId, d);
}

export async function demoUpdateSmsDocContent(tenantId: string, docId: string, content: string, contentKind: 'rich_text' | 'pdf', authorName?: string | null, authorRole?: string | null, authorOrigin?: string | null, fileSizeBytes?: number | null): Promise<void> {
  const updates: Record<string, unknown> = { content, content_kind: contentKind, approval_state: 'pending_dpa' };
  if (authorName) updates.author_name = authorName;
  if (authorRole) updates.author_role = authorRole;
  if (authorOrigin) updates.author_origin = authorOrigin;
  // Only touch file_size_bytes when a new file was actually picked — otherwise
  // a plain resubmit-with-unchanged-PDF would wipe out the recorded size.
  if (fileSizeBytes != null) updates.file_size_bytes = fileSizeBytes;
  const d = await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, updates);
  dataCache.upsertCachedSmsDoc(tenantId, d);
}

export async function demoApproveSmsDoc(tenantId: string, docId: string): Promise<void> {
  const d = await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, { approval_state: 'approved' });
  dataCache.upsertCachedSmsDoc(tenantId, d);
}

export async function demoApproveAllSmsDocs(tenantId: string): Promise<number> {
  const all = getEffectiveDemoSmsDocs(tenantId);
  const pending = all.filter((d) => d.approval_state === 'pending_dpa');
  for (const p of pending) {
    const d = await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, p.id, { approval_state: 'approved' });
    dataCache.upsertCachedSmsDoc(tenantId, d);
  }
  return pending.length;
}

export async function demoRejectSmsDoc(tenantId: string, docId: string, comments?: string): Promise<void> {
  const d = await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, { approval_state: 'rejected', rejection_comments: comments ?? null });
  dataCache.upsertCachedSmsDoc(tenantId, d);
}

export async function demoResubmitSmsDoc(tenantId: string, docId: string, content?: string, contentKind?: 'rich_text' | 'pdf', authorName?: string | null, authorRole?: string | null, authorOrigin?: string | null, fileSizeBytes?: number | null): Promise<void> {
  const updates: Record<string, unknown> = { approval_state: 'pending_dpa', rejection_comments: null };
  if (content !== undefined) updates.content = content;
  if (contentKind !== undefined) updates.content_kind = contentKind;
  if (authorName) updates.author_name = authorName;
  if (authorRole) updates.author_role = authorRole;
  if (authorOrigin) updates.author_origin = authorOrigin;
  if (fileSizeBytes != null) updates.file_size_bytes = fileSizeBytes;
  const d = await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, updates);
  dataCache.upsertCachedSmsDoc(tenantId, d);
}

// Deletion by a company admin (or DPA) never removes a document outright —
// it only flags the document as awaiting DPA sign-off, mirroring the
// add/edit review flow above. The document (and its content) is left
// untouched in the database; only `approval_state` changes, which also
// has the side effect of hiding it from the fleet-facing view (same as a
// pending edit) until the DPA reaches a decision.
export async function demoRequestDeleteSmsDoc(tenantId: string, docId: string): Promise<void> {
  const d = await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, { approval_state: 'pending_delete', rejection_comments: null });
  dataCache.upsertCachedSmsDoc(tenantId, d);
}

// DPA approves the deletion request — this is the only path that actually
// removes the row (and, via ON DELETE CASCADE, any children).
export async function demoApproveDeleteSmsDoc(tenantId: string, docId: string): Promise<number> {
  return demoDeleteSmsDoc(tenantId, docId);
}

// DPA rejects the deletion request — the document is restored to its
// previous approved, fleet-visible state.
export async function demoRejectDeleteSmsDoc(tenantId: string, docId: string, comments?: string): Promise<void> {
  const d = await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, { approval_state: 'approved', rejection_comments: comments ?? null });
  dataCache.upsertCachedSmsDoc(tenantId, d);
}

export async function demoDeleteSmsDoc(tenantId: string, docId: string): Promise<number> {
  const all = getEffectiveDemoSmsDocs(tenantId);
  const toDelete = new Set<string>([docId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of all) {
      if (d.parent_id && toDelete.has(d.parent_id) && !toDelete.has(d.id)) {
        toDelete.add(d.id);
        changed = true;
      }
    }
  }
  for (const id of toDelete) {
    await api.apiDeleteSmsDoc(tenantId, id);
  }
  dataCache.removeCachedSmsDocs(tenantId, toDelete);
  return toDelete.size;
}

export function demoCloneMasterSms(_tenantId: string): void {
  // Master SMS cloning is handled via the SMS document API
}

// ── Custom tabs ─────────────────────────────────────────────

export async function getDemoCustomTabs(tenantId: string): Promise<Record<string, { key: string; label: string; subtitle: string; custom?: boolean }>> {
  const rows = await api.apiGetSmsDocTabs<{ tab_key: string; label: string; subtitle: string | null }>(tenantId);
  const out: Record<string, { key: string; label: string; subtitle: string; custom?: boolean }> = {};
  for (const r of rows) {
    out[r.tab_key] = { key: r.tab_key, label: r.label, subtitle: r.subtitle ?? 'Custom document group', custom: true };
  }
  return out;
}

export async function createDemoCustomTab(tenantId: string, key: string, label: string, subtitle: string): Promise<void> {
  await api.apiCreateSmsDocTab(tenantId, { tab_key: key, label, subtitle });
}

export async function renameDemoCustomTab(tenantId: string, key: string, label: string): Promise<void> {
  await api.apiUpdateSmsDocTab(tenantId, key, { label });
}

export async function deleteDemoCustomTab(tenantId: string, key: string): Promise<void> {
  await api.apiDeleteSmsDocTab(tenantId, key);
}

// ── Audit logs ──────────────────────────────────────────────

export function getDemoAuditLogs(tenantId: string): AuditLogRow[] {
  return dataCache.getCachedAuditLogs(tenantId);
}
