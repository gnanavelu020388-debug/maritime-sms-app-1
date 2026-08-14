import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500');
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== req.params.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [rows] = await pool.query('SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 500', [req.params.tenantId]);
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { tenant_id, actor_email, category, action, target, severity, before_data, after_data } = req.body;
    const id = uuidv4();
    await pool.query(
      'INSERT INTO audit_logs (id, tenant_id, actor_user_id, actor_email, category, action, target, severity, before_data, after_data) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        id, tenant_id || null, req.user.id || null, actor_email, category, action, target || null, severity || 'info',
        before_data ? JSON.stringify(before_data) : null,
        after_data ? JSON.stringify(after_data) : null,
      ],
    );
    return res.status(201).json({ success: true, id });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
