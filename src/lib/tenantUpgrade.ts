import * as api from './api';
import { logAudit } from './audit';
import type { Tenant, PlanTier, TierConfig } from '../types';

// Suggests the next tier up from a tenant's current plan, used to
// pre-select a sensible target when opening the Upgrade modal. Tier names
// are editable, so "next" is positional within the live tierConfigs list
// (ordered by monthly price ascending, per GET /platform/tiers) rather than
// a hardcoded name list.
export function nextPlanUp(current: PlanTier, tierConfigs: TierConfig[]): PlanTier {
  const idx = tierConfigs.findIndex((c) => c.name === current);
  if (idx < 0 || tierConfigs.length === 0) return current;
  return idx < tierConfigs.length - 1 ? tierConfigs[idx + 1].name : tierConfigs[idx].name;
}

// Persists a tenant's plan change: writes the target tier's limits (from
// tierConfigs, the SaaS Tier Constructor's saved values — the single
// source of truth for what a plan includes) to the real tenant row and
// logs the change. Every tenant reaching this function came from
// GET /tenants (dataCache only ever populates from the real backend — see
// src/lib/dataCache.ts), so it always has a real row to write to.
export async function upgradeTenantPlan(
  tenant: Tenant,
  plan: PlanTier,
  contractExpires: string,
  tierConfigs: TierConfig[],
  actorEmail: string,
): Promise<{ vessels: number; seats: number; storageGb: number; monthly: number }> {
  const d = tierConfigs.find((c) => c.name === plan) ?? { vessels: 0, seats: 0, storageGb: 0, monthly: 0 };
  await api.apiUpdateTenant(tenant.id, {
    plan, vessels_max: d.vessels, seats_max: d.seats, storage_gb_max: d.storageGb, monthly_revenue: d.monthly,
    contract_expires: contractExpires,
  });
  await logAudit({
    tenantId: tenant.id,
    actorEmail,
    category: 'billing',
    action: `Plan tier changed to ${plan}: ${tenant.company}`,
    target: tenant.company,
    before: { plan: tenant.plan, vessels_max: tenant.vessels.max, seats_max: tenant.seats.max, storage_gb_max: tenant.storageGb.max, contract_expires: tenant.contractExpires },
    after: { plan, vessels_max: d.vessels, seats_max: d.seats, storage_gb_max: d.storageGb, contract_expires: contractExpires },
  });
  return d;
}
