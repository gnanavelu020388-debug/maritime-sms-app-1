import { Router } from 'express';
import { refreshAllTenantStorage } from '../jobs/refreshStorageUsage.js';
import { runAutoBackups } from '../jobs/autoBackup.js';

const router = Router();

// Called by Cloud Scheduler (or manually in dev) on a cron — not a
// user-facing route, so it's protected by a shared secret rather than a
// login session. Safe to hit concurrently: refreshAllTenantStorage() is a
// no-op if a refresh is already in flight on this instance.
function requireInternalSecret(req, res, next) {
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret || req.headers['x-internal-job-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.post('/storage/refresh', requireInternalSecret, async (_req, res) => {
  try {
    const result = await refreshAllTenantStorage();
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Refresh failed' });
  }
});

router.post('/backups/auto-run', requireInternalSecret, async (_req, res) => {
  try {
    const result = await runAutoBackups();
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Auto-backup run failed' });
  }
});

export default router;
