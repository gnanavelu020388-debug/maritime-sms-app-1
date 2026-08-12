import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import tenantRoutes from './routes/tenants.js';
import userRoutes from './routes/users.js';
import vesselRoutes from './routes/vessels.js';
import assignmentRoutes from './routes/assignments.js';
import smsDocRoutes from './routes/smsDocuments.js';
import auditRoutes from './routes/auditLogs.js';
import featureFlagRoutes from './routes/featureFlags.js';
import smsProfileRoutes from './routes/smsProfiles.js';
import fileRoutes from './routes/files.js';
import syncConfigRoutes from './routes/syncConfig.js';
import sessionRoutes from './routes/sessions.js';
import bannerRoutes from './routes/banner.js';
import vesselSyncRoutes from './routes/vesselSync.js';
import invoiceRoutes from './routes/invoices.js';
import backupRoutes from './routes/backups.js';
import platformStaffRoutes from './routes/platformStaff.js';
import errorLogRoutes from './routes/errorLogs.js';
import smsTemplateRoutes from './routes/smsTemplates.js';
import pool from './db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Info'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── API routes ──────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/users', userRoutes);
app.use('/api/vessels', vesselRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/sms-documents', smsDocRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/feature-flags', featureFlagRoutes);
app.use('/api/sms-profiles', smsProfileRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/sync-config', syncConfigRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/banner', bannerRoutes);
app.use('/api/vessel-sync', vesselSyncRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/platform-staff', platformStaffRoutes);
app.use('/api/error-logs', errorLogRoutes);
app.use('/api/sms-templates', smsTemplateRoutes);

// ── Health check ────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Serve static frontend in production ──────────────────────
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// ── Initialize schema on startup ─────────────────────────────
async function initSchema() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      await pool.query(stmt);
    }
    console.log('[DB] Schema initialized');
  } catch (err) {
    console.error('[DB] Schema init error:', err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`[Server] Maritime Platform API running on port ${PORT}`);
  await initSchema();
});

export default app;
