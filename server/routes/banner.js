import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', authMiddleware, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM maintenance_banner WHERE is_active = TRUE ORDER BY published_at DESC LIMIT 1');
    return res.json(rows[0] || null);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { message, severity } = req.body;
    await pool.query('UPDATE maintenance_banner SET is_active = FALSE WHERE is_active = TRUE');
    const id = uuidv4();
    await pool.query('INSERT INTO maintenance_banner (id, message, severity, published_by, is_active) VALUES (?,?,?,?,TRUE)', [id, message, severity || 'info', req.user.email || null]);
    return res.status(201).json({ id, message, severity, published_by: req.user.email, is_active: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    await pool.query('UPDATE maintenance_banner SET is_active = FALSE WHERE is_active = TRUE');
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
