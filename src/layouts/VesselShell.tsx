import { useEffect, useState, type ReactNode } from 'react';
import {
  Anchor, LogOut, Ship, Lock, ShieldX, Zap, Loader2, ShieldAlert,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { startSyncLoop, getSyncStatus, getVesselSyncState, replicateToShoreNow, type SyncResult } from '../lib/syncService';
import { getLocalSmsVersion } from '../lib/localVesselDb';
import { getEffectiveDemoVessels, getEffectiveDemoAssignments, getEffectiveDemoUsers } from '../lib/demoData';
import { useVesselConnection } from '../lib/useVesselConnection';
import { VesselSyncStatusPill } from '../components/VesselSyncStatusPill';
import { useSyncConfig, useModuleDefinitions, getDisplayName, type ModuleKey } from '../lib/featureFlags';
import type { Rank } from '../lib/supabase';
import { SessionSecurityGuard, broadcastSecurityTenant } from '../components/SessionSecurityGuard';
import { NetworkStatusBadge } from '../components/NetworkStatusBadge';
import { ReconnectionBanner } from '../components/ReconnectionBanner';
import { BridgeDrawer, type DrawerSection } from '../components/BridgeDrawer';

import { Toaster } from '../components/Toaster';
import { StoreProvider } from '../store';
import { SmsUpdateBanner } from '../components/SmsUpdateBanner';
import { MaintenanceBanner } from '../components/MaintenanceBanner';

export function VesselShell({
  children, activeModule, onReturnToDashboard,
  drawerOpen, onDrawerOpenChange, drawerSection, onSelectDrawerSection,
}: {
  children: ReactNode;
  activeModule: ModuleKey | null;
  onReturnToDashboard: () => void;
  drawerOpen: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  drawerSection: DrawerSection | null;
  onSelectDrawerSection: (section: DrawerSection) => void;
}) {
  const { user, tenant, activeAssignment, tenantUser, signOut } = useAuth();
  const [localVersion, setLocalVersion] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [isReplicating, setIsReplicating] = useState(false);
  const [syncIntervalMs, setSyncIntervalMs] = useState<number | null>(null);
  const [manualReplicateEnabled, setManualReplicateEnabled] = useState(false);
  const [showReplicateConfirm, setShowReplicateConfirm] = useState(false);
  const [replicateConfirmText, setReplicateConfirmText] = useState('');

  useEffect(() => {
    broadcastSecurityTenant(tenant?.id);
  }, [tenant?.id]);

  const { config: syncConfig } = useSyncConfig(tenant?.id);
  useEffect(() => {
    if (!syncConfig) return;
    const intervalMs = syncConfig.auto_sync_interval_hours * 60 * 60 * 1000;
    setSyncIntervalMs(intervalMs);
    setManualReplicateEnabled(syncConfig.manual_replicate_enabled);
    console.log(
      `[VesselShell] sync config loaded tenant=${tenant?.id} interval=${syncConfig.auto_sync_interval_hours}h (${intervalMs}ms) manualReplicate=${syncConfig.manual_replicate_enabled} updatedBy=${syncConfig.updated_by ?? 'N/A'}`,
    );
  }, [syncConfig]);

  const crewRank: Rank | null = activeAssignment?.rank ?? tenantUser?.rank as Rank ?? null;
  const canReplicate = (crewRank === 'Master' || crewRank === 'Chief Engineer') && manualReplicateEnabled;

  const vesselConn = useVesselConnection(tenant?.id);

  const allVessels = tenant ? getEffectiveDemoVessels(tenant.id) : [];
  const vesselUsers = tenant
    ? getEffectiveDemoUsers(tenant.id).filter((u) => u.role === 'vessel')
    : [];
  const currentUserObj = vesselUsers.find((u) => u.id === user?.id) ?? vesselUsers[0];

  const assignedVesselIds = tenant && currentUserObj
    ? new Set(getEffectiveDemoAssignments(tenant.id).filter((a) => a.user_id === currentUserObj.id).map((a) => a.vessel_id))
    : new Set<string>();
  const accessibleVessels = tenant && currentUserObj
    ? allVessels.filter((v) => assignedVesselIds.has(v.id))
    : [];
  const currentVessel = accessibleVessels[0] ?? null;

  const activeVesselId = activeAssignment?.vessel_id ?? currentVessel?.id;

  useEffect(() => {
    if (!tenant?.id) return;
    const tenantId = tenant.id;
    getSyncStatus(tenantId).then((s) => {
      setLocalVersion(s.localVersion);
      setLastSync(s.lastSyncAt);
    });
  }, [tenant?.id]);

  useEffect(() => {
    if (!tenant?.id || syncIntervalMs === null) return;
    const tenantId = tenant.id;
    const vesselId = activeVesselId;
    const stop = startSyncLoop(tenantId, () => {
      getSyncStatus(tenantId).then((s) => {
        setLocalVersion(s.localVersion);
        setLastSync(s.lastSyncAt);
      });
    }, syncIntervalMs, vesselId);
    return stop;
  }, [tenant?.id, syncIntervalMs, activeVesselId]);

  useEffect(() => {
    if (!tenant?.id) return;
    getLocalSmsVersion(tenant.id).then(setLocalVersion);
  }, [tenant?.id, tenant?.sms_version]);

  const versionLabel = localVersion ?? tenant?.sms_version ?? '—';

  // Real pending-outbox count for the header sync pill — previously
  // hardcoded to 0 regardless of what was actually queued, which could
  // hide a real backlog from a crew member at sea. Re-fetched whenever a
  // sync completes (lastSync changes) so it drops back to 0 for real.
  const [pendingSyncItems, setPendingSyncItems] = useState(0);
  useEffect(() => {
    if (!tenant?.id || !activeVesselId) return;
    let cancelled = false;
    getVesselSyncState(tenant.id, activeVesselId).then((s) => {
      if (!cancelled) setPendingSyncItems(s?.pendingOutbox ?? 0);
    });
    return () => { cancelled = true; };
  }, [tenant?.id, activeVesselId, lastSync]);

  async function handleReplicateToShore() {
    if (!tenant?.id || !canReplicate || isReplicating) return;
    setShowReplicateConfirm(true);
    setReplicateConfirmText('');
  }

  async function executeReplication() {
    if (!tenant?.id || isReplicating) return;
    setIsReplicating(true);
    setShowReplicateConfirm(false);
    try {
      const result: SyncResult = await replicateToShoreNow(tenant.id, activeVesselId);
      if (result.applied) {
        setLastSync(new Date().toISOString());
        if (result.toVersion) setLocalVersion(result.toVersion);
      }
    } catch {
      // Silently handle
    } finally {
      setIsReplicating(false);
      setReplicateConfirmText('');
    }
  }

  function handleSignOut() {
    signOut();
  }

  const isMasterOrChiefEng = crewRank === 'Master' || crewRank === 'Chief Engineer';

  const { defs } = useModuleDefinitions();

  if (tenant && currentUserObj && accessibleVessels.length === 0 && !activeAssignment) {
    return (
      <StoreProvider>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-50 p-6 text-center dark:bg-ink-950">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-100 dark:bg-danger-900/30">
            <ShieldX className="h-8 w-8 text-danger-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink-900 dark:text-white">No Active Vessel Assignment</h1>
            <p className="mt-2 max-w-md text-sm text-ink-500 dark:text-ink-400">
              You are not currently signed on to any vessel. Shipboard users can only access the vessel they are actively assigned to by Company Admin.
            </p>
            <p className="mt-3 text-xs text-ink-400">Contact your Company Admin or DPA to be signed on to a vessel.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-ink-100 px-4 py-2 text-xs text-ink-500 dark:bg-ink-800 dark:text-ink-300">
            <Anchor className="h-4 w-4" /> Status: <strong className="font-semibold">Ashore / Unassigned</strong>
          </div>
          <button onClick={handleSignOut} className="btn-secondary mt-2">Sign Out</button>
        </div>
      </StoreProvider>
    );
  }

  const activeModuleLabel = activeModule ? getDisplayName(activeModule, defs) : null;

  const isInModule = activeModule !== null || drawerSection !== null;
  const vesselName = activeAssignment?.vessel_name ?? currentVessel?.name ?? tenant?.company ?? 'Vessel Portal';

  return (
    <StoreProvider>
    <SessionSecurityGuard>
    <div className="flex min-h-screen flex-col bg-ink-50 dark:bg-ink-950">
      <MaintenanceBanner />
      <ReconnectionBanner />

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-ink-100 bg-white/95 px-4 backdrop-blur dark:border-ink-800 dark:bg-ink-900/95">
        <div className="flex items-center gap-3">
          {isInModule && (
            <button
              onClick={onReturnToDashboard}
              className="flex items-center gap-1.5 rounded-lg bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-700 transition hover:bg-primary-100 dark:bg-primary-900/20 dark:text-primary-300 dark:hover:bg-primary-900/40"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Master Dashboard
            </button>
          )}

          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 text-white">
              <Anchor className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-ink-900 dark:text-white">{vesselName}</p>
              <p className="text-[10px] text-ink-400">
                {crewRank ? `${crewRank}` : 'Crew'}{activeModule ? ` · ${activeModuleLabel ?? 'Module'}` : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <NetworkStatusBadge compact />
          <VesselSyncStatusPill
            lastSyncAt={lastSync ?? vesselConn.lastSyncAt}
            pendingSyncItems={pendingSyncItems}
            localVersion={versionLabel}
          />

          {canReplicate && (
            <button
              onClick={handleReplicateToShore}
              disabled={isReplicating}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                isReplicating
                  ? 'bg-ink-200 text-ink-400 dark:bg-ink-700 dark:text-ink-500'
                  : 'bg-warning-500 text-white hover:bg-warning-600 shadow-sm'
              }`}
              title="Manually trigger data replication to shore now (requires confirmation)"
            >
              {isReplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {isReplicating ? 'Replicating…' : 'Replicate to Shore Now'}
            </button>
          )}

          {showReplicateConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowReplicateConfirm(false)}>
              <div className="w-full max-w-md rounded-xl border border-warning-200 bg-white p-6 dark:border-warning-800 dark:bg-ink-900" onClick={(e) => e.stopPropagation()}>
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning-100 dark:bg-warning-900/30">
                    <ShieldAlert className="h-5 w-5 text-warning-600 dark:text-warning-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-ink-900 dark:text-white">Confirm Shore Replication</h3>
                    <p className="text-xs text-ink-500 dark:text-ink-400">Dual-authentication security check</p>
                  </div>
                </div>
                <p className="mb-4 text-sm text-ink-600 dark:text-ink-300">
                  You are about to manually replicate <strong>all pending vessel data across every active module</strong> to the shore server. This action is logged in the audit trail.
                  Your identity: <strong className="font-semibold">{tenantUser?.name}</strong> ({crewRank})
                </p>
                <p className="mb-2 text-xs font-semibold text-ink-700 dark:text-ink-300">
                  Type <span className="font-mono text-warning-600 dark:text-warning-400">REPLICATE</span> to confirm:
                </p>
                <input
                  value={replicateConfirmText}
                  onChange={(e) => setReplicateConfirmText(e.target.value)}
                  placeholder="REPLICATE"
                  className="input mb-4 font-mono"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={() => setShowReplicateConfirm(false)} className="btn-secondary flex-1">Cancel</button>
                  <button
                    onClick={executeReplication}
                    disabled={replicateConfirmText.trim().toUpperCase() !== 'REPLICATE' || isReplicating}
                    className="flex-1 rounded-lg bg-warning-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-warning-600 disabled:opacity-40"
                  >
                    {isReplicating ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : 'Confirm Replication'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="hidden text-right sm:block">
            <p className="text-xs font-semibold text-ink-800 dark:text-white">{tenantUser?.name ?? user?.email}</p>
            <p className="text-[10px] text-ink-400">SMS v{versionLabel}{lastSync ? ` · synced ${new Date(lastSync).toLocaleTimeString()}` : ''}</p>
          </div>

          {currentVessel && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-ink-50 px-2.5 py-1.5 text-xs font-semibold text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300" title="Vessel locked to your active sign-on assignment">
              <Lock className="h-3 w-3 text-ink-400" />
              <Ship className="h-3.5 w-3.5 text-primary-500" />
              <span className="max-w-[120px] truncate">{currentVessel.name}</span>
            </div>
          )}

          {currentUserObj && (
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-ink-50 px-2.5 py-1.5 text-xs font-semibold text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-300" title="Crew identity locked to your authenticated sign-on">
              <Lock className="h-3 w-3 text-ink-400" />
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-500/15 text-[9px] font-bold text-accent-600">
                {currentUserObj.name.split(' ').map((w) => w[0]).join('')}
              </div>
              <span className="max-w-[120px] truncate">{currentUserObj.rank} {currentUserObj.name}</span>
            </div>
          )}

          <button onClick={handleSignOut} className="rounded-lg p-2 text-ink-500 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30" title="Sign Out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <SmsUpdateBanner />

      <div className="flex flex-1">
        <BridgeDrawer
          open={drawerOpen}
          onOpenChange={onDrawerOpenChange}
          vesselName={vesselName}
          crewRank={crewRank}
          isMasterOrChiefEng={isMasterOrChiefEng}
          lastSyncAt={lastSync ?? vesselConn.lastSyncAt}
          localVersion={versionLabel}
          activeSection={drawerSection}
          onSelectSection={onSelectDrawerSection}
        />

        <main className={`flex-1 overflow-x-hidden px-6 py-6 transition-all duration-200 ${drawerOpen ? 'ml-[260px]' : 'ml-0'}`}>
          {children}
        </main>
      </div>

      <Toaster />
    </div>
    </SessionSecurityGuard>
    </StoreProvider>
  );
}
