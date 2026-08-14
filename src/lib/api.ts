/**
 * API Client — communicates with the Express backend server.
 *
 * All frontend data operations route through this client. The base URL
 * is determined by the network mode: ONLINE hits Cloud Run, OFFLINE
 * hits the local Docker instance. Write operations performed while
 * offline are queued and flushed back to Cloud Run on reconnection.
 */

import { getApiBase } from './networkContext';
import { getToken, setToken, clearToken } from './authToken';

export { getToken, setToken, clearToken };

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

function getNetworkMode(): 'online' | 'offline' {
  const fn = (window as unknown as Record<string, unknown>).__networkMode as (() => 'online' | 'offline') | undefined;
  return fn ? fn() : 'online';
}

function enqueueOfflineAction(path: string, method: string, body: unknown): void {
  const fn = (window as unknown as Record<string, unknown>).__networkEnqueueAction as ((a: { path: string; method: string; body: unknown }) => void) | undefined;
  if (fn) fn({ path, method, body });
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const method = (options.method || 'GET').toUpperCase();
  const mode = getNetworkMode();

  // In offline mode, queue writes and throw a gentle error so the UI
  // can show "saved locally" feedback. Reads still hit the local server.
  if (mode === 'offline' && WRITE_METHODS.has(method)) {
    let body: unknown = null;
    if (options.body) {
      try { body = JSON.parse(options.body as string); } catch { body = options.body; }
    }
    enqueueOfflineAction(path, method, body);
    throw new Error('OFFLINE_QUEUED');
  }

  const res = await fetch(`${getApiBase()}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();

    // Only treat 401 as an expired session when the request
    // actually started with an authenticated session.
    if (token) {
      const onExpired = (window as unknown as Record<string, unknown>)
        .__mpcAuthExpired as (() => void) | undefined;

      onExpired?.();
    }

    throw new Error(
      token
        ? 'Your session has expired. Please sign in again.'
        : 'Authentication required.'
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────

export interface AuthLoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    name: string;
    tenant_id?: string;
    rank?: string;
    adminName?: string;
    mustChangePassword?: boolean;
  };
}

export async function apiLogin(email: string, password: string): Promise<AuthLoginResponse> {
  const res = await request<AuthLoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(res.token);
  return res;
}

export async function apiSignup(
  email: string,
  password: string,
  name: string,
  asSuperAdmin: boolean,
): Promise<{ error: string | null; token?: string; user?: AuthLoginResponse['user'] }> {
  try {
    const res = await request<{ token?: string; user?: AuthLoginResponse['user']; error?: string }>(
      '/auth/signup',
      { method: 'POST', body: JSON.stringify({ email, password, name, asSuperAdmin }) },
    );
    if (res.token) {
      setToken(res.token);
      return { error: null, token: res.token, user: res.user };
    }
    return { error: null };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function apiGetMe(): Promise<{ user: AuthLoginResponse['user'] }> {
  return request<{ user: AuthLoginResponse['user'] }>('/auth/me');
}

export async function apiChangePassword(newPassword: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/auth/change-password', {
    method: 'PUT',
    body: JSON.stringify({ newPassword }),
  });
}

// ── Tenants ───────────────────────────────────────────────

export async function apiGetTenants<T>(): Promise<T[]> {
  return request<T[]>('/tenants');
}

export async function apiGetTenant<T>(tenantId: string): Promise<T> {
  return request<T>(`/tenants/${tenantId}`);
}

export async function apiCreateTenant<T>(data: Record<string, unknown>): Promise<T> {
  return request<T>('/tenants', { method: 'POST', body: JSON.stringify(data) });
}

export async function apiUpdateTenant<T>(tenantId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/tenants/${tenantId}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function apiArchiveTenant(tenantId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/tenants/${tenantId}`, { method: 'DELETE' });
}

export async function apiDeleteTenantPermanent(tenantId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/tenants/${tenantId}/permanent`, { method: 'DELETE' });
}

// ── Users ─────────────────────────────────────────────────

export async function apiGetUsers<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/users/${tenantId}`);
}

