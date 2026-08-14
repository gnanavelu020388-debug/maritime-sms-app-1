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
import smsDocTabRoutes from './routes/smsDocTabs.js';
import fileRoutes from './routes/files.js';
import syncConfigRoutes from './routes/syncConfig.js';
import tenantSecurityRoutes from './routes/tenantSecurity.js';
import rankPermissionRoutes from './routes/rankPermissions.js';
import shoreRoleRoutes from './routes/shoreRoles.js';
import sessionRoutes from './routes/sessions.js';
import bannerRoutes from './routes/banner.js';
import vesselSyncRoutes from './routes/vesselSync.js';
import invoiceRoutes from './routes/invoices.js';
import backupRoutes from './routes/backups.js';
import platformStaffRoutes from './routes/platformStaff.js';
import errorLogRoutes from './routes/errorLogs.js';
import smsTemplateRoutes from './routes/smsTemplates.js';
import internalJobRoutes from './routes/internalJobs.js';
import platformSettingsRoutes from './routes/platformSettings.js';
import pool from './db.js';
import { recordRequestDuration } from './metrics.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Info'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Records real response times for the "API traffic (p95)" dashboard
// metric — see server/metrics.js.
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    recordRequestDuration(ms);
  });
  next();
});

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
app.use('/api/sms-doc-tabs', smsDocTabRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/sync-config', syncConfigRoutes);
app.use('/api/tenant-security', tenantSecurityRoutes);
app.use('/api/rank-permissions', rankPermissionRoutes);
app.use('/api/shore-roles', shoreRoleRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/banner', bannerRoutes);
app.use('/api/vessel-sync', vesselSyncRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/backups', backupRoutes);
app.use('/api/platform-staff', platformStaffRoutes);
app.use('/api/error-logs', errorLogRoutes);
app.use('/api/sms-templates', smsTemplateRoutes);
app.use('/api/internal', internalJobRoutes);
app.use('/api/platform', platformSettingsRoutes);

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
      try {
        await pool.query(stmt);
      } catch (stmtErr) {
        // A single statement (e.g. an ALTER already applied in a prior run)
        // failing shouldn't block the rest of the schema from initializing.
        console.error('[DB] Schema statement failed, continuing:', stmtErr.message);
      }
    }
    await pool.query(
      "INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('platform_storage_pool_gb', '500')",
    );
    // MySQL (unlike MariaDB) has no `ADD COLUMN IF NOT EXISTS` — check
    // information_schema instead so this stays safe to run on every boot.
    const [[{ hasStatusCol }]] = await pool.query(
      `SELECT COUNT(*) AS hasStatusCol FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'tenant_storage_cache' AND column_name = 'status'`,
    );
    if (!hasStatusCol) {
      await pool.query("ALTER TABLE tenant_storage_cache ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'NORMAL'");
      console.log('[DB] Added tenant_storage_cache.status column');
    }
    console.log('[DB] Schema initialized');
  } catch (err) {
    console.error('[DB] Schema init error:', err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`[Server] Maritime Platform API running on port ${PORT}`);
  await initSchema();
  // Periodic storage refresh runs via Cloud Scheduler hitting
  // POST /api/internal/storage/refresh — not an in-process setInterval,
  // which would run duplicated across Cloud Run's autoscaled instances.
});

export default app;
