import { useState, type ReactNode } from "react";
import {
  TrendingUp,
  ArrowUpRight,
  HardDrive,
  Ship,
  Users as UsersIcon,
} from "lucide-react";
import { Modal } from "./Modal";
import { Badge } from "./Badge";
import { formatGb, formatCurrency } from "../constants";
import type { Tenant, PlanTier, TierConfig } from "../types";

export function UpgradeModal({
  tenant,
  tierConfigs,
  selectedPlan,
  onSelectPlan,
  onClose,
  onConfirm,
}: {
  tenant: Tenant;
  tierConfigs: TierConfig[];
  selectedPlan: PlanTier;
  onSelectPlan: (p: PlanTier) => void;
  onClose: () => void;
  onConfirm: (plan: PlanTier, contractExpires: string) => void | Promise<void>;
}) {
  const targetDefs = tierConfigs.find((c) => c.name === selectedPlan) ?? {
    name: selectedPlan,
    vessels: 0,
    seats: 0,
    storageGb: 0,
    monthly: 0,
    annual: 0,
  };
  // A tenant's stored limits are a snapshot taken at their last upgrade —
  // editing a tier's numbers in the Tier Constructor never touches tenants
  // that are already on it (see tenantUpgrade.ts), so a plan name match
  // alone doesn't mean "nothing to change" any more. Only treat an option
  // as a true no-op when the name AND every number already line up; that's
  // what lets an admin deliberately re-select the tenant's current plan to
  // pull in a catalog update it has drifted out of sync with.
  const isNoOp = (c: TierConfig) =>
    c.name === tenant.plan &&
    c.vessels === tenant.vessels.max &&
    c.seats === tenant.seats.max &&
    c.storageGb === tenant.storageGb.max &&
    c.monthly === tenant.monthlyRevenue;
  // A plan change starts a new contract term, so it needs its own expiry —
  // default to one year out (same convention as a brand-new tenant), but
  // let the admin pick a different date before confirming.
  const [contractExpires, setContractExpires] = useState(
    new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
  );
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
    <Modal scrollable
      open
      onClose={onClose}
      title="Upgrade Tenant Tier"
      subtitle={`${tenant.company} · ${tenant.id}`}
      icon={<TrendingUp className="h-5 w-5" />}
      size="3xl"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary p-2 rounded-md">
            Cancel
          </button>
          <button
            onClick={() =>
              onConfirm(selectedPlan, new Date(contractExpires).toISOString())
            }
            disabled={isNoOp(targetDefs) || !contractExpires}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50 rounded-md flex gap-2 p-2 items-center"
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

        <div className="overflow-x-auto rounded-xl border border-ink-200 dark:border-ink-800">
          <table className="w-full min-w-[700px] text-left text-sm">
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
            {tierConfigs.map((c) => (
              <option key={c.name} value={c.name} disabled={isNoOp(c)}>
                {c.name}
                {c.name === tenant.plan
                  ? isNoOp(c)
                    ? " (current)"
                    : " (current — catalog updated since assigned)"
                  : ""}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
            Monthly revenue will adjust to {formatCurrency(targetDefs.monthly)}
            /mo based on the {selectedPlan} tier.
          </p>
        </div>

        <div>
          <label className="label">New contract expiry</label>
          <input
            type="date"
            className="input"
            value={contractExpires}
            onChange={(e) => setContractExpires(e.target.value)}
          />
          <p className="mt-2 text-xs text-ink-500 dark:text-ink-400">
            The {selectedPlan} tier's contract term will run through this date.
          </p>
        </div>
      </div>
    </Modal>
  );
}
