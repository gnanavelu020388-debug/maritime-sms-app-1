import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';
import { SNAPSHOT_TABLES, captureSnapshotData, enforceSnapshotLimit } from '../lib/backupSnapshot.js';

const router = Router();

// snapshot_data can be large — excluded from the list/join query below and
// only pulled out explicitly by the restore route that actually needs it.
const SELECT_JOINED = 'SELECT b.id, b.tenant_id, b.taken_at, b.size_gb, b.type, b.status, b.expiry, b.reason, b.created_by, b.created_at, t.company FROM backup_snapshots b JOIN tenants t ON t.id = b.tenant_id';

function parseBackup(row) {
  if (!row) return null;
  return { ...row, size_gb: Number(row.size_gb) };
}

// sms_documents self-references via parent_id (folder trees). Snapshot rows
// come back in arbitrary PK order (UUIDs), so a naive insert can hit a child
// row before its parent and fail the parent_id FK — reorder parents first.
function topoSortDocuments(rows) {
  const byId = new Set(rows.map((r) => r.id));
  const childrenOf = new Map();
  const roots = [];
  for (const row of rows) {
    if (row.parent_id && byId.has(row.parent_id)) {
      if (!childrenOf.has(row.parent_id)) childrenOf.set(row.parent_id, []);
      childrenOf.get(row.parent_id).push(row);
    } else {
      roots.push(row);
    }
  }
  const ordered = [];
  const queue = [...roots];
  while (queue.length) {
    const node = queue.shift();
    ordered.push(node);
    const kids = childrenOf.get(node.id);
    if (kids) queue.push(...kids);
  }
  return ordered;
}

router.get('/', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(`${SELECT_JOINED} ORDER BY b.taken_at DESC LIMIT 1000`);
    return res.json(rows.map(parseBackup));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { tenant_id, type, status, expiry, reason } = req.body;
    const id = uuidv4();
    // mysql2 auto-formats JS Date objects for TIMESTAMP columns, but rejects
    // a raw ISO string ("...T...Z") from the client — always wrap in Date().
    const expiryDate = expiry ? new Date(expiry) : new Date(Date.now() + 30 * 86400000);
    const snapshotData = await captureSnapshotData(tenant_id);
    // A real (if rough) size measure — the JSON byte length of what was
    // actually captured — rather than a fabricated heuristic.
    const sizeGb = Buffer.byteLength(JSON.stringify(snapshotData), 'utf8') / (1024 ** 3);
    await pool.query(
      'INSERT INTO backup_snapshots (id, tenant_id, size_gb, type, status, expiry, reason, created_by, snapshot_data) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, tenant_id, sizeGb, type || 'manual', status || 'completed', expiryDate, reason || null, req.user.email || null, JSON.stringify(snapshotData)],
    );
    await enforceSnapshotLimit(tenant_id);
    const [rows] = await pool.query(`${SELECT_JOINED} WHERE b.id = ?`, [id]);
    return res.status(201).json(parseBackup(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// A real logical restore: replaces the tenant's current rows in every
// snapshotted table with exactly what was captured at backup time, inside
// one transaction (all-or-nothing). Runs in reverse table order on the
// delete pass (children before parents) and forward order on the insert
// pass (parents before children) to respect foreign keys.
router.post('/:id/restore', authMiddleware, requireSuperAdmin, async (req, res) => {
  const [rows] = await pool.query(`${SELECT_JOINED} WHERE b.id = ?`, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Snapshot not found' });
  const snapshot = rows[0];
  const [[dataRow]] = await pool.query('SELECT snapshot_data FROM backup_snapshots WHERE id = ?', [req.params.id]);
  const snapshotData = typeof dataRow?.snapshot_data === 'string' ? JSON.parse(dataRow.snapshot_data) : dataRow?.snapshot_data;
  if (!snapshotData) return res.status(400).json({ error: 'This snapshot predates restore support and has no captured data.' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const table of [...SNAPSHOT_TABLES].reverse()) {
      await conn.query(`DELETE FROM \`${table}\` WHERE tenant_id = ?`, [snapshot.tenant_id]);
    }
    const restoredCounts = {};
    for (const table of SNAPSHOT_TABLES) {
      const rawRows = snapshotData[table] || [];
      const tableRows = table === 'sms_documents' ? topoSortDocuments(rawRows) : rawRows;
      restoredCounts[table] = tableRows.length;
      for (const row of tableRows) {
        const columns = Object.keys(row);
        const placeholders = columns.map(() => '?').join(',');
        // JSON round-trip turns TIMESTAMP columns into "...T...Z" strings
        // and JSON columns into plain objects/arrays — mysql2 needs a real
        // Date() for the former and a re-stringified value for the latter.
        const values = columns.map((c) => {
          const v = row[c];
          if (v !== null && typeof v === 'object') return JSON.stringify(v);
          if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) return new Date(v);
          return v;
        });
        await conn.query(
          `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(',')}) VALUES (${placeholders})`,
          values,
        );
      }
    }
    await conn.commit();
    return res.json({ ...parseBackup(snapshot), restoredCounts });
  } catch (err) {
    await conn.rollback();
    console.error('[backups] restore failed:', err);
    return res.status(500).json({ error: 'Restore failed — no changes were applied.' });
  } finally {
    conn.release();
  }
});

router.delete('/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM backup_snapshots WHERE id = ?', [req.params.id]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
