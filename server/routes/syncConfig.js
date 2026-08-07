import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();

const ALLOWED_INTERVALS = [2, 4, 6, 12, 24];

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== req.params.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [rows] = await pool.query(
      'SELECT auto_sync_interval_hours, manual_replicate_enabled, updated_by, updated_at FROM tenant_sync_config WHERE tenant_id = ?',
      [req.params.tenantId],
    );
    if (rows.length === 0) {
      return res.json({ auto_sync_interval_hours: 6, manual_replicate_enabled: true, updated_by: null, updated_at: null });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('[syncConfig GET]', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

router.put('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only Super Admins can change sync configuration' });
    }

    const { auto_sync_interval_hours, manual_replicate_enabled } = req.body;
    const intervalHours = Number(auto_sync_interval_hours);

    if (!ALLOWED_INTERVALS.includes(intervalHours)) {
      return res.status(400).json({ error: `Invalid interval. Allowed values: ${ALLOWED_INTERVALS.join(', ')} hours` });
    }

    const manualReplicate = Boolean(manual_replicate_enabled);
    const updatedBy = req.user.email || req.user.name || 'super_admin';
    const id = crypto.randomUUID();

    await pool.query(
      `INSERT INTO tenant_sync_config (id, tenant_id, auto_sync_interval_hours, manual_replicate_enabled, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         auto_sync_interval_hours = VALUES(auto_sync_interval_hours),
         manual_replicate_enabled = VALUES(manual_replicate_enabled),
         updated_by = VALUES(updated_by)`,
      [id, req.params.tenantId, intervalHours, manualReplicate, updatedBy],
    );

    const [rows] = await pool.query(
      'SELECT auto_sync_interval_hours, manual_replicate_enabled, updated_by, updated_at FROM tenant_sync_config WHERE tenant_id = ?',
      [req.params.tenantId],
    );

    console.log(`[syncConfig PUT] tenant=${req.params.tenantId} interval=${intervalHours}h manual=${manualReplicate} by=${updatedBy}`);

    return res.json(rows[0]);
  } catch (err) {
    console.error('[syncConfig PUT]', err);
    return res.status(500).json({ error: 'Database error' });
  }
});

export default router;
