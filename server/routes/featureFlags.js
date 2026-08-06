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
