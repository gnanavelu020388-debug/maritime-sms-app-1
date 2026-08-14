import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type {
  AuditCategory,
  AuditEvent,
  BackupSnapshot,
  ErrorLog,
  ImpersonationState,
  InternalUser,
  Invoice,
  MaintenanceBanner,
  ModuleKey,
  PlanTier,
  SmsSnapshot,
  SshRole,
  Tenant,
  TenantGuardrails,
  TenantStatus,
  TierConfig,
} from './types';
import { SUPER_ADMIN_ID, SUPER_ADMIN_NAME, uid, DEFAULT_TIER_CONFIGS, SYSTEM_ROLES } from './constants';
import { onSyncEvent, type SyncEvent } from './lib/syncChannel';
import { AUDIT_LOCAL_EVENT } from './lib/audit';
import type {
  TenantRow,
  AuditLogRow,
  InvoiceRow,
  BackupSnapshotRow,
  PlatformStaffRow,
  ErrorLogRow,
  SmsSnapshotRow,
} from './lib/supabase';

// A row fetched from the real backend, merged into the ledger by
// TENANTS_HYDRATE. Usage counts (seats/vessels used) are computed
// client-side from the data cache since the backend doesn't return them.
export interface HydratedTenantRow extends TenantRow {
  seatsUsed: number;
  vesselsUsed: number;
}

function bytesToGb(bytes: number | undefined): number {
  return Math.round(((bytes ?? 0) / (1024 ** 3)) * 100) / 100;
}

// ── Raw DB row → frontend shape mappers ──────────────────────────────
// All six Super-Admin-only domains below are hydrated from the real
// backend (see server/routes/{auditLogs,invoices,backups,platformStaff,
// errorLogs,smsTemplates}.js) rather than fabricated client-side.

function mapAuditRow(row: AuditLogRow): AuditEvent {
  return {
    id: row.id,
    ts: row.created_at,
    actor: row.actor_email,
    category: (row.category as AuditCategory) ?? 'system',
    action: row.action,
    target: row.target ?? '',
    companyId: row.tenant_id,
    ip: row.ip_address ?? '—',
    scope: row.location ?? row.category,
    severity: row.severity,
    impersonation: row.category === 'impersonation',
  };
}

function mapInvoiceRow(row: InvoiceRow): Invoice {
  return {
    id: `INV-${String(row.invoice_no).padStart(4, '0')}`,
    tenantId: row.tenant_id,
    company: row.company ?? row.tenant_id,
    amount: Number(row.amount),
    currency: row.currency,
    period: row.period,
    issued: row.issued_at,
    status: row.status as Invoice['status'],
    lineItems: row.line_items,
    dueDate: row.due_date ?? undefined,
  };
}

function mapBackupRow(row: BackupSnapshotRow): BackupSnapshot {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    company: row.company ?? row.tenant_id,
    takenAt: row.taken_at,
    sizeGb: Number(row.size_gb),
    type: row.type as BackupSnapshot['type'],
    status: row.status as BackupSnapshot['status'],
    expiry: row.expiry,
    reason: row.reason ?? undefined,
  };
}

function mapStaffRow(row: PlatformStaffRow): InternalUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    lastActive: row.last_active ?? row.created_at,
    mfa: row.mfa,
  };
}

function mapErrorLogRow(row: ErrorLogRow): ErrorLog {
  return {
    id: row.id,
    ts: row.ts,
    level: row.level,
    source: row.source,
    message: row.message,
    tenantId: row.tenant_id,
    payload: JSON.stringify(row.payload ?? {}),
  };
}

function mapSmsSnapshotRow(row: SmsSnapshotRow, company: string): SmsSnapshot {
  return { id: row.id, tenantId: row.tenant_id, company, takenAt: row.taken_at, label: row.label };
}

