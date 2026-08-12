import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import pool from './db.js';

dotenv.config();

/**
 * Additive demo-data seed for the Monitoring page's Company/Vessel
 * Connectivity Log. Assumes seed.js has already been run (needs the
 * demo tenants + vessels to exist). Safe to re-run — it only touches
 * the vessels/sms_documents rows it creates.
 *
 * Gives a spread of connectivity states (online / offline / never
 * synced) and a handful of sms_documents with varied author_origin
 * (Shoreside HQ vs specific vessels) so the "last modified file"
 * popup has something real to show.
 */

const ROLE_BY_VESSEL_NAME = {
  'MV Blue Horizon': { name: 'James Whitfield', role: 'Master' },
  'MV Northern Star': { name: 'Ivan Petrov', role: 'Second Engineer' },
  'MV Ocean Pioneer': { name: 'Maria Santos', role: 'Chief Mate' },
  'MV Pacific Pearl': { name: 'Raj Kapoor', role: 'Chief Engineer' },
  'MV ONE REPUTATION': { name: 'Ahmed Hassan', role: 'Bosun' },
  'MV Atlas Pride': { name: 'Pierre Dubois', role: 'Master' },
  'MV Stella Voyager': { name: 'Dimitri Volkov', role: 'Chief Mate' },
  'MV Crest Breeze': { name: 'Kwame Asante', role: 'Bosun' },
  'MV Nordic Breeze': { name: 'Lars Anderson', role: 'Master' },
  'MV Polar Explorer': { name: 'Anna Lindqvist', role: 'Chief Mate' },
  'MV Crescent Trader': { name: 'Ali Hassan', role: 'Master' },
  'MV Gulf Pioneer': { name: 'Hassan Bilal', role: 'Chief Mate' },
};

const SHORESIDE_DOCS = [
  'Fleet Safety Management Manual',
  'ISM Emergency Preparedness Procedure',
  'Fleet Circular — Q3 Navigation Policy Update',
];

const VESSEL_DOCS = [
  'Mooring Operations Checklist',
  'Engine Room Watchkeeping Log Template',
  'Bridge Resource Management Notes',
];

