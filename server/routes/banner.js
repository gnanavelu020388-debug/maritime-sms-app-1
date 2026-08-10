import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { optionalAuth, authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

// Returns the single banner relevant to the caller: their tenant's own
// banner takes priority over the platform-wide one if both are active.
// Unauthenticated visitors (the login screen) only ever see platform-wide.
router.get('/', optionalAuth, async (req, res) => {
  try {
    const tenantId = req.user && req.user.role !== 'super_admin' ? req.user.tenant_id : undefined;
    if (tenantId) {
      const [tenantRows] = await pool.query('SELECT * FROM maintenance_banner WHERE is_active = TRUE AND tenant_id = ? ORDER BY published_at DESC LIMIT 1', [tenantId]);
      if (tenantRows.length > 0) return res.json(tenantRows[0]);
    }
    const [platformRows] = await pool.query('SELECT * FROM maintenance_banner WHERE is_active = TRUE AND tenant_id IS NULL ORDER BY published_at DESC LIMIT 1');
    return res.json(platformRows[0] || null);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Management list for the Super Admin console: every currently-active
// banner (platform-wide + one per tenant), with the tenant's company name.
router.get('/all', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.*, t.company AS tenant_company FROM maintenance_banner b
       LEFT JOIN tenants t ON t.id = b.tenant_id
       WHERE b.is_active = TRUE ORDER BY b.published_at DESC`,
    );
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { message, severity, tenant_id } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required.' });
    const tenantId = tenant_id || null;
    // Null-safe equals (<=>) so this only deactivates the previous banner in
    // the SAME scope — a tenant-specific publish must never wipe out other
    // tenants' banners or the platform-wide one, and vice versa.
    await pool.query('UPDATE maintenance_banner SET is_active = FALSE WHERE is_active = TRUE AND tenant_id <=> ?', [tenantId]);
    const id = uuidv4();
    await pool.query('INSERT INTO maintenance_banner (id, message, severity, published_by, is_active, tenant_id) VALUES (?,?,?,?,TRUE,?)', [id, message.trim(), severity || 'info', req.user.email || null, tenantId]);
    return res.status(201).json({ id, message: message.trim(), severity: severity || 'info', published_by: req.user.email, is_active: true, tenant_id: tenantId });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const tenantId = req.query.tenant_id || req.body?.tenant_id || null;
    await pool.query('UPDATE maintenance_banner SET is_active = FALSE WHERE is_active = TRUE AND tenant_id <=> ?', [tenantId]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
