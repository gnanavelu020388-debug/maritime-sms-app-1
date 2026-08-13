import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function canAccess(req, tid) {
  return req.user.role === 'super_admin' || req.user.tenant_id === tid;
}

function parseActions(row) {
  return { ...row, actions: typeof row.actions === 'string' ? JSON.parse(row.actions) : row.actions };
}

// ── Shore role definitions (custom / edited roles) ────────────────────

router.get('/:tenantId/defs', authMiddleware, async (req, res) => {
  try {
    if (!canAccess(req, req.params.tenantId)) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await pool.query('SELECT * FROM shore_role_defs WHERE tenant_id = ? ORDER BY created_at', [req.params.tenantId]);
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/:tenantId/defs', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { role, description } = req.body;
    if (!role) return res.status(400).json({ error: 'role is required' });
    const id = uuidv4();
    await pool.query(
      'INSERT INTO shore_role_defs (id, tenant_id, role, description, is_custom) VALUES (?,?,?,?,TRUE)',
      [id, tid, role, description ?? null],
    );
    const [rows] = await pool.query('SELECT * FROM shore_role_defs WHERE id = ?', [id]);
    return res.status(201).json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.patch('/:tenantId/defs/:role', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { role: newRole, description } = req.body;
    await pool.query(
      'UPDATE shore_role_defs SET role = COALESCE(?, role), description = COALESCE(?, description) WHERE tenant_id = ? AND role = ?',
      [newRole ?? null, description ?? null, tid, req.params.role],
    );
    const [rows] = await pool.query('SELECT * FROM shore_role_defs WHERE tenant_id = ? AND role = ?', [tid, newRole || req.params.role]);
    return res.json(rows[0] ?? null);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:tenantId/defs/:role', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM shore_role_defs WHERE tenant_id = ? AND role = ? AND is_custom = TRUE', [tid, req.params.role]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// ── Shore role permission overrides ────────────────────────────────────

router.get('/:tenantId/perms', authMiddleware, async (req, res) => {
  try {
    if (!canAccess(req, req.params.tenantId)) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await pool.query('SELECT * FROM shore_role_permissions WHERE tenant_id = ?', [req.params.tenantId]);
    return res.json(rows.map(parseActions));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId/perms/:role', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { actions } = req.body;
    if (!actions) return res.status(400).json({ error: 'actions is required' });
    const updatedBy = req.user.email || req.user.name || 'company_admin';
    const id = uuidv4();
    await pool.query(
      `INSERT INTO shore_role_permissions (id, tenant_id, role, actions, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE actions = VALUES(actions), updated_by = VALUES(updated_by)`,
      [id, tid, req.params.role, JSON.stringify(actions), updatedBy],
    );
    const [rows] = await pool.query('SELECT * FROM shore_role_permissions WHERE tenant_id = ? AND role = ?', [tid, req.params.role]);
    return res.json(parseActions(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
