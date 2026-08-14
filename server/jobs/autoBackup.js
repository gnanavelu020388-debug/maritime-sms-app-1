import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { captureSnapshotData } from '../lib/backupSnapshot.js';

// Runs any tenant whose auto_backup_interval_hours has elapsed since its
// last auto-backup (or has never run one). Triggered by Cloud Scheduler
// hitting POST /api/internal/backups/auto-run — same pattern as
// server/jobs/refreshStorageUsage.js — not an in-process setInterval,
// which would run duplicated across Cloud Run's autoscaled instances.
export async function runAutoBackups() {
  const [tenants] = await pool.query(
    `SELECT id, company FROM tenants
     WHERE auto_backup_interval_hours IS NOT NULL
       AND status NOT IN ('archived', 'suspended')
       AND (last_auto_backup_at IS NULL OR last_auto_backup_at <= (NOW() - INTERVAL auto_backup_interval_hours HOUR))`,
  );

  const results = [];
  for (const tenant of tenants) {
    try {
      const snapshotData = await captureSnapshotData(tenant.id);
      const sizeGb = Buffer.byteLength(JSON.stringify(snapshotData), 'utf8') / (1024 ** 3);
      const id = uuidv4();
      const expiry = new Date(Date.now() + 30 * 86400000);
      await pool.query(
        'INSERT INTO backup_snapshots (id, tenant_id, size_gb, type, status, expiry, reason, created_by, snapshot_data) VALUES (?,?,?,?,?,?,?,?,?)',
        [id, tenant.id, sizeGb, 'auto', 'completed', expiry, 'Scheduled auto-backup', 'system', JSON.stringify(snapshotData)],
      );
      await pool.query('UPDATE tenants SET last_auto_backup_at = NOW() WHERE id = ?', [tenant.id]);
      results.push({ tenantId: tenant.id, company: tenant.company, backupId: id, status: 'completed' });
    } catch (err) {
      console.error(`[autoBackup] Failed for tenant ${tenant.id}:`, err.message);
      results.push({ tenantId: tenant.id, company: tenant.company, status: 'failed', error: err.message });
    }
  }
  return { checked: tenants.length, results };
}
