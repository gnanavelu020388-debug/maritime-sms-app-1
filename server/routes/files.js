import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { authMiddleware } from '../middleware/auth.js';
import { uploadFile, getSignedReadUrl, deleteFile } from '../storage.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

router.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const { tenantId, docId } = req.body;
    const ext = req.file.originalname.split('.').pop();
    const filePath = `tenants/${tenantId}/sms-documents/${docId || uuidv4()}.${ext}`;
    const gcsUri = await uploadFile(filePath, req.file.buffer, req.file.mimetype);
    return res.status(201).json({ gcsUri, fileName: req.file.originalname, contentType: req.file.mimetype, size: req.file.size });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Upload failed' }); }
});

router.get('/signed-url', authMiddleware, async (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });
    const url = await getSignedReadUrl(filePath);
    return res.json({ url });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Failed to generate URL' }); }
});

router.delete('/', authMiddleware, async (req, res) => {
  try {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'filePath required' });
    await deleteFile(filePath);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Delete failed' }); }
});

export default router;
