import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  Session,
  User,
  PlatformRole,
  InternalRole,
  TenantRow,
  TenantUserRow,
  ActiveAssignment,
} from "./supabase";
import { clearFeatureFlagCache } from "./featureFlags";
import { registerSessionToken, clearSessionToken } from "./sessionSecurity";
import {
  DEFAULT_RANK_PERMISSIONS,
  type RankPermissionMap,
} from "./rankPermissions";
import {
  getEffectiveDemoUsers,
  getEffectiveDemoAssignments,
  getEffectiveDemoVessels,
  getDemoTenant,
  getEffectiveDemoTenants,
} from "./demoData";
import * as api from "./api";
import { initializeDataCache, isCacheInitialized } from "./dataCache";

export type { Session, User } from "./supabase";

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
  mustChangePassword: boolean;
}

export interface AuthContextValue extends AuthState {
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string,
    name: string,
    asSuperAdmin: boolean,
  ) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  dismissSessionConflict: () => void;
  clearMustChangePassword: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function buildUser(uid: string, email: string): User {
  return {
    id: uid,
    aud: "authenticated",
    role: "authenticated",
    email,
    app_metadata: {},
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
  };
}

function buildSession(user: User, token: string): Session {
  return {
    access_token: token,
    refresh_token: "",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user,
  };
}

function resolveRoleAndTenant(
  uid: string,
  email: string,
): Pick<
  AuthState,
  | "role"
  | "tenant"
  | "tenantUser"
  | "activeAssignment"
  | "internalRole"
  | "adminName"
  | "rankPermissions"
