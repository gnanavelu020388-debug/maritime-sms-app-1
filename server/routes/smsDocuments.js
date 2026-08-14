import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

function canAccess(req, tid) {
  return req.user.role === 'super_admin' || req.user.tenant_id === tid;
}

// Real enforcement for the Super Admin "Workspace Freeze" and "Guardrails"
// controls (previously client-side-only no-ops — see demoData.ts). A
// Super Admin acting on their own tenant's workspace (there isn't one) or
// operating platform-wide is never blocked by this; it only ever applies
// to a tenant's own writes to their own SMS documents.
async function assertNotFrozen(res, tenantId) {
  const [[t]] = await pool.query('SELECT workspace_frozen FROM tenants WHERE id = ?', [tenantId]);
  if (t?.workspace_frozen) {
    res.status(423).json({ error: 'This workspace has been frozen by the platform administrator. Creating, editing, renaming, uploading, and deleting SMS content is disabled until it is unfrozen.' });
    return false;
  }
  return true;
}

async function folderDepth(tenantId, parentId) {
  let depth = 0;
  let currentId = parentId;
  while (currentId) {
    depth += 1;
    const [[row]] = await pool.query('SELECT parent_id FROM sms_documents WHERE id = ? AND tenant_id = ?', [currentId, tenantId]);
    if (!row) break;
    currentId = row.parent_id;
    if (depth > 50) break; // guard against a corrupt/cyclical parent chain
  }
  return depth;
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
    if (!(await assertNotFrozen(res, tid))) return;
    const { parent_id, tree_kind, label, node_kind, content_kind, content, file_size_bytes, is_regulatory_header, approval_state, version, sort_order, profile_id, author_name, author_role, author_origin, rejection_comments } = req.body;

    if (parent_id) {
      const [[t]] = await pool.query('SELECT max_subfolder_depth FROM tenants WHERE id = ?', [tid]);
      const depth = await folderDepth(tid, parent_id);
      if (depth >= (t?.max_subfolder_depth ?? 4)) {
        return res.status(400).json({ error: `This workspace's maximum folder depth (${t?.max_subfolder_depth ?? 4}) has been reached.` });
      }
    }
    if (content_kind === 'pdf' && file_size_bytes) {
      const [[t]] = await pool.query('SELECT max_upload_size_mb FROM tenants WHERE id = ?', [tid]);
      const maxBytes = (t?.max_upload_size_mb ?? 50) * 1024 * 1024;
      if (file_size_bytes > maxBytes) {
        return res.status(400).json({ error: `File exceeds this workspace's upload limit (${t?.max_upload_size_mb ?? 50} MB).` });
      }
    }

    const id = uuidv4();
    await pool.query(
      'INSERT INTO sms_documents (id, tenant_id, parent_id, tree_kind, label, node_kind, content_kind, content, file_size_bytes, is_regulatory_header, approval_state, version, sort_order, profile_id, author_name, author_role, author_origin, rejection_comments) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, tid, parent_id || null, tree_kind, label, node_kind, content_kind || null, content || null, file_size_bytes ?? null, is_regulatory_header ?? false, approval_state || 'draft', version || '1.0.0', sort_order || 0, profile_id || null, author_name || null, author_role || null, author_origin || null, rejection_comments || null],
    );
    const [rows] = await pool.query('SELECT * FROM sms_documents WHERE id = ?', [id]);
    return res.status(201).json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId/:docId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    if (!(await assertNotFrozen(res, tid))) return;
    if (req.body.file_size_bytes) {
      const [[t]] = await pool.query('SELECT max_upload_size_mb FROM tenants WHERE id = ?', [tid]);
      const maxBytes = (t?.max_upload_size_mb ?? 50) * 1024 * 1024;
      if (req.body.file_size_bytes > maxBytes) {
        return res.status(400).json({ error: `File exceeds this workspace's upload limit (${t?.max_upload_size_mb ?? 50} MB).` });
      }
    }
    const fields = ['parent_id', 'tree_kind', 'label', 'node_kind', 'content_kind', 'content', 'file_size_bytes', 'is_regulatory_header', 'approval_state', 'version', 'sort_order', 'profile_id', 'author_name', 'author_role', 'author_origin', 'rejection_comments'];
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
    if (!(await assertNotFrozen(res, tid))) return;
    await pool.query('DELETE FROM sms_documents WHERE id = ? AND tenant_id = ?', [req.params.docId, tid]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// ── Document version history (sms_document_versions) ────────────────────
// Real backing for src/lib/docVersions.ts — previously a fabricated local
// object that was never persisted, never listed, and could never restore.

router.get('/:tenantId/:docId/versions', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const [rows] = await pool.query(
      'SELECT * FROM sms_document_versions WHERE tenant_id = ? AND document_id = ? ORDER BY revision DESC',
      [tid, req.params.docId],
    );
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Snapshots the document's CURRENT state before the caller overwrites it —
// call this immediately before the PUT that applies the new content.
router.post('/:tenantId/:docId/versions', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    const [[doc]] = await pool.query('SELECT * FROM sms_documents WHERE id = ? AND tenant_id = ?', [req.params.docId, tid]);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    const { uploaded_by } = req.body;
    const [[{ maxRevision }]] = await pool.query(
      'SELECT COALESCE(MAX(revision), 0) AS maxRevision FROM sms_document_versions WHERE tenant_id = ? AND document_id = ?',
      [tid, req.params.docId],
    );
    const id = uuidv4();
    await pool.query(
      'INSERT INTO sms_document_versions (id, tenant_id, document_id, revision, version_label, content, content_kind, uploaded_by) VALUES (?,?,?,?,?,?,?,?)',
      [id, tid, req.params.docId, maxRevision + 1, doc.version, doc.content, doc.content_kind, uploaded_by || doc.author_name || null],
    );
    const [rows] = await pool.query('SELECT * FROM sms_document_versions WHERE id = ?', [id]);
    return res.status(201).json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/:tenantId/:docId/versions/:revision/restore', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (!canAccess(req, tid)) return res.status(403).json({ error: 'Access denied' });
    if (!(await assertNotFrozen(res, tid))) return;
    const [[version]] = await pool.query(
      'SELECT * FROM sms_document_versions WHERE tenant_id = ? AND document_id = ? AND revision = ?',
      [tid, req.params.docId, req.params.revision],
    );
    if (!version) return res.status(404).json({ error: 'Version not found' });
    await pool.query(
      'UPDATE sms_documents SET content = ?, content_kind = ?, approval_state = ? WHERE id = ? AND tenant_id = ?',
      [version.content, version.content_kind, 'pending_dpa', req.params.docId, tid],
    );
    const [rows] = await pool.query('SELECT * FROM sms_documents WHERE id = ?', [req.params.docId]);
    return res.json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
