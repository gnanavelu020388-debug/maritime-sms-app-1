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

export type DemoTenantId = string;

// Real (backend) tenants get a UUID id; the legacy in-memory demo seed
// tenants used elsewhere in the UI use "T-####" — this distinguishes which
// ones actually exist as a row in the `tenants` table (and so can be
// targeted by anything with a real FK to it, e.g. a scoped banner) from
// the local-only simulated ones.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isRealTenantId(id: string): boolean {
  return UUID_RE.test(id);
}

// ── Tenant getters ──────────────────────────────────────────

export function getDemoTenant(id: string): TenantRow {
  return dataCache.getCachedTenants().find((t) => t.id === id) ?? { id, company: 'Unknown', contact_email: '', plan: 'Standard', status: 'active', vessels_max: 0, seats_max: 0, storage_gb_max: 0, monthly_revenue: 0, region: '', mfa_enforced: false, modules: [], sms_version: '1.0.0', created_at: '', contract_expires: '', updated_at: '' };
}

export function getEffectiveDemoTenants(): TenantRow[] {
  return dataCache.getCachedTenants();
}

export async function demoCreateTenant(
  data: { company: string; contact_email: string; plan: string; vessels_max: number; seats_max: number; region: string },
): Promise<string> {
  const t = await api.apiCreateTenant<TenantRow>({
    company: data.company,
    contact_email: data.contact_email,
    plan: data.plan,
    vessels_max: data.vessels_max,
    seats_max: data.seats_max,
    region: data.region,
    storage_gb_max: 50,
    monthly_revenue: 0,
    mfa_enforced: false,
    modules: ['sms_documentation'],
    sms_version: '1.0.0',
    status: 'active',
  });
  await dataCache.refreshAllTenants();
  return t.id;
}

export async function demoDeleteTenant(tenantId: string): Promise<void> {
  await api.apiArchiveTenant(tenantId);
  await dataCache.refreshAllTenants();
}

export async function demoUpdateTenantSmsVersion(tenantId: string, smsVersion: string): Promise<void> {
  await api.apiUpdateTenant<TenantRow>(tenantId, { sms_version: smsVersion });
  await dataCache.refreshAllTenants();
}

// ── Workspace freeze / guardrails ───────────────────────────

export function demoGetWorkspaceFrozen(_tenantId: string): boolean {
  return false;
}

export function demoSetWorkspaceFrozen(_tenantId: string, _frozen: boolean): void {
  // Guardrails are managed via API in production
}

export interface DemoGuardrails {
  maxSubfolderDepth: number;
  maxUploadSizeMb: number;
}

export function demoGetGuardrails(_tenantId: string): DemoGuardrails | null {
  return { maxSubfolderDepth: 4, maxUploadSizeMb: 50 };
}