> {
  // Super admin
  if (email === "admin@maritime-platform.io" || uid === "local-sa") {
    return {
      role: "super_admin",
      internalRole: "super_admin",
      adminName: "Platform Admin",
      tenant: null,
      tenantUser: null,
      activeAssignment: null,
      rankPermissions: null,
    };
  }

  // Search all tenant users
  const allUsers: TenantUserRow[] = [];
  for (const t of getEffectiveDemoTenants()) {
    allUsers.push(...getEffectiveDemoUsers(t.id));
  }

  const tenantUser = allUsers.find((u) => u.email === email);
  if (!tenantUser) {
    return {
      role: null,
      internalRole: null,
      adminName: null,
      tenant: null,
      tenantUser: null,
      activeAssignment: null,
      rankPermissions: null,
    };
  }

  const tenant = getDemoTenant(tenantUser.tenant_id);
  if (tenant.status === "archived") {
    return {
      role: null,
      internalRole: null,
      adminName: null,
      tenant: null,
      tenantUser: null,
      activeAssignment: null,
      rankPermissions: null,
    };
  }

  let activeAssignment: ActiveAssignment | null = null;
  if (tenantUser.role === "vessel") {
    const assignments = getEffectiveDemoAssignments(tenantUser.tenant_id);
    const active = assignments.find(
      (a) => a.user_id === tenantUser.id && !a.signed_off_at,
    );
    if (active) {
      const vessel = getEffectiveDemoVessels(tenantUser.tenant_id).find(
        (v) => v.id === active.vessel_id,
      );
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
  const adminName =
    tenantUser.rank === "DPA" ? `${tenantUser.name} (DPA)` : tenantUser.name;

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

async function resolveFromApi(userObj: {
  id: string;
  email: string;
  role?: string;
  tenant_id?: string;
  rank?: string;
  name?: string;
}): Promise<
  Pick<
    AuthState,
    | "role"
    | "tenant"
    | "tenantUser"
    | "activeAssignment"
    | "internalRole"
    | "adminName"
    | "rankPermissions"
  >
> {
  // If server provided a role, prefer that and fetch tenant data when available
  try {
    if (userObj.role === "super_admin") {
      return {
        role: "super_admin",
        internalRole: "super_admin",
        adminName: "Platform Admin",
        tenant: null,
        tenantUser: null,
        activeAssignment: null,
        rankPermissions: null,
      };
    }
    if (userObj.tenant_id) {
      try {
        const tenant = await api.apiGetTenant(userObj.tenant_id);
        const tenantUser = userObj
          ? ({
              id: userObj.id,
              tenant_id: userObj.tenant_id,
              name: userObj.name || "",
              email: userObj.email,
              rank: userObj.rank || "Crew",
              role: (userObj.role as any) || "vessel",
            } as any)
          : null;
        let activeAssignment = null;
        if (tenantUser && tenantUser.role === "vessel") {
          // attempt to locate an active assignment from demo fallback (best-effort)
          const assignments = getEffectiveDemoAssignments(tenantUser.tenant_id);
          const active = assignments.find(
            (a) => a.user_id === tenantUser.id && !a.signed_off_at,
          );
          if (active) {
            const vessel = getEffectiveDemoVessels(tenantUser.tenant_id).find(
              (v) => v.id === active.vessel_id,
            );
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
        const rankPermissions =
          (tenantUser && (DEFAULT_RANK_PERMISSIONS as any)[tenantUser.rank]) ??
          null;
        const adminName =
          tenantUser && tenantUser.rank === "DPA"
            ? `${tenantUser.name} (DPA)`
            : (tenantUser?.name ?? null);
        return {
          role: tenantUser?.role ?? null,
          internalRole: null,
          adminName,
          tenant: tenant as any,
          tenantUser: tenantUser as any,
          activeAssignment,
          rankPermissions,
        };
      } catch {
        // fall through to demo resolution
      }
    }
  } catch {
    // ignore and fall back
  }
  return {
    role: null,
    internalRole: null,
    adminName: null,
    tenant: null,
    tenantUser: null,
    activeAssignment: null,
    rankPermissions: null,
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
    mustChangePassword: false,
  });

  // Registered so api.ts's request() can drop the app back to the login
  // screen immediately when any call comes back 401, instead of leaving the
  // UI looking logged-in while every subsequent action silently fails.
  useEffect(() => {
    const handleAuthExpired = () => {
      clearFeatureFlagCache();
      setState({
        user: null,
        session: null,
        role: null,
        internalRole: null,
        adminName: null,
        tenant: null,
        tenantUser: null,
        activeAssignment: null,
        loading: false,
        error: "Your session has expired. Please sign in again.",
        sessionToken: null,
        sessionConflict: false,
        rankPermissions: null,
        mustChangePassword: false,
      });
    };
    (window as Record<string, unknown>).__mpcAuthExpired = handleAuthExpired;
    return () => {
      delete (window as Record<string, unknown>).__mpcAuthExpired;
    };
  }, []);

  async function registerNewSessionToken(uid: string): Promise<string | null> {
    let deviceInfo = "Unknown browser";
    if (typeof navigator !== "undefined") {
      deviceInfo = navigator.userAgent.slice(0, 200);
    }
    return registerSessionToken(uid, deviceInfo);
  }

  async function refresh() {
    try {
      const res = await api.apiGetMe();
      if (!res.user) {
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      // prefer server-provided role/tenant information when available
      const resolved = await resolveFromApi(res.user as any);
      const user = buildUser(res.user.id, res.user.email);
      const session = buildSession(user, api.getToken() ?? "");
      const token = await registerNewSessionToken(res.user.id);
      setState({
        user,
        session,
        ...resolved,
        loading: false,
        error: null,
        sessionToken: token,
        sessionConflict: false,
        mustChangePassword: !!res.user.mustChangePassword,
      });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }

  useEffect(() => {
    let mounted = true;
    const token = api.getToken();
    if (!token) {
      setState((s) => ({ ...s, loading: false }));
      return () => {
        mounted = false;
      };
    }
    // Initialize data cache from backend, then verify token
    initializeDataCache().then(async () => {
      if (!mounted) return;
      try {
        const res = await api.apiGetMe();
        if (!res.user) {
          api.clearToken();
          setState((s) => ({ ...s, loading: false }));
          return;
        }
        const resolved =
          (await resolveFromApi(res.user as any)) ??
          resolveRoleAndTenant(res.user.id, res.user.email);
        const user = buildUser(res.user.id, res.user.email);
        const session = buildSession(user, token);
        const sessionToken = await registerNewSessionToken(res.user.id);
        if (mounted) {
          setState({
            user,
            session,
            ...resolved,
            loading: false,
            error: null,
            sessionToken,
            sessionConflict: false,
            mustChangePassword: !!res.user.mustChangePassword,
          });
        }
      } catch {
        api.clearToken();
        if (mounted) setState((s) => ({ ...s, loading: false }));
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const result = await api.apiLogin(email, password);
      const { user: apiUser, token } = result;
      const uid = apiUser.id;

      if (!isCacheInitialized()) {
        await initializeDataCache();
      }

      // prefer API-resolved role/tenant
      const resolved =
        (await resolveFromApi(apiUser as any)) ||
        resolveRoleAndTenant(uid, email);
      const user = buildUser(uid, email);
      const session = buildSession(user, token);
      const sessionToken = await registerNewSessionToken(uid);
      setState({
        user,
        session,
        ...resolved,
        loading: false,
        error: null,
        sessionToken,
        sessionConflict: false,
        mustChangePassword: !!apiUser.mustChangePassword,
      });
      return { error: null };
    } catch (err) {
      return { error: (err as Error).message || "Invalid email or password." };
    }
  };

  const signUp = async (
    email: string,
    password: string,
    name: string,
    asSuperAdmin: boolean,
  ) => {
    if (password.length < 6)
      return { error: "Password must be at least 6 characters." };
    const result = await api.apiSignup(email, password, name, asSuperAdmin);
    if (result.error) return { error: result.error };
    if (asSuperAdmin && result.token && result.user) {
      const uid = result.user.id;
      if (!isCacheInitialized()) {
        await initializeDataCache();
      }
      const resolved = resolveRoleAndTenant(uid, email);
      const user = buildUser(uid, email);
      const session = buildSession(user, result.token);
      const sessionToken = await registerNewSessionToken(uid);
      setState({
        user,
        session,
        ...resolved,
        loading: false,
        error: null,
        sessionToken,
        sessionConflict: false,
        mustChangePassword: false,
      });
    }
    return { error: null };
  };

  const signOut = async () => {
    clearFeatureFlagCache();
    if (state.user) {
      await clearSessionToken(state.user.id);
    }
    api.clearToken();
    setState({
      user: null,
      session: null,
      role: null,
      internalRole: null,
      adminName: null,
      tenant: null,
      tenantUser: null,
      activeAssignment: null,
      loading: false,
      error: null,
      sessionToken: null,
      sessionConflict: false,
      rankPermissions: null,
      mustChangePassword: false,
    });
  };

  const dismissSessionConflict = () => {
    setState((s) => ({ ...s, sessionConflict: false }));
  };

  const clearMustChangePassword = () => {
    setState((s) => ({ ...s, mustChangePassword: false }));
  };

  return (
    <AuthContext.Provider
      value={{
        ...state,
        signIn,
        signUp,
        signOut,
        refresh,
        dismissSessionConflict,
        clearMustChangePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
