import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User, PlatformRole, InternalRole, TenantRow, TenantUserRow, ActiveAssignment } from './supabase';
import { clearFeatureFlagCache } from './featureFlags';
import { registerSessionToken, clearSessionToken } from './sessionSecurity';
import { DEFAULT_RANK_PERMISSIONS, type RankPermissionMap } from './rankPermissions';
import { DEMO_TENANTS, getDemoTenant, getEffectiveDemoUsers, getEffectiveDemoAssignments, getEffectiveDemoVessels } from './demoData';
import * as api from './api';
import { initializeDataCache, isCacheInitialized } from './dataCache';

export type { Session, User } from './supabase';

export interface AuthState {
  user: User | null;
  session: Session | null;
  role: PlatformRole | null;
  internalRole: InternalRole | null;
  adminName: string | null;
  tenant: TenantRow | null;
  tenantUser: TenantUserRow | null;
  activeAssignment: ActiveAssignment | null;
  loading: boolean;
  error: string | null;
  sessionToken: string | null;
  sessionConflict: boolean;
  rankPermissions: RankPermissionMap | null;
}

export interface AuthContextValue extends AuthState {
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, name: string, asSuperAdmin: boolean) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  sessionToken: string | null;
  sessionConflict: boolean;
  dismissSessionConflict: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

let demoGetter: (() => AuthContextValue | null) | null = null;

export function _registerDemoAuthGetter(getter: () => AuthContextValue | null) {
  demoGetter = getter;
}

const LS_AUTH_SESSION = 'mpc-local-auth-session';

interface LocalAuthSession {
  email: string;
  uid: string;
}

function loadStoredSession(): LocalAuthSession | null {
  try {
    const raw = localStorage.getItem(LS_AUTH_SESSION);
    if (raw) return JSON.parse(raw) as LocalAuthSession;
  } catch { /* ignore */ }
  return null;
}

function storeSession(s: LocalAuthSession | null): void {
  if (s) {
    localStorage.setItem(LS_AUTH_SESSION, JSON.stringify(s));
  } else {
    localStorage.removeItem(LS_AUTH_SESSION);
  }
}

function buildUser(uid: string, email: string): User {
  return {
    id: uid,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: '2025-01-01T00:00:00Z',
  };
}

function buildSession(user: User): Session {
  return {
    access_token: `local-${user.id}-${Date.now()}`,
    refresh_token: `local-refresh-${user.id}`,
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  };
}

