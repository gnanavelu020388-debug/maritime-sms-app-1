import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

const SELECT_JOINED = 'SELECT b.*, t.company FROM backup_snapshots b JOIN tenants t ON t.id = b.tenant_id';

function parseBackup(row) {
  if (!row) return null;
  return { ...row, size_gb: Number(row.size_gb) };
}

router.get('/', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(`${SELECT_JOINED} ORDER BY b.taken_at DESC LIMIT 1000`);
    return res.json(rows.map(parseBackup));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { tenant_id, size_gb, type, status, expiry, reason } = req.body;
    const id = uuidv4();
    // mysql2 auto-formats JS Date objects for TIMESTAMP columns, but rejects
    // a raw ISO string ("...T...Z") from the client — always wrap in Date().
    const expiryDate = expiry ? new Date(expiry) : new Date(Date.now() + 30 * 86400000);
    await pool.query(
      'INSERT INTO backup_snapshots (id, tenant_id, size_gb, type, status, expiry, reason, created_by) VALUES (?,?,?,?,?,?,?,?)',
      [id, tenant_id, size_gb || 0, type || 'manual', status || 'completed', expiryDate, reason || null, req.user.email || null],
    );
    const [rows] = await pool.query(`${SELECT_JOINED} WHERE b.id = ?`, [id]);
    return res.status(201).json(parseBackup(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// No real restore/rollback logic exists for tenant data — this endpoint
// exists so the action is real and auditable, mirroring today's behavior.
router.post('/:id/restore', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`${SELECT_JOINED} WHERE b.id = ?`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Snapshot not found' });
    return res.json(parseBackup(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM backup_snapshots WHERE id = ?', [req.params.id]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
