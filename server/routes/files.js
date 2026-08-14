import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../middleware/auth.js';
import { uploadFile, getSignedReadUrl, deleteFile } from '../storage.js';
import { refreshTenantStorage } from '../jobs/refreshStorageUsage.js';
import pool from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const BYTES_PER_GB = 1024 ** 3;

// filePath convention is `tenants/{tenantId}/...` — reject any request for
// a path whose tenant segment doesn't match the authenticated user's tenant.
function tenantOwnsPath(req, filePath) {
  if (req.user.role === 'super_admin') return true;
  const [prefix, tenantId] = filePath.split('/');
  return prefix === 'tenants' && tenantId === req.user.tenant_id;
}

router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const { tenantId, docId } = req.body;
    if (!tenantId) return res.status(400).json({ error: 'tenantId required' });
    // tenantId is form data, not part of the URL/JWT — never trust it
    // blindly, validate against the authenticated user's own tenant.
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'Tenant access denied' });
    }

    // Reserve the incoming file's size against the tenant's quota in one
    // atomic statement so concurrent uploads can't both pass a check based
    // on stale reads. Ensure a cache row exists first (new tenants may not
    // have been refreshed yet).
    await pool.query(
      "INSERT IGNORE INTO tenant_storage_cache (tenant_id, bytes_used, status) VALUES (?, 0, 'NORMAL')",
      [tenantId],
    );
    const [reserveResult] = await pool.query(
      `UPDATE tenant_storage_cache
       SET bytes_used = bytes_used + ?
       WHERE tenant_id = ? AND bytes_used + ? <= (SELECT storage_gb_max * ? FROM tenants WHERE id = ?)`,
      [req.file.size, tenantId, req.file.size, BYTES_PER_GB, tenantId],
    );
    if (reserveResult.affectedRows === 0) {
      return res.status(403).json({ error: 'Storage limit reached', code: 'STORAGE_LIMIT_REACHED' });
    }

    const ext = req.file.originalname.split('.').pop();
    const filePath = `tenants/${tenantId}/sms-documents/${docId || uuidv4()}.${ext}`;
    try {
      const gcsUri = await uploadFile(filePath, req.file.buffer, req.file.mimetype);
      return res.status(201).json({ gcsUri, fileName: req.file.originalname, contentType: req.file.mimetype, size: req.file.size });
    } finally {
      // Reconciles the optimistic reservation above with the real GCS total
      // — self-corrects even if the upload itself failed.
      refreshTenantStorage(tenantId).catch((err) => console.error('[StorageRefresh] Failed after upload:', err.message));
    }
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Upload failed' }); }
});

router.get('/signed-url', authMiddleware, async (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });
    if (!tenantOwnsPath(req, filePath)) return res.status(403).json({ error: 'Access denied' });
    const url = await getSignedReadUrl(filePath);
    return res.json({ url });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Failed to generate URL' }); }
});

router.delete('/', authMiddleware, async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });
    if (!tenantOwnsPath(req, filePath)) return res.status(403).json({ error: 'Access denied' });
    await deleteFile(filePath);
    const tenantId = filePath.split('/')[1];
    if (tenantId) refreshTenantStorage(tenantId).catch((err) => console.error('[StorageRefresh] Failed after delete:', err.message));
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Delete failed' }); }
});

export default router;
