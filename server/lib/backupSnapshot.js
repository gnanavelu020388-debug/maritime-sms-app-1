import pool from '../db.js';

// Tables captured/restored by a tenant backup — scoped strictly to a
// tenant's own business data (SMS documents, forms, logs, user accounts),
// per the scope directive in src/types.ts. Order matters for restore: it's
// also the FK-safe insert order (parents before children). Shared between
// the manual/restore routes (server/routes/backups.js) and the scheduled
// auto-backup job (server/jobs/autoBackup.js).
export const SNAPSHOT_TABLES = ['tenant_users', 'vessels', 'crew_assignments', 'sms_profiles', 'sms_documents', 'sms_doc_tabs'];

export async function captureSnapshotData(tenantId) {
  const data = {};
  for (const table of SNAPSHOT_TABLES) {
    const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE tenant_id = ?`, [tenantId]);
    data[table] = rows;
  }
  return data;
}

// Tenant Backup & Recovery tab keeps only the 2 most recent snapshots per
// tenant (current + previous) — called after every manual snapshot insert
// in server/routes/backups.js so a third snapshot pushes the oldest out.
export async function enforceSnapshotLimit(tenantId) {
  await pool.query(
    `DELETE FROM backup_snapshots WHERE tenant_id = ? AND id NOT IN (
       SELECT id FROM (
         SELECT id FROM backup_snapshots WHERE tenant_id = ? ORDER BY taken_at DESC LIMIT 2
       ) AS keep
     )`,
    [tenantId, tenantId],
  );
}
