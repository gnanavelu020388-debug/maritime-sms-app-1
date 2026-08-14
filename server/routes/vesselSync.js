import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin, requireTenantAccess } from '../middleware/auth.js';

const router = Router();

// A vessel only counts as "live online" while it reported reachable AND
// its heartbeat falls inside this window. Computed with MySQL's own NOW()
// against MySQL's own stored timestamps, entirely server-side — never
// compared against the browser's Date.now(), so it can't be thrown off by
// clock drift between the app server/browser and the DB host.
const LIVE_CONNECTIVITY_WINDOW_MINUTES = 10;
const IS_ONLINE_SQL = `(s.server_reachable = TRUE AND s.last_heartbeat_at IS NOT NULL AND s.last_heartbeat_at >= (NOW() - INTERVAL ? MINUTE))`;

// Super Admin: every vessel across every tenant, left-joined with its
// vessel_sync_state row (may not exist yet if the vessel has never gone
// through the unified sync engine — those come back with null status
// fields rather than a fabricated default).
router.get('/', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        v.id AS vessel_id,
        v.tenant_id,
        s.connection_mode,
        s.server_reachable,
        s.last_heartbeat_at,
        s.last_sync_at AS state_last_sync_at,
        s.last_sync_method,
        s.pending_outbox_count,
        s.failed_outbox_count,
        s.total_payloads_synced,
        s.total_bytes_synced,
        s.updated_at AS state_updated_at,
        ${IS_ONLINE_SQL} AS is_online
      FROM vessels v
      LEFT JOIN vessel_sync_state s ON s.vessel_id = v.id`,
      [LIVE_CONNECTIVITY_WINDOW_MINUTES],
    );
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

const MAX_PAGE_SIZE = 100;

// Super Admin: the paginated connectivity log — vessels joined with their
// tenant and sync state, paged with LIMIT/OFFSET (and counted) at the
// database rather than fetched in full and sliced in the browser.
router.get('/log', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const search = (req.query.search || '').toString().trim();
    const tenantId = (req.query.tenantId || '').toString().trim();
    const offset = (page - 1) * pageSize;

    // Search matches on the vessel's own name OR its company's name (so
    // searching a company surfaces every ship under it); the company
    // dropdown filter narrows to one tenant. Both can apply together.
    const conditions = [];
    const whereParams = [];
    if (search) {
      conditions.push('(v.name LIKE ? OR t.company LIKE ?)');
      whereParams.push(`%${search}%`, `%${search}%`);
    }
    if (tenantId) {
      conditions.push('t.id = ?');
      whereParams.push(tenantId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total FROM vessels v JOIN tenants t ON t.id = v.tenant_id ${where}`,
      whereParams,
    );
    const total = countRows[0].total;

    const [rows] = await pool.query(
      `SELECT
         v.id AS vessel_id,
         v.tenant_id,
         v.name AS vessel_name,
         t.company,
         v.sms_active_version,
         v.satellite_provider,
         v.last_sync_at AS vessel_last_sync_at,
         s.last_sync_at AS state_last_sync_at,
         s.last_sync_method,
         s.server_reachable,
         s.last_heartbeat_at,
         s.pending_outbox_count,
         s.failed_outbox_count,
         ${IS_ONLINE_SQL} AS is_online
       FROM vessels v
       JOIN tenants t ON t.id = v.tenant_id
       LEFT JOIN vessel_sync_state s ON s.vessel_id = v.id
       ${where}
       ORDER BY v.name ASC
       LIMIT ? OFFSET ?`,
      [LIVE_CONNECTIVITY_WINDOW_MINUTES, ...whereParams, pageSize, offset],
    );

    return res.json({ rows, total, page, pageSize });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Any tenant user (vessel/company_admin/dpa) or super admin: enqueue a real
