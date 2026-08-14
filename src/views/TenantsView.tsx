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
} from "lucide-react";
import { Card } from "../components/Card";
import { Modal } from "../components/Modal";
import { Toggle } from "../components/Toggle";
import { Badge, StatusBadge } from "../components/Badge";
import { ProgressBar } from "../components/ProgressBar";
import { DataTable, type Column } from "../components/DataTable";
import { CriticalActionWizard } from "../components/CriticalActionWizard";
import { useStore } from "../store";
import { useAuth } from "../lib/auth";
import { PLAN_DEFAULTS, PLAN_TIERS, formatUtc } from "../constants";
import type { Capabilities } from "../lib/permissions";
import type {
  PlanTier,
  Tenant,
  TenantStatus,
} from "../types";
import {
  demoCreateTenant,
  demoCreateUser,
  demoCloneMasterSms,
  getEffectiveDemoTenants,
  getEffectiveDemoUsers,
  getEffectiveDemoVessels,
  isRealTenantId,
} from "../lib/demoData";
import { refreshAllTenants, refreshTenantData } from "../lib/dataCache";
import * as api from "../lib/api";
import { logAudit } from "../lib/audit";
import type { HydratedTenantRow } from "../store";

// Short, human-friendly display code (e.g. "T-0007") for real tenants —
// the UUID in t.id remains the actual identifier used for every API call
// and dispatch; this is purely what's shown/typed by a human. Legacy demo
// tenants have no tenantNo and just show their already-short id.
function displayTenantId(t: Tenant): string {
  return t.tenantNo != null ? `T-${String(t.tenantNo).padStart(4, "0")}` : t.id;
}