// Shared by the cross-tab (BroadcastChannel) and same-tab (CustomEvent)
// audit listeners below — both carry the same logAudit() payload shape.
function auditEventFromLogPayload(tenantId: string | null, payload: unknown, ip: string): AuditEvent {
  const p = payload as { actorEmail: string; category: string; action: string; target?: string; severity?: 'info' | 'warning' | 'critical'; location?: string };
  return { id: uid('evt'), ts: new Date().toISOString(), actor: p.actorEmail, category: (p.category as AuditCategory) ?? 'system', action: p.action, target: p.target ?? '', companyId: tenantId, ip, scope: p.location ?? 'tenant', severity: p.severity ?? 'info' };
}

interface Toast { id: string; title: string; message?: string; tone: 'info' | 'success' | 'warning' | 'danger'; }

interface State {
  tenants: Tenant[];
  isTenantsLoading: boolean;
  tierConfigs: TierConfig[];
  audit: AuditEvent[];
  invoices: Invoice[];
  backups: BackupSnapshot[];
  internalUsers: InternalUser[];
  systemRoles: SshRole[];
  errorLogs: ErrorLog[];
  maintenance: MaintenanceBanner | null;
  impersonation: ImpersonationState;
  globalMfaEnforced: boolean;
  globalGuardrails: TenantGuardrails;
  smsSnapshots: SmsSnapshot[];
  toasts: Toast[];
  theme: 'light' | 'dark';
}

type Action =
  | { type: 'TOAST_ADD'; toast: Toast } | { type: 'TOAST_DISMISS'; id: string } | { type: 'THEME_SET'; theme: 'light' | 'dark' }
  | { type: 'MAINTENANCE_REMOTE'; banner: MaintenanceBanner | null }
  | { type: 'TENANTS_HYDRATE'; rows: HydratedTenantRow[] }
  | { type: 'AUDIT_HYDRATE'; rows: AuditLogRow[] } | { type: 'INVOICES_HYDRATE'; rows: InvoiceRow[] }
  | { type: 'BACKUPS_HYDRATE'; rows: BackupSnapshotRow[] } | { type: 'STAFF_HYDRATE'; rows: PlatformStaffRow[] }
  | { type: 'ERROR_LOGS_HYDRATE'; rows: ErrorLogRow[] }
  | { type: 'SMS_SNAPSHOTS_HYDRATE'; tenantId: string; rows: SmsSnapshotRow[] }
  | { type: 'TENANT_CREATE'; tenant: Tenant } | { type: 'TENANT_UPDATE'; id: string; patch: Partial<Tenant> } | { type: 'TENANT_SET_STATUS'; id: string; status: TenantStatus }
  | { type: 'TENANT_DELETE'; id: string } | { type: 'TENANT_SET_PLAN'; id: string; plan: PlanTier } | { type: 'TENANT_TOGGLE_MODULE'; id: string; module: ModuleKey }
  | { type: 'TENANT_TOGGLE_MODULE_REMOTE'; id: string; module: ModuleKey; enabled: boolean } | { type: 'TIER_CONFIG_UPDATE'; index: number; patch: Partial<TierConfig> }
  | { type: 'BACKUP_ADD'; snapshot: BackupSnapshot } | { type: 'BACKUP_RESTORE'; snapshotId: string } | { type: 'BACKUP_DELETE'; snapshotId: string }
  | { type: 'INVOICE_ADD'; invoice: Invoice } | { type: 'USER_RESET_PASSWORD'; id: string } | { type: 'USER_LOCK_TOGGLE'; id: string; user?: InternalUser }
  | { type: 'USER_INVITE'; user: InternalUser } | { type: 'USER_EDIT'; id: string; name: string; email: string; role: InternalUser['role'] }
  | { type: 'USER_DELETE'; id: string; mode: 'soft' | 'hard' } | { type: 'MFA_GLOBAL_TOGGLE'; enforced: boolean }
  | { type: 'IMPERSONATE_START'; tenantId: string } | { type: 'IMPERSONATE_END' } | { type: 'AUDIT_ADD'; event: AuditEvent }
  | { type: 'TENANT_FREEZE'; id: string; frozen: boolean } | { type: 'TENANT_ROLLBACK'; snapshotId: string }
  | { type: 'GUARDRAILS_UPDATE'; id: string; patch: Partial<TenantGuardrails> } | { type: 'GUARDRAILS_GLOBAL_UPDATE'; patch: Partial<TenantGuardrails> };