export async function apiCreateUser<T>(tenantId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/users/${tenantId}`, { method: 'POST', body: JSON.stringify(data) });
}

export async function apiUpdateUser<T>(tenantId: string, userId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/users/${tenantId}/${userId}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function apiDeleteUser(tenantId: string, userId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/users/${tenantId}/${userId}`, { method: 'DELETE' });
}

export async function apiDeactivateUser(tenantId: string, userId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/users/${tenantId}/${userId}/deactivate`, { method: 'PUT' });
}

// ── Vessels ───────────────────────────────────────────────

export async function apiGetVessels<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/vessels/${tenantId}`);
}

export async function apiCreateVessel<T>(tenantId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/vessels/${tenantId}`, { method: 'POST', body: JSON.stringify(data) });
}

export async function apiUpdateVessel<T>(tenantId: string, vesselId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/vessels/${tenantId}/${vesselId}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function apiDeleteVessel(tenantId: string, vesselId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/vessels/${tenantId}/${vesselId}`, { method: 'DELETE' });
}

// ── Assignments ───────────────────────────────────────────

export async function apiGetAssignments<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/assignments/${tenantId}`);
}

export async function apiCreateAssignment<T>(tenantId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/assignments/${tenantId}`, { method: 'POST', body: JSON.stringify(data) });
}

export async function apiSignOffAssignment<T>(tenantId: string, assignmentId: string): Promise<T> {
  return request<T>(`/assignments/${tenantId}/${assignmentId}/signoff`, { method: 'PUT' });
}

// ── SMS Documents ─────────────────────────────────────────

export async function apiGetSmsDocuments<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/sms-documents/${tenantId}`);
}

export async function apiCreateSmsDoc<T>(tenantId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/sms-documents/${tenantId}`, { method: 'POST', body: JSON.stringify(data) });
}

export async function apiUpdateSmsDoc<T>(tenantId: string, docId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/sms-documents/${tenantId}/${docId}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function apiDeleteSmsDoc(tenantId: string, docId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/sms-documents/${tenantId}/${docId}`, { method: 'DELETE' });
}

// ── Audit Logs ────────────────────────────────────────────

export async function apiGetAuditLogs<T>(tenantId?: string): Promise<T[]> {
  if (tenantId) return request<T[]>(`/audit-logs/${tenantId}`);
  return request<T[]>('/audit-logs');
}

export async function apiCreateAuditLog(data: Record<string, unknown>): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/audit-logs', { method: 'POST', body: JSON.stringify(data) });
}

// ── Feature Flags ─────────────────────────────────────────

export async function apiGetFeatureFlags<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/feature-flags/${tenantId}`);
}

export async function apiUpdateFeatureFlag<T>(tenantId: string, featureKey: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/feature-flags/${tenantId}/${featureKey}`, { method: 'PUT', body: JSON.stringify(data) });
}

// ── SMS Profiles ──────────────────────────────────────────

export async function apiGetSmsProfiles<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/sms-profiles/${tenantId}`);
}

export async function apiCreateSmsProfile<T>(tenantId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/sms-profiles/${tenantId}`, { method: 'POST', body: JSON.stringify(data) });
}

export async function apiUpdateSmsProfile<T>(tenantId: string, profileId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/sms-profiles/${tenantId}/${profileId}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function apiDeleteSmsProfile(tenantId: string, profileId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/sms-profiles/${tenantId}/${profileId}`, { method: 'DELETE' });
}

export async function apiGetProfileVessels(tenantId: string, profileId: string): Promise<string[]> {
  return request<string[]>(`/sms-profiles/${tenantId}/${profileId}/vessels`);
}

export async function apiAssignProfileVessel(tenantId: string, profileId: string, vesselId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/sms-profiles/${tenantId}/${profileId}/vessels/${vesselId}`, { method: 'POST' });
}

export async function apiUnassignProfileVessel(tenantId: string, profileId: string, vesselId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/sms-profiles/${tenantId}/${profileId}/vessels/${vesselId}`, { method: 'DELETE' });
}

