import { useMemo, useState, useEffect, type ReactNode } from "react";
import {
  Wifi,
  WifiOff,
  FileWarning,
  TrendingUp,
  ArrowUpRight,
  Filter,
  HardDrive,
  Users as UsersIcon,
  Ship,
  Building2,
  FileText,
  User as UserIcon,
  Search,
  ChevronLeft,
  ChevronRight,
  Satellite,
  Activity,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { Card } from "../components/Card";
import { Badge } from "../components/Badge";
import { DataTable, type Column } from "../components/DataTable";
import { Modal } from "../components/Modal";
import { useStore } from "../store";
import { useAuth } from "../lib/auth";
import { logAudit } from "../lib/audit";
import {
  formatGb,
  formatBytes,
  formatCurrency,
  relativeTime,
} from "../constants";
import { PLAN_TIERS, PLAN_DEFAULTS } from "../constants";
import type { Tenant, PlanTier } from "../types";
import type { Capabilities } from "../lib/permissions";
import {
  getEffectiveDemoTenants,
  getEffectiveDemoVessels,
  getEffectiveDemoSmsDocs,
  isRealTenantId,
} from "../lib/demoData";
import { LIVE_MODULES, getDisplayName, useModuleDefinitions } from "../lib/featureFlags";
import { ScrollSelect } from "../components/ScrollSelect";
import * as api from "../lib/api";


type BreachType = "vessels" | "storage" | "seats";

function detectBreaches(t: Tenant): BreachType[] {
  const out: BreachType[] = [];
  if (t.vessels.used > t.vessels.max) out.push("vessels");
  if (t.storageGb.status === "OVER_LIMIT" || t.storageGb.used > t.storageGb.max) out.push("storage");
  if (t.seats.used / t.seats.max > 0.9) out.push("seats");
  return out;
}

export function MonitoringView({ caps: _caps }: { caps: Capabilities }) {
  const { tenants, dispatch, toast } = useStore();
  const { user } = useAuth();
  const [upgradeFor, setUpgradeFor] = useState<Tenant | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>("Professional");
  const [breachFilter, setBreachFilter] = useState<"all" | BreachType>("all");

  const breaches = useMemo(
    () =>
      tenants.filter(
        (t) => t.status !== "archived" && detectBreaches(t).length > 0,
      ),
    [tenants],
  );

  const filteredBreaches = useMemo(
    () =>
      breachFilter === "all"
        ? breaches
        : breaches.filter((t) => detectBreaches(t).includes(breachFilter)),
    [breaches, breachFilter],
  );

  const breachColumns: Column<Tenant>[] = useMemo(
    () => [
      {
        key: "company",
        header: "Tenant",
        width: "min-w-[200px]",
        sortValue: (t) => t.company,
        render: (t) => (
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-primary-500/15 to-accent-500/15 text-[10px] font-bold text-primary-700 dark:text-primary-300">
              {t.company
                .split(" ")
                .slice(0, 2)
                .map((w) => w[0])
                .join("")}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink-900 dark:text-white">
                {t.company}
              </p>
              <p className="truncate text-[11px] text-ink-400">
                {t.id} · {t.plan} plan
              </p>
            </div>
          </div>
        ),
      },
      {
        key: "breaches",
        header: "Breaches",
        render: (t) => (
          <div className="flex flex-wrap gap-1">
            {detectBreaches(t).map((b) => (
              <BreachPill key={b} type={b} />
            ))}
          </div>
        ),
      },
      {
        key: "vessels",
        header: "Vessels",
        sortValue: (t) => t.vessels.used - t.vessels.max,
        render: (t) => (
          <span
            className={`text-xs font-bold ${t.vessels.used > t.vessels.max ? "text-danger-600 dark:text-danger-400" : "text-ink-600 dark:text-ink-300"}`}
          >
            {t.vessels.used} / {t.vessels.max}
            {t.vessels.used > t.vessels.max && (
              <span className="ml-1 text-[10px]">OVER</span>
            )}
          </span>
        ),
      },
      {
        key: "storage",
        header: "Storage",
        sortValue: (t) => t.storageGb.used - t.storageGb.max,
        render: (t) => (
          <span
            className={`text-xs font-bold ${t.storageGb.used > t.storageGb.max ? "text-danger-600 dark:text-danger-400" : "text-ink-600 dark:text-ink-300"}`}
          >
            {formatGb(t.storageGb.used)} / {formatGb(t.storageGb.max)}
            {t.storageGb.used > t.storageGb.max && (
              <span className="ml-1 text-[10px]">OVER</span>
            )}
          </span>
        ),
      },
      {
        key: "seats",
        header: "Users",
        sortValue: (t) => t.seats.used / t.seats.max,
        render: (t) => (
          <span
            className={`text-xs font-bold ${t.seats.used / t.seats.max > 0.9 ? "text-warning-600 dark:text-warning-400" : "text-ink-600 dark:text-ink-300"}`}
          >
            {t.seats.used} / {t.seats.max}
            {t.seats.used / t.seats.max > 0.9 && (
              <span className="ml-1 text-[10px]">NEAR</span>
            )}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        width: "min-w-[180px]",
        render: (t) => {
          const next = nextPlanUp(t.plan);
          return (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  setUpgradeFor(t);
                  setSelectedPlan(next);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-300 dark:hover:bg-primary-900/50"
                title="Open upgrade modal"
              >
                <TrendingUp className="h-3.5 w-3.5" /> Upgrade
              </button>
              <button
                className="btn-ghost rounded-lg p-1.5 text-xs"
                title="View tenant"
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        },
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900 dark:text-white">
          Platform Monitoring
        </h1>
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Vessel connectivity, license compliance & technical error logs.
        </p>
      </div>

      {/* ── Company / Vessel connectivity & sync evidence log ── */}
      <SyncConnectivityLog />

      <Card
        title="License Compliance — Over-Limit Flagging"
        subtitle="Tenants exceeding tier limits or approaching seat capacity"
        icon={<FileWarning className="h-4 w-4" />}
      >
        <DataTable
          columns={breachColumns}
          rows={filteredBreaches}
          pageSize={6}
          searchPlaceholder="Search companies, IDs, plans…"
          searchFn={(t, q) =>
            t.company.toLowerCase().includes(q) ||
            t.id.toLowerCase().includes(q) ||
            t.plan.toLowerCase().includes(q) ||
            t.region.toLowerCase().includes(q)
          }
          emptyMessage="No compliance breaches detected — all tenants within limits."
          toolbar={
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-ink-400" />
              {(["all", "vessels", "storage", "seats"] as const).map((bt) => (
                <button
                  key={bt}
                  onClick={() => setBreachFilter(bt)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
                    breachFilter === bt
                      ? "bg-primary-600 text-white shadow-sm"
                      : "bg-ink-100 text-ink-600 hover:bg-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:hover:bg-ink-700"
                  }`}
                >
                  {bt === "all" ? "All Breaches" : bt}
                </button>
              ))}
            </div>
          }
        />
      </Card>

      {upgradeFor && (
        <UpgradeModal
          tenant={upgradeFor}
          selectedPlan={selectedPlan}
          onSelectPlan={setSelectedPlan}
          onClose={() => setUpgradeFor(null)}
          onConfirm={async (plan) => {
            const d = PLAN_DEFAULTS[plan];
            if (isRealTenantId(upgradeFor.id)) {
              try {
                await api.apiUpdateTenant(upgradeFor.id, {
                  plan, vessels_max: d.vessels, seats_max: d.seats, storage_gb_max: d.storageGb, monthly_revenue: d.monthly,
                });
              } catch (err) {
                toast({ tone: "danger", title: "Upgrade failed", message: (err as Error).message });
                return;
              }
              await logAudit({
                tenantId: upgradeFor.id,
                actorEmail: user?.email ?? "super-admin",
                category: "billing",
                action: `Plan tier changed to ${plan}: ${upgradeFor.company}`,
                target: upgradeFor.company,
                before: { plan: upgradeFor.plan, vessels_max: upgradeFor.vessels.max, seats_max: upgradeFor.seats.max, storage_gb_max: upgradeFor.storageGb.max },
                after: { plan, vessels_max: d.vessels, seats_max: d.seats, storage_gb_max: d.storageGb },
              });
            }
            dispatch({ type: "TENANT_SET_PLAN", id: upgradeFor.id, plan });
            toast({
              tone: "success",
              title: "Tier upgraded",
              message: `${upgradeFor.company} → ${plan}. Limits recalculated from tier config.`,
            });
            setUpgradeFor(null);
          }}
        />
      )}
    </div>
  );
}

const PLAN_ORDER: PlanTier[] = [
  "Standard",
  "Professional",
  "Enterprise",
  "Custom",
];

function nextPlanUp(current: PlanTier): PlanTier {
  const idx = PLAN_ORDER.indexOf(current);
  return idx >= 0 && idx < PLAN_ORDER.length - 1
    ? PLAN_ORDER[idx + 1]
    : "Enterprise";
}

function BreachPill({ type }: { type: BreachType }) {
  const map: Record<BreachType, { label: string; tone: "danger" | "warning" }> =
    {
      vessels: { label: "Vessels", tone: "danger" },
      storage: { label: "Storage", tone: "danger" },
      seats: { label: "Users", tone: "warning" },
    };
  const { label, tone } = map[type];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
        tone === "danger"
          ? "bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300"
          : "bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300"
      }`}
    >
      {label}
    </span>
  );
}

function UpgradeModal({
  tenant,
  selectedPlan,
  onSelectPlan,
  onClose,
  onConfirm,
}: {
  tenant: Tenant;
  selectedPlan: PlanTier;
  onSelectPlan: (p: PlanTier) => void;
  onClose: () => void;
  onConfirm: (plan: PlanTier) => void | Promise<void>;
}) {
  const targetDefs = PLAN_DEFAULTS[selectedPlan];
  const rows: {
    label: string;
    icon: ReactNode;
    used: number;
    currentMax: number;
    targetMax: number;
    fmt?: (n: number) => string;
  }[] = [
    {
      label: "Vessels",
      icon: <Ship className="h-4 w-4" />,
      used: tenant.vessels.used,
      currentMax: tenant.vessels.max,
      targetMax: targetDefs.vessels,
    },
    {
      label: "Storage",
      icon: <HardDrive className="h-4 w-4" />,
      used: tenant.storageGb.used,
      currentMax: tenant.storageGb.max,
      targetMax: targetDefs.storageGb,
      fmt: formatGb,
    },
    {
      label: "Users",
      icon: <UsersIcon className="h-4 w-4" />,
      used: tenant.seats.used,
      currentMax: tenant.seats.max,
      targetMax: targetDefs.seats,
    },
  ];
  return (
    <Modal
      open
      onClose={onClose}
      title="Upgrade Tenant Tier"
      subtitle={`${tenant.company} · ${tenant.id}`}
      icon={<TrendingUp className="h-5 w-5" />}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selectedPlan)}
            disabled={selectedPlan === tenant.plan}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrendingUp className="h-4 w-4" /> Confirm & Upgrade Tier
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 dark:border-ink-800 dark:bg-ink-800/50">
          <div>
            <p className="text-xs text-ink-500">Current plan</p>
            <p className="text-lg font-bold text-ink-900 dark:text-white">
              {tenant.plan}
            </p>
          </div>
          <div className="text-ink-300">
            <ArrowUpRight className="h-6 w-6" />
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-500">Target plan</p>
            <p className="text-lg font-bold text-primary-600 dark:text-primary-400">
              {selectedPlan}
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-ink-200 dark:border-ink-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-50/80 text-xs uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Resource</th>
                <th className="px-4 py-2.5 font-semibold">Current Usage</th>
                <th className="px-4 py-2.5 font-semibold">
                  {tenant.plan} Limit
                </th>
                <th className="px-4 py-2.5 font-semibold">
                  {selectedPlan} Limit
                </th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
              {rows.map((r) => {
                const fmt = r.fmt ?? ((n: number) => String(n));
                const over = r.used > r.currentMax;
                const resolves = r.used <= r.targetMax;
                return (
                  <tr key={r.label} className="bg-white dark:bg-ink-900">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 text-ink-700 dark:text-ink-200">
                        {r.icon}
                        <span className="font-semibold">{r.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-semibold text-ink-900 dark:text-white">
                      {fmt(r.used)}
                    </td>
                    <td className="px-4 py-2.5 text-ink-500">
                      {fmt(r.currentMax)}
                    </td>
                    <td className="px-4 py-2.5 font-bold text-primary-600 dark:text-primary-400">
                      {fmt(r.targetMax)}
                    </td>
                    <td className="px-4 py-2.5">
                      {over ? (
                        resolves ? (
                          <Badge tone="success" dot>
                            Resolves breach
                          </Badge>
                        ) : (
                          <Badge tone="warning" dot>
                            Still over
                          </Badge>
                        )
                      ) : (
                        <Badge tone="neutral">Within limit</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div>
          <label className="label">Select new plan</label>
          <select
            value={selectedPlan}
            onChange={(e) => onSelectPlan(e.target.value as PlanTier)}
            className="input"
          >
            {PLAN_TIERS.map((p) => (
              <option key={p} value={p} disabled={p === tenant.plan}>
                {p}
                {p === tenant.plan ? " (current)" : ""}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
            Monthly revenue will adjust to{" "}
            {formatCurrency(PLAN_DEFAULTS[selectedPlan].monthly)}/mo based on
            the {selectedPlan} tier.
          </p>
        </div>
      </div>
    </Modal>
  );
}

// ── Company / Vessel connectivity & sync evidence log ────────────────────
// Real data only: connectivity is derived from vessels.last_sync_at (the
// vessel's own reported check-in time), and "last modified file" evidence
// comes straight from sms_documents (author_name/author_role/author_origin
// + updated_at) — no simulated payloads or random state.

type SyncStatus = "processed" | "syncing" | "failed";

// Row shape returned by GET /api/vessel-sync — a left join of vessels to
// vessel_sync_state, so vessels that have never gone through the unified
// sync engine come back with null state fields rather than a fake default.
interface VesselSyncStateRow {
  vessel_id: string;
  tenant_id: string;
  connection_mode: string | null;
  server_reachable: number | boolean | null;
  last_heartbeat_at: string | null;
  state_last_sync_at: string | null;
  last_sync_method: string | null;
  pending_outbox_count: number | null;
  failed_outbox_count: number | null;
  total_payloads_synced: number | null;
  total_bytes_synced: number | null;
  state_updated_at: string | null;
  // Computed server-side, in SQL, from MySQL's own NOW() against MySQL's
  // own stored last_heartbeat_at — never from the browser's clock, so it
  // can't be thrown off by clock drift between the app/browser and the DB.
  is_online: number | boolean | null;
}

// Row shape returned by GET /api/vessel-sync/log — vessel + tenant + sync
// state already joined and paginated at the database (LIMIT/OFFSET), not
// fetched in full and sliced client-side.
interface VesselSyncLogRow {
  vessel_id: string;
  tenant_id: string;
  vessel_name: string;
  company: string;
  sms_active_version: string;
  satellite_provider: string | null;
  vessel_last_sync_at: string | null;
  state_last_sync_at: string | null;
  last_sync_method: string | null;
  server_reachable: number | boolean | null;
  last_heartbeat_at: string | null;
  pending_outbox_count: number | null;
  failed_outbox_count: number | null;
  is_online: number | boolean | null;
}

const LOG_PAGE_SIZE = 10;

/** failed_outbox_count wins over pending (an active retry still counts as failed until it clears); no outbox activity falls back to whether a sync has ever completed. */
function deriveSyncStatus(
  pendingOutbox: number,
  failedOutbox: number,
  lastSync: string | null,
): SyncStatus {
  if (failedOutbox > 0) return "failed";
  if (pendingOutbox > 0) return "syncing";
  return lastSync ? "processed" : "failed";
}

interface VesselConnRow {
  vesselId: string;
  vesselName: string;
  tenantId: string;
  company: string;
  smsVersion: string;
  connectionProvider: string | null;
  lastSync: string | null;
  lastSyncMethod: string | null;
  online: boolean;
  status: SyncStatus;
  pendingOutbox: number;
  failedOutbox: number;
  lastModifiedFile: string | null;
}

interface CompanyConnRow {
  tenantId: string;
  company: string;
  vesselCount: number;
  onlineCount: number;
  lastSync: string | null;
  lastSyncMethod: string | null;
  // Which vessel in the fleet produced that most recent sync — so the
  // Company tab can show "via MV Atlas Pride" instead of just a bare
  // fleet-wide timestamp.
  lastSyncVesselName: string | null;
}

interface FileEvidence {
  label: string;
  version: string;
  treeKind: string;
  updatedAt: string;
  authorName: string | null;
  authorRole: string | null;
  authorOrigin: string | null;
  fileSizeBytes: number | null;
}

/**
 * Live connectivity: `is_online` is computed server-side, in SQL, from
 * MySQL's own NOW() against MySQL's own stored `last_heartbeat_at` —
 * TRUE only while the vessel's most recent real check-in both reported
 * `server_reachable` and happened within the live window (see
 * LIVE_CONNECTIVITY_WINDOW_MINUTES in server/routes/vesselSync.js). A
 * stale-but-truthy `server_reachable` (the flag never expires on its own —
 * it only flips on the next check-in, success or failure) does not count
 * as online once it falls outside that window.
 *
 * Deliberately never computed from the browser's Date.now(): the app
 * server/browser clock and the DB host clock are two different clocks
 * that can drift out of sync (e.g. a WSL2/container clock skew), so any
 * client-side "is this timestamp recent" comparison against a DB-issued
 * timestamp is unreliable. Comparing entirely within one SQL statement
 * sidesteps that.
 */
function isOnline(isOnlineFlag: number | boolean | null | undefined): boolean {
  return isOnlineFlag === true || isOnlineFlag === 1;
}

/** Most recently modified SMS documents for a company, optionally narrowed to one vessel's authored files, newest first. */
function getLastModifiedFiles(
  tenantId: string,
  vesselName?: string,
  limit = 5,
): FileEvidence[] {
  const docs = getEffectiveDemoSmsDocs(tenantId).filter(
    (d) => d.node_kind === "document",
  );
  const scoped = vesselName
    ? docs.filter((d) => d.author_origin === vesselName)
    : docs;
  return [...scoped]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit)
    .map((latest) => ({
      label: latest.label,
      version: latest.version,
      treeKind: latest.tree_kind,
      updatedAt: latest.updated_at,
      authorName: latest.author_name,
      authorRole: latest.author_role,
      authorOrigin: latest.author_origin,
      fileSizeBytes: latest.file_size_bytes,
    }));
}

/** Single most recently modified SMS document — used for the compact row-level display. */
function getLastModifiedFile(
  tenantId: string,
  vesselName?: string,
): FileEvidence | null {
  return getLastModifiedFiles(tenantId, vesselName, 1)[0] ?? null;
}

type DetailTarget =
  | {
      scope: "vessel";
      vesselId: string;
      vesselName: string;
      tenantId: string;
      company: string;
      lastSync: string | null;
      lastSyncMethod: string | null;
      online: boolean;
      connectionProvider: string | null;
    }
  | {
      scope: "company";
      tenantId: string;
      company: string;
      onlineCount: number;
      vesselCount: number;
      lastSync: string | null;
      lastSyncMethod: string | null;
      lastSyncVesselName: string | null;
    };

function SyncConnectivityLog() {
  const [scope, setScope] = useState<"company" | "vessel">("vessel");
  const [vesselRows, setVesselRows] = useState<VesselConnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  // Manual refresh trigger.
  // Incrementing this value causes the relevant data-loading effects
  // to run once. There is intentionally no background polling — the
  // connectivity status itself is still computed live (server-side, in
  // SQL) each time this runs, so a manual Refresh always reflects
  // current reality; it's just not fetched on a timer.
  const [refreshKey, setRefreshKey] = useState(0);

  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Vessel-tab-only company dropdown filter, applied together with the
  // search box (AND, not either/or) — "" means all companies.
  const [companyFilter, setCompanyFilter] = useState("");
  // App/module filter — applies to both tabs. "" means all apps. Options
  // are sourced from LIVE_MODULES, so a new app only needs to be added
  // there (and start writing module_key-tagged outbox entries) to show up
  // here — no further change to this view.
  const [appFilter, setAppFilter] = useState("");
  const [page, setPage] = useState(1);

  // Display names come from the global module-definition overrides that
  // Super Admin can rename in the tenant feature matrix — falls back to the
  // built-in MODULE_LABELS until those load. The filter itself is keyed on
  // the stable module_key (e.g. "sms_documentation"), which a rename never
  // touches, so filtering keeps working correctly regardless of the label.
  const { defs: moduleDefs } = useModuleDefinitions();
  const appOptions = useMemo(
    () => LIVE_MODULES.map((m) => ({ value: m, label: getDisplayName(m, moduleDefs) })),
    [moduleDefs],
  );
  const [pageRows, setPageRows] = useState<VesselConnRow[]>([]);
  const [pageTotal, setPageTotal] = useState(0);
  const [pageLoading, setPageLoading] = useState(true);

  /*
   * Load the complete vessel sync state used by:
   * - Company tab
   * - Connectivity statistics
   * - Company fleet rollups
   *
   * This runs:
   * 1. Once when the component opens
   * 2. When the user manually clicks Refresh
   *
   * It does NOT poll in the background.
   */
  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const syncStates = await api
          .apiGetVesselSyncStates<VesselSyncStateRow>(appFilter)
          .catch(() => [] as VesselSyncStateRow[]);

        const syncStateByVessel = new Map(
          syncStates.map((s) => [s.vessel_id, s]),
        );

        const rows: VesselConnRow[] = [];

        for (const t of getEffectiveDemoTenants()) {
          for (const v of getEffectiveDemoVessels(t.id)) {
            const state = syncStateByVessel.get(v.id);

            const pendingOutbox = state?.pending_outbox_count ?? 0;
            const failedOutbox = state?.failed_outbox_count ?? 0;
            const lastSync = state?.state_last_sync_at ?? v.last_sync_at;

            rows.push({
              vesselId: v.id,
              vesselName: v.name,
              tenantId: t.id,
              company: t.company,
              smsVersion: v.sms_active_version,
              connectionProvider: v.satellite_provider,
              lastSync,
              lastSyncMethod: state?.last_sync_method ?? null,
              online: isOnline(state?.is_online),
              status: deriveSyncStatus(pendingOutbox, failedOutbox, lastSync),
              pendingOutbox,
              failedOutbox,
              lastModifiedFile: getLastModifiedFile(t.id, v.name)?.label ?? null,
            });
          }
        }

        if (mounted) {
          setVesselRows(rows);
          setLoading(false);
          setLastRefreshedAt(new Date().toISOString());
        }
      } catch {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [refreshKey, appFilter]);

  const companyRows: CompanyConnRow[] = useMemo(() => {
    const byTenant = new Map<string, CompanyConnRow>();

    for (const r of vesselRows) {
      const existing = byTenant.get(r.tenantId);

      if (!existing) {
        byTenant.set(r.tenantId, {
          tenantId: r.tenantId,
          company: r.company,
          vesselCount: 1,
          onlineCount: r.online ? 1 : 0,
          lastSync: r.lastSync,
          lastSyncMethod: r.lastSyncMethod,
          lastSyncVesselName: r.lastSync ? r.vesselName : null,
        });
      } else {
        existing.vesselCount += 1;

        if (r.online) {
          existing.onlineCount += 1;
        }

        if (
          r.lastSync &&
          (!existing.lastSync || r.lastSync > existing.lastSync)
        ) {
          existing.lastSync = r.lastSync;
          existing.lastSyncMethod = r.lastSyncMethod;
          existing.lastSyncVesselName = r.vesselName;
        }
      }
    }

    return Array.from(byTenant.values());
  }, [vesselRows]);

  // Real DB-driven equivalents of the old satellite queue's four stats.
  const stats = useMemo(
    () => ({
      activeStreams: vesselRows.filter((r) => r.status === "syncing").length,

      processedToday: vesselRows.filter(
        (r) => r.status === "processed" && r.online,
      ).length,

      queuedPayloads: vesselRows.reduce((sum, r) => sum + r.pendingOutbox, 0),

      failedHandshakes: vesselRows.reduce((sum, r) => sum + r.failedOutbox, 0),
    }),
    [vesselRows],
  );

  // Debounce the search box so every keystroke does not fire a DB query.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 300);

    return () => clearTimeout(t);
  }, [searchQuery]);

  // Changing the company or app filter jumps back to page 1, same as a new search.
  useEffect(() => {
    setPage(1);
  }, [companyFilter, appFilter]);

  /*
   * Load the current vessel log page.
   *
   * This runs:
   * 1. When the vessel tab is opened
   * 2. When page changes
   * 3. When the debounced search changes
   * 4. When the company filter changes
   * 5. When the user manually clicks Refresh
   *
   * There is intentionally no interval or cache subscription here.
   */
  useEffect(() => {
    if (scope !== "vessel") return;

    let mounted = true;

    async function loadPage() {
      try {
        const res = await api.apiGetVesselSyncLog<VesselSyncLogRow>(
          page,
          LOG_PAGE_SIZE,
          debouncedSearch,
          companyFilter,
          appFilter,
        );

        const rows: VesselConnRow[] = res.rows.map((r) => {
          const pendingOutbox = r.pending_outbox_count ?? 0;
          const failedOutbox = r.failed_outbox_count ?? 0;
          const lastSync = r.state_last_sync_at ?? r.vessel_last_sync_at;

          return {
            vesselId: r.vessel_id,
            vesselName: r.vessel_name,
            tenantId: r.tenant_id,
            company: r.company,
            smsVersion: r.sms_active_version,
            connectionProvider: r.satellite_provider,
            lastSync,
            lastSyncMethod: r.last_sync_method,
            online: isOnline(r.is_online),
            status: deriveSyncStatus(pendingOutbox, failedOutbox, lastSync),
            pendingOutbox,
            failedOutbox,
            lastModifiedFile:
              getLastModifiedFile(r.tenant_id, r.vessel_name)?.label ?? null,
          };
        });

        if (mounted) {
          setPageRows(rows);
          setPageTotal(res.total);
          setPageLoading(false);
        }
      } catch {
        if (mounted) {
          setPageLoading(false);
        }
      }
    }

    loadPage();

    return () => {
      mounted = false;
    };
  }, [scope, page, debouncedSearch, companyFilter, appFilter, refreshKey]);

  const pageTotalPages = Math.max(1, Math.ceil(pageTotal / LOG_PAGE_SIZE));

  const pageRangeStart = pageTotal === 0 ? 0 : (page - 1) * LOG_PAGE_SIZE + 1;

  const pageRangeEnd = Math.min(pageTotal, page * LOG_PAGE_SIZE);

  const filteredCompanyRows = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();

    if (!q) return companyRows;

    return companyRows.filter((r) => r.company.toLowerCase().includes(q));
  }, [companyRows, debouncedSearch]);

  // Dropdown options for the vessel-tab company filter — reuses the same
  // company rollup already loaded for the Company tab, so no extra fetch.
  const companyOptions = useMemo(
    () =>
      [...companyRows].sort((a, b) => a.company.localeCompare(b.company)),
    [companyRows],
  );

  /*
   * Manual refresh.
   *
   * This does NOT directly call the APIs.
   * It changes refreshKey, which causes the appropriate
   * loading effects above to execute once.
   *
   * The current:
   * - tab
   * - page
   * - search query
   *
   * are preserved.
   */
  const handleManualRefresh = () => {
    setLoading(true);

    if (scope === "vessel") {
      setPageLoading(true);
    }

    setRefreshKey((key) => key + 1);
  };

  const isRefreshing = loading || (scope === "vessel" && pageLoading);

  return (
    <>
      <Card
        title="Company / Vessel Connectivity Log"
        subtitle="Satellite link evidence and last-modified-file trail"
        icon={<Wifi className="h-4 w-4" />}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
            {/* Updated time + Refresh button */}
            <div className="ml-auto flex items-center gap-2">
              {!isRefreshing && lastRefreshedAt && (
                <span
                  className="text-[11px] text-ink-400"
                  title={`Last refreshed ${new Date(
                    lastRefreshedAt,
                  ).toLocaleString()}`}
                >
                  Updated {relativeTime(lastRefreshedAt)}
                </span>
              )}

              {isRefreshing && lastRefreshedAt && (
                <span className="text-[11px] text-ink-400">Refreshing…</span>
              )}

              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="group relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ink-200/80 bg-white text-ink-500 shadow-sm transition-all duration-200 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-600 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-400 dark:hover:border-primary-600 dark:hover:bg-primary-900/30 dark:hover:text-primary-300"
                title={
                  isRefreshing ? "Refreshing…" : "Refresh connectivity data"
                }
                aria-label="Refresh connectivity data"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${
                    isRefreshing
                      ? "animate-spin"
                      : "transition-transform duration-300 group-hover:rotate-180"
                  }`}
                />
              </button>
            </div>

            {/* Vessel / Company switch */}
            <div className="inline-flex w-full flex-col rounded-lg border border-ink-200 bg-white p-0.5 dark:border-ink-700 dark:bg-ink-800 sm:w-auto sm:flex-row">
              {(["vessel", "company"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`flex-1 rounded-md px-4 py-1.5 text-xs font-semibold capitalize transition sm:flex-none ${
                    scope === s
                      ? "bg-primary-600 text-white shadow-sm"
                      : "text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ConnStat
              icon={<Satellite className="h-3.5 w-3.5" />}
              label="Active streams"
              value={stats.activeStreams}
              tone="info"
            />

            <ConnStat
              icon={<Activity className="h-3.5 w-3.5" />}
              label="Processed today"
              value={stats.processedToday}
              tone="success"
            />

            <ConnStat
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              label="Queued payloads"
              value={stats.queuedPayloads}
              tone="warning"
            />

            <ConnStat
              icon={<FileWarning className="h-3.5 w-3.5" />}
              label="Failed handshakes"
              value={stats.failedHandshakes}
              tone="danger"
            />
          </div>

          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />

              <input
                type="search"
                placeholder={scope === "vessel" ? "Search by vessel or company..." : "Search by company..."}
                className="input pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="flex w-full gap-2 sm:w-auto">
              <ScrollSelect
                value={appFilter}
                onChange={setAppFilter}
                options={appOptions}
                placeholder="All apps"
                title="Filter by app"
                className="w-full sm:w-auto sm:min-w-[180px]"
              />

              {scope === "vessel" && (
                <ScrollSelect
                  value={companyFilter}
                  onChange={setCompanyFilter}
                  options={companyOptions.map((c) => ({ value: c.tenantId, label: c.company }))}
                  placeholder="All companies"
                  title="Filter by company"
                  className="w-full sm:w-auto sm:min-w-[200px]"
                />
              )}
            </div>
          </div>

          {scope === "vessel" ? (
            pageLoading ? (
              <div className="py-8 text-center text-sm text-ink-400">
                Loading connectivity data…
              </div>
            ) : pageRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-ink-400">
                No vessels found.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto rounded-xl border border-ink-200 dark:border-ink-800">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-ink-50/80 text-[11px] uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Vessel</th>

                        <th className="px-4 py-2.5 font-semibold">Company</th>

                        <th className="px-4 py-2.5 font-semibold">
                          SMS Version
                        </th>

                        <th className="px-4 py-2.5 font-semibold">
                          Connection
                        </th>

                        <th className="px-4 py-2.5 font-semibold">
                          Last Modified File
                        </th>

                        <th className="px-4 py-2.5 font-semibold">Last Sync</th>

                        <th className="px-4 py-2.5 font-semibold">Status</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                      {pageRows.map((r) => (
                        <tr
                          key={r.vesselId}
                          className="bg-white transition-colors hover:bg-primary-50/30 dark:bg-ink-900 dark:hover:bg-ink-800/40"
                        >
                          <td className="px-4 py-2.5">
                            <button
                              onClick={() =>
                                setDetail({
                                  scope: "vessel",
                                  vesselId: r.vesselId,
                                  vesselName: r.vesselName,
                                  tenantId: r.tenantId,
                                  company: r.company,
                                  lastSync: r.lastSync,
                                  lastSyncMethod: r.lastSyncMethod,
                                  online: r.online,
                                  connectionProvider: r.connectionProvider,
                                })
                              }
                              className="flex items-center gap-2 font-medium text-primary-700 hover:underline dark:text-primary-300"
                              title="View last-modified-file evidence"
                            >
                              <Ship className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                              {r.vesselName}
                            </button>
                          </td>

                          <td className="px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">
                            {r.company}
                          </td>

                          <td className="px-4 py-2.5">
                            <span className="font-mono text-xs font-bold text-primary-600 dark:text-primary-400">
                              v{r.smsVersion}
                            </span>
                          </td>

                          <td className="px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">
                            {r.connectionProvider ?? (
                              <span className="text-ink-300 dark:text-ink-600">
                                Not set
                              </span>
                            )}
                          </td>

                          <td className="max-w-[200px] px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">
                            {r.lastModifiedFile ? (
                              <span
                                className="flex items-center gap-1.5 truncate"
                                title={r.lastModifiedFile}
                              >
                                <FileText className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                                <span className="truncate">
                                  {r.lastModifiedFile}
                                </span>
                              </span>
                            ) : (
                              <span className="text-ink-300 dark:text-ink-600">
                                No files yet
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">
                            {r.lastSync
                              ? new Date(r.lastSync).toLocaleDateString() +
                                " " +
                                new Date(r.lastSync).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "Never"}
                          </td>

                          <td className="px-4 py-2.5">
                            {r.status === "processed" && (
                              <Badge
                                tone="success"
                                dot
                                className="!text-[10px]"
                              >
                                Processed
                              </Badge>
                            )}

                            {r.status === "syncing" && (
                              <Badge
                                tone="info"
                                dot
                                pulse
                                className="!text-[10px]"
                              >
                                Syncing
                              </Badge>
                            )}

                            {r.status === "failed" && (
                              <Badge tone="danger" dot className="!text-[10px]">
                                Failed
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-xs text-ink-500 dark:text-ink-400">
                    Showing{" "}
                    <span className="font-semibold text-ink-700 dark:text-ink-200">
                      {pageRangeStart}
                    </span>
                    –
                    <span className="font-semibold text-ink-700 dark:text-ink-200">
                      {pageRangeEnd}
                    </span>{" "}
                    of{" "}
                    <span className="font-semibold text-ink-700 dark:text-ink-200">
                      {pageTotal}
                    </span>
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="btn-ghost rounded-md p-1.5 disabled:opacity-40"
                      title="Previous page"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>

                    <span className="px-2 text-xs font-medium text-ink-600 dark:text-ink-300">
                      {page} / {pageTotalPages}
                    </span>

                    <button
                      onClick={() =>
                        setPage((p) => Math.min(pageTotalPages, p + 1))
                      }
                      disabled={page >= pageTotalPages}
                      className="btn-ghost rounded-md p-1.5 disabled:opacity-40"
                      title="Next page"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </>
            )
          ) : loading ? (
            <div className="py-8 text-center text-sm text-ink-400">
              Loading connectivity data…
            </div>
          ) : filteredCompanyRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-ink-400">
              No companies found.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-ink-200 dark:border-ink-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-ink-50/80 text-[11px] uppercase tracking-wide text-ink-500 dark:bg-ink-950/50 dark:text-ink-400">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Company</th>

                    <th className="px-4 py-2.5 font-semibold">Fleet</th>

                    <th className="px-4 py-2.5 font-semibold">
                      Last Sync (fleet-wide)
                    </th>

                    <th className="px-4 py-2.5 font-semibold">Connectivity</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-ink-100 dark:divide-ink-800">
                  {filteredCompanyRows.map((r) => (
                    <tr
                      key={r.tenantId}
                      className="bg-white transition-colors hover:bg-primary-50/30 dark:bg-ink-900 dark:hover:bg-ink-800/40"
                    >
                      <td className="px-4 py-2.5">
                        <button
                          onClick={() =>
                            setDetail({
                              scope: "company",
                              tenantId: r.tenantId,
                              company: r.company,
                              onlineCount: r.onlineCount,
                              vesselCount: r.vesselCount,
                              lastSync: r.lastSync,
                              lastSyncMethod: r.lastSyncMethod,
                              lastSyncVesselName: r.lastSyncVesselName,
                            })
                          }
                          className="flex items-center gap-2 font-medium text-primary-700 hover:underline dark:text-primary-300"
                          title="View last-modified-file evidence"
                        >
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                          {r.company}
                        </button>
                      </td>

                      <td className="px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">
                        {r.vesselCount} vessel
                        {r.vesselCount === 1 ? "" : "s"}
                      </td>

                      <td className="px-4 py-2.5 text-xs text-ink-500 dark:text-ink-400">
                        {r.lastSync ? (
                          <>
                            <p>
                              {new Date(r.lastSync).toLocaleDateString() +
                                " " +
                                new Date(r.lastSync).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                            </p>
                            {r.lastSyncVesselName && (
                              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-400">
                                <Ship className="h-3 w-3 shrink-0" />
                                via {r.lastSyncVesselName}
                              </p>
                            )}
                          </>
                        ) : (
                          "Never"
                        )}
                      </td>

                      <td className="px-4 py-2.5">
                        {r.onlineCount === 0 ? (
                          <Badge tone="danger" dot className="!text-[10px]">
                            All offline
                          </Badge>
                        ) : r.onlineCount === r.vesselCount ? (
                          <Badge tone="success" dot className="!text-[10px]">
                            All online
                          </Badge>
                        ) : (
                          <Badge tone="warning" dot className="!text-[10px]">
                            {r.onlineCount}/{r.vesselCount} online
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {detail && (
        <FileEvidenceModal target={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}

function ConnStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: "info" | "success" | "warning" | "danger" | "neutral";
}) {
  const tones = {
    info: "bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300",
    success:
      "bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-300",
    warning:
      "bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300",
    danger:
      "bg-danger-50 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300",
    neutral: "bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300",
  };
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-ink-200/70 bg-white p-3 dark:border-ink-800 dark:bg-ink-900">
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-md ${tones[tone]}`}
      >
        {icon}
      </div>
      <div>
        <p className="text-lg font-bold text-ink-900 dark:text-white">
          {value}
        </p>
        <p className="text-[10px] font-medium text-ink-500 dark:text-ink-400">
          {label}
        </p>
      </div>
    </div>
  );
}

function FileEvidenceModal({
  target,
  onClose,
}: {
  target: DetailTarget;
  onClose: () => void;
}) {
  const evidenceList = useMemo(
    () =>
      target.scope === "vessel"
        ? getLastModifiedFiles(target.tenantId, target.vesselName, 5)
        : getLastModifiedFiles(target.tenantId, undefined, 5),
    [target],
  );

  const online =
    target.scope === "vessel" ? target.online : target.onlineCount > 0;
  const lastSync = target.lastSync;
  const lastSyncMethod = target.lastSyncMethod;

  return (
    <Modal
      open
      onClose={onClose}
      title={target.scope === "vessel" ? target.vesselName : target.company}
      subtitle={
        target.scope === "vessel"
          ? `${target.company} · vessel file evidence`
          : `${target.vesselCount} vessel fleet · company file evidence`
      }
      icon={
        target.scope === "vessel" ? (
          <Ship className="h-5 w-5" />
        ) : (
          <Building2 className="h-5 w-5" />
        )
      }
      size="xl"
      scrollable
      footer={
        <button onClick={onClose} className="btn-secondary p-1 rounded-md">
          Close
        </button>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 dark:border-ink-800 dark:bg-ink-800/50">
          <div className="flex items-center gap-2">
            {online ? (
              <Wifi className="h-4 w-4 text-success-600 dark:text-success-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-danger-600 dark:text-danger-400" />
            )}
            <div>
              <p className="text-xs text-ink-500">Connectivity evidence</p>
              <p
                className={`text-sm font-bold ${online ? "text-success-600 dark:text-success-400" : "text-danger-600 dark:text-danger-400"}`}
              >
                {target.scope === "vessel"
                  ? online
                    ? "Connected to the internet"
                    : "Not connected — offline"
                  : `${target.onlineCount}/${target.vesselCount} vessels connected`}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-500">Last sync check-in</p>
            <p className="flex items-center justify-end gap-1.5 text-sm font-semibold text-ink-800 dark:text-ink-100">
              {lastSync ? new Date(lastSync).toLocaleString() : "Never synced"}
              {lastSync && lastSyncMethod && (
                <span
                  title={
                    lastSyncMethod === "automatic"
                      ? "Delivered by the scheduled auto-sync timer"
                      : "Delivered by a crew member clicking Replicate to Shore Now"
                  }
                >
                  <Badge
                    tone={lastSyncMethod === "automatic" ? "info" : "neutral"}
                    className="!text-[9px]"
                  >
                    {lastSyncMethod === "automatic" ? "Auto-synced" : "Manual sync"}
                  </Badge>
                </span>
              )}
            </p>
            {target.scope === "company" && target.lastSyncVesselName && (
              <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-ink-400">
                <Ship className="h-3 w-3 shrink-0" />
                via {target.lastSyncVesselName}
              </p>
            )}
            {target.scope === "vessel" && (
              <>
                <p className="mt-1.5 text-xs text-ink-500">
                  Connection provider
                </p>
                <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">
                  {target.connectionProvider ?? "Not set"}
                </p>
              </>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
            <FileText className="h-3.5 w-3.5" />{" "}
            {evidenceList.length > 0
              ? `Last ${evidenceList.length} ${evidenceList.length === 1 ? "file" : "files"} transferred`
              : "Recent files transferred"}
          </p>
          {evidenceList.length > 0 ? (
            <div className="divide-y divide-ink-100 rounded-xl border border-ink-200 dark:divide-ink-800 dark:border-ink-800">
              {evidenceList.map((evidence, i) => (
                <div
                  key={`${evidence.label}-${evidence.updatedAt}-${i}`}
                  className="flex flex-col gap-3 p-3.5 md:flex-row md:items-center md:justify-between"
                >
                  {/* Left: Title & version */}
                  <div className="min-w-0 md:w-44 md:shrink-0">
                    <p className="truncate text-sm font-bold text-ink-900 dark:text-white">
                      {evidence.label}
                    </p>
                    <p className="text-xs text-ink-400">
                      {evidence.treeKind} · v{evidence.version}
                    </p>
                    {target.scope === "company" && (
                      <p className="mt-1 flex items-center gap-1 truncate text-[11px] font-medium text-primary-600 dark:text-primary-400">
                        {evidence.authorOrigin === "Shoreside HQ" ? (
                          <Building2 className="h-3 w-3 shrink-0" />
                        ) : (
                          <Ship className="h-3 w-3 shrink-0" />
                        )}
                        {evidence.authorOrigin ?? "Unknown origin"}
                      </p>
                    )}
                  </div>

                  {/* Middle: Details */}
                  <div className="flex items-center gap-5 text-xs">
                    <div>
                      <p className="text-ink-400">Modified on</p>
                      <p className="font-semibold text-ink-800 dark:text-ink-100">
                        {new Date(evidence.updatedAt).toLocaleDateString()}{" "}
                        {new Date(evidence.updatedAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-ink-400">Transfer size</p>
                      <p className="font-semibold text-ink-800 dark:text-ink-100">
                        {evidence.fileSizeBytes != null
                          ? formatBytes(evidence.fileSizeBytes / 1024)
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Right: Author */}
                  <div className="flex items-center gap-1.5 text-xs md:w-40 md:shrink-0 md:justify-end">
                    <UserIcon className="h-3.5 w-3.5 shrink-0 text-ink-400" />
                    <p className="truncate font-semibold text-ink-800 dark:text-ink-100">
                      {evidence.authorName ?? "Unknown"}{" "}
                      {evidence.authorRole ? `(${evidence.authorRole})` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-ink-200 p-4 text-center text-xs text-ink-400 dark:border-ink-700">
              No SMS document modifications recorded for this {target.scope}{" "}
              yet.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
