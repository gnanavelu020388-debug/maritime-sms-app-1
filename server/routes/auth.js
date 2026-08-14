import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { signToken, authMiddleware } from '../middleware/auth.js';

const router = Router();

// platform_staff.role (roster label) -> InternalRole (frontend permission
// key consumed by capabilitiesFor() in src/lib/permissions.ts). Every
// platform_staff login carries PlatformRole 'super_admin' (the only
// backend-enforced tier — see requireSuperAdmin) plus this finer-grained
// internalRole for frontend section/action gating, same split as an
// internalRole resolved any other way.
const STAFF_ROLE_TO_INTERNAL_ROLE = {
  'Super-Admin': 'super_admin',
  'Platform Auditor': 'platform_auditor',
  'Global Support Staff': 'global_support',
};

// Shared by POST /login (no MFA needed) and mfa.js's login-verify (MFA code
// just confirmed) — both end in the exact same full-session response shape.
export function buildTenantUserSession(tu) {
  const token = signToken({
    id: tu.id,
    email: tu.email,
    role: tu.role,
    tenant_id: tu.tenant_id,
    name: tu.name,
    rank: tu.rank,
  });
  return {
    token,
    user: {
      id: tu.id,
      email: tu.email,
      role: tu.role,
      tenant_id: tu.tenant_id,
      name: tu.name,
      rank: tu.rank,
      adminName: tu.rank === 'DPA' ? `${tu.name} (DPA)` : tu.name,
      mustChangePassword: !!tu.must_change_password,
    },
  };
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const [saRows] = await pool.query('SELECT * FROM super_admins WHERE email = ?', [email]);
    if (saRows.length > 0) {
      const sa = saRows[0];
      const ok = await bcrypt.compare(password, sa.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
      const token = signToken({ id: sa.id, email: sa.email, role: 'super_admin', name: sa.name });
      return res.json({
        token,
        user: { id: sa.id, email: sa.email, role: 'super_admin', name: sa.name, adminName: 'Platform Admin' },
      });
    }

    // Real internal-staff login (previously roster-only — see the comment
    // on the platform_staff table in schema.sql). password_hash is NULL
    // until an invite/reset actually issues one, so an un-activated roster
    // entry correctly falls through to "invalid credentials" rather than
    // ever matching a blank/undefined password.
    const [staffRows] = await pool.query('SELECT * FROM platform_staff WHERE email = ?', [email]);
    if (staffRows.length > 0 && staffRows[0].password_hash) {
      const staff = staffRows[0];
      if (staff.status === 'locked') return res.status(403).json({ error: 'Account is locked. Contact your administrator.' });
      const ok = await bcrypt.compare(password, staff.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
      const internalRole = STAFF_ROLE_TO_INTERNAL_ROLE[staff.role] || 'global_support';
      const token = signToken({ id: staff.id, email: staff.email, role: 'super_admin', internalRole, staffId: staff.id, name: staff.name });
      await pool.query('UPDATE platform_staff SET last_active = NOW() WHERE id = ?', [staff.id]);
      return res.json({
        token,
        user: { id: staff.id, email: staff.email, role: 'super_admin', internalRole, name: staff.name, adminName: staff.name, mustChangePassword: !!staff.must_change_password },
      });
    }

    const [userRows] = await pool.query('SELECT * FROM tenant_users WHERE email = ?', [email]);
    if (userRows.length === 0) {
      const [appRows] = await pool.query('SELECT * FROM app_users WHERE email = ?', [email]);
      if (appRows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });
      const au = appRows[0];
      if (au.locked) return res.status(403).json({ error: 'Account is locked. Contact your administrator.' });
      const ok = await bcrypt.compare(password, au.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
      const role = au.is_super_admin ? 'super_admin' : 'vessel';
      const token = signToken({ id: au.id, email: au.email, role, name: au.name });
      return res.json({ token, user: { id: au.id, email: au.email, role, name: au.name } });
    }

    const tu = userRows[0];
    if (tu.status === 'locked') return res.status(403).json({ error: 'Account is locked. Contact your administrator.' });
    const ok = await bcrypt.compare(password, tu.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = ?', [tu.tenant_id]);
    if (tenantRows.length === 0 || tenantRows[0].status === 'archived') {
      return res.status(403).json({ error: 'Tenant account is archived.' });
    }
    // Real enforcement for the Super Admin "Emergency account lockdown"
    // action (UsersView.tsx) — suspending a tenant now actually blocks its
    // users from signing in, not just from showing a different badge.
    if (tenantRows[0].status === 'suspended') {
      return res.status(403).json({ error: 'This company account has been suspended. Contact your platform administrator.' });
    }

    // Real MFA gate: a tenant with mfa_enforced=TRUE never gets a full
    // session token from a bare password check. If the user has already
    // enrolled a TOTP secret, they get a short-lived "enter your code"
    // token; otherwise a short-lived "set up MFA now" token. Both are
    // rejected by every other route (see requireMfaStage in mfa.js) since
    // they deliberately carry no role/tenant_id.
    if (tenantRows[0].mfa_enforced) {
      if (tu.mfa_enabled) {
        const mfaToken = signToken({ id: tu.id, email: tu.email, stage: 'mfa_verify' }, '5m');
        return res.json({ mfaRequired: true, mfaToken });
      }
      const mfaToken = signToken({ id: tu.id, email: tu.email, stage: 'mfa_setup' }, '15m');
      return res.json({ mfaSetupRequired: true, mfaToken });
    }

    return res.json(buildTenantUserSession(tu));
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/signup', async (req, res) => {
  try {
    const { email, password, name, asSuperAdmin } = req.body;
    if (!email || !password || !name) return res.status(400).json({ error: 'Email, password, and name required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const [existing] = await pool.query(
      'SELECT email FROM tenant_users WHERE email = ? UNION SELECT email FROM super_admins WHERE email = ? UNION SELECT email FROM app_users WHERE email = ? UNION SELECT email FROM platform_staff WHERE email = ?',
      [email, email, email, email],
    );
    if (existing.length > 0) return res.status(409).json({ error: 'An account with this email already exists.' });

    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();

    if (asSuperAdmin) {
      await pool.query('INSERT INTO app_users (id, email, password_hash, name, is_super_admin) VALUES (?, ?, ?, ?, TRUE)', [id, email, hash, name]);
      const token = signToken({ id, email, role: 'super_admin', name });
      return res.json({ token, user: { id, email, role: 'super_admin', name } });
    }

    await pool.query('INSERT INTO app_users (id, email, password_hash, name, is_super_admin) VALUES (?, ?, ?, ?, FALSE)', [id, email, hash, name]);
    return res.json({ error: null });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    if (req.user.staffId) {
      const [rows] = await pool.query('SELECT * FROM platform_staff WHERE id = ?', [req.user.staffId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Staff account not found' });
      const staff = rows[0];
      const internalRole = STAFF_ROLE_TO_INTERNAL_ROLE[staff.role] || 'global_support';
      return res.json({
        user: { id: staff.id, email: staff.email, role: 'super_admin', internalRole, name: staff.name, adminName: staff.name, mustChangePassword: !!staff.must_change_password },
      });
    }
    if (req.user.role === 'super_admin') {
      return res.json({ user: { id: req.user.id, email: req.user.email, role: 'super_admin', name: req.user.name, adminName: 'Platform Admin' } });
    }
    const [rows] = await pool.query('SELECT * FROM tenant_users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const tu = rows[0];
    const [tenantRows] = await pool.query('SELECT * FROM tenants WHERE id = ?', [tu.tenant_id]);
    const tenant = tenantRows[0] || null;
    return res.json({
      user: {
        id: tu.id,
        email: tu.email,
        role: tu.role,
        tenant_id: tu.tenant_id,
        name: tu.name,
        rank: tu.rank,
        adminName: tu.rank === 'DPA' ? `${tu.name} (DPA)` : tu.name,
        mustChangePassword: !!tu.must_change_password,
      },
      tenant,
    });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/change-password', authMiddleware, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const hash = await bcrypt.hash(newPassword, 10);

    if (req.user.staffId) {
      await pool.query('UPDATE platform_staff SET password_hash = ?, must_change_password = FALSE WHERE id = ?', [hash, req.user.staffId]);
      return res.json({ success: true });
    }
    if (req.user.role === 'super_admin') return res.status(400).json({ error: 'Not applicable to this account type.' });

    const [rows] = await pool.query('SELECT id FROM tenant_users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });

    await pool.query('UPDATE tenant_users SET password_hash = ?, must_change_password = FALSE WHERE id = ?', [hash, req.user.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
