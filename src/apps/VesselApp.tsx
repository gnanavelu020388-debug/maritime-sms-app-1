import { useState, useEffect, useCallback } from 'react';
import { VesselShell } from '../layouts/VesselShell';
import { VesselPortalView } from '../views/vessel/VesselPortalView';
import { useAuth } from '../lib/auth';
import { getSyncStatus } from '../lib/syncService';
import type { ModuleKey } from '../lib/featureFlags';
import type { DrawerSection } from '../components/BridgeDrawer';

export function VesselApp() {
  const { tenant } = useAuth();
  const [activeModule, setActiveModule] = useState<ModuleKey | null>(null);
  const [drawerSection, setDrawerSection] = useState<DrawerSection | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(true);

  // Real local SMS version + last-sync timestamp for the portal's status
  // panel — previously hardcoded to null/"—" regardless of actual state.
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState<string>('—');
  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    getSyncStatus(tenant.id).then((s) => {
      if (cancelled) return;
      setLastSyncAt(s.lastSyncAt);
      setLocalVersion(s.localVersion ?? '—');
    });
    return () => { cancelled = true; };
  }, [tenant?.id]);

  useEffect(() => {
    const handler = (e: Event) => {
      const key = (e as CustomEvent).detail as ModuleKey;
      setDrawerSection(null);
      setActiveModule(key);
    };
    window.addEventListener('vessel-launch-module', handler);
    return () => window.removeEventListener('vessel-launch-module', handler);
  }, []);

  const handleReturnToDashboard = useCallback(() => {
    setActiveModule(null);
    setDrawerSection(null);
  }, []);

  const handleSelectDrawerSection = useCallback((section: DrawerSection) => {
    setActiveModule(null);
    setDrawerSection((prev) => (prev === section ? null : section));
  }, []);

  const handleClearDrawerSection = useCallback(() => {
    setDrawerSection(null);
  }, []);

  const content = (
    <VesselShell
      activeModule={activeModule}
      onReturnToDashboard={handleReturnToDashboard}
      drawerOpen={drawerOpen}
      onDrawerOpenChange={setDrawerOpen}
      drawerSection={drawerSection}
      onSelectDrawerSection={handleSelectDrawerSection}
    >
      <VesselPortalView
        activeModule={activeModule}
        onReturnToDashboard={handleReturnToDashboard}
        drawerSection={drawerSection}
        onClearDrawerSection={handleClearDrawerSection}
        lastSyncAt={lastSyncAt}
        localVersion={localVersion}
      />
    </VesselShell>
  );

  return content;
}
