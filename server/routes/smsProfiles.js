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
    const [rows] = await pool.query('SELECT * FROM sms_profiles WHERE tenant_id = ? ORDER BY name', [req.params.tenantId]);
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/:tenantId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { name, version, is_default } = req.body;
    const id = uuidv4();
    await pool.query('INSERT INTO sms_profiles (id, tenant_id, name, version, is_default) VALUES (?,?,?,?,?)', [id, tid, name, version || '1.0.0', is_default ?? false]);
    const [rows] = await pool.query('SELECT * FROM sms_profiles WHERE id = ?', [id]);
    return res.status(201).json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.get('/:tenantId/:profileId/vessels', authMiddleware, async (req, res) => {
  try {
    if (!canAccess(req, req.params.tenantId)) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await pool.query('SELECT vessel_id FROM sms_profile_vessels WHERE profile_id = ?', [req.params.profileId]);
    return res.json(rows.map(r => r.vessel_id));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/:tenantId/:profileId/vessels/:vesselId', authMiddleware, async (req, res) => {
  try {
    if (!canAccess(req, req.params.tenantId)) return res.status(403).json({ error: 'Access denied' });
    await pool.query('INSERT IGNORE INTO sms_profile_vessels (profile_id, vessel_id) VALUES (?, ?)', [req.params.profileId, req.params.vesselId]);
    return res.status(201).json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:tenantId/:profileId/vessels/:vesselId', authMiddleware, async (req, res) => {
  try {
    if (!canAccess(req, req.params.tenantId)) return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM sms_profile_vessels WHERE profile_id = ? AND vessel_id = ?', [req.params.profileId, req.params.vesselId]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