// bottom-up outbox entry — e.g. a vessel crew member creating or editing an
// SMS document. Upserts vessel_sync_state so pending_outbox_count reflects
// reality even for a vessel that's never gone through the sync engine before.
router.post('/outbox', authMiddleware, requireTenantAccess, async (req, res) => {
  try {
    const { tenant_id, vessel_id, module_key, entity_type, entity_id, payload, operation, priority } = req.body;
    if (!tenant_id || !vessel_id || !module_key || !entity_type || !entity_id) {
      return res.status(400).json({ error: 'tenant_id, vessel_id, module_key, entity_type and entity_id are required' });
    }

    // A real write collision: this same entity already has an unsynced
    // pending write queued from the same vessel (e.g. two workstations on
    // the vessel LAN edited the same document before either reached
    // shore). Recorded for the Monitoring "dedup events" view — resolution
    // is always "latest_wins" because check-in below applies outbox
    // entries in insertion order, so the newer row is what ships.
    const [priorPending] = await pool.query(
      "SELECT id FROM vessel_sync_outbox WHERE tenant_id = ? AND vessel_id = ? AND entity_type = ? AND entity_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      [tenant_id, vessel_id, entity_type, entity_id],
    );

    const newOutboxId = uuidv4();
    await pool.query(
      'INSERT INTO vessel_sync_outbox (id, tenant_id, vessel_id, module_key, operation, entity_type, entity_id, payload, priority, status) VALUES (?,?,?,?,?,?,?,?,?,\'pending\')',
      [newOutboxId, tenant_id, vessel_id, module_key, operation || 'upsert', entity_type, entity_id, JSON.stringify(payload || {}), priority || 0],
    );

    if (priorPending.length > 0) {
      await pool.query(
        'INSERT INTO sync_collision_events (id, tenant_id, vessel_id, module_key, entity_type, entity_id, prior_outbox_id, new_outbox_id) VALUES (?,?,?,?,?,?,?,?)',
        [uuidv4(), tenant_id, vessel_id, module_key, entity_type, entity_id, priorPending[0].id, newOutboxId],
      );
    }

    await pool.query(
      `INSERT INTO vessel_sync_state
         (id, tenant_id, vessel_id, connection_mode, server_reachable, pending_outbox_count, failed_outbox_count, active_module_keys, total_payloads_synced, total_bytes_synced)
       VALUES (?, ?, ?, 'VESSEL_SERVER_LAN', TRUE, 1, 0, ?, 0, 0)
       ON DUPLICATE KEY UPDATE pending_outbox_count = pending_outbox_count + 1, updated_at = NOW()`,
      [uuidv4(), tenant_id, vessel_id, JSON.stringify([module_key])],
    );

    return res.status(201).json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Drains a vessel's pending outbox — this is the real "sync check-in".
// Called from the vessel-side "Replicate to Shore Now" button (sync_method
// 'manual') and the background auto-sync loop (sync_method 'automatic') —
// both already exist; see src/lib/syncService.ts. This never re-attributes
// document authorship: `sync_method` only records how this particular
// check-in was triggered, not who wrote anything.
// Only a genuine query error here ever produces a real "Failed" status —
// there's no artificial/random failure injection.
router.post('/:vesselId/checkin', authMiddleware, requireTenantAccess, async (req, res) => {
  const { vesselId } = req.params;
  const { tenant_id, sync_method } = req.body;
  if (!tenant_id) return res.status(400).json({ error: 'tenant_id is required' });
  const syncMethod = sync_method === 'automatic' ? 'automatic' : 'manual';

  try {
    const [result] = await pool.query(
      "UPDATE vessel_sync_outbox SET status='synced', synced_at=NOW() WHERE vessel_id=? AND tenant_id=? AND status='pending'",
      [vesselId, tenant_id],
    );
    const synced = result.affectedRows;

    await pool.query(
      `INSERT INTO vessel_sync_state
         (id, tenant_id, vessel_id, connection_mode, server_reachable, last_heartbeat_at, last_sync_at, last_sync_method, pending_outbox_count, failed_outbox_count, active_module_keys, total_payloads_synced, total_bytes_synced)
       VALUES (?, ?, ?, 'VESSEL_SERVER_LAN', TRUE, NOW(), NOW(), ?, 0, 0, '[]', ?, 0) AS new_state
       ON DUPLICATE KEY UPDATE
         pending_outbox_count = 0,
         last_sync_at = NOW(),
         last_sync_method = new_state.last_sync_method,
         last_heartbeat_at = NOW(),
         server_reachable = TRUE,
         total_payloads_synced = vessel_sync_state.total_payloads_synced + new_state.total_payloads_synced,
         updated_at = NOW()`,
      [uuidv4(), tenant_id, vesselId, syncMethod, synced],
    );
    await pool.query('UPDATE vessels SET last_sync_at = NOW() WHERE id = ? AND tenant_id = ?', [vesselId, tenant_id]);

    return res.json({ synced, failed: 0 });
  } catch (err) {
    console.error(err);
    // A real failure: whatever's still pending genuinely didn't make it —
    // mark it failed rather than leaving it silently stuck as "pending".
    try {
      const [failedResult] = await pool.query(
        "UPDATE vessel_sync_outbox SET status='failed', attempts=attempts+1, last_error=? WHERE vessel_id=? AND tenant_id=? AND status='pending'",
        [err.message || 'Check-in failed', vesselId, tenant_id],
      );
      await pool.query(
        `UPDATE vessel_sync_state SET failed_outbox_count = failed_outbox_count + ?, server_reachable = FALSE, last_heartbeat_at = NOW(), updated_at = NOW() WHERE vessel_id = ? AND tenant_id = ?`,
        [failedResult.affectedRows, vesselId, tenant_id],
      );
    } catch (innerErr) { console.error('[vesselSync] failed to record check-in failure:', innerErr); }
    return res.status(500).json({ error: 'Check-in failed' });
  }
});

// Super Admin: recent real write collisions across the fleet — backs the
// Monitoring "Offline Data Collision Logic Guard" card (previously a
// hardcoded illustrative list).
router.get('/collisions', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const [rows] = await pool.query(
      `SELECT c.id, c.tenant_id, c.vessel_id, c.module_key, c.entity_type, c.entity_id, c.resolution, c.detected_at,
              v.name AS vessel_name, t.company
       FROM sync_collision_events c
       JOIN vessels v ON v.id = c.vessel_id
       JOIN tenants t ON t.id = c.tenant_id
       ORDER BY c.detected_at DESC
       LIMIT ?`,
      [limit],
    );
    return res.json(rows);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Single-vessel sync state — powers getVesselSyncState() in syncService.ts.
router.get('/:vesselId', authMiddleware, requireTenantAccess, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM vessel_sync_state WHERE vessel_id = ?', [req.params.vesselId]);
    return res.json(rows[0] || null);
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