export function TenantsView({ caps }: { caps: Capabilities }) {
  const { tenants, dispatch, toast } = useStore();
  const { user } = useAuth();
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [editingAdminStatus, setEditingAdminStatus] = useState<{
    mustChangePassword: boolean;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<Tenant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Pull real tenants from the backend and merge them into the ledger
  // alongside the local demo-seed tenants (see isRealTenantId above).
  async function hydrateTenants() {
    try {
      await refreshAllTenants();
      const rows = getEffectiveDemoTenants();
      await Promise.all(rows.map((r) => refreshTenantData(r.id)));
      const hydrated: HydratedTenantRow[] = rows.map((r) => ({
        ...r,
        seatsUsed: getEffectiveDemoUsers(r.id).length,
        vesselsUsed: getEffectiveDemoVessels(r.id).length,
      }));
      dispatch({ type: "TENANTS_HYDRATE", rows: hydrated });
    } catch {
      // Best-effort — the ledger still shows local/demo tenants if this fails.
    }
  }

  useEffect(() => {
    hydrateTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveTenant(tenant: Tenant) {
    setSaveError(null);
    if (editing) {
      if (isRealTenantId(editing.id)) {
        setSaveBusy(true);
        try {
          await api.apiUpdateTenant(editing.id, {
            company: tenant.company,
            contact_email: tenant.contactEmail,
            plan: tenant.plan,
            status: tenant.status,
            region: tenant.region,
            vessels_max: tenant.vessels.max,
            seats_max: tenant.seats.max,
            storage_gb_max: tenant.storageGb.max,
            monthly_revenue: tenant.monthlyRevenue,
            mfa_enforced: tenant.mfaEnforced,
          });
        } catch (err) {
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
            company: editing.company, contact_email: editing.contactEmail, plan: editing.plan, status: editing.status,
            region: editing.region, vessels_max: editing.vessels.max, seats_max: editing.seats.max,
            storage_gb_max: editing.storageGb.max, monthly_revenue: editing.monthlyRevenue, mfa_enforced: editing.mfaEnforced,
          },
          after: {
            company: tenant.company, contact_email: tenant.contactEmail, plan: tenant.plan, status: tenant.status,
            region: tenant.region, vessels_max: tenant.vessels.max, seats_max: tenant.seats.max,
            storage_gb_max: tenant.storageGb.max, monthly_revenue: tenant.monthlyRevenue, mfa_enforced: tenant.mfaEnforced,
          },
        });
      }
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
        region: tenant.region,
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
      setSaveError((err as Error).message || "Failed to provision tenant.");
    } finally {
      setSaveBusy(false);
    }
  }

  async function setTenantStatus(
    t: Tenant,
    status: TenantStatus,
  ): Promise<boolean> {
    if (isRealTenantId(t.id)) {
      try {
        await api.apiUpdateTenant(t.id, { status });
      } catch (err) {
        toast({
          tone: "danger",
          title: "Status update failed",
          message: (err as Error).message,
        });
        return false;
      }
      await logAudit({
        tenantId: t.id,
        actorEmail: user?.email ?? "super-admin",
        category: "tenant",
        action: `Tenant ${status}: ${t.company}`,
        target: t.company,
        severity: status === "suspended" || status === "archived" ? "critical" : "info",
        before: { status: t.status },
        after: { status },
      });
    }
    dispatch({ type: "TENANT_SET_STATUS", id: t.id, status });
    return true;
  }

  function loginAsTenant(t: Tenant) {
    const demoTenantId = t.demoTenantId;
    if (demoTenantId) {
      const params = new URLSearchParams();
      params.set("view", "company");
      params.set("tenant", demoTenantId);
      window.open(
        `${window.location.pathname}?${params.toString()}`,
        "maritime_company",
        "width=1100,height=800,scrollbars=1",
      );
      toast({
        tone: "info",
        title: "Opening Company Admin",
        message: `Switching to ${t.company} workspace in a new window.`,
      });
    } else {
      dispatch({ type: "IMPERSONATE_START", tenantId: t.id });
      void logAudit({
        tenantId: t.id,
        actorEmail: user?.email ?? "super-admin",
        category: "impersonation",
        action: `Login As — impersonation started: ${t.company}`,
        target: t.contactEmail,
        severity: "critical",
        after: { impersonating: true, tenant: t.company },
      });
      toast({
        tone: "info",
        title: "Impersonation started",
        message: `Simulating session as ${t.company} Admin (Read-Only Audit Mode).`,
      });
    }
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
                {displayTenantId(t)} · {t.region}
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
        <select
          value={t.plan}
          disabled={!caps.tenantEdit || t.status === "archived"}
          onChange={async (e) => {
            const plan = e.target.value as PlanTier;
            if (isRealTenantId(t.id)) {
              const d = PLAN_DEFAULTS[plan];
              try {
                await api.apiUpdateTenant(t.id, {
                  plan,
                  vessels_max: d.vessels,
                  seats_max: d.seats,
                  storage_gb_max: d.storageGb,
                  monthly_revenue: d.monthly,
                });
              } catch (err) {
                toast({
                  tone: "danger",
                  title: "Plan update failed",
                  message: (err as Error).message,
                });
                return;
              }
              await logAudit({
                tenantId: t.id,
                actorEmail: user?.email ?? "super-admin",
                category: "billing",
                action: `Plan tier changed to ${plan}: ${t.company}`,
                target: t.company,
                before: { plan: t.plan, vessels_max: t.vessels.max, seats_max: t.seats.max, storage_gb_max: t.storageGb.max, monthly_revenue: t.monthlyRevenue },
                after: { plan, vessels_max: d.vessels, seats_max: d.seats, storage_gb_max: d.storageGb, monthly_revenue: d.monthly },
              });
            }
            dispatch({ type: "TENANT_SET_PLAN", id: t.id, plan });
            toast({
              tone: "success",
              title: "Plan updated",
              message: `${t.company} → ${plan}.`,
            });
          }}
          className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-ink-700 focus:border-primary-500 focus:outline-none disabled:opacity-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200"
        >
          {PLAN_TIERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: "limits",
      header: "Assigned Limits",
      width: "min-w-[200px]",
      render: (t) => {
        const overV = t.vessels.used > t.vessels.max;
        const overS = t.seats.used > t.seats.max;
        const overG = t.storageGb.status
          ? t.storageGb.status === "OVER_LIMIT" || t.storageGb.status === "LIMIT_REACHED"
          : t.storageGb.used > t.storageGb.max;
        return (
          <div className="space-y-1 py-0.5">
            <MiniLimit
              label="Ships"
              used={t.vessels.used}
              max={t.vessels.max}
              over={overV}
            />
            <MiniLimit
              label="Users"
              used={t.seats.used}
              max={t.seats.max}
              over={overS}
            />
            <MiniLimit
              label="GB"
              used={t.storageGb.used}
              max={t.storageGb.max}
              over={overG}
            />
            {(overV || overS || overG) && (
              <Badge tone="danger" dot pulse className="!text-[10px]">
                Over Limit
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "features",
      header: "Feature Flags",
      render: (t) => (
        <div className="flex items-center gap-1.5 py-0.5">
          <Badge tone="info" className="!text-[10px] !px-1.5 !py-0">
            {t.modules.length} active
          </Badge>
          {caps.tenantEdit && t.status !== "archived" && (
            <span
              className="text-[10px] font-medium text-ink-400"
              title="Module licensing is managed in the Tenant Feature Matrix"
            >
              <Grid3x3 className="inline h-3 w-3" /> Matrix
            </span>
          )}
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
                  if (!(await setTenantStatus(t, "active"))) return;
                  toast({
                    tone: "success",
                    title: "Tenant restored",
                    message: `${t.company} reactivated. Login access re-enabled.`,
                  });
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
                  onClick={async () => {
                    if (!(await setTenantStatus(t, "suspended"))) return;
                    toast({
                      tone: "warning",
                      title: "Suspended",
                      message: t.company,
                    });
                  }}
                  disabled={!caps.tenantEdit}
                  className="rounded p-1 text-ink-400 hover:bg-danger-50 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-danger-900/30 dark:hover:text-danger-400"
                  title="Suspend"
                >
                  <Ban className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={async () => {
                    if (!(await setTenantStatus(t, "active"))) return;
                    toast({
                      tone: "success",
                      title: "Activated",
                      message: t.company,
                    });
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
          searchPlaceholder="Search companies, IDs, regions…"
          searchFn={(t, q) =>
            t.company.toLowerCase().includes(q) ||
            t.id.toLowerCase().includes(q) ||
            displayTenantId(t).toLowerCase().includes(q) ||
            t.region.toLowerCase().includes(q) ||
            t.contactEmail.toLowerCase().includes(q)
          }
          compact
        />
      </Card>

      {(editing || creating) && (
        <TenantFormModal
          tenant={editing}
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

      {archiveConfirm && (
        <Modal
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
                  if (!(await setTenantStatus(archiveConfirm, "archived")))
                    return;
                  toast({
                    tone: "warning",
                    title: "Tenant archived",
                    message: `${archiveConfirm.company} archived. Login blocked for all users. Records retained.`,
                  });
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
              { label: "Region", value: deleteTarget.region },
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
            if (isRealTenantId(deleteTarget.id)) {
              await api.apiDeleteTenantPermanent(deleteTarget.id);
            }
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
              before: { status: deleteTarget.status, company: deleteTarget.company },
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
}: {
  label: string;
  used: number;
  max: number;
  over: boolean;
}) {
  const pct = Math.min(100, (used / max) * 100);
  const tone = over ? "danger" : pct > 85 ? "warning" : "success";
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-8 text-[10px] text-ink-400">{label}</span>
      <div className="w-20 shrink-0">
        <ProgressBar
          value={used}
          max={max}
          tone={tone as "success" | "warning" | "danger"}
          size="sm"
        />
      </div>
      <span
        className={`text-[10px] font-medium tabular-nums ${over ? "text-danger-600 dark:text-danger-400" : "text-ink-500"}`}
      >
        {used}/{max}
      </span>
    </div>
  );
}

function TenantFormModal({
  tenant,
  adminStatus,
  canEditStatus,
  busy,
  error,
  onClose,
  onSave,
}: {
  tenant: Tenant | null;
  adminStatus: { mustChangePassword: boolean } | null;
  canEditStatus: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (t: Tenant) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState<Tenant>(
    tenant ?? {
      id: "",
      company: "",
      contactEmail: "",
      companyEmail: "",
      companyMailPassword: "",
      plan: "Professional",
      status: "provisioning",
      seats: { used: 0, max: PLAN_DEFAULTS.Professional.seats },
      vessels: { used: 0, max: PLAN_DEFAULTS.Professional.vessels },
      storageGb: { used: 0, max: PLAN_DEFAULTS.Professional.storageGb },
      modules: ["voyage_logging", "crew_matrix"],
      mfaEnforced: true,
      createdAt: new Date().toISOString(),
      contractExpires: new Date(Date.now() + 365 * 86400000).toISOString(),
      monthlyRevenue: PLAN_DEFAULTS.Professional.monthly,
      region: "EMEA",
    },
  );

  const setPlan = (plan: PlanTier) => {
    const d = PLAN_DEFAULTS[plan];
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
          <label className="label">Region</label>
          <select
            className="input"
            value={form.region}
            onChange={(e) => setForm({ ...form, region: e.target.value })}
          >
            {["EMEA", "APAC", "MEA", "AMER"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Plan Tier</label>
          <select
            className="input"
            value={form.plan}
            onChange={(e) => setPlan(e.target.value as PlanTier)}
          >
            {PLAN_TIERS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
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
          <input
            type="number"
            className="input"
            value={form.vessels.max}
            onChange={(e) =>
              setForm({
                ...form,
                vessels: { ...form.vessels, max: +e.target.value },
              })
            }
          />
        </div>
        <div>
          <label className="label">Max Users</label>
          <input
            type="number"
            className="input"
            value={form.seats.max}
            onChange={(e) =>
              setForm({
                ...form,
                seats: { ...form.seats, max: +e.target.value },
              })
            }
          />
        </div>
        <div>
          <label className="label">Storage Quota (GB)</label>
          <input
            type="number"
            className="input"
            value={form.storageGb.max}
            onChange={(e) =>
              setForm({
                ...form,
                storageGb: { ...form.storageGb, max: +e.target.value },
              })
            }
          />
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
