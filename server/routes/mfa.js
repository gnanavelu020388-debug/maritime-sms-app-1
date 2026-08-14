import { Router } from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { verifyToken } from '../middleware/auth.js';
import { generateBase32Secret, buildOtpauthUrl, verifyTotp, generateBackupCodes } from '../lib/totp.js';
import { buildTenantUserSession } from './auth.js';

const router = Router();

// Accepts EITHER a short-lived pending token with the given `stage` (issued
// by POST /auth/login when MFA applies) OR a normal full session token for
// a tenant_user (so an already-logged-in user can voluntarily turn MFA on
// from Security Settings, not just during a forced setup). Deliberately not
// `authMiddleware` — a pending token has no role/tenant_id and would be
// rejected everywhere else in the app by design; this is the one place it's
// meant to work.
function requireMfaCapableToken(stage) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing authorization header' });
    const decoded = verifyToken(header.slice(7));
    if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });
    if (decoded.stage && decoded.stage !== stage) return res.status(401).json({ error: 'Invalid or expired token' });
    if (!decoded.stage && !decoded.role) return res.status(401).json({ error: 'Invalid or expired token' });
    req.mfaUser = decoded;
    next();
  };
}

async function getTenantUserById(id) {
  const [rows] = await pool.query('SELECT * FROM tenant_users WHERE id = ?', [id]);
  return rows[0] || null;
}

// Step 1 of enrollment: generate (but don't yet activate) a TOTP secret.
// Works for a forced setup (stage=mfa_setup pending token) or a voluntary
// opt-in (any full tenant_user session token).
router.post('/setup/init', requireMfaCapableToken('mfa_setup'), async (req, res) => {
  try {
    const tu = await getTenantUserById(req.mfaUser.id);
    if (!tu) return res.status(404).json({ error: 'User not found' });
    const secret = generateBase32Secret();
    await pool.query('UPDATE tenant_users SET mfa_secret = ?, mfa_enabled = FALSE WHERE id = ?', [secret, tu.id]);
    return res.json({ secret, otpauthUrl: buildOtpauthUrl(tu.email, secret) });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Step 2 of enrollment: prove the authenticator app actually has the
// secret by submitting a live code. Only on success is mfa_enabled flipped
// on and backup codes minted — an abandoned setup leaves mfa_enabled=FALSE,
// so it never silently locks the account out.
router.post('/setup/verify', requireMfaCapableToken('mfa_setup'), async (req, res) => {
  try {
    const { code } = req.body;
    const tu = await getTenantUserById(req.mfaUser.id);
    if (!tu) return res.status(404).json({ error: 'User not found' });
    if (!tu.mfa_secret) return res.status(400).json({ error: 'Call /setup/init first' });
    if (!verifyTotp(tu.mfa_secret, code)) return res.status(401).json({ error: 'Incorrect code — check your authenticator app and try again.' });

    const backupCodes = generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));
    await pool.query(
      'UPDATE tenant_users SET mfa_enabled = TRUE, mfa_backup_codes = ? WHERE id = ?',
      [JSON.stringify(hashedCodes), tu.id],
    );

    const refreshed = await getTenantUserById(tu.id);
    // Setup started from a forced (stage=mfa_setup) pending token completes
    // the login right here — the user already proved their password once.
    const session = buildTenantUserSession(refreshed);
    return res.json({ ...session, backupCodes });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Step 3, only reached when login found mfa_enabled=TRUE: exchange the
// pending token + a live code (or an unused backup code) for a real session.
router.post('/login/verify', requireMfaCapableToken('mfa_verify'), async (req, res) => {
  try {
    const { code, backupCode } = req.body;
    const tu = await getTenantUserById(req.mfaUser.id);
    if (!tu) return res.status(404).json({ error: 'User not found' });
    if (!tu.mfa_enabled || !tu.mfa_secret) return res.status(400).json({ error: 'MFA is not enabled for this account.' });

    if (code) {
      if (!verifyTotp(tu.mfa_secret, code)) return res.status(401).json({ error: 'Incorrect code.' });
      return res.json(buildTenantUserSession(tu));
    }

    if (backupCode) {
      const hashedCodes = typeof tu.mfa_backup_codes === 'string' ? JSON.parse(tu.mfa_backup_codes) : (tu.mfa_backup_codes || []);
      let matchedIndex = -1;
      for (let i = 0; i < hashedCodes.length; i++) {
        if (await bcrypt.compare(backupCode.trim().toUpperCase(), hashedCodes[i])) { matchedIndex = i; break; }
      }
      if (matchedIndex === -1) return res.status(401).json({ error: 'Invalid or already-used backup code.' });
      // Single-use: remove the code that was just spent.
      hashedCodes.splice(matchedIndex, 1);
      await pool.query('UPDATE tenant_users SET mfa_backup_codes = ? WHERE id = ?', [JSON.stringify(hashedCodes), tu.id]);
      return res.json(buildTenantUserSession(tu));
    }

    return res.status(400).json({ error: 'code or backupCode is required' });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

// Voluntary disable — requires a live code, not just a session token, so a
// hijacked-but-unlocked browser tab can't turn MFA off on its own.
router.put('/disable', requireMfaCapableToken(undefined), async (req, res) => {
  try {
    const { code } = req.body;
    const tu = await getTenantUserById(req.mfaUser.id);
    if (!tu) return res.status(404).json({ error: 'User not found' });
    if (!tu.mfa_enabled || !tu.mfa_secret) return res.status(400).json({ error: 'MFA is not enabled for this account.' });
    if (!verifyTotp(tu.mfa_secret, code)) return res.status(401).json({ error: 'Incorrect code.' });
    await pool.query('UPDATE tenant_users SET mfa_enabled = FALSE, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = ?', [tu.id]);
    return res.json({ success: true });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