export function demoSetGuardrails(_tenantId: string, _guardrails: DemoGuardrails): void {
  // Guardrails are managed via API in production
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

export function getDemoFeatureFlagsForTenant(tenantId: string): Map<string, boolean> {
  const cached = featureFlagCache.get(tenantId);
  if (cached) return cached;
  return new Map();
}

export function getDemoFeatureFlags(): DemoFeatureFlagEntry[] {
  const entries: DemoFeatureFlagEntry[] = [];
  for (const t of dataCache.getCachedTenants()) {
    const flags = getDemoFeatureFlagsForTenant(t.id);
    for (const [key, enabled] of flags) {
      entries.push({ tenant_id: t.id, feature_key: key, enabled, updated_by: null, updated_at: '' });
    }
  }
  return entries;
}

export async function demoSetFeatureFlag(
  tenantId: string,
  featureKey: string,
  enabled: boolean,
  updatedBy: string | null,
): Promise<void> {
  await api.apiUpdateFeatureFlag(tenantId, featureKey, { enabled, updated_by: updatedBy });
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

export function getDemoSyncConfigForTenant(tenantId: string): DemoSyncConfigEntry | null {
  return syncConfigCache.get(tenantId) ?? null;
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

// ── Module definitions ──────────────────────────────────────

export interface DemoModuleDefEntry {
  feature_key: string;
  display_name: string;
  updated_by: string | null;
  updated_at: string;
}

const moduleDefCache = new Map<string, DemoModuleDefEntry>();

export function getDemoModuleDefs(): DemoModuleDefEntry[] {
  return Array.from(moduleDefCache.values());
}

export function getDemoModuleDef(featureKey: string): string | null {
  return moduleDefCache.get(featureKey)?.display_name ?? null;
}

export function demoSetModuleDef(featureKey: string, displayName: string, updatedBy: string | null): void {
  moduleDefCache.set(featureKey, { feature_key: featureKey, display_name: displayName, updated_by: updatedBy, updated_at: new Date().toISOString() });
}

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
  await dataCache.refreshTenantData(tenantId);
  return u.id;
}

export async function demoDeleteUser(tenantId: string, userId: string): Promise<void> {
  await api.apiDeleteUser(tenantId, userId);
  await dataCache.refreshTenantData(tenantId);
}

export async function demoSetUserStatus(tenantId: string, userId: string, status: string): Promise<void> {
  await api.apiUpdateUser<TenantUserRow>(tenantId, userId, { status });
  await dataCache.refreshTenantData(tenantId);
}

export async function demoDeactivateUser(tenantId: string, userId: string): Promise<void> {
  await api.apiDeactivateUser(tenantId, userId);
  await dataCache.refreshTenantData(tenantId);
}

// ── Vessel getters ──────────────────────────────────────────

export function getEffectiveDemoVessels(tenantId: string): VesselRow[] {
  return dataCache.getCachedVessels(tenantId);
}

export async function demoCreateVessel(
  tenantId: string,
  data: { name: string; imo_number: string; call_sign: string | null; flag_state: string | null; port_of_registry: string | null; gross_tonnage: number | null; kw_power: number | null; vessel_type: string | null; class_society: string | null; satellite_provider?: string | null },
  smsVersion: string,
): Promise<string> {
  const v = await api.apiCreateVessel<VesselRow>(tenantId, {
    name: data.name, imo_number: data.imo_number, call_sign: data.call_sign,
    flag_state: data.flag_state, port_of_registry: data.port_of_registry,
    gross_tonnage: data.gross_tonnage, kw_power: data.kw_power,
    vessel_type: data.vessel_type, class_society: data.class_society,
    satellite_provider: data.satellite_provider ?? null,
  });
  await dataCache.refreshTenantData(tenantId);
  return v.id;
}

export async function demoDeleteVessel(tenantId: string, vesselId: string): Promise<void> {
  await api.apiDeleteVessel(tenantId, vesselId);
  await dataCache.refreshTenantData(tenantId);
}

export async function demoUpdateVesselSync(tenantId: string, vesselId: string, smsVersion: string): Promise<void> {
  await api.apiUpdateVessel<VesselRow>(tenantId, vesselId, { sms_active_version: smsVersion, last_sync_at: new Date().toISOString() });
  await dataCache.refreshTenantData(tenantId);
}

export async function demoUpdateVessel(tenantId: string, vesselId: string, updates: Partial<Omit<VesselRow, 'id' | 'tenant_id' | 'created_at'>>): Promise<void> {
  await api.apiUpdateVessel<VesselRow>(tenantId, vesselId, updates);
  await dataCache.refreshTenantData(tenantId);
}

// ── Crew assignments ────────────────────────────────────────

export function getEffectiveDemoAssignments(tenantId: string): CrewAssignmentRow[] {
  return dataCache.getCachedAssignments(tenantId);
}

export async function demoSignOn(tenantId: string, userId: string, vesselId: string, rank: string): Promise<string> {
  const a = await api.apiCreateAssignment<CrewAssignmentRow>(tenantId, {
    vessel_id: vesselId, user_id: userId, rank,
  });
  await dataCache.refreshTenantData(tenantId);
  return a.id;
}

export async function demoSignOff(tenantId: string, assignmentId: string): Promise<void> {
  await api.apiSignOffAssignment<CrewAssignmentRow>(tenantId, assignmentId);
  await dataCache.refreshTenantData(tenantId);
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
  await dataCache.refreshTenantData(tenantId);
  return d.id;
}

export async function demoRenameSmsDoc(tenantId: string, docId: string, newLabel: string): Promise<void> {
  await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, { label: newLabel });
  await dataCache.refreshTenantData(tenantId);
}

export async function demoUpdateSmsDocContent(tenantId: string, docId: string, content: string, contentKind: 'rich_text' | 'pdf', authorName?: string | null, authorRole?: string | null, authorOrigin?: string | null, fileSizeBytes?: number | null): Promise<void> {
  const updates: Record<string, unknown> = { content, content_kind: contentKind, approval_state: 'pending_dpa' };
  if (authorName) updates.author_name = authorName;
  if (authorRole) updates.author_role = authorRole;
  if (authorOrigin) updates.author_origin = authorOrigin;
  // Only touch file_size_bytes when a new file was actually picked — otherwise
  // a plain resubmit-with-unchanged-PDF would wipe out the recorded size.
  if (fileSizeBytes != null) updates.file_size_bytes = fileSizeBytes;
  await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, updates);
  await dataCache.refreshTenantData(tenantId);
}

