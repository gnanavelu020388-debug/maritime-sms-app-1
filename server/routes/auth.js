import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { signToken, authMiddleware } from '../middleware/auth.js';

const router = Router();

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

    const token = signToken({
      id: tu.id,
      email: tu.email,
      role: tu.role,
      tenant_id: tu.tenant_id,
      name: tu.name,
      rank: tu.rank,
    });

    return res.json({
      token,
      user: {
        id: tu.id,
        email: tu.email,
        role: tu.role,
        tenant_id: tu.tenant_id,
        name: tu.name,
        rank: tu.rank,
        adminName: tu.rank === 'DPA' ? `${tu.name} (DPA)` : tu.name,
      },
    });
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
      'SELECT email FROM tenant_users WHERE email = ? UNION SELECT email FROM super_admins WHERE email = ? UNION SELECT email FROM app_users WHERE email = ?',
      [email, email, email],
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
      },
      tenant,
    });
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
