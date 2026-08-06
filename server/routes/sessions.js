import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

router.post('/register', authMiddleware, async (req, res) => {
  try {
    const { deviceInfo } = req.body;
    const token = uuidv4() + '-' + Date.now();
    await pool.query('INSERT INTO session_tokens (id, user_id, token, device_info) VALUES (?,?,?,?)', [uuidv4(), req.user.id, token, deviceInfo || null]);
    return res.json({ token });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:token', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM session_tokens WHERE token = ? AND user_id = ?', [req.params.token, req.user.id]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.get('/check/:userId', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT token, device_info, created_at FROM session_tokens WHERE user_id = ? ORDER BY created_at DESC', [req.params.userId]);
    return res.json({ sessions: rows });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
