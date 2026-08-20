import { useEffect, useState } from "react";
import {
  Building2,
  Plus,
  Pencil,
  Ban,
  CheckCircle2,
  LogIn,
  ShieldCheck,
  Archive,
  RotateCcw,
  ArchiveRestore,
  Trash2,
  Grid3x3,
  Loader2,
  Eye,
  EyeOff,
  TrendingUp,
} from "lucide-react";
import { Card } from "../components/Card";
import { Modal } from "../components/Modal";
import { Toggle } from "../components/Toggle";
import { Badge, StatusBadge } from "../components/Badge";
import { DataTable, type Column } from "../components/DataTable";
import { CriticalActionWizard } from "../components/CriticalActionWizard";
import { UpgradeModal } from "../components/UpgradeModal";
import { useStore } from "../store";
import { useAuth } from "../lib/auth";
import { formatUtc } from "../constants";
import type { Capabilities } from "../lib/permissions";
import type { PlanTier, Tenant, TenantStatus, TierConfig } from "../types";
import {
  demoCreateTenant,
  demoCreateUser,
  demoCloneMasterSms,
  getEffectiveDemoUsers,
  hydrateAllTenants,
} from "../lib/demoData";
import {
  MODULE_KEYS,
  fetchEnabledFeatures,
  onFeatureFlagsChanged,
} from "../lib/featureFlags";
import * as api from "../lib/api";
import { logAudit } from "../lib/audit";
import { nextPlanUp, upgradeTenantPlan } from "../lib/tenantUpgrade";
import { detectTenantBreaches } from "../lib/breachDetection";

// Short, human-friendly display code (e.g. "T-0007") for real tenants —
// the UUID in t.id remains the actual identifier used for every API call
// and dispatch; this is purely what's shown/typed by a human. Legacy demo
// tenants have no tenantNo and just show their already-short id.
function displayTenantId(t: Tenant): string {
  return t.tenantNo != null ? `T-${String(t.tenantNo).padStart(4, "0")}` : t.id;
}