function loadStoredTheme(): 'dark' | 'light' {
  try {
    return localStorage.getItem('mpc-theme') === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

const initialState: State = {
  tenants: [],
  isTenantsLoading: true,
  tierConfigs: DEFAULT_TIER_CONFIGS.map((t) => ({ ...t })),
  audit: [], invoices: [], backups: [],
  internalUsers: [], systemRoles: SYSTEM_ROLES, errorLogs: [],
  maintenance: null, // populated by MaintenanceBanner's poll against the real backend
  impersonation: { active: false, tenantId: null, startedAt: null },
  globalMfaEnforced: true, globalGuardrails: { workspaceFrozen: false, maxSubfolderDepth: 4, maxUploadSizeMb: 50 },
  smsSnapshots: [], toasts: [],
  theme: loadStoredTheme(),
};

function applyTierLimits(tenants: Tenant[], tierConfigs: TierConfig[], planFor?: { id: string; plan: PlanTier }): Tenant[] {
  return tenants.map((t) => {
    const plan = planFor && planFor.id === t.id ? planFor.plan : t.plan;
    const cfg = tierConfigs.find((c) => c.name === plan) ?? { name: plan, vessels: t.vessels.max, seats: t.seats.max, storageGb: t.storageGb.max, monthly: t.monthlyRevenue, annual: 0 };
    return { ...t, plan, vessels: { ...t.vessels, max: cfg.vessels || t.vessels.max }, seats: { ...t.seats, max: cfg.seats || t.seats.max }, storageGb: { ...t.storageGb, max: cfg.storageGb || t.storageGb.max }, monthlyRevenue: cfg.monthly || t.monthlyRevenue };
  });
}

// Local-only audit fabrication, retained for domains not yet wired to the
// real audit_logs endpoint from their call sites (tenant lifecycle,
// impersonation, guardrails, tier config). Real API-backed domains
// (invoices, backups, internal staff, SMS rollback) log via logAudit()
// in src/lib/audit.ts from the view instead — see AUDIT_ADD below, which
// picks those up through the existing syncChannel broadcast.
function pushAudit(state: State, event: Omit<AuditEvent, 'id' | 'ts' | 'actor'> & { actor?: string }): State {
  const full: AuditEvent = { id: uid('aud'), ts: new Date().toISOString(), actor: event.actor ?? SUPER_ADMIN_ID, ...event };
  return { ...state, audit: [full, ...state.audit].slice(0, 400) };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'TOAST_ADD': return { ...state, toasts: [...state.toasts, action.toast] };
    case 'TOAST_DISMISS': return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'THEME_SET': return { ...state, theme: action.theme };
    case 'MAINTENANCE_REMOTE': return { ...state, maintenance: action.banner };
    case 'TENANTS_HYDRATE': {
      const existingIds = new Set(state.tenants.map((t) => t.id));
      const merged = state.tenants.map((t) => {
        const row = action.rows.find((r) => r.id === t.id);
        if (!row) return t;
        return {
          ...t,
          tenantNo: row.tenant_no,
          company: row.company, contactEmail: row.contact_email,
          plan: row.plan as PlanTier, status: row.status as TenantStatus, region: row.region,
          mfaEnforced: row.mfa_enforced, modules: row.modules as ModuleKey[],
          monthlyRevenue: Number(row.monthly_revenue), createdAt: row.created_at, contractExpires: row.contract_expires,
          vessels: { used: row.vesselsUsed, max: row.vessels_max },
          seats: { used: row.seatsUsed, max: row.seats_max },
          storageGb: {
            used: bytesToGb(row.storage_bytes_used), max: row.storage_gb_max,
            remaining: row.storage_remaining_gb ?? Math.max(0, row.storage_gb_max - bytesToGb(row.storage_bytes_used)),
            percentage: row.storage_percentage ?? 0,
            status: row.storage_status ?? 'NORMAL',
          },
        };
      });
      const newOnes: Tenant[] = action.rows.filter((r) => !existingIds.has(r.id)).map((row) => ({
        id: row.id, tenantNo: row.tenant_no, company: row.company, contactEmail: row.contact_email,
        companyEmail: '', companyMailPassword: '',
        plan: row.plan as PlanTier, status: row.status as TenantStatus,
        seats: { used: row.seatsUsed, max: row.seats_max },
        vessels: { used: row.vesselsUsed, max: row.vessels_max },
        storageGb: {
          used: bytesToGb(row.storage_bytes_used), max: row.storage_gb_max,
          remaining: row.storage_remaining_gb ?? Math.max(0, row.storage_gb_max - bytesToGb(row.storage_bytes_used)),
          percentage: row.storage_percentage ?? 0,
          status: row.storage_status ?? 'NORMAL',
        },
        modules: row.modules as ModuleKey[], mfaEnforced: row.mfa_enforced,
        createdAt: row.created_at, contractExpires: row.contract_expires,
        monthlyRevenue: Number(row.monthly_revenue), region: row.region,
        guardrails: { workspaceFrozen: false, maxSubfolderDepth: 3, maxUploadSizeMb: 25 },
        demoTenantId: null,
      }));
      return { ...state, tenants: [...merged, ...newOnes], isTenantsLoading: false };
    }
    case 'AUDIT_HYDRATE': return { ...state, audit: action.rows.map(mapAuditRow) };
    case 'INVOICES_HYDRATE': return { ...state, invoices: action.rows.map(mapInvoiceRow) };
    case 'BACKUPS_HYDRATE': return { ...state, backups: action.rows.map(mapBackupRow) };
    case 'STAFF_HYDRATE': return { ...state, internalUsers: action.rows.map(mapStaffRow) };
    case 'ERROR_LOGS_HYDRATE': return { ...state, errorLogs: action.rows.map(mapErrorLogRow) };
    case 'SMS_SNAPSHOTS_HYDRATE': {
      const tenant = state.tenants.find((t) => t.id === action.tenantId);
      const mapped = action.rows.map((r) => mapSmsSnapshotRow(r, tenant?.company ?? action.tenantId));
      return { ...state, smsSnapshots: [...state.smsSnapshots.filter((s) => s.tenantId !== action.tenantId), ...mapped] };
    }
    case 'TENANT_CREATE': { const next = pushAudit(state, { category: 'tenant', action: `Tenant provisioned: ${action.tenant.company}`, target: action.tenant.company, companyId: action.tenant.id, ip: '10.42.1.8', scope: 'tenant', severity: 'info' }); return { ...next, tenants: [action.tenant, ...state.tenants] }; }
    case 'TENANT_UPDATE': { const tenant = state.tenants.find((t) => t.id === action.id); const next = pushAudit(state, { category: 'tenant', action: `Tenant edited: ${tenant?.company ?? action.id}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'tenant', severity: 'info' }); return { ...next, tenants: state.tenants.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)) }; }
    case 'TENANT_SET_STATUS': { const tenant = state.tenants.find((t) => t.id === action.id); const next = pushAudit(state, { category: 'tenant', action: `Tenant ${action.status}: ${tenant?.company ?? action.id}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'tenant', severity: action.status === 'suspended' ? 'warning' : 'info' }); return { ...next, tenants: state.tenants.map((t) => (t.id === action.id ? { ...t, status: action.status } : t)) }; }
    case 'TENANT_DELETE': { const t = state.tenants.find((x) => x.id === action.id); const next = pushAudit(state, { category: 'tenant', action: `Tenant permanently deleted: ${t?.company ?? action.id}`, target: t?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'tenant', severity: 'critical' }); return { ...next, tenants: state.tenants.filter((x) => x.id !== action.id), backups: state.backups.filter((b) => b.tenantId !== action.id) }; }
    case 'TENANT_SET_PLAN': { const tenant = state.tenants.find((t) => t.id === action.id); const next = pushAudit(state, { category: 'tenant', action: `Plan tier changed to ${action.plan}: ${tenant?.company ?? action.id}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'billing', severity: 'info' }); return { ...next, tenants: applyTierLimits(state.tenants, state.tierConfigs, { id: action.id, plan: action.plan }) }; }
    case 'TENANT_TOGGLE_MODULE': { const tenant = state.tenants.find((t) => t.id === action.id); const has = tenant?.modules.includes(action.module); const next = pushAudit(state, { category: 'tenant', action: `Module ${has ? 'revoked' : 'granted'}: ${action.module}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'tenant', severity: 'info' }); return { ...next, tenants: state.tenants.map((t) => t.id === action.id ? { ...t, modules: has ? t.modules.filter((m) => m !== action.module) : [...t.modules, action.module] } : t) }; }
    case 'TENANT_TOGGLE_MODULE_REMOTE': return { ...state, tenants: state.tenants.map((t) => t.id === action.id ? { ...t, modules: action.enabled ? t.modules.includes(action.module) ? t.modules : [...t.modules, action.module] : t.modules.filter((m) => m !== action.module) } : t) };
    case 'TIER_CONFIG_UPDATE': { const tierConfigs = state.tierConfigs.map((t, i) => (i === action.index ? { ...t, ...action.patch } : t)); const tenants = applyTierLimits(state.tenants, tierConfigs); const changedTier = tierConfigs[action.index]; const next = pushAudit(state, { category: 'billing', action: `Tier config updated: ${changedTier.name}`, target: changedTier.name, companyId: null, ip: '10.42.1.8', scope: 'billing', severity: 'info' }); return { ...next, tierConfigs, tenants }; }
    case 'BACKUP_ADD': return { ...state, backups: [action.snapshot, ...state.backups] };
    case 'BACKUP_RESTORE': return state;
    case 'BACKUP_DELETE': return { ...state, backups: state.backups.filter((b) => b.id !== action.snapshotId) };
    case 'INVOICE_ADD': return { ...state, invoices: [action.invoice, ...state.invoices] };
    case 'USER_RESET_PASSWORD': return state;
    case 'USER_LOCK_TOGGLE': return action.user
      ? { ...state, internalUsers: state.internalUsers.map((x) => x.id === action.id ? action.user! : x) }
      : { ...state, internalUsers: state.internalUsers.map((x) => x.id === action.id ? { ...x, status: x.status === 'locked' ? 'active' : 'locked' } : x) };
    case 'USER_INVITE': return { ...state, internalUsers: [action.user, ...state.internalUsers] };
    case 'USER_EDIT': return { ...state, internalUsers: state.internalUsers.map((x) => x.id === action.id ? { ...x, name: action.name, email: action.email, role: action.role } : x) };
    case 'USER_DELETE': {
      if (action.mode === 'soft') return { ...state, internalUsers: state.internalUsers.map((x) => x.id === action.id ? { ...x, status: 'locked' as const, mfa: false } : x) };
      return { ...state, internalUsers: state.internalUsers.filter((x) => x.id !== action.id) };
    }
    case 'MFA_GLOBAL_TOGGLE': { const next = pushAudit(state, { category: 'security', action: `Global MFA enforcement ${action.enforced ? 'enabled' : 'disabled'}`, target: 'platform', companyId: null, ip: '10.42.1.8', scope: 'security', severity: 'warning' }); return { ...next, globalMfaEnforced: action.enforced }; }
    case 'IMPERSONATE_START': { const tenant = state.tenants.find((t) => t.id === action.tenantId); const next = pushAudit(state, { category: 'impersonation', action: `Login As — impersonation started: ${tenant?.company ?? action.tenantId}`, target: tenant?.contactEmail ?? action.tenantId, companyId: action.tenantId, ip: '10.42.1.8', scope: 'impersonation', severity: 'critical', impersonation: true }); return { ...next, impersonation: { active: true, tenantId: action.tenantId, startedAt: new Date().toISOString() } }; }
    case 'IMPERSONATE_END': { const next = pushAudit(state, { category: 'impersonation', action: 'Impersonation session ended', target: state.impersonation.tenantId ?? 'platform', companyId: state.impersonation.tenantId, ip: '10.42.1.8', scope: 'impersonation', severity: 'warning', impersonation: true }); return { ...next, impersonation: { active: false, tenantId: null, startedAt: null } }; }
    case 'TENANT_FREEZE': { const tenant = state.tenants.find((t) => t.id === action.id); const next = pushAudit(state, { category: 'sms', action: `Workspace ${action.frozen ? 'frozen' : 'unfrozen'}: ${tenant?.company ?? action.id}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'sms', severity: action.frozen ? 'critical' : 'warning' }); return { ...next, tenants: state.tenants.map((t) => t.id === action.id ? { ...t, guardrails: { ...(t.guardrails ?? { workspaceFrozen: false, maxSubfolderDepth: 3, maxUploadSizeMb: 25 }), workspaceFrozen: action.frozen } } : t) }; }
    // No real document state to overwrite on this parallel master-template
    // system (see server/routes/smsTemplates.js) — rollback is a purely
    // audit-logged event, matching BACKUP_RESTORE's semantics above.
    case 'TENANT_ROLLBACK': return state;
    case 'GUARDRAILS_UPDATE': { const tenant = state.tenants.find((t) => t.id === action.id); const next = pushAudit(state, { category: 'sms', action: `Guardrails updated: ${tenant?.company ?? action.id}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'sms', severity: 'warning' }); return { ...next, tenants: state.tenants.map((t) => t.id === action.id ? { ...t, guardrails: { ...(t.guardrails ?? { workspaceFrozen: false, maxSubfolderDepth: 3, maxUploadSizeMb: 25 }), ...action.patch } } : t) }; }
    case 'GUARDRAILS_GLOBAL_UPDATE': { const next = pushAudit(state, { category: 'sms', action: `Global guardrails updated`, target: 'Platform-wide', companyId: null, ip: 'local', scope: 'platform', severity: 'warning' }); return { ...next, globalGuardrails: { ...state.globalGuardrails, ...action.patch } }; }
    case 'AUDIT_ADD': return { ...state, audit: [action.event, ...state.audit].slice(0, 400) };
    default: return state;
  }
}

interface StoreCtx extends State { dispatch: React.Dispatch<Action>; toast: (t: Omit<Toast, 'id'>) => void; dismissToast: (id: string) => void; }
const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try { localStorage.setItem('mpc-theme', state.theme); } catch { /* ignore */ }
  }, [state.theme]);

  useEffect(() => {
    const off = onSyncEvent((evt: SyncEvent) => {
      if (evt.type === 'AUDIT_LOGGED') {
        dispatch({ type: 'AUDIT_ADD', event: auditEventFromLogPayload(evt.tenantId, evt.payload, 'remote') });
      } else if (evt.type === 'FEATURE_FLAGS_CHANGED' && evt.tenantId) {
        const p = evt.payload as { featureKey?: string; enabled?: boolean };
        if (p.featureKey && typeof p.enabled === 'boolean') dispatch({ type: 'TENANT_TOGGLE_MODULE_REMOTE', id: evt.tenantId, module: p.featureKey as ModuleKey, enabled: p.enabled });
      }
    });
    return off;
  }, []);

  // Same-tab counterpart to the AUDIT_LOGGED branch above — BroadcastChannel
  // never delivers a message back to the tab/channel that sent it, so the
  // tab performing the action needs this separate CustomEvent to see its
  // own audit entry appear immediately (see src/lib/audit.ts).
  useEffect(() => {
    const handler = (e: Event) => {
      const { tenantId, payload } = (e as CustomEvent).detail as { tenantId: string | null; payload: unknown };
      dispatch({ type: 'AUDIT_ADD', event: auditEventFromLogPayload(tenantId, payload, 'local') });
    };
    window.addEventListener(AUDIT_LOCAL_EVENT, handler);
    return () => window.removeEventListener(AUDIT_LOCAL_EVENT, handler);
  }, []);

  const value = useMemo<StoreCtx>(() => ({
    ...state, dispatch,
    toast: (t) => { const id = uid('toast'); dispatch({ type: 'TOAST_ADD', toast: { ...t, id } }); setTimeout(() => dispatch({ type: 'TOAST_DISMISS', id }), 4200); },
    dismissToast: (id) => dispatch({ type: 'TOAST_DISMISS', id }),
  }), [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

export { SUPER_ADMIN_ID, SUPER_ADMIN_NAME };
