// In-process runtime metrics for this server instance — no simulated
// numbers. CPU% comes from process.cpuUsage() deltas sampled on a timer;
// API p95 comes from a rolling window of real request durations recorded
// by the timing middleware in server/index.js. Read by
// GET /api/platform/health (server/routes/platformSettings.js), which
// caches the latest snapshot to platform_metrics_cache.
import os from 'os';

const CPU_SAMPLE_INTERVAL_MS = 5000;
const MAX_DURATION_SAMPLES = 500;

let cpuPercent = 0;
let lastCpuUsage = process.cpuUsage();
let lastSampleTime = Date.now();

setInterval(() => {
  const now = Date.now();
  const elapsedMs = now - lastSampleTime;
  const usage = process.cpuUsage(lastCpuUsage);
  const cpuMs = (usage.user + usage.system) / 1000;
  const cores = os.cpus().length || 1;
  cpuPercent = elapsedMs > 0 ? Math.min(100, Math.round((cpuMs / elapsedMs / cores) * 1000) / 10) : 0;
  lastCpuUsage = process.cpuUsage();
  lastSampleTime = now;
}, CPU_SAMPLE_INTERVAL_MS).unref();

export function getCpuPercent() {
  return cpuPercent;
}

const durationSamplesMs = [];

export function recordRequestDuration(ms) {
  durationSamplesMs.push(ms);
  if (durationSamplesMs.length > MAX_DURATION_SAMPLES) durationSamplesMs.shift();
}

export function getApiP95Ms() {
  if (durationSamplesMs.length === 0) return 0;
  const sorted = [...durationSamplesMs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return Math.round(sorted[idx]);
}
