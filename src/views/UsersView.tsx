import { useEffect, useState } from 'react';
import {
  Users, ShieldCheck, ShieldOff, KeyRound, Lock, Unlock, Search, UserPlus, AlertTriangle,
  Pencil, Trash2, Copy, Check,
} from 'lucide-react';
import { Card } from '../components/Card';
import { Modal } from '../components/Modal';
import { Toggle } from '../components/Toggle';
import { Badge, StatusBadge } from '../components/Badge';
import { DataTable, type Column } from '../components/DataTable';
import { CriticalActionWizard } from '../components/CriticalActionWizard';
import { useStore } from '../store';
import { useAuth } from '../lib/auth';
import { relativeTime } from '../constants';
import type { InternalUser, Tenant } from '../types';
import type { Capabilities } from '../lib/permissions';
import {
  apiInvitePlatformStaff, apiUpdatePlatformStaff, apiTogglePlatformStaffLock, apiResetPlatformStaffPassword, apiDeletePlatformStaff,
  apiGetMfaEnforcement, apiSetMfaEnforcement, apiForceTenantPasswordReset, apiUpdateTenant,
  apiSearchTenantUsers, apiResetUserMfa, apiEmergencyResetUserPassword, type TenantUserSearchResult,
} from '../lib/api';
import { logAudit } from '../lib/audit';
import type { PlatformStaffRow } from '../lib/supabase';

function mapStaffRow(row: PlatformStaffRow): InternalUser {
  return { id: row.id, name: row.name, email: row.email, role: row.role, status: row.status, lastActive: row.last_active ?? row.created_at, mfa: row.mfa };
}

const ROLE_TONE: Record<string, 'danger' | 'warning' | 'info'> = {
  'Super-Admin': 'danger',
  'Platform Auditor': 'warning',
  'Global Support Staff': 'info',
};

const ALL_ROLES: InternalUser['role'][] = ['Super-Admin', 'Platform Auditor', 'Global Support Staff'];

