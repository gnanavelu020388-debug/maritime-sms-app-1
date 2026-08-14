import { useEffect, useState } from 'react';
import { StoreProvider, useStore, type HydratedTenantRow } from '../store';
import { Sidebar } from '../components/Sidebar';
import { Topbar } from '../components/Topbar';
import { MaintenanceBanner } from '../components/MaintenanceBanner';
import { Toaster } from '../components/Toaster';
import { DashboardView } from '../views/DashboardView';
import { TenantsView } from '../views/TenantsView';
import { SmsView } from '../views/SmsView';
import { UsersView } from '../views/UsersView';
import { SecurityView } from '../views/SecurityView';
import { MonitoringView } from '../views/MonitoringView';
import { BillingView } from '../views/BillingView';
import { BackupsView } from '../views/BackupsView';
import { ProvisioningView } from '../views/ProvisioningView';
import { FeatureMatrixView } from '../views/FeatureMatrixView';
import type { SectionId } from '../types';
import type { User, PlatformRole, InternalRole } from '../lib/supabase';
import { INTERNAL_ROLE_LABEL, INTERNAL_ROLE_SUMMARY, canAccessSection, capabilitiesFor } from '../lib/permissions';
import { LogOut, Lock } from 'lucide-react';
import { refreshAllTenants, refreshTenantData } from '../lib/dataCache';
import { getEffectiveDemoTenants, getEffectiveDemoUsers, getEffectiveDemoVessels } from '../lib/demoData';
import * as api from '../lib/api';
import type { AuditLogRow, InvoiceRow, BackupSnapshotRow, PlatformStaffRow, ErrorLogRow } from '../lib/supabase';

export function SuperAdminShell(props: { user: User; role: PlatformRole; internalRole: InternalRole | null; onSignOut: () => void }) {
  return (
    <StoreProvider>
      <SuperAdminShellInner {...props} />
    </StoreProvider>
  );
}

function SuperAdminShellInner({ user, internalRole, onSignOut }: { user: User; role: PlatformRole; internalRole: InternalRole | null; onSignOut: () => void }) {
  const { dispatch } = useStore();
  const [active, setActive] = useState<SectionId>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const roleKey: InternalRole = internalRole ?? 'super_admin';
  const caps = capabilitiesFor(roleKey);

  // If the current section is outside this role's access matrix, show a
  // locked access-denied screen instead of the view.
  const sectionDenied = !canAccessSection(roleKey, active);

  // Pull real tenants from the backend once per session, at the shell level
  // rather than inside TenantsView — otherwise any view that needs the real
  // tenant list (e.g. the Dashboard's banner target picker) comes up empty
  // until the Super Admin happens to visit the Tenants page first.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshAllTenants();
        const rows = getEffectiveDemoTenants();
        await Promise.all(rows.map((r) => refreshTenantData(r.id)));
        if (cancelled) return;
        const hydrated: HydratedTenantRow[] = rows.map((r) => ({
          ...r,
          seatsUsed: getEffectiveDemoUsers(r.id).length,
          vesselsUsed: getEffectiveDemoVessels(r.id).length,
        }));
        dispatch({ type: 'TENANTS_HYDRATE', rows: hydrated });
      } catch {
        // Best-effort — views still show local/demo tenants if this fails.
      }

      // Super-Admin-only flat datasets — fetched once per session, in
      // parallel, independent of tenant hydration succeeding above.
      const [auditRows, invoiceRows, backupRows, staffRows, errRows, tierRows] = await Promise.all([
        api.apiGetAuditLogs<AuditLogRow>().catch(() => []),
        api.apiGetInvoices<InvoiceRow>().catch(() => []),
        api.apiGetBackups<BackupSnapshotRow>().catch(() => []),
        api.apiGetPlatformStaff<PlatformStaffRow>().catch(() => []),
        api.apiGetErrorLogs<ErrorLogRow>().catch(() => []),
        api.apiGetTierConfigs().catch(() => []),
      ]);
      if (cancelled) return;
      dispatch({ type: 'AUDIT_HYDRATE', rows: auditRows });
      dispatch({ type: 'INVOICES_HYDRATE', rows: invoiceRows });
      dispatch({ type: 'BACKUPS_HYDRATE', rows: backupRows });
      dispatch({ type: 'STAFF_HYDRATE', rows: staffRows });
      dispatch({ type: 'ERROR_LOGS_HYDRATE', rows: errRows });
      dispatch({ type: 'TIER_CONFIGS_HYDRATE', rows: tierRows });
    })();
    return () => { cancelled = true; };
  }, [dispatch]);

  return (
      <div className="flex h-screen overflow-hidden bg-ink-50 dark:bg-ink-950">
        <Sidebar active={active} onNavigate={setActive} open={sidebarOpen} onClose={() => setSidebarOpen(false)} roleKey={roleKey} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MaintenanceBanner />
          <Topbar active={active} onMenu={() => setSidebarOpen(true)} />
          <div className="flex items-center justify-between border-b border-ink-100 bg-white px-4 py-2 dark:border-ink-800 dark:bg-ink-900">
            <span className="text-xs text-ink-500">Signed in as <strong className="text-ink-800 dark:text-white">{user.email}</strong> · <span className="font-semibold text-primary-600">{INTERNAL_ROLE_LABEL[roleKey]}</span></span>
            <button onClick={onSignOut} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800">
              <LogOut className="h-3.5 w-3.5" /> Sign Out
            </button>
          </div>
          <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1920px] animate-fade-in">
              {sectionDenied ? (
                <AccessDenied roleKey={roleKey} />
              ) : (
                <>
                  {active === 'dashboard' && <DashboardView caps={caps} />}
                  {active === 'tenants' && <TenantsView caps={caps} />}
                  {active === 'provisioning' && <ProvisioningView caps={caps} />}
                  {active === 'sms' && <SmsView caps={caps} />}
                  {active === 'users' && <UsersView caps={caps} />}
                  {active === 'security' && <SecurityView caps={caps} />}
                  {active === 'monitoring' && <MonitoringView caps={caps} />}
                  {active === 'billing' && <BillingView caps={caps} />}
                  {active === 'backups' && <BackupsView caps={caps} />}
                  {active === 'features' && <FeatureMatrixView caps={caps} />}
                </>
              )}
            </div>
          </main>
        </div>
        <Toaster />
      </div>
  );
}

function AccessDenied({ roleKey }: { roleKey: InternalRole }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-100 text-ink-400 dark:bg-ink-800 dark:text-ink-500">
        <Lock className="h-7 w-7" />
      </div>
      <p className="text-lg font-bold text-ink-900 dark:text-white">Access restricted</p>
      <p className="max-w-md text-sm text-ink-500 dark:text-ink-400">
        Your role <strong>{INTERNAL_ROLE_LABEL[roleKey]}</strong> does not include this console area. {INTERNAL_ROLE_SUMMARY[roleKey]}
      </p>
    </div>
  );
}
