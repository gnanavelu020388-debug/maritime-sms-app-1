import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();

function canAccess(req, tid) {
  return req.user.role === 'super_admin' || req.user.tenant_id === tid;
}

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (!canAccess(req, req.params.tenantId)) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await pool.query(
      'SELECT inactivity_timeout_minutes, enforce_single_session, updated_by, updated_at FROM tenant_security_settings WHERE tenant_id = ?',
      [req.params.tenantId],
    );
    if (rows.length === 0) {
      return res.json({ inactivity_timeout_minutes: 15, enforce_single_session: true, updated_by: null, updated_at: null });
    }
    return res.json(rows[0]);
  } catch (err) { console.error('[tenantSecurity GET]', err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });

    const timeoutMinutes = Number(req.body.inactivity_timeout_minutes);
    if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 480) {
      return res.status(400).json({ error: 'inactivity_timeout_minutes must be between 1 and 480' });
    }
    const enforceSingle = Boolean(req.body.enforce_single_session);
    const updatedBy = req.user.email || req.user.name || 'company_admin';
    const id = crypto.randomUUID();

    await pool.query(
      `INSERT INTO tenant_security_settings (id, tenant_id, inactivity_timeout_minutes, enforce_single_session, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         inactivity_timeout_minutes = VALUES(inactivity_timeout_minutes),
         enforce_single_session = VALUES(enforce_single_session),
         updated_by = VALUES(updated_by)`,
      [id, tid, timeoutMinutes, enforceSingle, updatedBy],
    );

    const [rows] = await pool.query(
      'SELECT inactivity_timeout_minutes, enforce_single_session, updated_by, updated_at FROM tenant_security_settings WHERE tenant_id = ?',
      [tid],
    );
    return res.json(rows[0]);
  } catch (err) { console.error('[tenantSecurity PUT]', err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