export function UsersView({ caps }: { caps: Capabilities }) {
  const { internalUsers, globalMfaEnforced, tenants, dispatch, toast } = useStore();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<InternalUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InternalUser | null>(null);
  const [emergencyAction, setEmergencyAction] = useState<'reset' | 'lockdown' | null>(null);
  const [tempPasswordReveal, setTempPasswordReveal] = useState<{ email: string; password: string } | null>(null);
  const [mfaSearchQuery, setMfaSearchQuery] = useState('');
  const [mfaSearchResults, setMfaSearchResults] = useState<TenantUserSearchResult[]>([]);
  const [mfaSearchBusy, setMfaSearchBusy] = useState(false);
  const [mfaResetTarget, setMfaResetTarget] = useState<TenantUserSearchResult | null>(null);
  const [accountSearchResults, setAccountSearchResults] = useState<TenantUserSearchResult[]>([]);
  const [accountSearchBusy, setAccountSearchBusy] = useState(false);

  const currentEmail = user?.email ?? '';
  const isSelf = (u: InternalUser) => u.email === currentEmail;

  useEffect(() => {
    apiGetMfaEnforcement().then((r) => dispatch({ type: 'MFA_GLOBAL_HYDRATE', enforced: r.enforced })).catch(() => {});
  }, [dispatch]);

  useEffect(() => {
    const q = mfaSearchQuery.trim();
    if (!q) { setMfaSearchResults([]); return; }
    setMfaSearchBusy(true);
    const handle = setTimeout(() => {
      apiSearchTenantUsers(q)
        .then(setMfaSearchResults)
        .catch(() => setMfaSearchResults([]))
        .finally(() => setMfaSearchBusy(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [mfaSearchQuery]);

  // "Search any client account" must search real tenant users, not the
  // internal staff roster — same debounced cross-tenant lookup as the MFA
  // reset search above.
  useEffect(() => {
    if (!searchOpen) return;
    const q = query.trim();
    if (!q) { setAccountSearchResults([]); return; }
    setAccountSearchBusy(true);
    const handle = setTimeout(() => {
      apiSearchTenantUsers(q)
        .then(setAccountSearchResults)
        .catch(() => setAccountSearchResults([]))
        .finally(() => setAccountSearchBusy(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [query, searchOpen]);

  const columns: Column<InternalUser>[] = [
    {
      key: 'user', header: 'Staff Member', sortValue: (u) => u.name,
      render: (u) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary-500/15 to-accent-500/15 text-xs font-bold text-primary-700 dark:text-primary-300">
            {u.name.split(' ').map((w) => w[0]).join('')}
          </div>
          <div>
            <p className="font-semibold text-ink-900 dark:text-white">{u.name}{isSelf(u) && <span className="ml-1.5 text-[10px] font-bold uppercase text-primary-600 dark:text-primary-400">(You)</span>}</p>
            <p className="text-xs text-ink-500">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role', header: 'Role', sortValue: (u) => u.role,
      render: (u) => <Badge tone={ROLE_TONE[u.role]}>{u.role}</Badge>,
    },
    {
      key: 'status', header: 'Status', sortValue: (u) => u.status,
      render: (u) => <StatusBadge status={u.status} />,
    },
    {
      key: 'mfa', header: 'MFA',
      render: (u) => u.mfa ? <Badge tone="success" dot>Enabled</Badge> : <Badge tone="warning" dot>Off</Badge>,
    },
    {
      key: 'last', header: 'Last Active', sortValue: (u) => u.lastActive,
      render: (u) => <span className="text-xs text-ink-500">{relativeTime(u.lastActive)}</span>,
    },
    {
      key: 'actions', header: 'Actions',
      render: (u) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditTarget(u)}
            disabled={!caps.userEdit}
            className="btn-ghost rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-30"
            title="Edit profile & role"
          ><Pencil className="h-4 w-4" /></button>
          <button
            onClick={async () => {
              const result = await apiResetPlatformStaffPassword(u.id);
              dispatch({ type: 'USER_RESET_PASSWORD', id: u.id });
              await logAudit({ actorEmail: currentEmail || 'unknown', category: 'security', action: `Password reset issued: ${u.email}`, target: u.email, severity: 'warning' });
              setTempPasswordReveal({ email: u.email, password: result.tempPassword });
            }}
            disabled={!caps.userResetPassword}
            className="btn-ghost rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-30"
            title="Reset password"
          ><KeyRound className="h-4 w-4" /></button>
          <button
            onClick={async () => {
              const wasLocked = u.status === 'locked';
              const row = await apiTogglePlatformStaffLock<PlatformStaffRow>(u.id);
              dispatch({ type: 'USER_LOCK_TOGGLE', id: u.id, user: mapStaffRow(row) });
              await logAudit({ actorEmail: currentEmail || 'unknown', category: 'security', action: `Account ${wasLocked ? 'unlocked' : 'locked'}: ${u.email}`, target: u.email, severity: 'warning' });
              toast({ tone: wasLocked ? 'success' : 'warning', title: wasLocked ? 'Account unlocked' : 'Account locked', message: u.email });
            }}
            disabled={!caps.userLockToggle || isSelf(u)}
            className="btn-ghost rounded-md p-1.5 disabled:cursor-not-allowed disabled:opacity-30"
            title={u.status === 'locked' ? 'Unlock' : 'Lock'}
          >
            {u.status === 'locked' ? <Unlock className="h-4 w-4 text-success-600" /> : <Lock className="h-4 w-4 text-danger-600" />}
          </button>
          <button
            onClick={() => setDeleteTarget(u)}
            disabled={!caps.userDelete || isSelf(u)}
            className="btn-ghost rounded-md p-1.5 text-danger-600 hover:bg-danger-50 hover:text-danger-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-danger-900/30"
            title={isSelf(u) ? 'Cannot delete your own account' : 'Delete / revoke account'}
          ><Trash2 className="h-4 w-4" /></button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">User & Role Configuration</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">Internal platform staff accounts — Super-Admin, Platform Auditor, and Global Support Staff.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setSearchOpen(true)} className="btn-secondary"><Search className="h-4 w-4" /> Search accounts</button>
          <button onClick={() => setInviteOpen(true)} disabled={!caps.userInvite} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"><UserPlus className="h-4 w-4" /> Invite staff</button>
        </div>
      </div>

      {/* Emergency Security Toolkit */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Global MFA Enforcement" subtitle="Default applied to every tenant workspace" icon={<ShieldCheck className="h-4 w-4" />}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink-800 dark:text-ink-100">Require MFA at login for every company</p>
              <p className="mt-0.5 text-xs text-ink-500">When enabled, any tenant user without MFA already set up is prompted to enroll on their next sign-in.</p>
            </div>
            <Toggle checked={globalMfaEnforced} onChange={async (v) => {
              if (!caps.securityEdit) return;
              try {
                const result = await apiSetMfaEnforcement(v);
                dispatch({ type: 'MFA_GLOBAL_TOGGLE', enforced: result.enforced });
                await logAudit({ actorEmail: currentEmail || 'unknown', category: 'security', action: `Global MFA enforcement ${v ? 'enabled' : 'disabled'} (${result.tenantsUpdated} tenants)`, target: 'platform', severity: 'warning', before: { global_mfa_enforced: !v }, after: { global_mfa_enforced: v, tenants_updated: result.tenantsUpdated } });
                toast({ tone: v ? 'success' : 'warning', title: `MFA enforcement ${v ? 'enabled' : 'disabled'}`, message: `Applied to ${result.tenantsUpdated} tenant workspace(s).` });
              } catch (err) {
                toast({ tone: 'danger', title: 'Could not update MFA enforcement', message: (err as Error).message });
              }
            }} disabled={!caps.securityEdit} />
          </div>
        </Card>

        <Card title="Quick Account Actions" subtitle="Emergency security controls" icon={<KeyRound className="h-4 w-4" />}>
          <div className="space-y-2">
            <button onClick={() => setSearchOpen(true)} className="btn-secondary w-full justify-start"><Search className="h-4 w-4" /> Search any client account</button>
            <button onClick={() => setEmergencyAction('reset')} disabled={!caps.securityEdit} className="btn-secondary w-full justify-start disabled:cursor-not-allowed disabled:opacity-50"><KeyRound className="h-4 w-4" /> Trigger tenant password reset</button>
            <button onClick={() => setEmergencyAction('lockdown')} disabled={!caps.securityEdit} className="btn-danger w-full justify-start disabled:cursor-not-allowed disabled:opacity-50"><Lock className="h-4 w-4" /> Emergency account lockdown</button>
          </div>
        </Card>

        <Card title="Access Summary" subtitle="Internal team composition" icon={<Users className="h-4 w-4" />}>
          <div className="space-y-2">
            {ALL_ROLES.map((role) => {
              const count = internalUsers.filter((u) => u.role === role).length;
              return (
                <div key={role} className="flex items-center justify-between rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
                  <div className="flex items-center gap-2">
                    <Badge tone={ROLE_TONE[role]}>{role}</Badge>
                  </div>
                  <span className="text-sm font-bold text-ink-800 dark:text-ink-100">{count}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title="Reset User MFA" subtitle="Clear a tenant user's authenticator enrollment across any company" icon={<ShieldOff className="h-4 w-4" />}>
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              value={mfaSearchQuery}
              onChange={(e) => setMfaSearchQuery(e.target.value)}
              placeholder="Search by name or email…"
              className="input pl-9"
            />
          </div>
          {mfaSearchBusy && <p className="text-xs text-ink-500">Searching…</p>}
          {!mfaSearchBusy && mfaSearchQuery.trim() && mfaSearchResults.length === 0 && (
            <p className="text-xs text-ink-500">No matching users found.</p>
          )}
          {mfaSearchResults.length > 0 && (
            <div className="space-y-2">
              {mfaSearchResults.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
                  <div>
                    <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{u.name} <span className="text-xs font-normal text-ink-500">({u.rank})</span></p>
                    <p className="text-xs text-ink-500">{u.email} · {u.company}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {u.mfa_enabled ? <Badge tone="success" dot>Enabled</Badge> : <Badge tone="warning" dot>Off</Badge>}
                    <button
                      onClick={() => setMfaResetTarget(u)}
                      disabled={!caps.securityEdit || !u.mfa_enabled}
                      className="btn-secondary disabled:cursor-not-allowed disabled:opacity-30"
                      title={u.mfa_enabled ? 'Reset MFA' : 'MFA is not enabled for this account'}
                    ><ShieldOff className="h-4 w-4" /> Reset MFA</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card title="Internal Access Matrix" subtitle="Platform owner's internal team" icon={<Users className="h-4 w-4" />}>
        <DataTable columns={columns} rows={internalUsers} pageSize={6} searchPlaceholder="Search staff…" searchFn={(u, q) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)} />
      </Card>

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onInvite={async (draft) => {
            const row = await apiInvitePlatformStaff<PlatformStaffRow & { tempPassword: string }>({ name: draft.name, email: draft.email, role: draft.role });
            const u = mapStaffRow(row);
            dispatch({ type: 'USER_INVITE', user: u });
            await logAudit({ actorEmail: currentEmail || 'unknown', category: 'security', action: `Internal staff invited: ${u.email}`, target: u.email, severity: 'info' });
            setTempPasswordReveal({ email: u.email, password: row.tempPassword });
            setInviteOpen(false);
          }}
        />
      )}

      {editTarget && (
        <EditStaffModal
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onSave={async (name, email, role) => {
            await apiUpdatePlatformStaff<PlatformStaffRow>(editTarget.id, { name, email, role });
            dispatch({ type: 'USER_EDIT', id: editTarget.id, name, email, role });
            await logAudit({ actorEmail: currentEmail || 'unknown', category: 'security', action: `Staff account edited: ${editTarget.email} → ${email} (${role})`, target: email, severity: 'warning' });
            toast({ tone: 'success', title: 'Staff account updated', message: `${email} saved as ${role}.` });
            setEditTarget(null);
          }}
        />
      )}

      {deleteTarget && (
        <CriticalActionWizard
          target={{
            kind: 'Staff Account',
            title: deleteTarget.name,
            subtitle: deleteTarget.id,
            rows: [
              { label: 'Staff ID', value: deleteTarget.id },
              { label: 'Name', value: deleteTarget.name },
              { label: 'Email', value: deleteTarget.email },
              { label: 'Role', value: deleteTarget.role },
              { label: 'Status', value: deleteTarget.status },
              { label: 'MFA', value: deleteTarget.mfa ? 'Enabled' : 'Disabled' },
              { label: 'Last Active', value: relativeTime(deleteTarget.lastActive) },
            ],
            acknowledgements: [
              `I acknowledge this will revoke all active session tokens for ${deleteTarget.email}.`,
              'I understand historical logs and audit trails linked to this user ID will be preserved in Platform Security & Audits.',
              'I confirm this account deletion is intentional and authorized.',
            ],
            confirmPhrase: `DELETE ${deleteTarget.id}`,
            confirmHint: `DELETE ${deleteTarget.id}`,
          }}
          actorEmail={currentEmail || 'unknown'}
          onClose={() => setDeleteTarget(null)}
          onExecute={async (payload) => {
            await apiDeletePlatformStaff(deleteTarget.id, 'hard');
            dispatch({ type: 'USER_DELETE', id: deleteTarget.id, mode: 'hard' });
            await logAudit({ actorEmail: currentEmail || 'unknown', category: 'security', action: `Staff account permanently removed: ${deleteTarget.email}`, target: deleteTarget.email, severity: 'critical' });
            toast({ tone: 'danger', title: 'Staff account permanently deleted', message: `${deleteTarget.email} removed. Audit entry: ${payload.timestamp}.` });
            setDeleteTarget(null);
          }}
        />
      )}

      {searchOpen && (
        <Modal open onClose={() => { setSearchOpen(false); setQuery(''); setAccountSearchResults([]); }} title="Account Search" subtitle="Search any client account across all tenants" icon={<Search className="h-5 w-5" />} size="md">
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Email, company, or user ID…" className="input pl-9" />
            </div>
            <div className="space-y-2">
              {accountSearchBusy && <p className="py-2 text-center text-xs text-ink-400">Searching…</p>}
              {!accountSearchBusy && query.trim() && accountSearchResults.length === 0 && (
                <p className="py-2 text-center text-xs text-ink-400">No matching tenant users found.</p>
              )}
              {accountSearchResults.map((u) => (
                <div key={u.id} className="flex items-center justify-between rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
                  <div>
                    <p className="text-sm font-medium text-ink-800 dark:text-ink-100">{u.name}</p>
                    <p className="text-xs text-ink-500">{u.email} · {u.company}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={u.mfa_enabled ? 'success' : 'warning'} dot>{u.mfa_enabled ? 'MFA On' : 'MFA Off'}</Badge>
                    <button
                      title="Emergency password reset"
                      onClick={async () => {
                        const result = await apiEmergencyResetUserPassword(u.tenant_id, u.id);
                        await logAudit({ tenantId: u.tenant_id, actorEmail: currentEmail || 'unknown', category: 'security', action: `Password reset issued: ${u.email}`, target: u.email, severity: 'warning' });
                        setTempPasswordReveal({ email: u.email, password: result.tempPassword });
                      }}
                      className="btn-ghost rounded-md p-1.5"
                    ><KeyRound className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
              {query && <div className="rounded-lg bg-warning-50 p-3 text-xs text-warning-700 dark:bg-warning-900/20 dark:text-warning-300"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />This tool can target any tenant user. All actions are recorded in the immutable audit ledger.</div>}
            </div>
          </div>
        </Modal>
      )}

      {tempPasswordReveal && (
        <TempPasswordModal reveal={tempPasswordReveal} onClose={() => setTempPasswordReveal(null)} />
      )}

      {mfaResetTarget && (
        <MfaResetModal
          target={mfaResetTarget}
          actorEmail={currentEmail || 'unknown'}
          onClose={() => setMfaResetTarget(null)}
          onDone={(id) => {
            setMfaSearchResults((rows) => rows.map((r) => (r.id === id ? { ...r, mfa_enabled: false } : r)));
            setMfaResetTarget(null);
          }}
          toast={toast}
        />
      )}

      {emergencyAction && (
        <EmergencyTenantActionModal
          action={emergencyAction}
          tenants={tenants}
          actorEmail={currentEmail || 'unknown'}
          onClose={() => setEmergencyAction(null)}
          toast={toast}
        />
      )}
    </div>
  );
}

interface InviteDraft { name: string; email: string; role: InternalUser['role'] }

function InviteModal({ onClose, onInvite }: { onClose: () => void; onInvite: (draft: InviteDraft) => Promise<void> }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InternalUser['role']>('Global Support Staff');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!name.trim() || !email.trim() || saving) return;
    setSaving(true);
    try { await onInvite({ name, email, role }); } finally { setSaving(false); }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Invite Internal Staff"
      subtitle="Provision a new platform team account"
      icon={<UserPlus className="h-5 w-5" />}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            disabled={!name.trim() || !email.trim() || saving}
            onClick={submit}
            className="btn-primary"
          >{saving ? 'Sending…' : 'Send invitation'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div><label className="label">Full name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jordan Avery" /></div>
        <div><label className="label">Email</label><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="j.avery@maritime-platform.io" /></div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as InternalUser['role'])}>
            {ALL_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}

function EditStaffModal({ user, onClose, onSave }: { user: InternalUser; onClose: () => void; onSave: (name: string, email: string, role: InternalUser['role']) => Promise<void> }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<InternalUser['role']>(user.role);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!name.trim() || !email.trim() || saving) return;
    setSaving(true);
    try { await onSave(name.trim(), email.trim(), role); } finally { setSaving(false); }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit Staff Account"
      subtitle={`Update profile & role — ${user.email}`}
      icon={<Pencil className="h-5 w-5" />}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            disabled={!name.trim() || !email.trim() || saving}
            onClick={submit}
            className="btn-primary"
          >{saving ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg bg-ink-50 p-3 dark:bg-ink-800/50">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary-500/15 to-accent-500/15 text-sm font-bold text-primary-700 dark:text-primary-300">
            {name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
          </div>
          <div>
            <p className="text-sm font-bold text-ink-900 dark:text-white">{user.name}</p>
            <p className="text-xs text-ink-500">ID: {user.id}</p>
          </div>
        </div>
        <div><label className="label">Full name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label">Email</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div>
          <label className="label">Internal role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as InternalUser['role'])}>
            {ALL_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ALL_ROLES.map((r) => (
              <span key={r} className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${r === role ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-400'}`}>{r}</span>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function EmergencyTenantActionModal({
  action, tenants, actorEmail, onClose, toast,
}: {
  action: 'reset' | 'lockdown';
  tenants: Tenant[];
  actorEmail: string;
  onClose: () => void;
  toast: (t: { tone: 'info' | 'success' | 'warning' | 'danger'; title: string; message?: string }) => void;
}) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const selected = tenants.find((t) => t.id === tenantId);
  const isReset = action === 'reset';

  const execute = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      if (isReset) {
        const result = await apiForceTenantPasswordReset(selected.id);
        await logAudit({ tenantId: selected.id, actorEmail, category: 'security', action: `Password reset forced for all users: ${selected.company}`, target: selected.company, severity: 'warning' });
        toast({ tone: 'success', title: 'Password reset triggered', message: `${result.affected} user(s) at ${selected.company} must set a new password on next sign-in.` });
      } else {
        await apiUpdateTenant(selected.id, { status: 'suspended' });
        await logAudit({ tenantId: selected.id, actorEmail, category: 'security', action: `Emergency lockdown — tenant suspended: ${selected.company}`, target: selected.company, severity: 'critical' });
        toast({ tone: 'danger', title: 'Tenant suspended', message: `${selected.company} is locked out — no user at this company can sign in until reactivated.` });
      }
      onClose();
    } catch (err) {
      toast({ tone: 'danger', title: 'Action failed', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isReset ? 'Trigger Tenant Password Reset' : 'Emergency Account Lockdown'}
      subtitle={isReset ? 'Force every user at a company to set a new password' : 'Immediately suspend a company — blocks all sign-ins'}
      icon={isReset ? <KeyRound className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            disabled={!selected || busy}
            onClick={execute}
            className={isReset ? 'btn-primary' : 'btn-danger'}
          >{busy ? 'Working…' : isReset ? 'Force password reset' : 'Suspend company'}</button>
        </>
      }
    >
      <div className="space-y-4">
        {!isReset && (
          <div className="rounded-lg bg-danger-50 p-3 text-xs text-danger-700 dark:bg-danger-900/20 dark:text-danger-300">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
            This immediately blocks every user at the selected company from signing in, until a Super Admin reactivates the account from Tenant &amp; Company Management.
          </div>
        )}
        <div>
          <label className="label">Company</label>
          <select className="input" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            {tenants.length === 0 && <option value="">No tenants loaded</option>}
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.company}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}

function MfaResetModal({
  target, actorEmail, onClose, onDone, toast,
}: {
  target: TenantUserSearchResult;
  actorEmail: string;
  

  onClose: () => void;
  onDone: (id: string) => void;
  toast: (t: { tone: 'info' | 'success' | 'warning' | 'danger'; title: string; message?: string }) => void;
}) {
  const [busy, setBusy] = useState(false);

  const execute = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await apiResetUserMfa(target.tenant_id, target.id);
      await logAudit({ tenantId: target.tenant_id, actorEmail, category: 'security', action: `MFA reset for ${target.email}`, target: target.email, severity: 'warning' });
      toast({ tone: 'success', title: 'MFA reset', message: `${target.email} will be prompted for fresh authenticator setup on next sign-in.` });
      onDone(target.id);
    } catch (err) {
      toast({ tone: 'danger', title: 'Could not reset MFA', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Reset User MFA"
      subtitle={`${target.name} — ${target.email}`}
      icon={<ShieldOff className="h-5 w-5" />}
      size="sm"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button disabled={busy} onClick={execute} className="btn-danger">{busy ? 'Working…' : 'Reset MFA'}</button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-warning-50 p-3 text-xs text-warning-700 dark:bg-warning-900/20 dark:text-warning-300">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          This clears the authenticator secret and backup codes for this account at {target.company}. They'll go through fresh QR setup the next time they sign in.
        </div>
      </div>
    </Modal>
  );
}

function TempPasswordModal({ reveal, onClose }: { reveal: { email: string; password: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard access denied — value is still selectable on screen */ }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Temporary Password Issued"
      subtitle={reveal.email}
      icon={<KeyRound className="h-5 w-5" />}
      size="sm"
      footer={<button onClick={onClose} className="btn-primary w-full">Done</button>}
    >
      <div className="space-y-3">
        <div className="rounded-lg bg-warning-50 p-3 text-xs text-warning-700 dark:bg-warning-900/20 dark:text-warning-300">
          <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
          This is shown once and cannot be retrieved again. Relay it to {reveal.email} through a secure channel — they'll be required to set a new password on next sign-in.
        </div>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2.5 font-mono text-sm dark:border-ink-800 dark:bg-ink-800/50">
          <span className="select-all text-ink-900 dark:text-white">{reveal.password}</span>
          <button onClick={copy} className="btn-ghost rounded-md p-1.5 shrink-0" title="Copy password">
            {copied ? <Check className="h-4 w-4 text-success-500" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </Modal>
  );
}

