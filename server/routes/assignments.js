import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function canAccess(req, tid) {
  return req.user.role === 'super_admin' || req.user.tenant_id === tid;
}

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (!canAccess(req, req.params.tenantId)) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await pool.query('SELECT * FROM crew_assignments WHERE tenant_id = ? ORDER BY signed_on_at DESC', [req.params.tenantId]);
    return res.json(rows.map(r => ({ ...r })));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/:tenantId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { vessel_id, user_id, rank, signed_on_at, notes } = req.body;
    const id = uuidv4();
    await pool.query(
      'INSERT INTO crew_assignments (id, vessel_id, tenant_id, user_id, rank, signed_on_at, notes) VALUES (?,?,?,?,?,?,?)',
      [vessel_id, vessel_id, tid, user_id, rank, signed_on_at || new Date().toISOString(), notes || null],
    );
    const [rows] = await pool.query('SELECT * FROM crew_assignments WHERE id = ?', [id]);
    return res.status(201).json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId/:assignmentId/signoff', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    await pool.query('UPDATE crew_assignments SET signed_off_at = NOW() WHERE id = ? AND tenant_id = ?', [req.params.assignmentId, tid]);
    const [rows] = await pool.query('SELECT * FROM crew_assignments WHERE id = ?', [req.params.assignmentId]);
    return res.json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
