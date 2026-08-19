import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function canAccess(req, tid) {
  return req.user.role === 'super_admin' || req.user.tenant_id === tid;
}

function parseVessel(row) {
  if (!row) return null;
  return {
    ...row,
    gross_tonnage: row.gross_tonnage !== null ? Number(row.gross_tonnage) : null,
    kw_power: row.kw_power !== null ? Number(row.kw_power) : null,
  };
}

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (!canAccess(req, req.params.tenantId)) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await pool.query('SELECT * FROM vessels WHERE tenant_id = ? ORDER BY name', [req.params.tenantId]);
    return res.json(rows.map(parseVessel));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/:tenantId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { name, imo_number, call_sign, flag_state, port_of_registry, gross_tonnage, kw_power, vessel_type, class_society, satellite_provider } = req.body;
    const id = uuidv4();
    const [tRows] = await pool.query('SELECT sms_version, vessels_max FROM tenants WHERE id = ?', [tid]);
    if (!tRows[0]) return res.status(404).json({ error: 'Tenant not found' });
    const smsVer = tRows[0].sms_version || '1.0.0';
    const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM vessels WHERE tenant_id = ?', [tid]);
    if (count >= tRows[0].vessels_max) {
      return res.status(403).json({ error: `Vessel license limit reached (${tRows[0].vessels_max}).`, code: 'VESSEL_LIMIT_REACHED' });
    }
    await pool.query(
      'INSERT INTO vessels (id, tenant_id, name, imo_number, call_sign, flag_state, port_of_registry, gross_tonnage, kw_power, vessel_type, class_society, satellite_provider, sms_active_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, tid, name, imo_number, call_sign || null, flag_state || null, port_of_registry || null, gross_tonnage || null, kw_power || null, vessel_type || null, class_society || null, satellite_provider || null, smsVer],
    );
    const [rows] = await pool.query('SELECT * FROM vessels WHERE id = ?', [id]);
    return res.status(201).json(parseVessel(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId/:vesselId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const fields = ['name', 'imo_number', 'call_sign', 'flag_state', 'port_of_registry', 'gross_tonnage', 'kw_power', 'vessel_type', 'class_society', 'satellite_provider', 'sms_active_version', 'last_sync_at'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    }
    if (sets.length === 0) return res.json({ error: 'No fields to update' });
    vals.push(req.params.vesselId, tid);
    await pool.query(`UPDATE vessels SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, vals);
    const [rows] = await pool.query('SELECT * FROM vessels WHERE id = ?', [req.params.vesselId]);
    return res.json(parseVessel(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:tenantId/:vesselId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM vessels WHERE id = ? AND tenant_id = ?', [req.params.vesselId, tid]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
