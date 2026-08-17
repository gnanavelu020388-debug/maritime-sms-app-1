import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

// Readable, unambiguous (no 0/O/1/I) — matches what a Master would read
// aloud or hand-write for a crew member at sea.
function generateEmergencyOtp() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let otp = '';
  for (let i = 0; i < 8; i++) otp += chars[bytes[i] % chars.length];
  return otp;
}

const router = Router();

function parseUser(row) {
  if (!row) return null;
  return {
    ...row,
    assigned_vessel_ids: typeof row.assigned_vessel_ids === 'string' ? JSON.parse(row.assigned_vessel_ids) : (row.assigned_vessel_ids || []),
    assigned_fleet_profile_ids: typeof row.assigned_fleet_profile_ids === 'string' ? JSON.parse(row.assigned_fleet_profile_ids) : (row.assigned_fleet_profile_ids || []),
    auth_uid: row.auth_uid || null,
  };
}

// Super Admin cross-tenant lookup — "which company/user does this email
// belong to" without already knowing the tenantId. Must be registered
// before GET /:tenantId below or Express would match "search" as a
// tenantId value instead of reaching this route.
router.get('/search', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const like = `%${q}%`;
    const [rows] = await pool.query(
      `SELECT tu.id, tu.tenant_id, tu.name, tu.email, tu.\`rank\`, tu.\`role\`, tu.mfa_enabled, t.company
       FROM tenant_users tu
       JOIN tenants t ON t.id = tu.tenant_id
       WHERE tu.email LIKE ? OR tu.name LIKE ?
       ORDER BY tu.name
       LIMIT 10`,
      [like, like],
    );
    return res.json(rows.map((r) => ({ ...r, mfa_enabled: !!r.mfa_enabled })));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== req.params.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [rows] = await pool.query('SELECT * FROM tenant_users WHERE tenant_id = ? ORDER BY created_at', [req.params.tenantId]);
    return res.json(rows.map(parseUser));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/:tenantId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== tid) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const { name, email, password, rank, role, nationality, employee_id, passport_number, seaman_book_number, status, fleet_scope, assigned_vessel_ids, assigned_fleet_profile_ids } = req.body;
    const id = uuidv4();
    const defaultPass = '$2a$10$/RceoxCFoo88Mt8kCf4akuGNGM/9VyiIygSpRuz17ZALoU26qqBRS'; // bcrypt hash of 'demo'

    // If this email already self-registered (app_users), it'll be superseded by
    // the tenant_users row below — otherwise granting tenant access here would
    // leave a disconnected duplicate account with a different password.
    const [existingAppUsers] = await pool.query('SELECT * FROM app_users WHERE email = ?', [email]);

    // must_change_password is true whenever an admin (not the user themselves)
    // chose the password — either explicitly here, or via the disconnected
    // default. It's only false when we carried over a password the user
    // already chose themselves at self-signup (app_users).
    let passwordHash;
    let mustChangePassword;
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      passwordHash = await bcrypt.hash(password, 10);
      mustChangePassword = true;
    } else if (existingAppUsers.length > 0) {
      passwordHash = existingAppUsers[0].password_hash;
      mustChangePassword = false;
    } else {
      passwordHash = defaultPass;
      mustChangePassword = true;
    }

    await pool.query(
      'INSERT INTO tenant_users (id, tenant_id, name, email, password_hash, `rank`, `role`, nationality, employee_id, passport_number, seaman_book_number, status, must_change_password, fleet_scope, assigned_vessel_ids, assigned_fleet_profile_ids) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, tid, name, email, passwordHash, rank || 'Crew', role || 'vessel', nationality || null, employee_id || null, passport_number || null, seaman_book_number || null, status || 'invited', mustChangePassword, fleet_scope || 'global', JSON.stringify(assigned_vessel_ids || []), JSON.stringify(assigned_fleet_profile_ids || [])],
    );
    if (existingAppUsers.length > 0) {
      await pool.query('DELETE FROM app_users WHERE email = ?', [email]);
    }
    const [rows] = await pool.query('SELECT * FROM tenant_users WHERE id = ?', [id]);
    return res.status(201).json(parseUser(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId/:userId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== tid) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const fields = ['name', 'email', 'rank', 'role', 'nationality', 'employee_id', 'passport_number', 'seaman_book_number', 'status', 'fleet_scope'];
    const sets = [];
    const vals = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { sets.push(`\`${f}\` = ?`); vals.push(req.body[f]); }
    }
    if (req.body.assigned_vessel_ids !== undefined) { sets.push('assigned_vessel_ids = ?'); vals.push(JSON.stringify(req.body.assigned_vessel_ids)); }
    if (req.body.assigned_fleet_profile_ids !== undefined) { sets.push('assigned_fleet_profile_ids = ?'); vals.push(JSON.stringify(req.body.assigned_fleet_profile_ids)); }
    if (sets.length === 0) return res.json({ error: 'No fields to update' });
    vals.push(req.params.userId, tid);
    await pool.query(`UPDATE tenant_users SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, vals);
    const [rows] = await pool.query('SELECT * FROM tenant_users WHERE id = ?', [req.params.userId]);
    return res.json(parseUser(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.delete('/:tenantId/:userId', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== tid) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await pool.query('UPDATE crew_assignments SET signed_off_at = NOW() WHERE user_id = ? AND tenant_id = ? AND signed_off_at IS NULL', [req.params.userId, tid]);
    await pool.query('DELETE FROM tenant_users WHERE id = ? AND tenant_id = ?', [req.params.userId, tid]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Vessel Master "Emergency Password Reset" — a real credential rotation
// for a crew member who's locked out at sea with no shore IT available.
// Any authenticated user of the tenant can call this (matches the existing
// tenant-scoped access pattern on every other route in this file — the
// app has no finer-grained "is this user actually the Master" backend
// check anywhere, so this is consistent with, not weaker than, the rest
// of the API surface). The plaintext is returned exactly once.
router.put('/:tenantId/:userId/emergency-reset', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== tid) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const tempPassword = generateEmergencyOtp();
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const [result] = await pool.query(
      'UPDATE tenant_users SET password_hash = ?, must_change_password = TRUE WHERE id = ? AND tenant_id = ?',
      [passwordHash, req.params.userId, tid],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ tempPassword });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Super Admin "Trigger tenant password reset" emergency action — forces
// every user at a tenant to set a new password on next sign-in. A real,
// tenant-wide write, not a per-user endpoint, since the emergency-response
// use case is "something at this company may be compromised."
router.put('/:tenantId/force-password-reset', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('UPDATE tenant_users SET must_change_password = TRUE WHERE tenant_id = ?', [req.params.tenantId]);
    return res.json({ affected: result.affectedRows });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Super Admin "Reset MFA" — clears an account's enrolled authenticator so
// its next sign-in goes through fresh QR setup instead of asking for a
// code from an authenticator the user may have lost. Super-Admin-only
// (unlike most routes in this file) since forcibly dropping someone's
// second factor is itself a security-sensitive action.
router.put('/:tenantId/:userId/mfa-reset', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE tenant_users SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = ? AND tenant_id = ?',
      [req.params.userId, req.params.tenantId],
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.put('/:tenantId/:userId/deactivate', authMiddleware, async (req, res) => {
  try {
    const tid = req.params.tenantId;
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== tid) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await pool.query('UPDATE crew_assignments SET signed_off_at = NOW() WHERE user_id = ? AND tenant_id = ? AND signed_off_at IS NULL', [req.params.userId, tid]);
    await pool.query('UPDATE tenant_users SET status = ? WHERE id = ? AND tenant_id = ?', ['inactive', req.params.userId, tid]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
