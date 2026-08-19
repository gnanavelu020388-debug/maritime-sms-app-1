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
    // Also append to history so GET /metrics/history can answer range
    // queries — piggybacked on this poll rather than a separate scheduled
    // job, since this route already runs whenever a super-admin has the
    // dashboard open.
    const [[storageCache]] = await pool.query('SELECT bytes_used FROM platform_storage_cache WHERE id = 1');
    await pool.query(
      'INSERT INTO platform_metrics_history (cpu_percent, api_p95_ms, storage_bytes_used) VALUES (?, ?, ?)',
      [cpuPercent, apiP95Ms, Number(storageCache?.bytes_used || 0)],
    );
    return res.json({ cpuPercent, apiP95Ms, computedAt: new Date().toISOString() });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

const RANGE_HOURS = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

router.get('/metrics/history', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const range = RANGE_HOURS[req.query.range] ? req.query.range : '24h';
    const [rows] = await pool.query(
      `SELECT cpu_percent AS cpuPercent, api_p95_ms AS apiP95Ms, storage_bytes_used AS storageBytesUsed, captured_at AS capturedAt
       FROM platform_metrics_history
       WHERE captured_at >= (NOW() - INTERVAL ? HOUR)
       ORDER BY captured_at ASC`,
      [RANGE_HOURS[range]],
    );
    const samples = rows.length;
    const avgCpu = samples ? Math.round((rows.reduce((s, r) => s + Number(r.cpuPercent), 0) / samples) * 10) / 10 : 0;
    const maxCpu = samples ? Math.max(...rows.map((r) => Number(r.cpuPercent))) : 0;
    const avgP95 = samples ? Math.round(rows.reduce((s, r) => s + Number(r.apiP95Ms), 0) / samples) : 0;
    const maxP95 = samples ? Math.max(...rows.map((r) => Number(r.apiP95Ms))) : 0;
    const startBytes = samples ? Number(rows[0].storageBytesUsed) : null;
    const endBytes = samples ? Number(rows[samples - 1].storageBytesUsed) : null;
    return res.json({
      range,
      samples,
      since: samples ? rows[0].capturedAt : null,
      cpu: { avg: avgCpu, max: maxCpu },
      apiP95Ms: { avg: avgP95, max: maxP95 },
      storage: { startBytes, endBytes, deltaBytes: samples ? endBytes - startBytes : null },
    });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Global MFA Enforcement (Super Admin → Users): persists the platform-wide
// default AND bulk-applies it to every tenant's mfa_enforced column for
// real — that column is what auth.js's login route actually checks, so
// toggling this has an immediate, real effect on whether tenant users are
// prompted for a code at login.
router.get('/mfa-enforcement', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const [[row]] = await pool.query("SELECT setting_value FROM platform_settings WHERE setting_key = 'global_mfa_enforced'");
    return res.json({ enforced: row ? row.setting_value === '1' : true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/mfa-enforcement', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { enforced } = req.body;
    await pool.query(
      "INSERT INTO platform_settings (setting_key, setting_value) VALUES ('global_mfa_enforced', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
      [enforced ? '1' : '0'],
    );
    const [result] = await pool.query('UPDATE tenants SET mfa_enforced = ?', [!!enforced]);
    return res.json({ enforced: !!enforced, tenantsUpdated: result.affectedRows });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// SaaS Tier Constructor (Billing view) — real persistence for the pricing/
// limit config that used to be a client-only reducer with no backend at
// all. Changing a tier's pricing/limits here does NOT retroactively change
// any tenant already on that plan — it only changes what new plan
// assignments apply going forward. Renaming a tier (new_name below) is a
// different kind of edit: the name is the key every tenant's `plan` column
// points at, so a rename cascades to every tenant currently on it in the
// same transaction, keeping the two tables consistent.
router.get('/tiers', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM saas_tier_configs ORDER BY monthly ASC');
    return res.json(rows.map((r) => ({ ...r, monthly: Number(r.monthly), annual: Number(r.annual) })));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/tiers/:name', authMiddleware, requireSuperAdmin, async (req, res) => {
  const { monthly, annual, vessels, storage_gb, seats, new_name } = req.body;
  const trimmedNewName = typeof new_name === 'string' ? new_name.trim() : undefined;
  const renaming = trimmedNewName && trimmedNewName !== req.params.name;

  if (!renaming) {
    try {
      await pool.query(
        `INSERT INTO saas_tier_configs (name, monthly, annual, vessels, storage_gb, seats, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE monthly = VALUES(monthly), annual = VALUES(annual), vessels = VALUES(vessels), storage_gb = VALUES(storage_gb), seats = VALUES(seats), updated_by = VALUES(updated_by)`,
        [req.params.name, monthly || 0, annual || 0, vessels || 0, storage_gb || 0, seats || 0, req.user.email || null],
      );
      const [rows] = await pool.query('SELECT * FROM saas_tier_configs WHERE name = ?', [req.params.name]);
      return res.json({ ...rows[0], monthly: Number(rows[0].monthly), annual: Number(rows[0].annual) });
    } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
  }

  if (!trimmedNewName) return res.status(400).json({ error: 'Tier name cannot be empty.' });
  const conn = await pool.getConnection();
  try {
    const [[clash]] = await conn.query('SELECT name FROM saas_tier_configs WHERE name = ?', [trimmedNewName]);
    if (clash) return res.status(409).json({ error: `A tier named "${trimmedNewName}" already exists.` });

    await conn.beginTransaction();
    await conn.query(
      `UPDATE saas_tier_configs SET name = ?, monthly = ?, annual = ?, vessels = ?, storage_gb = ?, seats = ?, updated_by = ? WHERE name = ?`,
      [trimmedNewName, monthly || 0, annual || 0, vessels || 0, storage_gb || 0, seats || 0, req.user.email || null, req.params.name],
    );
    await conn.query('UPDATE tenants SET plan = ? WHERE plan = ?', [trimmedNewName, req.params.name]);
    await conn.commit();

    const [rows] = await conn.query('SELECT * FROM saas_tier_configs WHERE name = ?', [trimmedNewName]);
    return res.json({ ...rows[0], monthly: Number(rows[0].monthly), annual: Number(rows[0].annual) });
  } catch (err) {
    await conn.rollback();
    console.error('[platformSettings] tier rename failed:', err);
    return res.status(500).json({ error: 'Tier rename failed — no changes were applied.' });
  } finally {
    conn.release();
  }
});

export default router;
