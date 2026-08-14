// DEV/DEMO-ONLY companion to seedDemoStorage.js — deletes the demo GCS
// objects it created and restores the affected tenants' real storage_gb_max
// quotas (from server/seed.js), leaving the bucket/cache clean for a repeat run.
//
// Usage:  ALLOW_DEMO_SEED=true node server/resetDemoStorage.js
import dotenv from 'dotenv';
dotenv.config();

if (process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Refusing to run: set ALLOW_DEMO_SEED=true to reset demo GCS storage data.');
  process.exit(1);
}

import pool from './db.js';
import { deleteTenantPrefix } from './storage.js';
import { refreshTenantStorage } from './jobs/refreshStorageUsage.js';

// Original production-tier quotas from server/seed.js — restored after the
// demo script's temporary override.
const ORIGINAL_QUOTAS_GB = {
  'tnt-pacific-horizon': 500,
  'tnt-atlantic-liquid': 300,
  'tnt-nordic-reef': 100,
  'tnt-crescent-maritime': 50,
};

async function main() {
  for (const [tenantId, originalGb] of Object.entries(ORIGINAL_QUOTAS_GB)) {
    console.log(`[reset] ${tenantId} — deleting demo objects, restoring quota to ${originalGb}GB`);
    await deleteTenantPrefix(tenantId);
    await pool.query('UPDATE tenants SET storage_gb_max = ? WHERE id = ?', [originalGb, tenantId]);
    const { bytesUsed, status } = await refreshTenantStorage(tenantId);
    console.log(`  done — bytes_used=${bytesUsed}, status=${status}`);
  }
  console.log('\n[reset] Complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[reset] Failed:', err);
  process.exit(1);
});