export function TenantsView({ caps }: { caps: Capabilities }) {
  const { tenants, tierConfigs, dispatch, toast } = useStore();
  const { user } = useAuth();
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [editingAdminStatus, setEditingAdminStatus] = useState<{
    mustChangePassword: boolean;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<Tenant | null>(null);
  const [suspendConfirm, setSuspendConfirm] = useState<Tenant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [upgradeFor, setUpgradeFor] = useState<Tenant | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>("Professional");
  const [enabledModuleCounts, setEnabledModuleCounts] = useState<
    Record<string, number>
  >({});

  // Pull the full tenant ledger from the backend.
  async function hydrateTenants() {
    try {
      await hydrateAllTenants(dispatch);
    } catch {
      // Best-effort — the ledger still shows local/demo tenants if this fails.
    }
  }

  useEffect(() => {
    hydrateTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The "Feature Flags" column must reflect the Tenant Feature Matrix (the
  // feature_flags overrides + default-enabled set), not the tenant row's own
  // `modules` array — that array is only a legacy snapshot and can drift out
  // of sync with what's actually toggled on in the matrix.
  useEffect(() => {
    let mounted = true;
    const loadCounts = async (ids: string[]) => {
      const entries = await Promise.all(
        ids.map(
          async (id) => [id, (await fetchEnabledFeatures(id)).size] as const,
        ),
      );
      if (mounted) {
        setEnabledModuleCounts((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }));
      }
    };
    loadCounts(tenants.map((t) => t.id));
    const unsub = onFeatureFlagsChanged((tenantId) => loadCounts([tenantId]));
    return () => {
      mounted = false;
      unsub();
    };
  }, [tenants]);

  async function saveTenant(tenant: Tenant) {
    setSaveError(null);
    if (editing) {
      setSaveBusy(true);
      try {
        await api.apiUpdateTenant(editing.id, {
          company: tenant.company,
          contact_email: tenant.contactEmail,
          plan: tenant.plan,
          status: tenant.status,
          vessels_max: tenant.vessels.max,
          seats_max: tenant.seats.max,
          storage_gb_max: tenant.storageGb.max,
          monthly_revenue: tenant.monthlyRevenue,
          mfa_enforced: tenant.mfaEnforced,
        });
      } catch (err) {
        // Offline: the edit is safely queued, not rejected — close the form
        // like a normal save instead of leaving it open on an error. Skip
        // the audit log + dispatch below since the edit hasn't actually
        // landed yet; the toast says it won't show up until it syncs.
        if (api.isOfflineQueued(err)) {
          toast({ tone: "info", title: "Saved locally", message: (err as Error).message });
          setSaveBusy(false);
          setEditing(null);
          setCreating(false);
          return;
        }
        setSaveError((err as Error).message || "Failed to update tenant.");
        setSaveBusy(false);
        return;
      }
      setSaveBusy(false);
      await logAudit({
        tenantId: editing.id,
        actorEmail: user?.email ?? "super-admin",
        category: "tenant",
        action: `Tenant edited: ${tenant.company}`,
        target: tenant.company,
        before: {
          company: editing.company,
          contact_email: editing.contactEmail,
          plan: editing.plan,
          status: editing.status,
          vessels_max: editing.vessels.max,
          seats_max: editing.seats.max,
          storage_gb_max: editing.storageGb.max,
          monthly_revenue: editing.monthlyRevenue,
          mfa_enforced: editing.mfaEnforced,
        },
        after: {
          company: tenant.company,
          contact_email: tenant.contactEmail,
          plan: tenant.plan,
          status: tenant.status,
          vessels_max: tenant.vessels.max,
          seats_max: tenant.seats.max,
          storage_gb_max: tenant.storageGb.max,
          monthly_revenue: tenant.monthlyRevenue,
          mfa_enforced: tenant.mfaEnforced,
        },
      });
      dispatch({ type: "TENANT_UPDATE", id: editing.id, patch: tenant });
      toast({
        tone: "success",
        title: "Tenant updated",
        message: `${tenant.company} saved.`,
      });
      setEditing(null);
      setCreating(false);
      return;
    }

    setSaveBusy(true);
    try {
      // Create the real tenant + a company_admin account (using the Company
      // Email / Password fields) in the backend, so it can actually be used
      // to log in — this is separate from the Live Provisioning Studio flow.
      const tenantId = await demoCreateTenant({
        company: tenant.company,
        contact_email: tenant.contactEmail,
        plan: tenant.plan,
        vessels_max: tenant.vessels.max,
        seats_max: tenant.seats.max,
        storage_gb_max: tenant.storageGb.max,
        monthly_revenue: tenant.monthlyRevenue,
      });
      demoCloneMasterSms(tenantId);
      await demoCreateUser(tenantId, {
        name: `${tenant.company} Admin`,
        email: tenant.companyEmail.toLowerCase().trim(),
        password: tenant.companyMailPassword,
        employee_id: null,
        passport_number: null,
        seaman_book_number: null,
        nationality: null,
        rank: "DPA",
        role: "company_admin",
        status: "active",
      });
      await logAudit({
        tenantId,
        actorEmail: user?.email ?? "super-admin",
        category: "tenant",
        action: `Tenant provisioned: ${tenant.company}`,
        target: tenant.contactEmail,
      });
      await logAudit({
        tenantId,
        actorEmail: user?.email ?? "super-admin",
        category: "security",
        action: `Provisioned company_admin: ${tenant.company} Admin <${tenant.companyEmail}>`,
        target: tenant.companyEmail,
        location: tenant.company,
      });

      const newTenant: Tenant = {
        ...tenant,
        id: tenantId,
        companyMailPassword: "",
      };
      dispatch({ type: "TENANT_CREATE", tenant: newTenant });
      toast({
        tone: "success",
        title: "Tenant provisioned",
        message: `${newTenant.company} created. Company admin can log in with ${tenant.companyEmail}.`,
      });
      setEditing(null);
      setCreating(false);
      // Re-hydrate so the new tenant immediately picks up its real tenant_no
      // instead of showing its raw UUID until the next visit to this page.
      hydrateTenants();
    } catch (err) {
      if (api.isOfflineQueued(err)) {
        toast({ tone: "info", title: "Saved locally", message: (err as Error).message });
        setEditing(null);
        setCreating(false);
        return;
      }
      setSaveError((err as Error).message || "Failed to provision tenant.");
    } finally {
      setSaveBusy(false);
    }
  }

  // "ok" = actually applied — caller shows its specific success toast.
  // "queued" — safely captured but not applied yet; setTenantStatus already
  // showed the "Saved locally" toast itself, so the caller must NOT also
  // show its own "Tenant archived"/"Suspended" toast (that would both
  // duplicate the notification and falsely claim the status already
  // changed) — it should just close its confirmation modal, same as "ok".
  // "failed" — a real error; caller keeps its modal open.
  async function setTenantStatus(
    t: Tenant,
    status: TenantStatus,
  ): Promise<"ok" | "queued" | "failed"> {
    try {
      await api.apiUpdateTenant(t.id, { status });
    } catch (err) {
      if (api.isOfflineQueued(err)) {
        toast({ tone: "info", title: "Saved locally", message: (err as Error).message });
        return "queued";
      }
      toast({
        tone: "danger",
        title: "Status update failed",
        message: (err as Error).message,
      });
      return "failed";
    }
    await logAudit({
      tenantId: t.id,
      actorEmail: user?.email ?? "super-admin",
      category: "tenant",
      action: `Tenant ${status}: ${t.company}`,
      target: t.company,
      severity:
        status === "suspended" || status === "archived" ? "critical" : "info",
      before: { status: t.status },
      after: { status },
    });
    dispatch({ type: "TENANT_SET_STATUS", id: t.id, status });
    return "ok";
  }

  function loginAsTenant(t: Tenant) {
    const params = new URLSearchParams();
    params.set("previewTenant", t.id);
    window.open(
      `${window.location.pathname}?${params.toString()}`,
      "maritime_company_preview",
      "width=1280,height=860,scrollbars=1",
    );
    void logAudit({
      tenantId: t.id,
      actorEmail: user?.email ?? "super-admin",
      category: "impersonation",
      action: `Login As — read-only Company Admin preview opened: ${t.company}`,
      target: t.contactEmail,
      severity: "critical",
      after: { inspecting: true, tenant: t.company },
    });
    toast({
      tone: "info",
      title: "Opening read-only Company Admin portal",
      message: `Inspecting ${t.company}'s Company Admin portal in a new window (read-only — changes and document opens are disabled).`,
    });
  }

  // Master Tenant Ledger filter toggle: Active/Trial vs Archived.
  const visibleTenants = showArchived
    ? tenants.filter((t) => t.status === "archived")
    : tenants.filter((t) => t.status !== "archived");

  const columns: Column<Tenant>[] = [
    {
      key: "company",
      header: "Company",
      width: "min-w-[280px]",
      sortValue: (t) => t.company,
      render: (t) => {
        return (
          <div className="flex items-center gap-2.5 py-0.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary-500/15 to-accent-500/15 text-[10px] font-bold text-primary-700 dark:text-primary-300">
              {t.company
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0])
                .join("")}
            </div>
            <div className="min-w-0">
              <p className="whitespace-normal text-sm font-semibold leading-tight text-ink-900 dark:text-white">
                {t.company}
              </p>
              <p className="text-[11px] leading-tight text-ink-400">
                {displayTenantId(t)}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: "plan",
      header: "Plan",
      sortValue: (t) => t.plan,
      render: (t) => (
        <div className="flex items-center gap-1.5">
          <input
            value={t.plan}
            readOnly
            className="rounded border border-ink-200 w-[110px] bg-white px-1.5 py-0.5 text-xs text-center cursor-default font-semibold text-ink-700 outline-none dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
          />
          {caps.tenantEdit && t.status !== "archived" && (
            <button
              onClick={() => {
                setUpgradeFor(t);
                setSelectedPlan(nextPlanUp(t.plan, tierConfigs));
              }}
              className="btn-ghost rounded-md p-1.5 text-primary-600 dark:text-primary-400"
              title="Upgrade / change plan"
            >
              <TrendingUp className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ),
    },
    {
      key: "limits",
      header: "Assigned Limits",
      width: "min-w-[200px]",
      render: (t) => {
        const breaches = detectTenantBreaches(t);
        const overV = breaches.includes("vessels");
        const overS = breaches.includes("seats");
        const overG = breaches.includes("storage");
        return (
          <div className="grid grid-cols-3 gap-3 py-0.5">
            <MiniLimit
              label="Ships"
              used={t.vessels.used}
              max={t.vessels.max}
              over={overV}
              delayMs={0}
            />
            <MiniLimit
              label="Users"
              used={t.seats.used}
              max={t.seats.max}
              over={overS}
              delayMs={60}
            />
            <MiniLimit
              label="GB"
              used={t.storageGb.used}
              max={t.storageGb.max}
              over={overG}
              delayMs={120}
            />
          </div>
        );
      },
    },
    {
      key: "enabled_apps",
      header: "Enabled Apps",
      render: (t) => (
        <div className="flex justify-center py-0.5">
          <Badge tone="info" className="!text-[10px] !px-1.5 !py-0">
            {enabledModuleCounts[t.id] ?? t.modules.length}/{MODULE_KEYS.length}{" "}
            active
          </Badge>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (t) => t.status,
      render: (t) => <StatusBadge status={t.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      width: "min-w-[200px]",
      render: (t) => (
        <div className="flex items-center gap-1">
          {t.status === "archived" ? (
            caps.tenantArchive ? (
              <button
                onClick={async () => {
                  const result = await setTenantStatus(t, "active");
                  if (result === "failed") return;
                  if (result === "ok") {
                    toast({
                      tone: "success",
                      title: "Tenant restored",
                      message: `${t.company} reactivated. Login access re-enabled.`,
                    });
                  }
                }}
                className="inline-flex items-center gap-1 rounded bg-success-50 px-1.5 py-0.5 text-[11px] font-semibold text-success-700 hover:bg-success-100 dark:bg-success-900/30 dark:text-success-300 dark:hover:bg-success-900/50"
                title="Restore Tenant"
              >
                <RotateCcw className="h-3 w-3" /> Restore
              </button>
            ) : (
              <span className="text-[10px] text-ink-400">Archived</span>
            )
          ) : (
            <>
              <button
                onClick={() => {
                  // The tenant record itself has no company-admin email/password —
                  // those live on the separate tenant_users row. Pull the real
                  // email in so it actually shows instead of the blank default.
                  const admin = getEffectiveDemoUsers(t.id).find(
                    (u) => u.role === "company_admin",
                  );
                  setEditing(admin ? { ...t, companyEmail: admin.email } : t);
                  setEditingAdminStatus(
                    admin
                      ? { mustChangePassword: !!admin.must_change_password }
                      : null,
                  );
                }}
                disabled={!caps.tenantEdit}
                className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-ink-700 dark:hover:text-ink-200"
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {t.status === "active" || t.status === "trial" ? (
                <button
                  onClick={() => setSuspendConfirm(t)}
                  disabled={!caps.tenantEdit}
                  className="rounded p-1 text-ink-400 hover:bg-danger-50 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-danger-900/30 dark:hover:text-danger-400"
                  title="Suspend"
                >
                  <Ban className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={async () => {
                    const result = await setTenantStatus(t, "active");
                    if (result === "failed") return;
                    if (result === "ok") {
                      toast({
                        tone: "success",
                        title: "Activated",
                        message: t.company,
                      });
                    }
                  }}
                  disabled={!caps.tenantEdit}
                  className="rounded p-1 text-ink-400 hover:bg-success-50 hover:text-success-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-success-900/30 dark:hover:text-success-400"
                  title="Activate"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
              )}
              {caps.tenantArchive && (
                <button
                  onClick={() => setArchiveConfirm(t)}
                  className="rounded p-1 text-ink-400 hover:bg-ink-200 hover:text-ink-700 dark:hover:bg-ink-700 dark:hover:text-ink-200"
                  title="Archive Tenant"
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              )}
              {caps.tenantArchive && (
                <button
                  onClick={() => setDeleteTarget(t)}
                  className="rounded p-1 text-ink-400 hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30 dark:hover:text-danger-400"
                  title="Delete Tenant"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              {caps.impersonate && (
                <button
                  onClick={() => loginAsTenant(t)}
                  className="inline-flex items-center gap-1 rounded bg-primary-50 px-1.5 py-0.5 text-[11px] font-semibold text-primary-700 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50"
                  title="Login As"
                >
                  <LogIn className="h-3 w-3" /> Login As
                </button>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink-900 dark:text-white">
            Tenant & Company Management
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Onboard, configure and govern shipping company tenants.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          disabled={!caps.tenantProvision}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-50 flex justify-center items-center gap-1 p-1 rounded-md"
        >
          <Plus className="h-4 w-4" /> Provision Tenant
        </button>
      </div>

      <Card
        title="Master Tenant Ledger"
        subtitle="All shipping company accounts on the platform"
        icon={<Building2 className="h-4 w-4" />}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-0.5 dark:border-ink-700 dark:bg-ink-800">
            <button
              onClick={() => setShowArchived(false)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${!showArchived ? "bg-white text-ink-900 shadow-sm dark:bg-ink-900 dark:text-white" : "text-ink-500 hover:text-ink-700 dark:text-ink-400"}`}
            >
              Show Active / Trial
            </button>
            <button
              onClick={() => setShowArchived(true)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${showArchived ? "bg-white text-ink-900 shadow-sm dark:bg-ink-900 dark:text-white" : "text-ink-500 hover:text-ink-700 dark:text-ink-400"}`}
            >
              Show Archived
            </button>
          </div>
          <span className="text-xs text-ink-400">
            {showArchived
              ? `${visibleTenants.length} archived tenant(s)`
              : `${visibleTenants.length} active / trial tenant(s)`}
          </span>
        </div>
        <DataTable
          columns={columns}
          rows={visibleTenants}
          pageSize={8}
          searchPlaceholder="Search companies, IDs…"
          searchFn={(t, q) =>
            t.company.toLowerCase().includes(q) ||
            t.id.toLowerCase().includes(q) ||
            displayTenantId(t).toLowerCase().includes(q) ||
            t.contactEmail.toLowerCase().includes(q)
          }
          compact
        />
      </Card>

      {(editing || creating) && (
        <TenantFormModal
          tenant={editing}
          tierConfigs={tierConfigs}
          adminStatus={editingAdminStatus}
          canEditStatus={caps.tenantEdit}
          busy={saveBusy}
          error={saveError}
          onClose={() => {
            setEditing(null);
            setEditingAdminStatus(null);
            setCreating(false);
            setSaveError(null);
          }}
          onSave={saveTenant}
        />
      )}

      {upgradeFor && (
        <UpgradeModal
          tenant={upgradeFor}
          tierConfigs={tierConfigs}
          selectedPlan={selectedPlan}
          onSelectPlan={setSelectedPlan}
          onClose={() => setUpgradeFor(null)}
          onConfirm={async (plan, contractExpires) => {
            try {
              await upgradeTenantPlan(
                upgradeFor,
                plan,
                contractExpires,
                tierConfigs,
                user?.email ?? "super-admin",
              );
            } catch (err) {
              if (api.isOfflineQueued(err)) {
                toast({ tone: "info", title: "Saved locally", message: (err as Error).message });
                setUpgradeFor(null);
                return;
              }
              toast({
                tone: "danger",
                title: "Upgrade failed",
                message: (err as Error).message,
              });
              return;
            }
            dispatch({ type: "TENANT_SET_PLAN", id: upgradeFor.id, plan });
            dispatch({
              type: "TENANT_UPDATE",
              id: upgradeFor.id,
              patch: { contractExpires },
            });
            toast({
              tone: "success",
              title: "Tier upgraded",
              message: `${upgradeFor.company} → ${plan}. Limits recalculated from tier config.`,
            });
            setUpgradeFor(null);
          }}
        />
      )}

      {archiveConfirm && (
        <Modal
          scrollable
          open
          onClose={() => setArchiveConfirm(null)}
          title="Archive Tenant"
          subtitle={`${archiveConfirm.company} · ${archiveConfirm.id}`}
          icon={<Archive className="h-5 w-5" />}
          size="sm"
          footer={
            <>
              <button
                onClick={() => setArchiveConfirm(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const result = await setTenantStatus(archiveConfirm, "archived");
                  if (result === "failed") return;
                  if (result === "ok") {
                    toast({
                      tone: "warning",
                      title: "Tenant archived",
                      message: `${archiveConfirm.company} archived. Login blocked for all users. Records retained.`,
                    });
                  }
                  setArchiveConfirm(null);
                }}
                className="btn-primary"
              >
                <ArchiveRestore className="h-4 w-4" /> Archive & block logins
              </button>
            </>
          }
        >
          <p className="text-sm text-ink-600 dark:text-ink-300">
            Archiving <strong>{archiveConfirm.company}</strong> will instantly
            block login access for all users across shore and ship portals.
          </p>
          <ul className="mt-3 space-y-1 text-xs text-ink-500 dark:text-ink-400">
            <li>
              · All tenant database records, SMS history, and audit logs are
              retained for compliance.
            </li>
            <li>
              · The tenant is excluded from active subscription revenue
              calculations.
            </li>
            <li>
              · The tenant can be restored at any time using the Restore action.
            </li>
          </ul>
        </Modal>
      )}

      {suspendConfirm && (
        <Modal
          scrollable
          open
          onClose={() => setSuspendConfirm(null)}
          title="Suspend Tenant"
          subtitle={`${suspendConfirm.company} · ${suspendConfirm.id}`}
          icon={<Ban className="h-5 w-5" />}
          size="sm"
          footer={
            <>
              <button
                onClick={() => setSuspendConfirm(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const result = await setTenantStatus(suspendConfirm, "suspended");
                  if (result === "failed") return;
                  if (result === "ok") {
                    toast({
                      tone: "warning",
                      title: "Suspended",
                      message: suspendConfirm.company,
                    });
                  }
                  setSuspendConfirm(null);
                }}
                className="btn-primary"
              >
                <Ban className="h-4 w-4" /> Suspend & block logins
              </button>
            </>
          }
        >
          <p className="text-sm text-ink-600 dark:text-ink-300">
            Suspending <strong>{suspendConfirm.company}</strong> will instantly
            block login access for all users across shore and ship portals.
          </p>
          <ul className="mt-3 space-y-1 text-xs text-ink-500 dark:text-ink-400">
            <li>
              · All tenant database records, SMS history, and audit logs are
              retained.
            </li>
            <li>
              · The tenant is excluded from active subscription revenue
              calculations while suspended.
            </li>
            <li>
              · The tenant can be reactivated at any time using the Activate
              action.
            </li>
          </ul>
        </Modal>
      )}

      {deleteTarget && (
        <CriticalActionWizard
          target={{
            kind: "Tenant",
            title: deleteTarget.company,
            subtitle: displayTenantId(deleteTarget),
            rows: [
              { label: "Tenant ID", value: displayTenantId(deleteTarget) },
              { label: "Name", value: deleteTarget.company },
              {
                label: "Created Date",
                value: formatUtc(deleteTarget.createdAt),
              },
              {
                label: "Active Vessels",
                value: `${deleteTarget.vessels.used} / ${deleteTarget.vessels.max}`,
              },
              {
                label: "Assigned Users",
                value: `${deleteTarget.seats.used} / ${deleteTarget.seats.max}`,
              },
              {
                label: "Data Size",
                value: `${deleteTarget.storageGb.used} GB / ${deleteTarget.storageGb.max} GB`,
              },
              { label: "Plan", value: deleteTarget.plan },
            ],
            acknowledgements: [
              `I acknowledge this will sever all shipboard SMS access for ${deleteTarget.vessels.used} active vessel(s).`,
              "I understand historical logs and audit trails will be archived in the Platform Security ledger.",
              `I confirm this deletion is scoped to ${displayTenantId(deleteTarget)} only and will not affect any other tenant.`,
            ],
            confirmPhrase: `DELETE ${displayTenantId(deleteTarget)}`,
            confirmHint: `DELETE ${displayTenantId(deleteTarget)}`,
          }}
          actorEmail={user?.email ?? "unknown"}
          onClose={() => setDeleteTarget(null)}
          onExecute={async (payload) => {
            // Let a failed backend call throw — CriticalActionWizard catches it,
            // shows the error inline, and returns the wizard to a usable state
            // instead of us leaving it stuck on "Executing…".
            await api.apiDeleteTenantPermanent(deleteTarget.id);
            await logAudit({
              // No tenantId — the tenant (and its own audit_logs rows, via
              // ON DELETE CASCADE) is already gone by this point, so a
              // tenant-scoped entry would violate the FK and be lost. Same
              // platform-level pattern as the staff hard-delete audit entry.
              actorEmail: user?.email ?? "unknown",
              category: "tenant",
              action: `Tenant permanently deleted: ${deleteTarget.company}`,
              target: deleteTarget.company,
              severity: "critical",
              before: {
                status: deleteTarget.status,
                company: deleteTarget.company,
              },
              after: { status: "deleted" },
            });
            dispatch({ type: "TENANT_DELETE", id: deleteTarget.id });
            toast({
              tone: "danger",
              title: "Tenant permanently deleted",
              message: `${deleteTarget.company} (${displayTenantId(deleteTarget)}) removed. Audit entry: ${payload.timestamp}.`,
            });
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function MiniLimit({
  label,
  used,
  max,
  over,
  delayMs = 0,
}: {
  label: string;
  used: number;
  max: number;
  over: boolean;
  delayMs?: number;
}) {
  const pct = Math.min(100, (used / max) * 100);
  const tone = over ? "danger" : pct > 85 ? "warning" : "success";
  const barTone = {
    success: "bg-success-500",
    warning: "bg-warning-500",
    danger: "bg-danger-500",
  }[tone];
  const textTone = {
    success: "text-ink-500 dark:text-ink-400",
    warning: "text-warning-600 dark:text-warning-400",
    danger: "text-danger-600 dark:text-danger-400",
  }[tone];
  return (
    <div
      className="group flex w-16 shrink-0 items-center gap-1.5 animate-fade-in"
      style={{ animationDelay: `${delayMs}ms`, animationFillMode: "backwards" }}
      title={`${label}: ${used}/${max}`}
    >
      <div className="relative h-6 w-1.5 shrink-0 overflow-hidden rounded-full bg-ink-200/70 dark:bg-ink-800">
        <div
          className={`absolute inset-x-0 bottom-0 w-full rounded-full ${barTone} transition-[height] duration-700 ease-out ${over ? "animate-pulse-soft" : ""}`}
          style={{
            height: `${Math.max(pct, 8)}%`,
            transitionDelay: `${delayMs}ms`,
          }}
        />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-[9px] font-medium uppercase tracking-wide text-ink-400">
          {label}
        </span>
        <span className={`text-[11px] font-semibold tabular-nums ${textTone}`}>
          {used}/{max}
        </span>
      </div>
    </div>
  );
}

function TenantFormModal({
  tenant,
  tierConfigs,
  adminStatus,
  canEditStatus,
  busy,
  error,
  onClose,
  onSave,
}: {
  tenant: Tenant | null;
  tierConfigs: TierConfig[];
  adminStatus: { mustChangePassword: boolean } | null;
  canEditStatus: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (t: Tenant) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);

  function tierDefaults(plan: PlanTier) {
    return (
      tierConfigs.find((c) => c.name === plan) ?? {
        vessels: 0,
        seats: 0,
        storageGb: 0,
        monthly: 0,
      }
    );
  }

  const [form, setForm] = useState<Tenant>(
    tenant ?? {
      id: "",
      company: "",
      contactEmail: "",
      companyEmail: "",
      companyMailPassword: "",
      plan: "Professional",
      status: "provisioning",
      seats: { used: 0, max: tierDefaults("Professional").seats },
      vessels: { used: 0, max: tierDefaults("Professional").vessels },
      storageGb: { used: 0, max: tierDefaults("Professional").storageGb },
      modules: ["voyage_logging", "crew_matrix"],
      mfaEnforced: true,
      createdAt: new Date().toISOString(),
      contractExpires: new Date(Date.now() + 365 * 86400000).toISOString(),
      monthlyRevenue: tierDefaults("Professional").monthly,
    },
  );

  const setPlan = (plan: PlanTier) => {
    const d = tierDefaults(plan);
    setForm((f) => ({
      ...f,
      plan,
      vessels: { ...f.vessels, max: d.vessels },
      seats: { ...f.seats, max: d.seats },
      storageGb: { ...f.storageGb, max: d.storageGb },
      monthlyRevenue: d.monthly,
    }));
  };

  // Editing an existing (local-only) tenant doesn't need the admin
  // credential fields — those only apply when provisioning a new tenant.
  const canSubmit = tenant
    ? !!form.company.trim()
    : !!form.company.trim() &&
      !!form.companyEmail.trim() &&
      form.companyMailPassword.length >= 6;

  return (
    <Modal
      open
      onClose={onClose}
      title={tenant ? "Edit Tenant" : "Provision New Tenant"}
      subtitle="Configure company profile, limits and assigned modules"
      icon={<Building2 className="h-5 w-5" />}
      size="lg"
      scrollable={true}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary p-1 rounded-md">
            Cancel
          </button>
          <button
            onClick={() => {
              if (canSubmit) onSave(form);
            }}
            className="btn-primary p-1 rounded-md disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit || busy}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : tenant ? (
              "Save changes"
            ) : (
              "Provision tenant"
            )}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/20 dark:text-danger-400">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Company Name</label>
          <input
            className="input"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
            placeholder="e.g. Atlantic Liquid Bulk"
          />
        </div>
        <div>
          <label className="label">Contact Email</label>
          <input
            className="input"
            value={form.contactEmail}
            onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            placeholder="fleet.ops@company.com"
          />
        </div>
        <div>
          <label className="label">Company Email</label>
          <input
            className="input"
            type="email"
            value={form.companyEmail}
            onChange={(e) => setForm({ ...form, companyEmail: e.target.value })}
            placeholder="company.email@company.com"
            disabled={!!tenant}
          />
          <p className="mt-1 text-[11px] text-ink-400">
            {tenant
              ? "The Company Admin's sign-in email (read-only here)."
              : "This becomes the Company Admin's sign-in email."}
          </p>
        </div>
        {tenant ? (
          <div>
            <label className="label">Password</label>
            <div className="input flex items-center text-ink-500 dark:text-ink-400">
              {adminStatus
                ? adminStatus.mustChangePassword
                  ? "Set by admin — user will be asked to change it on next login"
                  : "Already changed by the company admin"
                : "No company admin account found for this tenant"}
            </div>
          </div>
        ) : (
          <div>
            <label className="label">Password</label>

            <div className="relative">
              <input
                className="input pr-10"
                type={showPassword ? "text" : "password"}
                value={form.companyMailPassword}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    companyMailPassword: e.target.value,
                  }))
                }
                placeholder="Please set a secure password"
                autoComplete="new-password"
                minLength={6}
              />

              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            <p className="mt-1 text-[11px] text-ink-400">
              Minimum 6 characters. Used to log in as this company's admin.
            </p>
          </div>
        )}
        <div>
          <label className="label">Plan Tier</label>
          {tenant ? (
            <input value={tenant.plan} readOnly className="input" />
          ) : (
            <select
              className="input"
              value={form.plan}
              onChange={(e) => setPlan(e.target.value as PlanTier)}
            >
              {tierConfigs.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <label className="label">Status</label>
          <select
            className="input"
            value={form.status}
            disabled={!canEditStatus}
            onChange={(e) =>
              setForm({ ...form, status: e.target.value as TenantStatus })
            }
          >
            {["active", "suspended", "trial", "provisioning", "archived"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
        </div>
        <div>
          <label className="label">Max Vessels</label>
          <input value={form.vessels.max} readOnly className="input" />
        </div>
        <div>
          <label className="label">Max Users</label>
          <input value={form.seats.max} readOnly className="input" />
        </div>
        <div>
          <label className="label">Storage Quota (GB)</label>
          <input value={form.storageGb.max} readOnly className="input" />
        </div>
        <div>
          <label className="label">Monthly Revenue (USD)</label>
          <input
            type="number"
            className="input"
            value={form.monthlyRevenue}
            onChange={(e) =>
              setForm({ ...form, monthlyRevenue: +e.target.value })
            }
          />
        </div>
        <div>
          <label className="label">Contract Expires</label>
          {tenant ? (
            <input
              className="input"
              value={form.contractExpires.slice(0, 10)}
              readOnly
            />
          ) : (
            <input
              type="date"
              className="input"
              value={form.contractExpires.slice(0, 10)}
              onChange={(e) =>
                setForm({
                  ...form,
                  contractExpires: new Date(e.target.value).toISOString(),
                })
              }
            />
          )}
        </div>
        <div className="sm:col-span-2 flex items-center justify-between rounded-lg border border-ink-200/70 p-3 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary-600" />
            <span className="text-sm font-medium text-ink-800 dark:text-ink-100">
              Enforce MFA for all tenant users
            </span>
          </div>
          <Toggle
            checked={form.mfaEnforced}
            onChange={(v) => setForm({ ...form, mfaEnforced: v })}
          />
        </div>
      </div>
    </Modal>
  );
}
