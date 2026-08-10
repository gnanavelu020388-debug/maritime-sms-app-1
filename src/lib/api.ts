/**
 * API Client — communicates with the Express backend server.
 *
 * All frontend data operations route through this client. The base URL
 * is determined by the network mode: ONLINE hits Cloud Run, OFFLINE
 * hits the local Docker instance. Write operations performed while
 * offline are queued and flushed back to Cloud Run on reconnection.
 */

import { getApiBase } from './networkContext';

function getToken(): string | null {
  return localStorage.getItem('mpc-auth-token');
}

export { getToken };

export function setToken(token: string): void {
  localStorage.setItem('mpc-auth-token', token);
}

export function clearToken(): void {
  localStorage.removeItem('mpc-auth-token');
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

function getNetworkMode(): 'online' | 'offline' {
  const fn = (window as Record<string, unknown>).__networkMode as (() => 'online' | 'offline') | undefined;
  return fn ? fn() : 'online';
}

function enqueueOfflineAction(path: string, method: string, body: unknown): void {
  const fn = (window as Record<string, unknown>).__networkEnqueueAction as ((a: { path: string; method: string; body: unknown }) => void) | undefined;
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
    // Clearing the token alone leaves the app's auth state stale — the UI
    // still looks logged in while every subsequent call keeps 401ing. Let
    // AuthProvider know so it can drop back to the login screen immediately.
    const onExpired = (window as Record<string, unknown>).__mpcAuthExpired as (() => void) | undefined;
    onExpired?.();
    throw new Error('Your session has expired. Please sign in again.');
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

export async function apiGetProfileVessels(tenantId: string, profileId: string): Promise<string[]> {
  return request<string[]>(`/sms-profiles/${tenantId}/${profileId}/vessels`);
}

export async function apiAssignProfileVessel(tenantId: string, profileId: string, vesselId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/sms-profiles/${tenantId}/${profileId}/vessels/${vesselId}`, { method: 'POST' });
}

export async function apiUnassignProfileVessel(tenantId: string, profileId: string, vesselId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/sms-profiles/${tenantId}/${profileId}/vessels/${vesselId}`, { method: 'DELETE' });
}

// ── Files (GCS) ───────────────────────────────────────────

export async function apiUploadFile(tenantId: string, docId: string, file: File): Promise<{ gcsUri: string; fileName: string; contentType: string; size: number }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('tenantId', tenantId);
  formData.append('docId', docId);
  const token = getToken();
  const res = await fetch(`${API_BASE}/files/upload`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: formData,
  });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

export async function apiGetSignedUrl(filePath: string): Promise<string> {
  const res = await request<{ url: string }>(`/files/signed-url?filePath=${encodeURIComponent(filePath)}`);
  return res.url;
}

// ── Sync Config ───────────────────────────────────────────

export async function apiGetSyncConfig<T>(tenantId: string): Promise<T> {
  return request<T>(`/sync-config/${tenantId}`);
}

export async function apiUpdateSyncConfig<T>(tenantId: string, data: { auto_sync_interval_hours: number; manual_replicate_enabled: boolean }): Promise<T> {
  return request<T>(`/sync-config/${tenantId}`, { method: 'PUT', body: JSON.stringify(data) });
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
