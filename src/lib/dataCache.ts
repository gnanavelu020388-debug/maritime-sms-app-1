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

// ── Targeted single-row cache patches ──────────────────────────────────────
// Every write mutation (create/update/delete) already gets the canonical
// row back from the API in its response. Patching that one row into the
// cache directly — instead of re-fetching all five tenant collections via
// refreshTenantData() — makes the tab that performed the write (and every
// other mounted view sharing this cache) show the new value the instant the
// write resolves, with no second network round trip. The API call itself is
// still the thing that persists the change; this just avoids re-asking the
// server for data we were already just handed.

function upsertById<T extends { id: string }>(list: T[], row: T): T[] {
  const idx = list.findIndex((r) => r.id === row.id);
  return idx === -1 ? [...list, row] : list.map((r, i) => (i === idx ? row : r));
}

export function upsertCachedTenant(tenant: TenantRow): void {
  cache.tenants = upsertById(cache.tenants, tenant);
  notifyListeners();
}

export function patchCachedTenant(tenantId: string, patch: Partial<TenantRow>): void {
  cache.tenants = cache.tenants.map((t) => (t.id === tenantId ? { ...t, ...patch } : t));
  notifyListeners();
}

export function upsertCachedUser(tenantId: string, user: TenantUserRow): void {
  cache.users.set(tenantId, upsertById(cache.users.get(tenantId) ?? [], user));
  notifyListeners();
}

export function patchCachedUser(tenantId: string, userId: string, patch: Partial<TenantUserRow>): void {
  cache.users.set(tenantId, (cache.users.get(tenantId) ?? []).map((u) => (u.id === userId ? { ...u, ...patch } : u)));
  notifyListeners();
}

// Mirrors the server's cascade for a hard user delete (tenant_users row
// removed, crew_assignments.user_id has ON DELETE CASCADE — see
// server/routes/users.js and schema.sql) so the vessel manning view doesn't
// keep showing a deleted crew member as signed on until its next full reload.
export function removeCachedUser(tenantId: string, userId: string): void {
  cache.users.set(tenantId, (cache.users.get(tenantId) ?? []).filter((u) => u.id !== userId));
  cache.assignments.set(tenantId, (cache.assignments.get(tenantId) ?? []).filter((a) => a.user_id !== userId));
  notifyListeners();
}

export function upsertCachedVessel(tenantId: string, vessel: VesselRow): void {
  cache.vessels.set(tenantId, upsertById(cache.vessels.get(tenantId) ?? [], vessel));
  notifyListeners();
}

// Mirrors the server's ON DELETE CASCADE from vessels to crew_assignments.
export function removeCachedVessel(tenantId: string, vesselId: string): void {
  cache.vessels.set(tenantId, (cache.vessels.get(tenantId) ?? []).filter((v) => v.id !== vesselId));
  cache.assignments.set(tenantId, (cache.assignments.get(tenantId) ?? []).filter((a) => a.vessel_id !== vesselId));
  notifyListeners();
}

export function upsertCachedAssignment(tenantId: string, assignment: CrewAssignmentRow): void {
  cache.assignments.set(tenantId, upsertById(cache.assignments.get(tenantId) ?? [], assignment));
  notifyListeners();
}

// Mirrors PUT /users/:tenantId/:userId/deactivate, which signs off this
// user's active assignment(s) server-side before flipping their status —
// the deactivate endpoint only returns {success}, not a row, so there's no
// response to patch from and this has to replay the same rule locally.
export function signOffCachedAssignmentsForUser(tenantId: string, userId: string): void {
  const now = new Date().toISOString();
  cache.assignments.set(tenantId, (cache.assignments.get(tenantId) ?? []).map((a) => (a.user_id === userId && !a.signed_off_at ? { ...a, signed_off_at: now } : a)));
  notifyListeners();
}

// logAudit() (src/lib/audit.ts) posts fire-and-forget to /audit-logs, which
// only returns {success, id} — not a row — so it synthesizes one from the
// payload it already had and prepends it here, keeping the tenant-scoped
// Audit Log tab (CompanyAuditView) live without a network re-fetch.
export function prependCachedAuditLog(tenantId: string, log: AuditLogRow): void {
  cache.auditLogs.set(tenantId, [log, ...(cache.auditLogs.get(tenantId) ?? [])]);
  notifyListeners();
}

export function upsertCachedSmsDoc(tenantId: string, doc: SmsDocRow): void {
  cache.smsDocs.set(tenantId, upsertById(cache.smsDocs.get(tenantId) ?? [], doc));
  notifyListeners();
}

export function removeCachedSmsDocs(tenantId: string, docIds: Iterable<string>): void {
  const idSet = new Set(docIds);
  cache.smsDocs.set(tenantId, (cache.smsDocs.get(tenantId) ?? []).filter((d) => !idSet.has(d.id)));
  notifyListeners();
}
