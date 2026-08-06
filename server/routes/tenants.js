import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

function parseTenant(row) {
  if (!row) return null;
  return {
    ...row,
    modules: typeof row.modules === 'string' ? JSON.parse(row.modules) : (row.modules || []),
    monthly_revenue: Number(row.monthly_revenue),
    storage_gb_max: Number(row.storage_gb_max),
  };
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    if (req.user.role === 'super_admin') {
      const [rows] = await pool.query('SELECT * FROM tenants ORDER BY created_at DESC');
      return res.json(rows.map(parseTenant));
    }
    const [rows] = await pool.query('SELECT * FROM tenants WHERE id = ?', [req.user.tenant_id]);
    return res.json(rows.map(parseTenant));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== req.params.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [rows] = await pool.query('SELECT * FROM tenants WHERE id = ?', [req.params.tenantId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
    return res.json(parseTenant(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { company, contact_email, plan, region, vessels_max, seats_max, storage_gb_max, monthly_revenue, mfa_enforced, modules, sms_version, status } = req.body;
    const id = uuidv4();
    await pool.query(
      'INSERT INTO tenants (id, company, contact_email, plan, region, vessels_max, seats_max, storage_gb_max, monthly_revenue, mfa_enforced, modules, sms_version, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, company, contact_email, plan || 'Standard', region || 'EMEA', vessels_max || 5, seats_max || 25, storage_gb_max || 50, monthly_revenue || 0, mfa_enforced ?? true, JSON.stringify(modules || []), sms_version || '1.0.0', status || 'active'],
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
    const fields = ['company', 'contact_email', 'plan', 'status', 'region', 'vessels_max', 'seats_max', 'storage_gb_max', 'monthly_revenue', 'mfa_enforced', 'sms_version'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    }
    if (req.body.modules !== undefined) { sets.push('modules = ?'); vals.push(JSON.stringify(req.body.modules)); }
    if (sets.length === 0) return res.json({ error: 'No fields to update' });
    vals.push(req.params.tenantId);
    await pool.query(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`, vals);
    const [rows] = await pool.query('SELECT * FROM tenants WHERE id = ?', [req.params.tenantId]);
    return res.json(parseTenant(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:tenantId', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE tenants SET status = ? WHERE id = ?', ['archived', req.params.tenantId]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
