/**
 * Data Cache Layer — bridges the synchronous demo data getters with the
 * async API backend.
 *
 * On app startup, `initializeDataCache()` fetches all data from the backend
 * and populates an in-memory cache. The existing synchronous getters in
 * demoData.ts (getEffectiveDemoUsers, getEffectiveDemoVessels, etc.) read
 * from this cache instead of the hardcoded arrays + localStorage overrides.
 *
 * Mutation functions (demoCreateUser, demoDeleteVessel, etc.) now write to
 * the API and update the cache, so changes persist to Cloud SQL.
 */

import type { TenantRow, TenantUserRow, VesselRow, CrewAssignmentRow, SmsDocRow, AuditLogRow } from './supabase';
import * as api from './api';

interface DataCache {
  tenants: TenantRow[];
  users: Map<string, TenantUserRow[]>;
  vessels: Map<string, VesselRow[]>;
  assignments: Map<string, CrewAssignmentRow[]>;
  smsDocs: Map<string, SmsDocRow[]>;
  auditLogs: Map<string, AuditLogRow[]>;
  initialized: boolean;
}

const cache: DataCache = {
  tenants: [],
  users: new Map(),
  vessels: new Map(),
  assignments: new Map(),
  smsDocs: new Map(),
  auditLogs: new Map(),
  initialized: false,
};

const cacheListeners = new Set<() => void>();
export function subscribeToCacheUpdates(fn: () => void): () => void {
  cacheListeners.add(fn);
  return () => cacheListeners.delete(fn);
}

function notifyListeners() {
  cacheListeners.forEach((fn) => fn());
}

export function isCacheInitialized(): boolean {
  return cache.initialized;
}

/** Load all data from the backend API into the in-memory cache. */
export async function initializeDataCache(): Promise<void> {
  try {
    cache.tenants = await api.apiGetTenants<TenantRow>();
    for (const t of cache.tenants) {
      const [users, vessels, assignments, smsDocs, auditLogs] = await Promise.all([
        api.apiGetUsers<TenantUserRow>(t.id).catch(() => []),
        api.apiGetVessels<VesselRow>(t.id).catch(() => []),
        api.apiGetAssignments<CrewAssignmentRow>(t.id).catch(() => []),
        api.apiGetSmsDocuments<SmsDocRow>(t.id).catch(() => []),
        api.apiGetAuditLogs<AuditLogRow>(t.id).catch(() => []),
      ]);
      cache.users.set(t.id, users);
      cache.vessels.set(t.id, vessels);
      cache.assignments.set(t.id, assignments);
      cache.smsDocs.set(t.id, smsDocs);
      cache.auditLogs.set(t.id, auditLogs);
    }
    cache.initialized = true;
    notifyListeners();
  } catch (err) {
    console.error('[DataCache] Initialization failed:', err);
    cache.initialized = true;
    notifyListeners();
  }
}

/** Reload a single tenant's data from the API. */
export async function refreshTenantData(tenantId: string): Promise<void> {
  const [users, vessels, assignments, smsDocs, auditLogs] = await Promise.all([
    api.apiGetUsers<TenantUserRow>(tenantId).catch(() => []),
    api.apiGetVessels<VesselRow>(tenantId).catch(() => []),
    api.apiGetAssignments<CrewAssignmentRow>(tenantId).catch(() => []),
    api.apiGetSmsDocuments<SmsDocRow>(tenantId).catch(() => []),
    api.apiGetAuditLogs<AuditLogRow>(tenantId).catch(() => []),
  ]);
  cache.users.set(tenantId, users);
  cache.vessels.set(tenantId, vessels);
  cache.assignments.set(tenantId, assignments);
  cache.smsDocs.set(tenantId, smsDocs);
  cache.auditLogs.set(tenantId, auditLogs);
  notifyListeners();
}

/** Reload all tenants (for super admin view). */
export async function refreshAllTenants(): Promise<void> {
  cache.tenants = await api.apiGetTenants<TenantRow>();
  notifyListeners();
}

// ── Cache getters (synchronous, used by the existing getters in demoData.ts) ──

export function getCachedTenants(): TenantRow[] {
  return cache.tenants;
}

export function getCachedUsers(tenantId: string): TenantUserRow[] {
  return cache.users.get(tenantId) ?? [];
}

export function getCachedVessels(tenantId: string): VesselRow[] {
  return cache.vessels.get(tenantId) ?? [];
}

export function getCachedAssignments(tenantId: string): CrewAssignmentRow[] {
  return cache.assignments.get(tenantId) ?? [];
}

export function getCachedSmsDocs(tenantId: string): SmsDocRow[] {
  return cache.smsDocs.get(tenantId) ?? [];
}

export function getCachedAuditLogs(tenantId: string): AuditLogRow[] {
  return cache.auditLogs.get(tenantId) ?? [];
}

// ── Cache mutators (called after API writes succeed) ──

export function setCachedTenants(tenants: TenantRow[]): void {
  cache.tenants = tenants;
  notifyListeners();
}

export function setCachedUsers(tenantId: string, users: TenantUserRow[]): void {
  cache.users.set(tenantId, users);
  notifyListeners();
}

export function setCachedVessels(tenantId: string, vessels: VesselRow[]): void {
  cache.vessels.set(tenantId, vessels);
  notifyListeners();
}

export function setCachedAssignments(tenantId: string, assignments: CrewAssignmentRow[]): void {
  cache.assignments.set(tenantId, assignments);
  notifyListeners();
}

export function setCachedSmsDocs(tenantId: string, docs: SmsDocRow[]): void {
  cache.smsDocs.set(tenantId, docs);
  notifyListeners();
}

export function setCachedAuditLogs(tenantId: string, logs: AuditLogRow[]): void {
  cache.auditLogs.set(tenantId, logs);
  notifyListeners();
}