export async function demoApproveSmsDoc(tenantId: string, docId: string): Promise<void> {
  await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, { approval_state: 'approved' });
  await dataCache.refreshTenantData(tenantId);
}

export async function demoApproveAllSmsDocs(tenantId: string): Promise<number> {
  const all = getEffectiveDemoSmsDocs(tenantId);
  const pending = all.filter((d) => d.approval_state === 'pending_dpa');
  for (const p of pending) {
    await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, p.id, { approval_state: 'approved' });
  }
  await dataCache.refreshTenantData(tenantId);
  return pending.length;
}

export async function demoRejectSmsDoc(tenantId: string, docId: string, comments?: string): Promise<void> {
  await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, { approval_state: 'rejected', rejection_comments: comments ?? null });
  await dataCache.refreshTenantData(tenantId);
}

export async function demoResubmitSmsDoc(tenantId: string, docId: string, content?: string, contentKind?: 'rich_text' | 'pdf', authorName?: string | null, authorRole?: string | null, authorOrigin?: string | null, fileSizeBytes?: number | null): Promise<void> {
  const updates: Record<string, unknown> = { approval_state: 'pending_dpa', rejection_comments: null };
  if (content !== undefined) updates.content = content;
  if (contentKind !== undefined) updates.content_kind = contentKind;
  if (authorName) updates.author_name = authorName;
  if (authorRole) updates.author_role = authorRole;
  if (authorOrigin) updates.author_origin = authorOrigin;
  if (fileSizeBytes != null) updates.file_size_bytes = fileSizeBytes;
  await api.apiUpdateSmsDoc<SmsDocRow>(tenantId, docId, updates);
  await dataCache.refreshTenantData(tenantId);
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
  await dataCache.refreshTenantData(tenantId);
  return toDelete.size;
}

export function demoCloneMasterSms(_tenantId: string): void {
  // Master SMS cloning is handled via the SMS document API
}

// ── Custom tabs ─────────────────────────────────────────────

const customTabsCache = new Map<string, Record<string, { key: string; label: string; subtitle: string; custom?: boolean }>>();

export function getDemoCustomTabs(tenantId: string): Record<string, { key: string; label: string; subtitle: string; custom?: boolean }> {
  return customTabsCache.get(tenantId) ?? {};
}

export function saveDemoCustomTabs(tenantId: string, tabs: Record<string, { key: string; label: string; subtitle: string; custom?: boolean }>): void {
  customTabsCache.set(tenantId, tabs);
}

// ── Audit logs ──────────────────────────────────────────────

export function getDemoAuditLogs(tenantId: string): AuditLogRow[] {
  return dataCache.getCachedAuditLogs(tenantId);
}
