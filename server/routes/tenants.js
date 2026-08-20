import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';
import { refreshTenantStorage } from '../jobs/refreshStorageUsage.js';

const router = Router();

const BYTES_PER_GB = 1024 ** 3;

function parseTenant(row) {
  if (!row) return null;
  const storageGbMax = Number(row.storage_gb_max);
  const storageBytesUsed = Number(row.storage_bytes_used || 0);
  const limitBytes = storageGbMax * BYTES_PER_GB;
  const usedGb = storageBytesUsed / BYTES_PER_GB;
  const remainingGb = Math.max(0, storageGbMax - usedGb);
  const percentage = limitBytes > 0 ? Math.round((storageBytesUsed / limitBytes) * 1000) / 10 : 0;
  return {
    ...row,
    modules: typeof row.modules === 'string' ? JSON.parse(row.modules) : (row.modules || []),
    monthly_revenue: Number(row.monthly_revenue),
    storage_gb_max: storageGbMax,
    storage_bytes_used: storageBytesUsed,
    storage_status: row.storage_status || 'NORMAL',
    storage_remaining_gb: remainingGb,
    storage_percentage: percentage,
  };
}

// Storage usage comes from tenant_storage_cache, populated by listing each
// tenant's GCS prefix (server/jobs/refreshStorageUsage.js and the quota
// reservation in server/routes/files.js) rather than a live bucket call on
// every request.
const TENANTS_WITH_STORAGE_SQL = `
  SELECT t.*, COALESCE(c.bytes_used, 0) AS storage_bytes_used, c.status AS storage_status
  FROM tenants t
  LEFT JOIN tenant_storage_cache c ON c.tenant_id = t.id
`;

router.get('/', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      const [rows] = await pool.query(`${TENANTS_WITH_STORAGE_SQL} ORDER BY t.created_at DESC`);
      return res.json(rows.map(parseTenant));
    }
    const [rows] = await pool.query(`${TENANTS_WITH_STORAGE_SQL} WHERE t.id = ?`, [req.user.tenant_id]);
    return res.json(rows.map(parseTenant));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== req.params.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [rows] = await pool.query(`${TENANTS_WITH_STORAGE_SQL} WHERE t.id = ?`, [req.params.tenantId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    return res.json(parseTenant(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { company, contact_email, plan, vessels_max, seats_max, storage_gb_max, monthly_revenue, mfa_enforced, modules, sms_version, status } = req.body;
    const id = uuidv4();
    await pool.query(
      'INSERT INTO tenants (id, company, contact_email, plan, vessels_max, seats_max, storage_gb_max, monthly_revenue, mfa_enforced, modules, sms_version, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, company, contact_email, plan || 'Standard', vessels_max || 5, seats_max || 25, storage_gb_max || 50, monthly_revenue || 0, mfa_enforced ?? true, JSON.stringify(modules || []), sms_version || '1.0.0', status || 'active'],
    );
    const [rows] = await pool.query('SELECT * FROM tenants WHERE id = ?', [id]);
    return res.status(201).json(parseTenant(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== req.params.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const fields = [
      'company', 'contact_email', 'plan', 'status', 'vessels_max', 'seats_max', 'storage_gb_max', 'monthly_revenue', 'mfa_enforced', 'sms_version',
      'workspace_frozen', 'max_subfolder_depth', 'max_upload_size_mb', 'auto_backup_interval_hours',
    ];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    }
    // mysql2 rejects a raw ISO string ("...T...Z") for a TIMESTAMP column —
    // always wrap in Date(), matching the convention in invoices.js/backups.js.
    if (req.body.contract_expires !== undefined) { sets.push('contract_expires = ?'); vals.push(new Date(req.body.contract_expires)); }
    if (req.body.modules !== undefined) { sets.push('modules = ?'); vals.push(JSON.stringify(req.body.modules)); }
    if (sets.length === 0) return res.json({ error: 'No fields to update' });
    vals.push(req.params.tenantId);
    await pool.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`, vals);
    // Changing the plan's storage limit makes the cached OVER_LIMIT/WARNING/
    // NORMAL verdict in tenant_storage_cache stale — it was computed against
    // the old limit and otherwise only gets recomputed by the periodic Cloud
    // Scheduler job. Recompute it inline here so a plan upgrade/downgrade is
    // reflected immediately instead of waiting for the next scheduled run.
    if (req.body.storage_gb_max !== undefined) {
      await refreshTenantStorage(req.params.tenantId);
    }
    const [rows] = await pool.query(`${TENANTS_WITH_STORAGE_SQL} WHERE t.id = ?`, [req.params.tenantId]);
    return res.json(parseTenant(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:tenantId', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE tenants SET status = ? WHERE id = ?', ['archived', req.params.tenantId]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Genuine hard delete — cascades to tenant_users, vessels, crew_assignments,
// sms_documents, audit_logs, etc. via the ON DELETE CASCADE foreign keys in
// schema.sql. Distinct from the route above, which only soft-archives.
router.delete('/:tenantId/permanent', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM tenants WHERE id = ?', [req.params.tenantId]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Tenant not found' });
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