// ── SMS Doc Tabs ────────────────────────────────────────────

export async function apiGetSmsDocTabs<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/sms-doc-tabs/${tenantId}`);
}

export async function apiCreateSmsDocTab<T>(tenantId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/sms-doc-tabs/${tenantId}`, { method: 'POST', body: JSON.stringify(data) });
}

export async function apiUpdateSmsDocTab<T>(tenantId: string, tabKey: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/sms-doc-tabs/${tenantId}/${tabKey}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function apiDeleteSmsDocTab(tenantId: string, tabKey: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/sms-doc-tabs/${tenantId}/${tabKey}`, { method: 'DELETE' });
}

// ── Files (GCS) ───────────────────────────────────────────

export class ApiFileError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export async function apiUploadFile(tenantId: string, docId: string, file: File): Promise<{ gcsUri: string; fileName: string; contentType: string; size: number }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('tenantId', tenantId);
  formData.append('docId', docId);
  const token = getToken();
  const res = await fetch(`${getApiBase()}/files/upload`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new ApiFileError(body.error || 'Upload failed', body.code);
  }
  return res.json();
}

export async function apiGetSignedUrl(filePath: string): Promise<string> {
  const res = await request<{ url: string }>(`/files/signed-url?filePath=${encodeURIComponent(filePath)}`);
  return res.url;
}

// ── Platform storage (Super Admin) ─────────────────────────

export interface PlatformStorage {
  actualUsageBytes: number;
  poolBytes: number;
  remainingBytes: number;
  percentage: number;
  computedAt: string | null;
}

export async function apiGetPlatformStorage(): Promise<PlatformStorage> {
  return request<PlatformStorage>('/platform/storage');
}

export async function apiSetPlatformStoragePool(poolGb: number): Promise<{ platform_storage_pool_gb: number }> {
  return request<{ platform_storage_pool_gb: number }>('/platform/storage', {
    method: 'PUT',
    body: JSON.stringify({ platform_storage_pool_gb: poolGb }),
  });
}

export interface PlatformHealth {
  cpuPercent: number;
  apiP95Ms: number;
  computedAt: string | null;
}

export async function apiGetPlatformHealth(): Promise<PlatformHealth> {
  return request<PlatformHealth>('/platform/health');
}

// ── Vessel Sync State (unified sync engine) ────────────────

export async function apiGetVesselSyncStates<T>(): Promise<T[]> {
  return request<T[]>('/vessel-sync');
}

export interface PagedResult<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export async function apiGetVesselSyncLog<T>(page: number, pageSize: number, search: string, tenantId?: string): Promise<PagedResult<T>> {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) qs.set('search', search);
  if (tenantId) qs.set('tenantId', tenantId);
  return request<PagedResult<T>>(`/vessel-sync/log?${qs.toString()}`);
}

export async function apiEnqueueSyncEntry(data: {
  tenant_id: string;
  vessel_id: string;
  module_key: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  operation?: 'upsert' | 'delete' | 'batch_upsert';
  priority?: number;
}): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/vessel-sync/outbox', { method: 'POST', body: JSON.stringify(data) });
}

export async function apiCheckInVessel(
  vesselId: string,
  tenantId: string,
  syncMethod: 'manual' | 'automatic' = 'manual',
): Promise<{ synced: number; failed: number }> {
  return request<{ synced: number; failed: number }>(`/vessel-sync/${vesselId}/checkin`, {
    method: 'POST',
    body: JSON.stringify({ tenant_id: tenantId, sync_method: syncMethod }),
  });
}

export async function apiGetVesselSyncStateOne<T>(vesselId: string, tenantId: string): Promise<T | null> {
  return request<T | null>(`/vessel-sync/${vesselId}?tenantId=${encodeURIComponent(tenantId)}`);
}

// ── Sync Config ───────────────────────────────────────────

export async function apiGetSyncConfig<T>(tenantId: string): Promise<T> {
  return request<T>(`/sync-config/${tenantId}`);
}

export async function apiUpdateSyncConfig<T>(tenantId: string, data: { auto_sync_interval_hours: number; manual_replicate_enabled: boolean }): Promise<T> {
  return request<T>(`/sync-config/${tenantId}`, { method: 'PUT', body: JSON.stringify(data) });
}

// ── Tenant Security Settings ────────────────────────────────

export async function apiGetTenantSecuritySettings<T>(tenantId: string): Promise<T> {
  return request<T>(`/tenant-security/${tenantId}`);
}

export async function apiUpdateTenantSecuritySettings<T>(tenantId: string, data: { inactivity_timeout_minutes: number; enforce_single_session: boolean }): Promise<T> {
  return request<T>(`/tenant-security/${tenantId}`, { method: 'PUT', body: JSON.stringify(data) });
}

// ── Rank Permissions ─────────────────────────────────────────

export async function apiGetRankDefs<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/rank-permissions/${tenantId}/defs`);
}

