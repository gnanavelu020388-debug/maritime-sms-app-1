import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

// A real, one-time temp credential (not the shared/guessable default
// tenant_users.js uses) — internal platform accounts warrant a genuinely
// random password since they carry Super-Admin-tier backend access.
function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 12);
}

router.get('/', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM platform_staff ORDER BY created_at DESC');
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { name, email, role } = req.body;
    const id = uuidv4();
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    await pool.query(
      'INSERT INTO platform_staff (id, name, email, role, status, mfa, password_hash, must_change_password) VALUES (?,?,?,?,?,?,?,TRUE)',
      [id, name, email, role || 'Global Support Staff', 'invited', false, passwordHash],
    );
    const [rows] = await pool.query('SELECT * FROM platform_staff WHERE id = ?', [id]);
    // tempPassword is returned exactly once — it is never stored or
    // retrievable again after this response (only its bcrypt hash is kept).
    return res.status(201).json({ ...rows[0], tempPassword });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const fields = ['name', 'email', 'role'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    }
    if (sets.length === 0) return res.json({ error: 'No fields to update' });
    vals.push(req.params.id);
    await pool.query(`UPDATE platform_staff SET ${sets.join(', ')} WHERE id = ?`, vals);
    const [rows] = await pool.query('SELECT * FROM platform_staff WHERE id = ?', [req.params.id]);
    return res.json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:id/lock-toggle', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query(
      "UPDATE platform_staff SET status = CASE WHEN status = 'locked' THEN 'active' ELSE 'locked' END WHERE id = ?",
      [req.params.id],
    );
    const [rows] = await pool.query('SELECT * FROM platform_staff WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Staff member not found' });
    return res.json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// A real credential rotation — generates a new temp password, hashes it,
// and forces a change on next sign-in. The plaintext is returned exactly
// once so the Super Admin can relay it to the staff member out-of-band.
router.put('/:id/reset-password', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const [result] = await pool.query(
      'UPDATE platform_staff SET password_hash = ?, must_change_password = TRUE WHERE id = ?',
      [passwordHash, req.params.id],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Staff member not found' });
    return res.json({ success: true, tempPassword });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    if (req.query.mode === 'soft') {
      await pool.query("UPDATE platform_staff SET status = 'locked', mfa = FALSE WHERE id = ?", [req.params.id]);
      return res.json({ success: true });
    }
    await pool.query('DELETE FROM platform_staff WHERE id = ?', [req.params.id]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
