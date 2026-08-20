export type StorageStatus = 'NORMAL' | 'WARNING' | 'LIMIT_REACHED' | 'OVER_LIMIT';

// Single source of truth for "is this tenant over its storage quota?" —
// always derived live from usage vs. the tenant's current plan limit
// (ultimately set by the SaaS Tier Constructor and written to
// tenants.storage_gb_max on every upgrade/downgrade), never from the
// separately cached tenant_storage_cache.status column. That cache only
// gets recomputed by the periodic storage-refresh job/upload path, so
// trusting it directly in the UI let a plan change look reverted until the
// next refresh ran. Computing it here instead means every screen agrees
// the moment the plan limit changes, with nothing else to go stale.
export function computeStorageStatus(usedGb: number, maxGb: number): StorageStatus {
  if (maxGb <= 0) return 'NORMAL';
  if (usedGb > maxGb) return 'OVER_LIMIT';
  if (usedGb === maxGb) return 'LIMIT_REACHED';
  if (usedGb >= 0.8 * maxGb) return 'WARNING';
  return 'NORMAL';
}
