import { Router } from 'express';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';
import { getCpuPercent, getApiP95Ms } from '../metrics.js';

const router = Router();
const BYTES_PER_GB = 1024 ** 3;

async function getPoolGb() {
  const [[row]] = await pool.query(
    "SELECT setting_value FROM platform_settings WHERE setting_key = 'platform_storage_pool_gb'",
  );
  return Number(row?.setting_value || 500);
}

router.get('/storage', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const [[cache]] = await pool.query('SELECT bytes_used, computed_at FROM platform_storage_cache WHERE id = 1');
    const poolGb = await getPoolGb();
    const actualUsageBytes = Number(cache?.bytes_used || 0);
    const poolBytes = poolGb * BYTES_PER_GB;
    const remainingBytes = Math.max(0, poolBytes - actualUsageBytes);
    const percentage = poolBytes > 0 ? Math.round((actualUsageBytes / poolBytes) * 1000) / 10 : 0;
    return res.json({
      actualUsageBytes,
      poolBytes,
      remainingBytes,
      percentage,
      computedAt: cache?.computed_at || null,
    });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/storage', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { platform_storage_pool_gb } = req.body;
    if (!platform_storage_pool_gb || Number(platform_storage_pool_gb) <= 0) {
      return res.status(400).json({ error: 'platform_storage_pool_gb must be a positive number' });
    }
    await pool.query(
      "INSERT INTO platform_settings (setting_key, setting_value) VALUES ('platform_storage_pool_gb', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
      [String(platform_storage_pool_gb)],
    );
    return res.json({ platform_storage_pool_gb: Number(platform_storage_pool_gb) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.get('/health', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const cpuPercent = getCpuPercent();
    const apiP95Ms = getApiP95Ms();
    await pool.query(
      'INSERT INTO platform_metrics_cache (id, cpu_percent, api_p95_ms) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE cpu_percent = VALUES(cpu_percent), api_p95_ms = VALUES(api_p95_ms)',
      [cpuPercent, apiP95Ms],
    );
    return res.json({ cpuPercent, apiP95Ms, computedAt: new Date().toISOString() });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
