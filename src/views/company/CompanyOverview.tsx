import { Ship, Shield, ArrowRight, TrendingUp, CheckCircle2, Clock, Anchor, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { getEffectiveDemoUsers, getEffectiveDemoSmsDocs, getEffectiveDemoAssignments, getEffectiveDemoVessels } from '../../lib/demoData';
import { useFleetScope } from '../../lib/useFleetScope';
import { useEffect, useState } from 'react';
import type { CompanySection } from '../../layouts/CompanyShell';

import { ShoreLaunchpadView } from '../../components/ShoreLaunchpadView';
import { useFeatureFlags, type ModuleKey } from '../../lib/featureFlags';
import { onSyncEvent } from '../../lib/syncChannel';
import { refreshTenantData } from '../../lib/dataCache';
import { formatGb } from '../../constants';

export function CompanyOverview({ onNavigate }: { onNavigate: (s: CompanySection) => void }) {
  const { tenant, tenantUser } = useAuth();
  const fleetScope = useFleetScope();
  const { isEnabled } = useFeatureFlags(tenant?.id);
  const [stats, setStats] = useState({ vessels: 0, users: 0, pendingDocs: 0, approvedDocs: 0, crewOnboard: 0 });
  const [syncTick, setSyncTick] = useState(0);

  // Live sync: refresh the shared data cache and recompute stats when any other
  // tab/role changes vessels, crew, or SMS documents for this tenant.
  useEffect(() => {
    if (!tenant) return;
    const off = onSyncEvent((evt) => {
      if (evt.tenantId !== tenant.id) return;
      if (evt.type === 'SMS_UPDATED' || evt.type === 'CREW_UPDATED' || evt.type === 'VESSELS_UPDATED' || evt.type === 'PROFILES_UPDATED') {
        refreshTenantData(tenant.id).then(() => setSyncTick((t) => t + 1));
      }
    });
    return off;
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    const liveVessels = fleetScope.filterVessels(getEffectiveDemoVessels(tenant.id));
    const liveUsers = getEffectiveDemoUsers(tenant.id);
    const liveDocs = getEffectiveDemoSmsDocs(tenant.id);
    const liveAssignments = getEffectiveDemoAssignments(tenant.id);
    setStats({
      vessels: liveVessels.length,
      users: liveUsers.length,
      pendingDocs: liveDocs.filter((d) => d.approval_state === 'pending_dpa').length,
      approvedDocs: liveDocs.filter((d) => d.approval_state === 'approved' && d.node_kind === 'document').length,
      crewOnboard: liveAssignments.filter((a) => !a.signed_off_at).length,
    });
  }, [tenant, fleetScope.isGlobal, fleetScope.assignedVesselIds.join(','), syncTick]);

  const cards = [
    { label: 'Vessels', value: stats.vessels, max: tenant?.vessels_max, icon: <Ship className="h-5 w-5" />, section: 'vessels' as CompanySection, tone: 'primary' },
    { label: 'Crew On Board', value: stats.crewOnboard, icon: <Anchor className="h-5 w-5" />, section: 'crew_management' as CompanySection, tone: 'success' },
    { label: 'Pending Approval', value: stats.pendingDocs, icon: <Clock className="h-5 w-5" />, section: 'sms_dpa' as CompanySection, tone: 'warning', feature: 'sms_documentation' as const },
    { label: 'Approved Docs', value: stats.approvedDocs, icon: <CheckCircle2 className="h-5 w-5" />, section: 'sms_dpa' as CompanySection, tone: 'success', feature: 'sms_documentation' as const },
  ].filter((c) => !('feature' in c && c.feature) || isEnabled(c.feature as ModuleKey));

  return (
    <div className="space-y-5">
      {/* Consolidated Header — title + launchpad pill */}
      <div className="flex flex-row items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">{tenant?.company}</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">Welcome, {tenantUser?.name}. Plan: {tenant?.plan} · SMS v{tenant?.sms_version}</p>
        </div>
        <div className="hidden items-center gap-2.5 rounded-full border border-ink-200/70 bg-white px-4 py-2 shadow-sm dark:border-ink-800 dark:bg-ink-900 sm:flex">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-accent-500 text-white">
            <TrendingUp className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-bold text-ink-700 dark:text-ink-200">Shore Operations</span>
          <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">{stats.vessels} vessels</span>
        </div>
      </div>

      {/* Shore Operations Launchpad */}
      <ShoreLaunchpadView
        onNavigate={(key) => {
          if (key === 'sms_documentation') onNavigate('sms_dpa');
        }}
        accent="primary"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={() => onNavigate(c.section)}
            className="group flex flex-col gap-3 rounded-xl border border-ink-200/70 bg-white p-4 text-left shadow-sm transition hover:border-primary-300 hover:shadow-md dark:border-ink-800 dark:bg-ink-900"
          >
            <div className="flex items-center justify-between">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                c.tone === 'primary' ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300' :
                c.tone === 'accent' ? 'bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300' :
                c.tone === 'warning' ? 'bg-warning-50 text-warning-600 dark:bg-warning-900/30 dark:text-warning-300' :
                'bg-success-50 text-success-600 dark:bg-success-900/30 dark:text-success-300'
              }`}>{c.icon}</div>
              <ArrowRight className="h-4 w-4 text-ink-300 transition group-hover:translate-x-1 group-hover:text-primary-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-ink-900 dark:text-white">{c.value}{c.max ? <span className="text-sm text-ink-400">/{c.max}</span> : null}</p>
              <p className="text-xs text-ink-500">{c.label}</p>
            </div>
          </button>
        ))}
      </div>

      {tenant?.storage_status && tenant.storage_status !== 'NORMAL' && (
        <StorageStatusBanner
          status={tenant.storage_status}
          usedGb={(tenant.storage_bytes_used ?? 0) / (1024 ** 3)}
          maxGb={tenant.storage_gb_max ?? 0}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-ink-200/70 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary-500" />
            <h3 className="text-sm font-bold text-ink-900 dark:text-white">License Usage</h3>
          </div>
          <div className="space-y-3">
            <UsageBar label="Vessels" used={stats.vessels} max={tenant?.vessels_max ?? 0} />
            <UsageBar label="Users" used={stats.users} max={tenant?.seats_max ?? 0} />
            <UsageBar
              label="Document Storage"
              used={(tenant?.storage_bytes_used ?? 0) / (1024 ** 3)}
              max={tenant?.storage_gb_max ?? 0}
              unit="GB"
            />
          </div>
        </div>

        <div className="rounded-xl border border-ink-200/70 bg-white p-5 dark:border-ink-800 dark:bg-ink-900">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-accent-500" />
            <h3 className="text-sm font-bold text-ink-900 dark:text-white">Compliance Status</h3>
          </div>
          <div className="space-y-2 text-sm">
            <Row label="SMS Version" value={`v${tenant?.sms_version}`} />
            <Row label="MFA Enforced" value={tenant?.mfa_enforced ? 'Yes' : 'No'} />
            <Row label="Plan" value={tenant?.plan ?? '—'} />
            <Row label="Region" value={tenant?.region ?? '—'} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StorageStatusBanner({
  status,
  usedGb,
  maxGb,
}: {
  status: 'WARNING' | 'LIMIT_REACHED' | 'OVER_LIMIT';
  usedGb: number;
  maxGb: number;
}) {
  const copy: Record<typeof status, { tone: string; title: string; message: string }> = {
    WARNING: {
      tone: 'warning',
      title: 'Storage usage is approaching your company limit.',
      message: `Your company has used ${formatGb(usedGb)} of its ${formatGb(maxGb)} document storage limit.`,
    },
    LIMIT_REACHED: {
      tone: 'danger',
      title: 'Storage limit reached.',
      message: `Your company has used ${formatGb(usedGb)} of its ${formatGb(maxGb)} document storage limit. New document uploads are currently unavailable. Please contact your administrator to increase the storage limit.`,
    },
    OVER_LIMIT: {
      tone: 'danger',
      title: 'Storage limit exceeded.',
      message: `Your company has used ${formatGb(usedGb)} of its ${formatGb(maxGb)} document storage limit. New document uploads remain disabled until usage is reduced or the limit is increased.`,
    },
  };
  const { tone, title, message } = copy[status];
  return (
    <div
      className={`flex items-start gap-2.5 rounded-xl border p-3 text-sm ${
        tone === 'danger'
          ? 'border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300'
          : 'border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-800 dark:bg-warning-900/20 dark:text-warning-300'
      }`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 text-xs opacity-90">{message}</p>
      </div>
    </div>
  );
}

// Rounding `used` and `max` to a fixed 2 decimals independently can make a
// tiny quota (e.g. a demo tenant with a 0.0098 GB limit) display as "used"
// exceeding "max" even when the real, unrounded values are the other way
// around. Pick enough decimal places to represent `max` meaningfully, and
// apply that same precision to `used` so the two numbers stay comparable.
function formatUsageValue(value: number, max: number): string {
  const decimals = max > 0 && max < 1 ? Math.min(6, Math.max(2, -Math.floor(Math.log10(max)) + 1)) : 2;
  return value.toFixed(decimals);
}

function UsageBar({ label, used, max, unit }: { label: string; used: number; max: number; unit?: string }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const tone = pct > 90 ? 'bg-danger-500' : pct > 75 ? 'bg-warning-500' : 'bg-primary-500';
  const usedText = unit ? formatUsageValue(used, max) : used;
  const maxText = unit ? formatUsageValue(max, max) : max;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-ink-600 dark:text-ink-300">{label}</span>
        <span className="font-semibold text-ink-800 dark:text-white">{usedText} / {maxText}{unit ? ` ${unit}` : ''}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-200 dark:bg-ink-700">
        <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-ink-100 pb-2 last:border-0 dark:border-ink-800">
      <span className="text-ink-500">{label}</span>
      <span className="font-semibold text-ink-800 dark:text-white">{value}</span>
    </div>
  );
}
