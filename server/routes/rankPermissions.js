import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function canAccess(req, tid) {
  return req.user.role === 'super_admin' || req.user.tenant_id === tid;
}

function parseApps(row) {
  return { ...row, apps: typeof row.apps === 'string' ? JSON.parse(row.apps) : row.apps };
}

// ── Rank definitions (custom / edited ranks) ─────────────────────────

router.get('/:tenantId/defs', authMiddleware, async (req, res) => {
  try {
    if (!canAccess(req, req.params.tenantId)) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await pool.query('SELECT * FROM rank_defs WHERE tenant_id = ? ORDER BY created_at', [req.params.tenantId]);
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/:tenantId/defs', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { rank, description } = req.body;
    if (!rank) return res.status(400).json({ error: 'rank is required' });
    const id = uuidv4();
    await pool.query(
      'INSERT INTO rank_defs (id, tenant_id, `rank`, description, is_custom) VALUES (?,?,?,?,TRUE)',
      [id, tid, rank, description ?? null],
    );
    const [rows] = await pool.query('SELECT * FROM rank_defs WHERE id = ?', [id]);
    return res.status(201).json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.patch('/:tenantId/defs/:rank', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { rank: newRank, description } = req.body;
    await pool.query(
      'UPDATE rank_defs SET `rank` = COALESCE(?, `rank`), description = COALESCE(?, description) WHERE tenant_id = ? AND `rank` = ?',
      [newRank ?? null, description ?? null, tid, req.params.rank],
    );
    const [rows] = await pool.query('SELECT * FROM rank_defs WHERE tenant_id = ? AND `rank` = ?', [tid, newRank || req.params.rank]);
    return res.json(rows[0] ?? null);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:tenantId/defs/:rank', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM rank_defs WHERE tenant_id = ? AND `rank` = ? AND is_custom = TRUE', [tid, req.params.rank]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// ── Rank permission overrides ─────────────────────────────────────────

router.get('/:tenantId/perms', authMiddleware, async (req, res) => {
  try {
    if (!canAccess(req, req.params.tenantId)) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await pool.query('SELECT * FROM rank_permissions WHERE tenant_id = ?', [req.params.tenantId]);
    return res.json(rows.map(parseApps));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId/perms/:rank', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { apps } = req.body;
    if (!apps) return res.status(400).json({ error: 'apps is required' });
    const updatedBy = req.user.email || req.user.name || 'company_admin';
    const id = uuidv4();
    await pool.query(
      `INSERT INTO rank_permissions (id, tenant_id, \`rank\`, apps, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE apps = VALUES(apps), updated_by = VALUES(updated_by)`,
      [id, tid, req.params.rank, JSON.stringify(apps), updatedBy],
    );
    const [rows] = await pool.query('SELECT * FROM rank_permissions WHERE tenant_id = ? AND `rank` = ?', [tid, req.params.rank]);
    return res.json(parseApps(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