function resolveRoleAndTenant(uid: string, email: string): Pick<AuthState, 'role' | 'tenant' | 'tenantUser' | 'activeAssignment' | 'internalRole' | 'adminName' | 'rankPermissions'> {
  // Super admin
  if (email === 'admin@maritime-platform.io' || uid === 'local-sa') {
    return {
      role: 'super_admin',
      internalRole: 'super_admin',
      adminName: 'Platform Admin',
      tenant: null,
      tenantUser: null,
      activeAssignment: null,
      rankPermissions: null,
    };
  }

  // Search all demo users across all tenants
  const allUsers: TenantUserRow[] = [];
  for (const t of DEMO_TENANTS) {
    allUsers.push(...getEffectiveDemoUsers(t.id));
  }

  const tenantUser = allUsers.find((u) => u.email === email);
  if (!tenantUser) {
    return { role: null, internalRole: null, adminName: null, tenant: null, tenantUser: null, activeAssignment: null, rankPermissions: null };
  }

  const tenant = getDemoTenant(tenantUser.tenant_id);

  if (tenant.status === 'archived') {
    return { role: null, internalRole: null, adminName: null, tenant: null, tenantUser: null, activeAssignment: null, rankPermissions: null };
  }

  // For vessel-role users, resolve active crew assignment
  let activeAssignment: ActiveAssignment | null = null;
  if (tenantUser.role === 'vessel') {
    const assignments = getEffectiveDemoAssignments(tenantUser.tenant_id);
    const active = assignments.find(
      (a) => a.user_id === tenantUser.id && !a.signed_off_at,
    );
    if (active) {
      const vessel = getEffectiveDemoVessels(tenantUser.tenant_id).find((v) => v.id === active.vessel_id);
      if (vessel) {
        activeAssignment = {
          assignment_id: active.id,
          vessel_id: vessel.id,
          vessel_name: vessel.name,
          tenant_id: vessel.tenant_id,
          user_id: tenantUser.id,
          rank: tenantUser.rank,
          signed_on_at: active.signed_on_at,
        };
      }
    }
  }

  const rankPermissions = DEFAULT_RANK_PERMISSIONS[tenantUser.rank] ?? null;
  const adminName = tenantUser.rank === 'DPA' ? `${tenantUser.name} (DPA)` : tenantUser.name;

  return {
    role: tenantUser.role,
    internalRole: null,
    adminName,
    tenant,
    tenantUser,
    activeAssignment,
    rankPermissions,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    role: null,
    internalRole: null,
    adminName: null,
    tenant: null,
    tenantUser: null,
    activeAssignment: null,
    loading: true,
    error: null,
    sessionToken: null,
    sessionConflict: false,
    rankPermissions: null,
  });

  async function registerNewSessionToken(uid: string): Promise<string | null> {
    let deviceInfo = 'Unknown browser';
    if (typeof navigator !== 'undefined') {
      deviceInfo = navigator.userAgent.slice(0, 200);
    }
    return registerSessionToken(uid, deviceInfo);
  }

  async function refresh() {
    const stored = loadStoredSession();
    if (!stored) {
      setState({ user: null, session: null, role: null, internalRole: null, adminName: null, tenant: null, tenantUser: null, activeAssignment: null, loading: false, error: null, rankPermissions: null });
      return;
    }
    const resolved = resolveRoleAndTenant(stored.uid, stored.email);
    const user = buildUser(stored.uid, stored.email);
    const session = buildSession(user);
    const token = await registerNewSessionToken(stored.uid);
    setState({ user, session, ...resolved, loading: false, error: null, sessionToken: token, sessionConflict: false });
  }

  useEffect(() => {
    let mounted = true;
    const stored = loadStoredSession();
    if (!stored) {
      // No stored session — still initialize the data cache so demo data is available
      initializeDataCache().then(() => {
        if (mounted) {
          setState({ user: null, session: null, role: null, internalRole: null, adminName: null, tenant: null, tenantUser: null, activeAssignment: null, loading: false, error: null, rankPermissions: null });
        }
      });
      return () => { mounted = false; };
    }
    // Initialize data cache from backend, then resolve session
    initializeDataCache().then(async () => {
      if (!mounted) return;
      const resolved = resolveRoleAndTenant(stored.uid, stored.email);
      const user = buildUser(stored.uid, stored.email);
      const session = buildSession(user);
      const token = await registerNewSessionToken(stored.uid);
      if (mounted) {
        setState({ user, session, ...resolved, loading: false, error: null, sessionToken: token, sessionConflict: false });
      }
    });
    return () => { mounted = false; };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const result = await api.apiLogin(email, password);
      const { user: apiUser, token } = result;
      const uid = apiUser.id;
      storeSession({ email, uid });

      // Initialize cache if not yet done
      if (!isCacheReady()) {
        await initializeDataCache();
      }

      const resolved = resolveRoleAndTenant(uid, email);
      const user = buildUser(uid, email);
      const session = buildSession(user);
      session.access_token = token;
      const sessionToken = await registerNewSessionToken(uid);
      setState({ user, session, ...resolved, loading: false, error: null, sessionToken, sessionConflict: false });
      return { error: null };
    } catch (err) {
      return { error: (err as Error).message || 'Invalid email or password.' };
    }
  };

  const signUp = async (email: string, password: string, name: string, asSuperAdmin: boolean) => {
    if (password.length < 6) return { error: 'Password must be at least 6 characters.' };

    const result = await api.apiSignup(email, password, name, asSuperAdmin);
    if (result.error) return { error: result.error };

    if (asSuperAdmin && result.token && result.user) {
      const uid = result.user.id;
      storeSession({ email, uid });
      if (!isCacheReady()) {
        await initializeDataCache();
      }
      const resolved = resolveRoleAndTenant(uid, email);
      const user = buildUser(uid, email);
      const session = buildSession(user);
      session.access_token = result.token;
      const sessionToken = await registerNewSessionToken(uid);
      setState({ user, session, ...resolved, loading: false, error: null, sessionToken, sessionConflict: false });
    }

    return { error: null };
  };

  const signOut = async () => {
    clearFeatureFlagCache();
    if (state.user) {
      await clearSessionToken(state.user.id);
    }
    api.clearToken();
    storeSession(null);
    setState({ user: null, session: null, role: null, internalRole: null, adminName: null, tenant: null, tenantUser: null, activeAssignment: null, loading: false, error: null, sessionToken: null, sessionConflict: false, rankPermissions: null });
  };

  const dismissSessionConflict = () => {
    setState((s) => ({ ...s, sessionConflict: false }));
  };

  return (
    <AuthContext.Provider value={{ ...state, signIn, signUp, signOut, refresh, dismissSessionConflict }}>
      {children}
    </AuthContext.Provider>
  );
}

function isCacheReady(): boolean {
  return isCacheInitialized();
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx) return ctx;
  if (demoGetter) {
    const demo = demoGetter();
    if (demo) return demo;
  }
  throw new Error('useAuth must be used within AuthProvider');
}