export async function apiCreateRankDef<T>(tenantId: string, data: { rank: string; description: string }): Promise<T> {
  return request<T>(`/rank-permissions/${tenantId}/defs`, { method: 'POST', body: JSON.stringify(data) });
}

export async function apiUpdateRankDef<T>(tenantId: string, rank: string, data: { rank?: string; description?: string }): Promise<T> {
  return request<T>(`/rank-permissions/${tenantId}/defs/${encodeURIComponent(rank)}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function apiDeleteRankDef(tenantId: string, rank: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/rank-permissions/${tenantId}/defs/${encodeURIComponent(rank)}`, { method: 'DELETE' });
}

export async function apiGetRankPermissions<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/rank-permissions/${tenantId}/perms`);
}

export async function apiUpdateRankPermission<T>(tenantId: string, rank: string, apps: Record<string, unknown>): Promise<T> {
  return request<T>(`/rank-permissions/${tenantId}/perms/${encodeURIComponent(rank)}`, { method: 'PUT', body: JSON.stringify({ apps }) });
}

// ── Shore Role Permissions ───────────────────────────────────

export async function apiGetShoreRoleDefs<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/shore-roles/${tenantId}/defs`);
}

export async function apiCreateShoreRoleDef<T>(tenantId: string, data: { role: string; description: string }): Promise<T> {
  return request<T>(`/shore-roles/${tenantId}/defs`, { method: 'POST', body: JSON.stringify(data) });
}

export async function apiUpdateShoreRoleDef<T>(tenantId: string, role: string, data: { role?: string; description?: string }): Promise<T> {
  return request<T>(`/shore-roles/${tenantId}/defs/${encodeURIComponent(role)}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function apiDeleteShoreRoleDef(tenantId: string, role: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/shore-roles/${tenantId}/defs/${encodeURIComponent(role)}`, { method: 'DELETE' });
}

export async function apiGetShoreRolePermissions<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/shore-roles/${tenantId}/perms`);
}

export async function apiUpdateShoreRolePermission<T>(tenantId: string, role: string, actions: Record<string, unknown>): Promise<T> {
  return request<T>(`/shore-roles/${tenantId}/perms/${encodeURIComponent(role)}`, { method: 'PUT', body: JSON.stringify({ actions }) });
}

// ── Sessions ──────────────────────────────────────────────

export async function apiRegisterSession(deviceInfo: string): Promise<string> {
  const res = await request<{ token: string }>('/sessions/register', {
    method: 'POST',
    body: JSON.stringify({ deviceInfo }),
  });
  return res.token;
}

export async function apiClearSession(token: string): Promise<void> {
  try {
    await request<{ success: boolean }>(`/sessions/${token}`, { method: 'DELETE' });
  } catch { /* non-fatal */ }
}

// ── Banner ────────────────────────────────────────────────
// tenant_id null/omitted = platform-wide notice; otherwise scoped to just
// that tenant's users.

export async function apiGetBanner<T>(): Promise<T | null> {
  return request<T | null>('/banner');
}

export async function apiGetAllBanners<T>(): Promise<T[]> {
  return request<T[]>('/banner/all');
}

export async function apiPublishBanner<T>(message: string, severity: string, tenantId: string | null): Promise<T> {
  return request<T>('/banner', { method: 'POST', body: JSON.stringify({ message, severity, tenant_id: tenantId }) });
}

export async function apiClearBanner(tenantId: string | null): Promise<{ success: boolean }> {
  const qs = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  return request<{ success: boolean }>(`/banner${qs}`, { method: 'DELETE' });
}

// ── Invoices ──────────────────────────────────────────────

export async function apiGetInvoices<T>(): Promise<T[]> {
  return request<T[]>('/invoices');
}

export async function apiCreateInvoice<T>(data: Record<string, unknown>): Promise<T> {
  return request<T>('/invoices', { method: 'POST', body: JSON.stringify(data) });
}

// ── Backups ───────────────────────────────────────────────

export async function apiGetBackups<T>(): Promise<T[]> {
  return request<T[]>('/backups');
}

export async function apiCreateBackup<T>(data: Record<string, unknown>): Promise<T> {
  return request<T>('/backups', { method: 'POST', body: JSON.stringify(data) });
}

export async function apiRestoreBackup<T>(id: string): Promise<T> {
  return request<T>(`/backups/${id}/restore`, { method: 'POST' });
}

export async function apiDeleteBackup(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/backups/${id}`, { method: 'DELETE' });
}

