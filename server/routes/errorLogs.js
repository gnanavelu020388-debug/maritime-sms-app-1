import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

function parseErrorLog(row) {
  if (!row) return null;
  return { ...row, payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {}) };
}

router.get('/', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM error_logs ORDER BY ts DESC LIMIT 500');
    return res.json(rows.map(parseErrorLog));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { level, source, message, tenant_id, payload } = req.body;
    const id = uuidv4();
    await pool.query(
      'INSERT INTO error_logs (id, level, source, message, tenant_id, payload) VALUES (?,?,?,?,?,?)',
      [id, level || 'error', source, message, tenant_id || null, JSON.stringify(payload || {})],
    );
    return res.status(201).json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
