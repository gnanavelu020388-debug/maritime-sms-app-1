import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

// ── Master SMS template tree (platform-wide, tenant-less) ──────────────
// Deliberately separate from /api/sms-documents (each tenant's real, live
// SMS document tree) — never joined or merged with it.

router.get('/master/:treeKind', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM master_sms_documents WHERE tree_kind = ? ORDER BY sort_order, label',
      [req.params.treeKind],
    );
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/master/:treeKind', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { parent_id, label, node_kind, content_kind, content, version, sort_order } = req.body;
    const id = uuidv4();
    await pool.query(
      'INSERT INTO master_sms_documents (id, parent_id, tree_kind, label, node_kind, content_kind, content, version, sort_order) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, parent_id || null, req.params.treeKind, label, node_kind, content_kind || null, content || null, version || '1.0.0', sort_order || 0],
    );
    const [rows] = await pool.query('SELECT * FROM master_sms_documents WHERE id = ?', [id]);
    return res.status(201).json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/master/:treeKind/:nodeId', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const fields = ['label', 'content', 'content_kind', 'version', 'sort_order'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    }
    if (sets.length === 0) return res.json({ error: 'No fields to update' });
    vals.push(req.params.nodeId);
    await pool.query(`UPDATE master_sms_documents SET ${sets.join(', ')} WHERE id = ?`, vals);
    const [rows] = await pool.query('SELECT * FROM master_sms_documents WHERE id = ?', [req.params.nodeId]);
    return res.json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/master/:treeKind/:nodeId', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM master_sms_documents WHERE id = ?', [req.params.nodeId]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/push', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { version, targetTenantIds } = req.body;
    const id = uuidv4();
    await pool.query(
      'INSERT INTO master_sms_pushes (id, version, pushed_by, target_tenant_ids) VALUES (?,?,?,?)',
      [id, version, req.user.email || null, JSON.stringify(targetTenantIds || [])],
    );
    return res.status(201).json({ id, version, targetTenantIds: targetTenantIds || [] });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// ── Per-tenant SMS-tree snapshots (powers the rollback feature) ────────

router.get('/snapshots/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== req.params.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [rows] = await pool.query(
      'SELECT * FROM sms_snapshots WHERE tenant_id = ? ORDER BY taken_at DESC',
      [req.params.tenantId],
    );
    return res.json(rows.map((r) => ({ ...r, tree_data: typeof r.tree_data === 'string' ? JSON.parse(r.tree_data) : r.tree_data })));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/snapshots/:tenantId', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { label, treeData } = req.body;
    const id = uuidv4();
    await pool.query(
      'INSERT INTO sms_snapshots (id, tenant_id, label, tree_data) VALUES (?,?,?,?)',
      [id, req.params.tenantId, label, JSON.stringify(treeData || {})],
    );
    const [rows] = await pool.query('SELECT * FROM sms_snapshots WHERE id = ?', [id]);
    return res.status(201).json({ ...rows[0], tree_data: treeData || {} });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// The actual "restore" is a client-side event — there's no live document
// state on this parallel system to authoritatively overwrite (see
// master_sms_documents comment above). This endpoint returns the snapshot
// so the rollback action is real and auditable.
router.post('/snapshots/:tenantId/:snapshotId/rollback', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM sms_snapshots WHERE id = ? AND tenant_id = ?',
      [req.params.snapshotId, req.params.tenantId],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Snapshot not found' });
    const row = rows[0];
    return res.json({ ...row, tree_data: typeof row.tree_data === 'string' ? JSON.parse(row.tree_data) : row.tree_data });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
