import { useEffect, useMemo, useState } from 'react';
import {
  Building2, Ship, Wifi, WifiOff, HardDrive, DollarSign, TrendingUp, TrendingDown,
  Megaphone, Radio, Gauge, ArrowUpRight, Server, Loader2, X, Pencil, Check,
} from 'lucide-react';
import { Card } from '../components/Card';
import { ProgressBar } from '../components/ProgressBar';
import { Badge } from '../components/Badge';
import { useStore } from '../store';
import { useAuth } from '../lib/auth';
import { formatCurrency, formatGb, formatNumber, relativeTime } from '../constants';
import type { Capabilities } from '../lib/permissions';
import * as api from '../lib/api';
import { isRealTenantId } from '../lib/demoData';
import { mapBannerRow } from '../components/MaintenanceBanner';
import { logAudit } from '../lib/audit';
import type { MaintenanceBanner as BannerData } from '../types';

export function DashboardView({ caps }: { caps: Capabilities }) {
  const { tenants, audit, toast } = useStore();
  const { user } = useAuth();
  const [bannerText, setBannerText] = useState('System Maintenance: The platform will undergo a brief scheduled update on 25-July at 0200 UTC. Offline sync will temporarily queue.');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('warning');
  const [targetTenantId, setTargetTenantId] = useState<string>(''); // '' = platform-wide
  const [dateRange, setDateRange] = useState<'24h' | '7d' | '30d'>('24h');
  const [activeBanners, setActiveBanners] = useState<BannerData[]>([]);
  const [bannersLoading, setBannersLoading] = useState(true);
  const [publishBusy, setPublishBusy] = useState(false);
  const [platformStorage, setPlatformStorage] = useState<api.PlatformStorage | null>(null);
  const [platformHealth, setPlatformHealth] = useState<api.PlatformHealth | null>(null);
  const [poolEditing, setPoolEditing] = useState(false);
  const [poolInput, setPoolInput] = useState('');
  const [poolSaving, setPoolSaving] = useState(false);

  useEffect(() => {
    api.apiGetPlatformStorage().then(setPlatformStorage).catch(() => {
      // Non-fatal — dashboard still renders with tenant-sum storage figures
      // if the platform-wide endpoint is unavailable (e.g. non-super-admin).
    });
    api.apiGetPlatformHealth().then(setPlatformHealth).catch(() => {
      // Non-fatal — falls back to a static 0 reading (see ResourceRow below)
      // if the platform-wide endpoint is unavailable (e.g. non-super-admin).
    });
  }, []);

  const realTenants = useMemo(() => tenants.filter((t) => isRealTenantId(t.id)), [tenants]);

  async function loadActiveBanners() {
    setBannersLoading(true);
    try {
      const rows = await api.apiGetAllBanners<Parameters<typeof mapBannerRow>[0]>();
      setActiveBanners(rows.map(mapBannerRow));
    } catch {
      // best-effort — the publish form still works even if this listing fails
    } finally {
      setBannersLoading(false);
    }
  }

  useEffect(() => { loadActiveBanners(); }, []);

  async function handlePublish() {
    if (!bannerText.trim()) return;
    setPublishBusy(true);
    try {
      const tenantId = targetTenantId || null;
      await api.apiPublishBanner(bannerText.trim(), severity, tenantId);
      const targetCompany = realTenants.find((t) => t.id === tenantId)?.company;
      await logAudit({
        tenantId: tenantId ?? undefined,
        actorEmail: user?.email ?? 'super-admin',
        category: 'system',
        action: tenantId ? `Maintenance banner published for ${targetCompany ?? tenantId}` : 'Platform-wide maintenance banner published',
        target: tenantId ? (targetCompany ?? tenantId) : 'platform',
      });
      toast({
        tone: 'success',
        title: 'Banner published',
        message: tenantId ? `Notice is now live for ${targetCompany ?? 'the selected company'} only.` : 'Notice is now live across all tenant portals.',
      });
      await loadActiveBanners();
    } catch (err) {
      toast({ tone: 'danger', title: 'Publish failed', message: (err as Error).message });
    } finally {
      setPublishBusy(false);
    }
  }

  async function handleClearBanner(banner: BannerData) {
    try {
      await api.apiClearBanner(banner.tenantId ?? null);
      await logAudit({
        tenantId: banner.tenantId ?? undefined,
        actorEmail: user?.email ?? 'super-admin',
        category: 'system',
        action: banner.tenantId ? `Maintenance banner cleared for ${banner.tenantCompany ?? banner.tenantId}` : 'Platform-wide maintenance banner cleared',
        target: banner.tenantId ? (banner.tenantCompany ?? banner.tenantId) : 'platform',
      });
      toast({ tone: 'info', title: 'Banner cleared' });
      await loadActiveBanners();
    } catch (err) {
      toast({ tone: 'danger', title: 'Clear failed', message: (err as Error).message });
    }
  }

  function startPoolEdit() {
    if (!platformStorage) return;
    setPoolInput(String(Math.round(platformStorage.poolBytes / (1024 ** 3))));
    setPoolEditing(true);
  }

  async function handleSavePool() {
    const poolGb = Number(poolInput);
    if (!poolGb || poolGb <= 0) {
      toast({ tone: 'danger', title: 'Invalid value', message: 'Enter a positive number of GB.' });
      return;
    }
    setPoolSaving(true);
    try {
      const previousGb = platformStorage ? Math.round(platformStorage.poolBytes / (1024 ** 3)) : null;
      await api.apiSetPlatformStoragePool(poolGb);
      const updated = await api.apiGetPlatformStorage();
      setPlatformStorage(updated);
      await logAudit({
        actorEmail: user?.email ?? 'super-admin',
        category: 'system',
        action: `Platform storage pool updated${previousGb != null ? ` from ${previousGb}GB` : ''} to ${poolGb}GB`,
        target: 'platform',
      });
      toast({ tone: 'success', title: 'Storage pool updated', message: `Platform pool set to ${formatGb(poolGb)}.` });
      setPoolEditing(false);
    } catch (err) {
      toast({ tone: 'danger', title: 'Update failed', message: (err as Error).message });
    } finally {
      setPoolSaving(false);
    }
  }

  const kpis = useMemo(() => {
    const activeTenants = tenants.filter((t) => t.status === 'active').length;
    const totalShips = tenants.reduce((s, t) => s + t.vessels.used, 0);
    const totalUsers = tenants.reduce((s, t) => s + t.seats.used, 0);
    // Prefer the bucket-wide actual usage (read directly from GCS via
    // /platform/storage) over summing each tenant's own usage, which is
    // pre-rounded to 0.01GB (see bytesToGb in store.tsx) — at MB-scale
    // quotas that rounding drops most tenants' usage to 0 before the sum,
    // undercounting the total. Falls back to the per-tenant sum if the
    // platform-wide endpoint isn't available (e.g. non-super-admin).
    const totalStorageUsed = platformStorage
      ? platformStorage.actualUsageBytes / (1024 ** 3)
      : tenants.reduce((s, t) => s + t.storageGb.used, 0);
    const totalStorageMax = tenants.reduce((s, t) => s + t.storageGb.max, 0);
    // Archived tenants are excluded from active subscription revenue.
    const revenue = tenants
      .filter((t) => t.status !== 'archived')
      .reduce((s, t) => s + t.monthlyRevenue, 0);
    const onlineShips = Math.round(totalShips * 0.81);
    const offlineShips = totalShips - onlineShips;
    return { activeTenants, totalTenants: tenants.length, totalShips, totalUsers, totalStorageUsed, totalStorageMax, revenue, onlineShips, offlineShips };
  }, [tenants, platformStorage]);

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">Executive Overview</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">Cross-tenant platform health & governance.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-800">
            {(['24h', '7d', '30d'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${dateRange === r ? 'bg-primary-600 text-white shadow-sm' : 'text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white'}`}
              >
                {r === '24h' ? '24 hours' : r === '7d' ? '7 days' : '30 days'}
              </button>
            ))}
          </div>
          <Badge tone="success" dot pulse>Network Online</Badge>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard
          icon={<Building2 className="h-5 w-5" />}
          label="Active Subscriptions"
          value={`${kpis.activeTenants} / ${kpis.totalTenants}`}
          sub="Tiers active across platform"
          trend={{ dir: 'up', text: '+2 this quarter' }}
          tone="primary"
        />
        <KpiCard
          icon={<Ship className="h-5 w-5" />}
          label="Vessels & Users"
          value={`${formatNumber(kpis.totalShips)}`}
          sub={`${formatNumber(kpis.totalUsers)} users · ${kpis.totalTenants} companies`}
          trend={{ dir: 'up', text: '+14 ships' }}
          tone="accent"
        />
        <KpiCard
          icon={<Wifi className="h-5 w-5" />}
          label="Fleet Sync Status"
          value={`${kpis.onlineShips}`}
          sub={`${kpis.offlineShips} offline via satellite gap`}
          gauge={{ value: kpis.onlineShips, max: kpis.totalShips, label: 'Online' }}
          tone="success"
        />
        <KpiCard
          icon={<HardDrive className="h-5 w-5" />}
          label="Platform Storage"
          value={formatGb(kpis.totalStorageUsed)}
          sub={`of ${formatGb(kpis.totalStorageMax)} allocated`}
          bar={{ value: kpis.totalStorageUsed, max: kpis.totalStorageMax }}
          tone="warning"
        />
        <KpiCard
          icon={<DollarSign className="h-5 w-5" />}
          label="Subscription Revenue"
          value={formatCurrency(kpis.revenue)}
          sub="Monthly recurring · 24 tiers active"
          trend={{ dir: 'up', text: '+8.4% MoM' }}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Maintenance broadcast */}
        <Card
          title="Maintenance Banners"
          subtitle="Publish platform-wide or company-specific notices"
          icon={<Megaphone className="h-4 w-4" />}
        >
          <div className="space-y-4">
            {bannersLoading ? (
              <p className="py-4 text-center text-xs text-ink-400">Loading active banners…</p>
            ) : activeBanners.length === 0 ? (
              <p className="rounded-lg border border-dashed border-ink-200 p-4 text-center text-xs text-ink-400 dark:border-ink-700">
                No banners currently live.
              </p>
            ) : (
              <div className="space-y-2">
                {activeBanners.map((b) => (
                  <div key={b.id} className="rounded-lg border border-warning-200 bg-warning-50 p-3 dark:border-warning-900/60 dark:bg-warning-900/20">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {b.tenantId ? <Building2 className="h-3 w-3 text-warning-700 dark:text-warning-300" /> : <Radio className="h-3 w-3 text-warning-700 dark:text-warning-300" />}
                          <p className="text-xs font-bold uppercase tracking-wide text-warning-700 dark:text-warning-300">
                            {b.tenantId ? (b.tenantCompany ?? 'Company-specific') : 'Platform-wide'}
                          </p>
                        </div>
                        <p className="mt-1 text-sm text-ink-800 dark:text-ink-100">{b.message}</p>
                        <p className="mt-1 text-[11px] text-ink-500">Published {relativeTime(b.publishedAt)} · {b.publishedBy}</p>
                      </div>
                      {caps.maintenancePublish && (
                        <button
                          onClick={() => handleClearBanner(b)}
                          className="shrink-0 rounded p-1 text-ink-400 hover:bg-danger-100 hover:text-danger-600 dark:hover:bg-danger-900/30 dark:hover:text-danger-400"
                          title="Clear this banner"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {caps.maintenancePublish ? (
              <div className="space-y-3 border-t border-ink-100 pt-3 dark:border-ink-800">
                <div>
                  <label className="label">Target</label>
                  <select
                    className="input"
                    value={targetTenantId}
                    onChange={(e) => setTargetTenantId(e.target.value)}
                  >
                    <option value="">Platform-wide (all companies)</option>
                    {realTenants.map((t) => (
                      <option key={t.id} value={t.id}>{t.company}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-ink-400">
                    Company notices only appear for that company's own users — nobody else sees them.
                  </p>
                </div>
                <div>
                  <label className="label">Notice message</label>
                  <textarea
                    value={bannerText}
                    onChange={(e) => setBannerText(e.target.value)}
                    rows={3}
                    className="input resize-none"
                  />
                </div>
                <div>
                  <label className="label">Severity</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['info', 'warning', 'critical'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setSeverity(s)}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-semibold capitalize transition ${severity === s
                          ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-900/30 dark:text-primary-300'
                          : 'border-ink-200 text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800'}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handlePublish}
                  disabled={publishBusy || !bannerText.trim()}
                  className="btn-primary w-full flex justify-center items-center gap-2 px-3 py-2 rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {publishBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                  {targetTenantId ? `Publish to ${realTenants.find((t) => t.id === targetTenantId)?.company ?? 'company'}` : 'Publish platform-wide'}
                </button>
              </div>
            ) : (
              <p className="py-2 text-center text-sm text-ink-400">No maintenance permissions for your role.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Resource indicators */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Platform Resource Health" subtitle="Real-time infrastructure indicators" icon={<Gauge className="h-4 w-4" />}>
          <div className="space-y-4">
            <ResourceRow
              icon={<Server className="h-4 w-4" />}
              label="CPU utilization"
              value={platformHealth?.cpuPercent ?? 0}
              unit="%"
              tone={!platformHealth ? 'success' : platformHealth.cpuPercent >= 85 ? 'danger' : platformHealth.cpuPercent >= 60 ? 'warning' : 'success'}
            />
            {platformStorage ? (
              <div>
                <ResourceRow
                  icon={<HardDrive className="h-4 w-4" />}
                  label="GCS storage pool"
                  value={platformStorage.percentage}
                  unit="%"
                  tone={platformStorage.percentage >= 100 ? 'danger' : platformStorage.percentage >= 80 ? 'warning' : 'success'}
                />
                {poolEditing ? (
                  <div className="mt-2 flex items-center gap-1.5 pl-6">
                    <input
                      type="number"
                      min={1}
                      className="input h-7 w-24 py-1 text-xs"
                      value={poolInput}
                      onChange={(e) => setPoolInput(e.target.value)}
                      autoFocus
                    />
                    <span className="text-[11px] text-ink-400">GB pool</span>
                    <button
                      onClick={handleSavePool}
                      disabled={poolSaving}
                      className="btn-primary rounded-md px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                      title="Save"
                    >
                      {poolSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    </button>
                    <button
                      onClick={() => setPoolEditing(false)}
                      disabled={poolSaving}
                      className="btn-ghost rounded-md p-1 disabled:cursor-not-allowed disabled:opacity-50"
                      title="Cancel"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 flex items-center justify-between gap-2 pl-6">
                    <p className="text-[11px] text-ink-400">
                      {formatGb(platformStorage.actualUsageBytes / (1024 ** 3))} used of {formatGb(platformStorage.poolBytes / (1024 ** 3))} allocated · {formatGb(platformStorage.remainingBytes / (1024 ** 3))} remaining
                    </p>
                    {caps.billingEdit && (
                      <button
                        onClick={startPoolEdit}
                        className="shrink-0 rounded p-1 text-ink-400 hover:bg-primary-50 hover:text-primary-600 dark:hover:bg-primary-900/30 dark:hover:text-primary-300"
                        title="Edit allocated storage pool"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <ResourceRow icon={<HardDrive className="h-4 w-4" />} label="GCS storage pool" value={0} unit="%" tone="success" />
            )}
            <ResourceRow
              icon={<Radio className="h-4 w-4" />}
              label="API traffic (p95)"
              value={platformHealth?.apiP95Ms ?? 0}
              max={500}
              unit="ms"
              tone={!platformHealth ? 'success' : platformHealth.apiP95Ms >= 400 ? 'danger' : platformHealth.apiP95Ms >= 200 ? 'warning' : 'success'}
            />
          </div>
        </Card>

        <Card title="License Compliance Snapshot" subtitle="Tenants near or over quota" icon={<TrendingUp className="h-4 w-4" />}>
          <div className="space-y-3">
            {tenants.map((t) => {
              const overVessels = t.vessels.used > t.vessels.max;
              const overStorage = t.storageGb.status
                ? t.storageGb.status === 'OVER_LIMIT' || t.storageGb.status === 'LIMIT_REACHED'
                : t.storageGb.used > t.storageGb.max;
              const nearSeats = t.seats.used / t.seats.max > 0.9;
              if (!overVessels && !overStorage && !nearSeats) return null;
              return (
                <div key={t.id} className="flex items-center justify-between rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
                  <div>
                    <p className="text-sm font-semibold text-ink-900 dark:text-white">{t.company}</p>
                    <p className="text-xs text-ink-500">
                      {overVessels && <span className="text-danger-600 dark:text-danger-400">Vessels over limit · </span>}
                      {overStorage && <span className="text-danger-600 dark:text-danger-400">Storage breach · </span>}
                      {nearSeats && <span className="text-warning-600 dark:text-warning-400">Seats near cap</span>}
                    </p>
                  </div>
                  <Badge tone={overVessels || overStorage ? 'danger' : 'warning'}>Breach Warning</Badge>
                </div>
              );
            })}
            {tenants.every((t) => t.vessels.used <= t.vessels.max && t.storageGb.used <= t.storageGb.max && t.seats.used / t.seats.max <= 0.9) && (
              <p className="py-6 text-center text-sm text-ink-400">All tenants within license limits.</p>
            )}
          </div>
        </Card>

        <Card title="Recent Audit Activity" subtitle="Last 5 high-risk events" icon={<ArrowUpRight className="h-4 w-4" />}>
          <div className="space-y-2">
            {audit.slice(0, 5).map((e) => (
              <div key={e.id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-ink-50 dark:hover:bg-ink-800/50">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.severity === 'critical' ? 'bg-danger-500' : e.severity === 'warning' ? 'bg-warning-500' : 'bg-primary-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink-800 dark:text-ink-100">{e.action}</p>
                  <p className="text-[11px] text-ink-500">{e.actor} · {relativeTime(e.ts)}</p>
                </div>
                {e.impersonation && <Badge tone="danger">Impersonation</Badge>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon, label, value, sub, trend, bar, gauge, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  trend?: { dir: 'up' | 'down'; text: string };
  bar?: { value: number; max: number };
  gauge?: { value: number; max: number; label: string };
  tone: 'primary' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const tones = {
    primary: 'from-primary-500/10 to-primary-500/0 text-primary-600 dark:text-primary-400',
    success: 'from-success-500/10 to-success-500/0 text-success-600 dark:text-success-400',
    warning: 'from-warning-500/10 to-warning-500/0 text-warning-600 dark:text-warning-400',
    danger: 'from-danger-500/10 to-danger-500/0 text-danger-600 dark:text-danger-400',
    accent: 'from-accent-500/10 to-accent-500/0 text-accent-600 dark:text-accent-400',
  };
  const barTone = tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : tone === 'danger' ? 'danger' : 'primary';
  return (
    <div className="card group relative overflow-hidden p-5 hover:shadow-elev-2">
      <div className={`absolute inset-x-0 top-0 h-20 bg-gradient-to-b ${tones[tone]}`} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-elev-1 dark:bg-ink-800 ${tones[tone]}`}>{icon}</div>
          {trend && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${trend.dir === 'up' ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400'}`}>
              {trend.dir === 'up' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {trend.text}
            </span>
          )}
        </div>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">{label}</p>
        <p className="mt-1 text-2xl font-bold text-ink-900 dark:text-white">{value}</p>
        <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{sub}</p>
        {bar && (
          <div className="mt-3">
            <ProgressBar value={bar.value} max={bar.max} tone={barTone as 'primary' | 'success' | 'warning' | 'danger'} size="sm" showLabel />
          </div>
        )}
        {gauge && (
          <div className="mt-3 flex items-center gap-2">
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-700">
              <div className="h-full rounded-full bg-success-500 transition-all" style={{ width: `${(gauge.value / gauge.max) * 100}%` }} />
            </div>
            <span className="text-xs font-semibold text-success-600 dark:text-success-400">
              <Wifi className="mr-1 inline h-3 w-3" />{gauge.value}
            </span>
            <span className="text-xs text-ink-400">
              <WifiOff className="mr-1 inline h-3 w-3" />{gauge.max - gauge.value}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ResourceRow({ icon, label, value, unit, tone, max = 100 }: { icon: React.ReactNode; label: string; value: number; unit: string; tone: 'success' | 'warning' | 'danger'; max?: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-ink-700 dark:text-ink-200">
          <span className="text-ink-400">{icon}</span>
          {label}
        </span>
        <span className={`text-sm font-bold ${tone === 'success' ? 'text-success-600 dark:text-success-400' : tone === 'warning' ? 'text-warning-600 dark:text-warning-400' : 'text-danger-600 dark:text-danger-400'}`}>{value}{unit}</span>
      </div>
      <ProgressBar value={value} max={max} tone={tone} size="sm" />
    </div>
  );
}
