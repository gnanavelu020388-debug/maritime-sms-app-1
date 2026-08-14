// DEV/DEMO-ONLY — creates real GCS objects under the existing demo tenants'
// `tenants/{id}/sms-documents/` prefixes so the storage quota UI (dashboard,
// Tenant & Company Management, alerts) can be exercised end-to-end before
// wiring up real document uploads.
//
// This deliberately OVERRIDES storage_gb_max for the 4 demo tenants to
// small, fast-to-fill MB-scale values so the NORMAL/WARNING/LIMIT_REACHED/
// OVER_LIMIT states can be demonstrated without uploading GBs of filler —
// their original production-tier quotas (500/300/100/50 GB from seed.js)
// are restored by resetDemoStorage.js.
//
// Quotas are sub-1GB, which is why server/schema.sql widened
// tenants.storage_gb_max from BIGINT to DECIMAL(12,6) — the quota
// calculation itself (storage_gb_max * bytes-per-GB, in
// server/jobs/refreshStorageUsage.js) is unchanged.
//
// Usage:  ALLOW_DEMO_SEED=true node server/seedDemoStorage.js
import dotenv from 'dotenv';
dotenv.config();

if (process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Refusing to run: set ALLOW_DEMO_SEED=true to seed demo GCS storage data (never set this in production).');
  process.exit(1);
}

import pool from './db.js';
import { uploadFile } from './storage.js';
import { refreshTenantStorage } from './jobs/refreshStorageUsage.js';

const BYTES_PER_MB = 1024 ** 2;
const MB_PER_GB = 1024;
const CHUNK_MB = 0.5; // upload filler in ~512KB chunks

// Matches the example scenario from the storage-quota spec, scaled down
// from GB to MB so each status (NORMAL/WARNING/LIMIT_REACHED/OVER_LIMIT)
// is reachable with a tiny, fast upload instead of several GB of filler.
const SCENARIOS = [
  { tenantId: 'tnt-atlantic-liquid', demoQuotaMb: 5, targetUsedMb: 4.8, label: 'near limit (WARNING)' },
  { tenantId: 'tnt-pacific-horizon', demoQuotaMb: 10, targetUsedMb: 8.5, label: 'moderate (WARNING)' },
  { tenantId: 'tnt-nordic-reef', demoQuotaMb: 20, targetUsedMb: 2, label: 'low usage (NORMAL)' },
  { tenantId: 'tnt-crescent-maritime', demoQuotaMb: 2, targetUsedMb: 2.1, label: 'over quota (OVER_LIMIT)' },
];

const REALISTIC_NAMES = [
  'safety-manual.pdf',
  'vessel-certificate.pdf',
  'emergency-procedure.pdf',
  'crew-training.pdf',
  'inspection-report.pdf',
];

// Builds a small but genuinely valid single-page PDF (correct object table,
// xref, and trailer) so these demo files open in any real PDF viewer —
// unlike raw filler bytes with a .pdf extension.
function buildMinimalPdf(title) {
  const escaped = title.replace(/[()\\]/g, (c) => `\\${c}`);
  const contentStream = `BT /F1 14 Tf 20 170 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(contentStream)} >>\nstream\n${contentStream}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

function makeFiller(sizeBytes, seed) {
  // Deterministic, non-zero content (not just for realism — some tooling
  // treats all-zero buffers specially) — cheap to generate at this scale.
  const buf = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i += 4096) buf.writeUInt32LE((seed + i) >>> 0, i);
  return buf;
}

async function seedTenant({ tenantId, demoQuotaMb, targetUsedMb, label }) {
  console.log(`\n[seed] ${tenantId} — ${label}: quota ${demoQuotaMb}MB, target ${targetUsedMb}MB`);

  const demoQuotaGb = demoQuotaMb / MB_PER_GB;
  await pool.query('UPDATE tenants SET storage_gb_max = ? WHERE id = ?', [demoQuotaGb, tenantId]);

  // A handful of small, realistically-named, genuinely-valid PDFs first.
  let realDocsBytes = 0;
  for (const name of REALISTIC_NAMES) {
    const buf = buildMinimalPdf(name);
    realDocsBytes += buf.length;
    await uploadFile(`tenants/${tenantId}/sms-documents/${name}`, buf, 'application/pdf');
  }

  // Filler chunks (raw, non-PDF bytes — named .bin so they're not mistaken
  // for real documents) to reach the target total.
  let remainingMb = Math.max(0, targetUsedMb - realDocsBytes / BYTES_PER_MB);
  let chunkIndex = 0;
  while (remainingMb > 0) {
    const thisChunkMb = Math.min(CHUNK_MB, remainingMb);
    const buf = makeFiller(Math.round(thisChunkMb * BYTES_PER_MB), chunkIndex);
    await uploadFile(`tenants/${tenantId}/sms-documents/demo-filler-${chunkIndex}.bin`, buf, 'application/octet-stream');
    remainingMb -= thisChunkMb;
    chunkIndex += 1;
  }
  console.log(`  uploaded ${REALISTIC_NAMES.length} PDFs (${(realDocsBytes / BYTES_PER_MB).toFixed(3)}MB) + ${chunkIndex} filler chunk(s)`);

  const { bytesUsed, status } = await refreshTenantStorage(tenantId);
  console.log(`  done — bytes_used=${bytesUsed} (${(bytesUsed / BYTES_PER_MB).toFixed(3)}MB), status=${status}`);
}

async function main() {
  const totalMb = SCENARIOS.reduce((sum, s) => sum + s.targetUsedMb, 0);
  console.log(`[seed] Will upload ~${totalMb.toFixed(1)}MB total across ${SCENARIOS.length} tenants.`);
  for (const scenario of SCENARIOS) {
    await seedTenant(scenario);
  }
  console.log('\n[seed] Complete. Reset with: node server/resetDemoStorage.js');
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});
