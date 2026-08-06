import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function canAccess(req, tid) {
  return req.user.role === 'super_admin' || req.user.tenant_id === tid;
}

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (!canAccess(req, req.params.tenantId)) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await pool.query('SELECT * FROM sms_documents WHERE tenant_id = ? ORDER BY sort_order, label', [req.params.tenantId]);
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/:tenantId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { parent_id, tree_kind, label, node_kind, content_kind, content, is_regulatory_header, approval_state, version, sort_order, profile_id, author_name, author_role, author_origin, rejection_comments } = req.body;
    const id = uuidv4();
    await pool.query(
      'INSERT INTO sms_documents (id, tenant_id, parent_id, tree_kind, label, node_kind, content_kind, content, is_regulatory_header, approval_state, version, sort_order, profile_id, author_name, author_role, author_origin, rejection_comments) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, tid, parent_id || null, tree_kind, label, node_kind, content_kind || null, content || null, is_regulatory_header ?? false, approval_state || 'draft', version || '1.0.0', sort_order || 0, profile_id || null, author_name || null, author_role || null, author_origin || null, rejection_comments || null],
    );
    const [rows] = await pool.query('SELECT * FROM sms_documents WHERE id = ?', [id]);
    return res.status(201).json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId/:docId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const fields = ['parent_id', 'tree_kind', 'label', 'node_kind', 'content_kind', 'content', 'is_regulatory_header', 'approval_state', 'version', 'sort_order', 'profile_id', 'author_name', 'author_role', 'author_origin', 'rejection_comments'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
    }
    if (sets.length === 0) return res.json({ error: 'No fields to update' });
    vals.push(req.params.docId, tid);
    await pool.query(`UPDATE sms_documents SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, vals);
    const [rows] = await pool.query('SELECT * FROM sms_documents WHERE id = ?', [req.params.docId]);
    return res.json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:tenantId/:docId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM sms_documents WHERE id = ? AND tenant_id = ?', [req.params.docId, tid]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
