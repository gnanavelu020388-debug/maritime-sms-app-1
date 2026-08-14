/**
 * Feature flags system — per-tenant module enablement.
 * Backed by an in-memory cache populated from the backend; no localStorage.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getDemoFeatureFlagsForTenant,
  demoSetFeatureFlag,
  demoSetSyncConfig,
  getDemoModuleDefs,
  demoSetModuleDef,
} from './demoData';
import { postSyncEvent, onSyncEvent, type SyncEvent } from './syncChannel';
import * as api from './api';

/** All platform modules that can be toggled per tenant. */
export const MODULE_KEYS = [
  'sms_documentation',
  'rest_hours',
  'haccp_galley',
  'certification_manager',
  'satellite_sync',
  'voyage_logging',
  'crew_matrix',
  'electronic_logbooks',
  'advanced_analytics',
  'risk_assessment',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABELS: Record<ModuleKey, { label: string; description: string; icon: string }> = {
  sms_documentation: { label: 'SMS Documentation', description: 'Safety Management System manuals, procedures, and policies', icon: 'FileCheck2' },
  rest_hours: { label: 'Rest Hours Engine', description: 'MLC-compliant rest hour tracking and fatigue management', icon: 'Clock' },
  haccp_galley: { label: 'HACCP / Galley', description: 'Food safety, galley inspections, and HACCP compliance', icon: 'UtensilsCrossed' },
  certification_manager: { label: 'Certification Manager', description: 'Crew certification, vessel certificates, and expiry tracking', icon: 'Award' },
  satellite_sync: { label: 'Satellite Sync', description: 'Priority satellite data synchronization and queue management', icon: 'SatelliteDish' },
  voyage_logging: { label: 'Voyage Logging', description: 'Voyage data recording and port arrival/departure logs', icon: 'Navigation' },
  crew_matrix: { label: 'Crew Matrix', description: 'Crew competency matrices and familiarization tracking', icon: 'Users' },
  electronic_logbooks: { label: 'Electronic Logbooks', description: 'Digital oil record, garbage, and cargo logbooks', icon: 'BookOpen' },
  advanced_analytics: { label: 'Advanced Analytics', description: 'Fleet performance analytics and trend dashboards', icon: 'BarChart3' },
  risk_assessment: { label: 'Risk Assessment', description: 'Operational risk assessments and mitigation tracking', icon: 'ShieldAlert' },
};

export const LIVE_MODULES: ModuleKey[] = [
  'sms_documentation',
];

export const LAUNCHPAD_EXCLUDED: ReadonlySet<ModuleKey> = new Set<ModuleKey>([
  'crew_matrix',
]);

export const DEFAULT_ENABLED_MODULES: ModuleKey[] = MODULE_KEYS.slice();

export const TOGGLEABLE_MODULE_KEYS: ModuleKey[] = MODULE_KEYS.slice();

export interface FeatureFlagRow {
  id: string;
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  custom_config: Record<string, unknown> | null;
  updated_by: string | null;
  updated_at: string;
}

export interface SyncConfigRow {
  id: string;
  tenant_id: string;
  auto_sync_interval_hours: number;
  manual_replicate_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

let flagCache: Map<string, Set<ModuleKey>> = new Map();
let syncConfigCache: Map<string, SyncConfigRow> = new Map();

export interface ModuleDefinitionRow {
  id: string;
  feature_key: ModuleKey;
  display_name: string;
  description: string | null;
  sort_order: number;
  updated_by: string | null;
  updated_at: string;
}
let moduleDefCache: Map<ModuleKey, ModuleDefinitionRow> | null = null;

const flagListeners = new Set<(tenantId: string) => void>();
const moduleDefListeners = new Set<() => void>();

export function onFeatureFlagsChanged(cb: (tenantId: string) => void): () => void {
  flagListeners.add(cb);
  return () => { flagListeners.delete(cb); };
}

if (typeof window !== 'undefined') {
  onSyncEvent((evt: SyncEvent) => {
    if (evt.type === 'FEATURE_FLAGS_CHANGED' && evt.tenantId) {
      flagCache.delete(evt.tenantId);
      syncConfigCache.delete(evt.tenantId);
      notifyFlagChange(evt.tenantId);
    }
  });
}

function notifyFlagChange(tenantId: string) {
  flagListeners.forEach((cb) => cb(tenantId));
}

function notifyModuleDefChange() {
  moduleDefListeners.forEach((cb) => cb());
}

export async function fetchEnabledFeatures(tenantId: string): Promise<Set<ModuleKey>> {
  const cached = flagCache.get(tenantId);
  if (cached) return cached;
  const overrides = getDemoFeatureFlagsForTenant(tenantId);
  const enabled = new Set<ModuleKey>();
  for (const k of MODULE_KEYS) {
    const explicit = overrides.get(k);
    if (explicit === false) continue;
    enabled.add(k);
  }
  flagCache.set(tenantId, enabled);
  return enabled;
}

export async function fetchSyncConfig(tenantId: string): Promise<SyncConfigRow> {
  const defaultConfig: SyncConfigRow = {
    id: 'default',
    tenant_id: tenantId,
    auto_sync_interval_hours: 6,
    manual_replicate_enabled: true,
    updated_by: null,
    updated_at: new Date().toISOString(),
  };

  const cached = syncConfigCache.get(tenantId);
  if (cached) return cached;

  try {
    const row = await api.apiGetSyncConfig<SyncConfigRow>(tenantId);
    const result: SyncConfigRow = {
      id: row.id ?? 'default',
      tenant_id: tenantId,
      auto_sync_interval_hours: row.auto_sync_interval_hours ?? 6,
      manual_replicate_enabled: row.manual_replicate_enabled ?? true,
      updated_by: row.updated_by ?? null,
      updated_at: row.updated_at ?? new Date().toISOString(),
    };
    syncConfigCache.set(tenantId, result);
    return result;
  } catch {
    return defaultConfig;
  }
}

export async function fetchAllFeatureFlags(): Promise<FeatureFlagRow[]> {
  try {
    const tenants = await api.apiGetTenants<{ id: string }>();
    const all: FeatureFlagRow[] = [];
    for (const t of tenants) {
      const flags = await api.apiGetFeatureFlags<FeatureFlagRow>(t.id).catch(() => []);
      all.push(...flags);
    }
    return all;
  } catch {
    return [];
  }
}

export async function setFeatureFlag(
  tenantId: string,
  featureKey: ModuleKey,
  enabled: boolean,
  updatedBy: string
): Promise<boolean> {
  try {
    await api.apiUpdateFeatureFlag(tenantId, featureKey, { enabled, updated_by: updatedBy });
  } catch (err) {
    console.error('[setFeatureFlag] API error:', err);
  }
  demoSetFeatureFlag(tenantId, featureKey, enabled, updatedBy);
  flagCache.delete(tenantId);
  notifyFlagChange(tenantId);
  postSyncEvent({ type: 'FEATURE_FLAGS_CHANGED', tenantId, payload: { tenantId, featureKey, enabled } });
  return true;
}

export async function setSyncConfig(
  tenantId: string,
  intervalHours: number,
  manualReplicateEnabled: boolean,
  updatedBy: string
): Promise<boolean> {
  try {
    await api.apiUpdateSyncConfig<SyncConfigRow>(tenantId, {
      auto_sync_interval_hours: intervalHours,
      manual_replicate_enabled: manualReplicateEnabled,
    });
  } catch (err) {
    console.error('[setSyncConfig] API error:', err);
    return false;
  }
  demoSetSyncConfig(tenantId, intervalHours, manualReplicateEnabled, updatedBy);
  syncConfigCache.delete(tenantId);
  notifyFlagChange(tenantId);
  postSyncEvent({ type: 'FEATURE_FLAGS_CHANGED', tenantId, payload: { tenantId, syncIntervalHours: intervalHours } });
  return true;
}

export function clearFeatureFlagCache(): void {
  flagCache = new Map();
  syncConfigCache = new Map();
  moduleDefCache = null;
}

export function startFeatureFlagRealtime(): void {
  // No external realtime — cross-window sync handled by syncChannel BroadcastChannel.
}

export function stopFeatureFlagRealtime(): void {
  // No-op — no external realtime to stop.
}

export function useFeatureFlags(tenantId: string | null | undefined) {
  const [flags, setFlags] = useState<Set<ModuleKey>>(new Set<ModuleKey>());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    let mounted = true;

    const refresh = () => {
      flagCache.delete(tenantId);
      fetchEnabledFeatures(tenantId).then((f) => {
        if (mounted) { setFlags(f); setLoading(false); }
      });
    };

    refresh();

    const unsub = onFeatureFlagsChanged((changedTenantId) => {
      if (changedTenantId === tenantId) refresh();
    });

    return () => { mounted = false; unsub(); };
  }, [tenantId]);

  const isEnabled = useCallback(
    (key: ModuleKey): boolean => flags.has(key),
    [flags]
  );

  return { flags, loading, isEnabled };
}

