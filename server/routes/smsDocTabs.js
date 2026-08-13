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
    const [rows] = await pool.query('SELECT * FROM sms_doc_tabs WHERE tenant_id = ? ORDER BY created_at', [req.params.tenantId]);
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/:tenantId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { tab_key, label, subtitle } = req.body;
    if (!tab_key || !label) return res.status(400).json({ error: 'tab_key and label are required' });
    const id = uuidv4();
    await pool.query('INSERT INTO sms_doc_tabs (id, tenant_id, tab_key, label, subtitle) VALUES (?,?,?,?,?)', [id, tid, tab_key, label, subtitle ?? null]);
    const [rows] = await pool.query('SELECT * FROM sms_doc_tabs WHERE id = ?', [id]);
    return res.status(201).json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.patch('/:tenantId/:tabKey', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const { label } = req.body;
    if (!label) return res.status(400).json({ error: 'label is required' });
    await pool.query('UPDATE sms_doc_tabs SET label = ? WHERE tab_key = ? AND tenant_id = ?', [label, req.params.tabKey, tid]);
    const [rows] = await pool.query('SELECT * FROM sms_doc_tabs WHERE tab_key = ? AND tenant_id = ?', [req.params.tabKey, tid]);
    return res.json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:tenantId/:tabKey', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM sms_doc_tabs WHERE tab_key = ? AND tenant_id = ?', [req.params.tabKey, tid]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