// ── Platform Staff ────────────────────────────────────────

export async function apiGetPlatformStaff<T>(): Promise<T[]> {
  return request<T[]>('/platform-staff');
}

export async function apiInvitePlatformStaff<T>(data: Record<string, unknown>): Promise<T> {
  return request<T>('/platform-staff', { method: 'POST', body: JSON.stringify(data) });
}

export async function apiUpdatePlatformStaff<T>(id: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/platform-staff/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function apiTogglePlatformStaffLock<T>(id: string): Promise<T> {
  return request<T>(`/platform-staff/${id}/lock-toggle`, { method: 'PUT' });
}

export async function apiResetPlatformStaffPassword(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/platform-staff/${id}/reset-password`, { method: 'PUT' });
}

export async function apiDeletePlatformStaff(id: string, mode: 'soft' | 'hard'): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/platform-staff/${id}?mode=${mode}`, { method: 'DELETE' });
}

// ── Error Logs ────────────────────────────────────────────

export async function apiGetErrorLogs<T>(): Promise<T[]> {
  return request<T[]>('/error-logs');
}

// ── SMS Master Template (parallel system — see server/routes/smsTemplates.js) ──

export async function apiGetMasterSmsTree<T>(treeKind: string): Promise<T[]> {
  return request<T[]>(`/sms-templates/master/${treeKind}`);
}

export async function apiAddMasterSmsNode<T>(treeKind: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/sms-templates/master/${treeKind}`, { method: 'POST', body: JSON.stringify(data) });
}

export async function apiUpdateMasterSmsNode<T>(treeKind: string, nodeId: string, data: Record<string, unknown>): Promise<T> {
  return request<T>(`/sms-templates/master/${treeKind}/${nodeId}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function apiDeleteMasterSmsNode(treeKind: string, nodeId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/sms-templates/master/${treeKind}/${nodeId}`, { method: 'DELETE' });
}

export async function apiPushMasterSms<T>(version: string, targetTenantIds: string[]): Promise<T> {
  return request<T>('/sms-templates/push', { method: 'POST', body: JSON.stringify({ version, targetTenantIds }) });
}

export async function apiGetSmsSnapshots<T>(tenantId: string): Promise<T[]> {
  return request<T[]>(`/sms-templates/snapshots/${tenantId}`);
}

export async function apiCreateSmsSnapshot<T>(tenantId: string, label: string, treeData: unknown): Promise<T> {
  return request<T>(`/sms-templates/snapshots/${tenantId}`, { method: 'POST', body: JSON.stringify({ label, treeData }) });
}

export async function apiRollbackSmsSnapshot<T>(tenantId: string, snapshotId: string): Promise<T> {
  return request<T>(`/sms-templates/snapshots/${tenantId}/${snapshotId}/rollback`, { method: 'POST' });
}
