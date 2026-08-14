import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== req.params.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [rows] = await pool.query('SELECT * FROM tenant_feature_flags WHERE tenant_id = ?', [req.params.tenantId]);
    return res.json(rows.map(r => ({
      ...r,
      custom_config: typeof r.custom_config === 'string' ? JSON.parse(r.custom_config) : (r.custom_config || {}),
    })));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Global (platform-wide) module display-name overrides — backs the
// Feature Matrix "rename module" action for real (previously an in-memory
// Map with no persistence — see demoSetModuleDef in demoData.ts).
router.get('/module-defs/all', authMiddleware, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM module_definitions WHERE tenant_id IS NULL');
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/module-defs/:featureKey', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { display_name, updated_by } = req.body;
    const [existing] = await pool.query('SELECT id FROM module_definitions WHERE module_key = ? AND tenant_id IS NULL', [req.params.featureKey]);
    if (existing.length > 0) {
      await pool.query('UPDATE module_definitions SET label = ? WHERE id = ?', [display_name, existing[0].id]);
    } else {
      await pool.query(
        'INSERT INTO module_definitions (id, tenant_id, module_key, label, is_system) VALUES (?, NULL, ?, ?, FALSE)',
        [uuidv4(), req.params.featureKey, display_name],
      );
    }
    void updated_by; // not persisted — module_definitions has no updated_by column; kept for API symmetry with the tenant-scoped flag endpoint
    const [rows] = await pool.query('SELECT * FROM module_definitions WHERE module_key = ? AND tenant_id IS NULL', [req.params.featureKey]);
    return res.json(rows[0]);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId/:featureKey', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { enabled, custom_config, updated_by } = req.body;
    const tid = req.params.tenantId;
    const [existing] = await pool.query('SELECT id FROM tenant_feature_flags WHERE tenant_id = ? AND feature_key = ?', [tid, req.params.featureKey]);
    if (existing.length > 0) {
      await pool.query('UPDATE tenant_feature_flags SET enabled = ?, custom_config = ?, updated_by = ? WHERE tenant_id = ? AND feature_key = ?',
        [enabled, JSON.stringify(custom_config || {}), updated_by || null, tid, req.params.featureKey]);
    } else {
      await pool.query('INSERT INTO tenant_feature_flags (id, tenant_id, feature_key, enabled, custom_config, updated_by) VALUES (?,?,?,?,?,?)',
        [uuidv4(), tid, req.params.featureKey, enabled, JSON.stringify(custom_config || {}), updated_by || null]);
    }
    const [rows] = await pool.query('SELECT * FROM tenant_feature_flags WHERE tenant_id = ? AND feature_key = ?', [tid, req.params.featureKey]);
    return res.json({ ...rows[0], custom_config: typeof rows[0].custom_config === 'string' ? JSON.parse(rows[0].custom_config) : rows[0].custom_config });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
