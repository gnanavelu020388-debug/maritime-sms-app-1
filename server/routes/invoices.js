import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../db.js';
import { authMiddleware, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

const SELECT_JOINED = 'SELECT i.*, t.company FROM invoices i JOIN tenants t ON t.id = i.tenant_id';

function parseInvoice(row) {
  if (!row) return null;
  return {
    ...row,
    amount: Number(row.amount),
    line_items: typeof row.line_items === 'string' ? JSON.parse(row.line_items) : (row.line_items || []),
  };
}

router.get('/', authMiddleware, requireSuperAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(`${SELECT_JOINED} ORDER BY i.issued_at DESC LIMIT 500`);
    return res.json(rows.map(parseInvoice));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.get('/:tenantId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.tenant_id !== req.params.tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [rows] = await pool.query(`${SELECT_JOINED} WHERE i.tenant_id = ? ORDER BY i.issued_at DESC LIMIT 500`, [req.params.tenantId]);
    return res.json(rows.map(parseInvoice));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

router.post('/', authMiddleware, requireSuperAdmin, async (req, res) => {
  try {
    const { tenant_id, amount, currency, period, due_date, status, line_items } = req.body;
    const id = uuidv4();
    // mysql2 auto-formats JS Date objects for TIMESTAMP columns, but rejects
    // a raw ISO string ("...T...Z") from the client — always wrap in Date().
    const dueDate = due_date ? new Date(due_date) : null;
    await pool.query(
      'INSERT INTO invoices (id, tenant_id, amount, currency, period, due_date, status, line_items) VALUES (?,?,?,?,?,?,?,?)',
      [id, tenant_id, amount || 0, currency || 'USD', period, dueDate, status || 'draft', JSON.stringify(line_items || [])],
    );
    const [rows] = await pool.query(`${SELECT_JOINED} WHERE i.id = ?`, [id]);
    return res.status(201).json(parseInvoice(rows[0]));
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Database error' }); }
});

export default router;
