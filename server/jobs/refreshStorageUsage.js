import pool from '../db.js';
import { getTenantStorageBytes, getPlatformStorageBytes } from '../storage.js';

const BYTES_PER_GB = 1024 ** 3;
let refreshing = false;

export function computeStatus(bytesUsed, limitBytes) {
  if (bytesUsed > limitBytes) return 'OVER_LIMIT';
  if (bytesUsed === limitBytes) return 'LIMIT_REACHED';
  if (bytesUsed >= 0.8 * limitBytes) return 'WARNING';
  return 'NORMAL';
}

export async function refreshTenantStorage(tenantId) {
  const bytesUsed = await getTenantStorageBytes(tenantId);
  const [[tenant]] = await pool.query('SELECT storage_gb_max FROM tenants WHERE id = ?', [tenantId]);
  const limitBytes = Number(tenant?.storage_gb_max || 0) * BYTES_PER_GB;
  const status = computeStatus(bytesUsed, limitBytes);
  await pool.query(
    'INSERT INTO tenant_storage_cache (tenant_id, bytes_used, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE bytes_used = VALUES(bytes_used), status = VALUES(status)',
    [tenantId, bytesUsed, status],
  );
  return { bytesUsed, status };
}

export async function refreshPlatformStorage() {
  const bytesUsed = await getPlatformStorageBytes();
  await pool.query(
    'INSERT INTO platform_storage_cache (id, bytes_used) VALUES (1, ?) ON DUPLICATE KEY UPDATE bytes_used = VALUES(bytes_used)',
    [bytesUsed],
  );
  return bytesUsed;
}

export async function refreshAllTenantStorage() {
  if (refreshing) return { skipped: true };
  refreshing = true;
  let tenantsRefreshed = 0;
  try {
    const [tenants] = await pool.query('SELECT id FROM tenants');
    for (const { id } of tenants) {
      try {
        await refreshTenantStorage(id);
        tenantsRefreshed += 1;
      } catch (err) {
        console.error(`[StorageRefresh] Failed for tenant ${id}:`, err.message);
      }
    }
    const platformBytes = await refreshPlatformStorage();
    return { tenantsRefreshed, platformBytes };
  } finally {
    refreshing = false;
  }
}