export function useSyncConfig(tenantId: string | null | undefined) {
  const [config, setConfig] = useState<SyncConfigRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    let mounted = true;

    const refresh = () => {
      syncConfigCache.delete(tenantId);
      fetchSyncConfig(tenantId).then((c) => {
        if (mounted) { setConfig(c); setLoading(false); }
      });
    };

    refresh();

    const unsub = onFeatureFlagsChanged((changedTenantId) => {
      if (changedTenantId === tenantId) refresh();
    });

    return () => { mounted = false; unsub(); };
  }, [tenantId]);

  return { config, loading };
}

export async function fetchModuleDefinitions(): Promise<Map<ModuleKey, ModuleDefinitionRow>> {
  if (moduleDefCache) return moduleDefCache;
  const map = new Map<ModuleKey, ModuleDefinitionRow>();
  const overrides = getDemoModuleDefs();
  MODULE_KEYS.forEach((k, i) => {
    const override = overrides.find((d) => d.feature_key === k);
    map.set(k, {
      id: k,
      feature_key: k,
      display_name: override?.display_name ?? MODULE_LABELS[k].label,
      description: MODULE_LABELS[k].description,
      sort_order: i + 1,
      updated_by: override?.updated_by ?? null,
      updated_at: override?.updated_at ?? new Date().toISOString(),
    });
  });
  moduleDefCache = map;
  return map;
}

export async function setModuleDisplayName(
  featureKey: ModuleKey,
  displayName: string,
  updatedBy: string,
): Promise<boolean> {
  demoSetModuleDef(featureKey, displayName, updatedBy);
  moduleDefCache = null;
  notifyModuleDefChange();
  return true;
}

export function getDisplayName(
  key: ModuleKey,
  defs: Map<ModuleKey, ModuleDefinitionRow> | null,
): string {
  return defs?.get(key)?.display_name ?? MODULE_LABELS[key].label;
}

export function useModuleDefinitions() {
  const [defs, setDefs] = useState<Map<ModuleKey, ModuleDefinitionRow> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      moduleDefCache = null;
      fetchModuleDefinitions().then((m) => {
        if (mounted) { setDefs(m); setLoading(false); }
      });
    };
    refresh();
    const unsub = onModuleDefinitionsChanged(refresh);
    return () => { mounted = false; unsub(); };
  }, []);

  return { defs, loading };
}

export function onModuleDefinitionsChanged(cb: () => void): () => void {
  moduleDefListeners.add(cb);
  return () => { moduleDefListeners.delete(cb); };
}