async function main() {
  const [tenants] = await pool.query('SELECT id, company FROM tenants');
  const [vessels] = await pool.query('SELECT id, tenant_id, name FROM vessels');

  if (tenants.length === 0 || vessels.length === 0) {
    console.error('[SeedConnDemo] No tenants/vessels found — run `npm run seed` first.');
    process.exit(1);
  }

  console.log(`[SeedConnDemo] Found ${tenants.length} tenants, ${vessels.length} vessels.`);

  // ── 1. Spread out vessel connectivity: some online, some offline, some never synced ──
  for (let i = 0; i < vessels.length; i++) {
    const v = vessels[i];
    const bucket = i % 5;
    let lastSyncSql;
    if (bucket === 0 || bucket === 1) {
      // Online — synced within the last few hours
      lastSyncSql = `NOW() - INTERVAL ${1 + i} HOUR`;
    } else if (bucket === 2 || bucket === 3) {
      // Offline — stale, synced a few days ago
      lastSyncSql = `NOW() - INTERVAL ${2 + i} DAY`;
    } else {
      // Never synced
      lastSyncSql = null;
    }
    if (lastSyncSql) {
      await pool.query(`UPDATE vessels SET last_sync_at = ${lastSyncSql} WHERE id = ?`, [v.id]);
    } else {
      await pool.query('UPDATE vessels SET last_sync_at = NULL WHERE id = ?', [v.id]);
    }
  }
  console.log('[SeedConnDemo] Updated vessel connectivity spread.');

  // ── 2. SMS document evidence — Shoreside HQ + per-vessel authored files ──
  for (const t of tenants) {
    await pool.query('DELETE FROM sms_documents WHERE tenant_id = ? AND label LIKE ?', [t.id, '[ConnDemo]%']);

    const rootId = uuidv4();
    await pool.query(
      'INSERT INTO sms_documents (id, tenant_id, parent_id, tree_kind, label, node_kind, sort_order, author_name, author_role, author_origin) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [rootId, t.id, null, 'sms', '[ConnDemo] SMS Documents', 'folder', 0, null, null, null],
    );

    let sort = 1;
    for (let i = 0; i < SHORESIDE_DOCS.length; i++) {
      const docId = uuidv4();
      const hoursAgo = 3 + i * 20;
      const sizeBytes = 180_000 + i * 240_000; // ~180KB-660KB, plausible for a PDF/rich-text SMS doc
      await pool.query(
        `INSERT INTO sms_documents (id, tenant_id, parent_id, tree_kind, label, node_kind, content_kind, content, file_size_bytes, version, sort_order, author_name, author_role, author_origin, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, NOW() - INTERVAL ${hoursAgo} HOUR)`,
        [docId, t.id, rootId, 'sms', `[ConnDemo] ${SHORESIDE_DOCS[i]}`, 'document', 'rich_text', '## Demo content\n\nSeeded for connectivity log preview.', sizeBytes, '1.' + i + '.0', sort++, 'Company DPA', 'DPA', 'Shoreside HQ'],
      );
    }

    const tenantVessels = vessels.filter((v) => v.tenant_id === t.id);
    for (let i = 0; i < tenantVessels.length; i++) {
      const v = tenantVessels[i];
      const author = ROLE_BY_VESSEL_NAME[v.name] || { name: 'Vessel Officer', role: 'Master' };
      const docLabel = VESSEL_DOCS[i % VESSEL_DOCS.length];
      const docId = uuidv4();
      const hoursAgo = 2 + i * 15;
      const sizeBytes = 45_000 + i * 95_000; // ~45KB-235KB, a vessel-authored checklist/log
      await pool.query(
        `INSERT INTO sms_documents (id, tenant_id, parent_id, tree_kind, label, node_kind, content_kind, content, file_size_bytes, version, sort_order, author_name, author_role, author_origin, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, NOW() - INTERVAL ${hoursAgo} HOUR)`,
        [docId, t.id, rootId, 'sms', `[ConnDemo] ${docLabel}`, 'document', 'rich_text', '## Demo content\n\nSeeded for connectivity log preview.', sizeBytes, '1.0.0', sort++, author.name, author.role, v.name],
      );
    }
    console.log(`[SeedConnDemo] Seeded documents for ${t.company}.`);
  }

  // ── 3. vessel_sync_state — a spread of processed / syncing / failed ──
  // so the Status column on Platform Monitoring shows all three states.
  for (let i = 0; i < vessels.length; i++) {
    const v = vessels[i];
    await pool.query('DELETE FROM vessel_sync_state WHERE vessel_id = ?', [v.id]);

    const bucket = i % 4;
    const pendingOutbox = bucket === 1 ? 1 + (i % 3) : 0; // syncing
    const failedOutbox = bucket === 0 ? 1 + (i % 2) : 0; // failed
    const connectionMode = i % 2 === 0 ? 'VESSEL_SERVER_LAN' : 'CLOUD_DIRECT';
    const serverReachable = pendingOutbox === 0 && failedOutbox === 0;

    // MonitoringView's live-online badge only lights up while the last
    // heartbeat is both `server_reachable` AND within its short live
    // window (see LIVE_CONNECTIVITY_WINDOW_MINUTES) — not merely synced
    // at some point in the past. Bucket 2 gets a heartbeat from just a
    // few minutes ago so it demonstrates genuinely "online" right now;
    // bucket 3 last succeeded hours ago and has since gone quiet, so it
    // correctly reads as "offline" despite `server_reachable` still
    // being TRUE (the flag only ever updates on the next check-in).
    const heartbeatIntervalSql =
      bucket === 2
        ? `NOW() - INTERVAL ${2 + (i % 8)} MINUTE`
        : `NOW() - INTERVAL ${1 + i} HOUR`;

    // Alternate manual ("Replicate to Shore Now") vs automatic (the
    // scheduled sync timer) so the evidence popup's badge shows both.
    const syncMethod = i % 2 === 0 ? 'manual' : 'automatic';

    await pool.query(
      `INSERT INTO vessel_sync_state
         (id, tenant_id, vessel_id, connection_mode, server_reachable, last_heartbeat_at, last_sync_at, last_sync_method, pending_outbox_count, failed_outbox_count, active_module_keys, total_payloads_synced, total_bytes_synced)
       VALUES (?,?,?,?,?, ${heartbeatIntervalSql}, (SELECT last_sync_at FROM vessels WHERE id = ?), ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), v.tenant_id, v.id, connectionMode, serverReachable, v.id, syncMethod, pendingOutbox, failedOutbox, '["sms_documentation"]', 40 + i * 6, 2_400_000 + i * 310_000],
    );
  }
  console.log('[SeedConnDemo] Seeded vessel_sync_state spread (processed/syncing/failed).');

  console.log('[SeedConnDemo] Done.');
  await pool.end();
}

main().catch((err) => { console.error('[SeedConnDemo] Error:', err); process.exit(1); });
