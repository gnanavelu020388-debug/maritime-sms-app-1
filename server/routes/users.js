import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

function parseUser(row) {
  if (!row) return null;
  return {
    ...row,
    assigned_vessel_ids: typeof row.assigned_vessel_ids === 'string' ? JSON.parse(row.assigned_vessel_ids) : (row.assigned_vessel_ids || []),
    assigned_fleet_profile_ids: typeof row.assigned_fleet_profile_ids === 'string' ? JSON.parse(row.assigned_fleet_profile_ids) : (row.assigned_fleet_profile_ids || []),
    auth_uid: row.auth_uid || null,
  };
}

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== req.params.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [rows] = await pool.query('SELECT * FROM tenant_users WHERE tenant_id = ? ORDER BY created_at', [req.params.tenantId]);
    return res.json(rows.map(parseUser));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/:tenantId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== tid) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { name, email, rank, role, nationality, employee_id, passport_number, seaman_book_number, status, fleet_scope, assigned_vessel_ids, assigned_fleet_profile_ids } = req.body;
    const id = uuidv4();
    const defaultPass = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'; // bcrypt hash of 'demo'
    await pool.query(
      'INSERT INTO tenant_users (id, tenant_id, name, email, password_hash, rank, role, nationality, employee_id, passport_number, seaman_book_number, status, fleet_scope, assigned_vessel_ids, assigned_fleet_profile_ids) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, tid, name, email, defaultPass, rank || 'Crew', role || 'vessel', nationality || null, employee_id || null, passport_number || null, seaman_book_number || null, status || 'invited', fleet_scope || 'global', JSON.stringify(assigned_vessel_ids || []), JSON.stringify(assigned_fleet_profile_ids || [])],
    );
    const [rows] = await pool.query('SELECT * FROM tenant_users WHERE id = ?', [id]);
    return res.status(201).json(parseUser(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId/:userId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== tid) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const fields = ['name', 'email', 'rank', 'role', 'nationality', 'employee_id', 'passport_number', 'seaman_book_number', 'status', 'fleet_scope'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    }
    if (req.body.assigned_vessel_ids !== undefined) { sets.push('assigned_vessel_ids = ?'); vals.push(JSON.stringify(req.body.assigned_vessel_ids)); }
    if (req.body.assigned_fleet_profile_ids !== undefined) { sets.push('assigned_fleet_profile_ids = ?'); vals.push(JSON.stringify(req.body.assigned_fleet_profile_ids)); }
    if (sets.length === 0) return res.json({ error: 'No fields to update' });
    vals.push(req.params.userId);
    await pool.query(`UPDATE tenant_users SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, [req.params.userId, tid]);
    const [rows] = await pool.query('SELECT * FROM tenant_users WHERE id = ?', [req.params.userId]);
    return res.json(parseUser(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:tenantId/:userId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== tid) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await pool.query('UPDATE crew_assignments SET signed_off_at = NOW() WHERE user_id = ? AND tenant_id = ? AND signed_off_at IS NULL', [req.params.userId, tid]);
    await pool.query('DELETE FROM tenant_users WHERE id = ? AND tenant_id = ?', [req.params.userId, tid]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId/:userId/deactivate', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== tid) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await pool.query('UPDATE crew_assignments SET signed_off_at = NOW() WHERE user_id = ? AND tenant_id = ? AND signed_off_at IS NULL', [req.params.userId, tid]);
    await pool.query('UPDATE tenant_users SET status = ? WHERE id = ? AND tenant_id = ?', ['inactive', req.params.userId, tid]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
