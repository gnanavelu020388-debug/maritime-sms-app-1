import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import pool from './db.js';

dotenv.config();

/**
 * Live-sync test harness — NOT part of the app. Writes directly to the
 * database (bypassing the API entirely) on a loop, so you can prove the
 * Platform Monitoring page is reading live from the DB (not replaying
 * local/cached state) by clicking its Refresh button and watching the
 * numbers change to match whatever this script just wrote.
 *
 * Usage:
 *   node simulateLiveSync.js            (one change every 8s, forever)
 *   node simulateLiveSync.js --once     (a single change, then exit)
 *
 * Open Platform Monitoring in the browser, start this script, then click
 * Refresh — the Status column / top four stat cards will reflect
 * whatever this script last wrote. There is no background polling, so
 * the page will not update on its own without that click.
 */

const INTERVAL_MS = 8000;
const once = process.argv.includes('--once');

async function tick() {
  const [vessels] = await pool.query('SELECT id, tenant_id, name FROM vessels');
  if (vessels.length === 0) {
    console.log('[LiveSim] No vessels found — run `node seed.js` first.');
    return;
  }

  const v = vessels[Math.floor(Math.random() * vessels.length)];
  const roll = Math.random();
  let pending = 0;
  let failed = 0;
  let label;
  if (roll < 0.34) { pending = 1 + Math.floor(Math.random() * 4); label = 'syncing'; }
  else if (roll < 0.6) { failed = 1 + Math.floor(Math.random() * 3); label = 'failed'; }
  else { label = 'processed'; }

  // This harness simulates the unattended background timer, not someone
  // clicking "Replicate to Shore Now" — so every write it makes is 'automatic'.
  const syncMethod = 'automatic';

  // Upsert — works whether or not this vessel already has a sync_state row.
  await pool.query(
    `INSERT INTO vessel_sync_state
       (id, tenant_id, vessel_id, connection_mode, server_reachable, last_heartbeat_at, last_sync_at, last_sync_method, pending_outbox_count, failed_outbox_count, active_module_keys, total_payloads_synced, total_bytes_synced)
     VALUES (?, ?, ?, 'VESSEL_SERVER_LAN', TRUE, NOW(), NOW(), ?, ?, ?, '["sms_documentation"]', 0, 0)
     ON DUPLICATE KEY UPDATE
       pending_outbox_count = VALUES(pending_outbox_count),
       failed_outbox_count = VALUES(failed_outbox_count),
       last_sync_at = NOW(),
       last_sync_method = VALUES(last_sync_method),
       last_heartbeat_at = NOW(),
       updated_at = NOW()`,
    [uuidv4(), v.tenant_id, v.id, syncMethod, pending, failed],
  );
  await pool.query('UPDATE vessels SET last_sync_at = NOW() WHERE id = ?', [v.id]);

  console.log(`[LiveSim] ${new Date().toLocaleTimeString()} — ${v.name} -> ${label} (pending=${pending}, failed=${failed})`);
}

console.log(`[LiveSim] Writing directly to the DB every ${INTERVAL_MS / 1000}s — this never touches the app's API or cache.`);
console.log('[LiveSim] Open Platform Monitoring and click Refresh to see each change — there is no background polling. Ctrl+C to stop.');

if (once) {
  tick().then(() => pool.end());
} else {
  tick();
  setInterval(tick, INTERVAL_MS);
}
