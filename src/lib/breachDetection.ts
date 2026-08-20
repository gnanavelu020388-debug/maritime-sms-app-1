import type { Tenant } from '../types';
import { computeStorageStatus } from './storageStatus';

export type BreachType = 'vessels' | 'storage' | 'seats';

// Single source of truth for "is this tenant in breach, and of what" — used
// by the Monitoring breach table, the Dashboard's License Compliance
// Snapshot, the platform-wide Data Breach KPI, and the Tenant Ledger's
// per-row limit indicators, so none of them can drift the way the storage
// check once did. All three parameters use the same standard — actually
// over the assigned plan limit, not merely approaching it — so "breach"
// means the same thing everywhere in the app. Storage is derived live from
// the tenant's current plan limit (see src/lib/storageStatus.ts) rather
// than any cached status.
export function detectTenantBreaches(t: Tenant): BreachType[] {
  const out: BreachType[] = [];
  if (t.vessels.used > t.vessels.max) out.push('vessels');
  if (computeStorageStatus(t.storageGb.used, t.storageGb.max) === 'OVER_LIMIT') out.push('storage');
  if (t.seats.used > t.seats.max) out.push('seats');
  return out;
}
