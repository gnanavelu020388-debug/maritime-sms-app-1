import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type {
  AuditCategory,
  AuditEvent,
  BackupSnapshot,
  DocTreeKind,
  DocumentNode,
  ErrorLog,
  ImpersonationState,
  InternalUser,
  Invoice,
  MaintenanceBanner,
  ModuleKey,
  PlanTier,
  SatellitePayload,
  SmsSnapshot,
  SshRole,
  Tenant,
  TenantGuardrails,
  TenantStatus,
  TierConfig,
} from './types';
import { SUPER_ADMIN_ID, SUPER_ADMIN_NAME, uid, DEFAULT_TIER_CONFIGS, PLAN_DEFAULTS } from './constants';
import { onSyncEvent, type SyncEvent } from './lib/syncChannel';
import type { TenantRow } from './lib/supabase';

// A row fetched from the real backend, merged into the ledger by
// TENANTS_HYDRATE. Usage counts (seats/vessels used) are computed
// client-side from the data cache since the backend doesn't return them.
export interface HydratedTenantRow extends TenantRow {
  seatsUsed: number;
  vesselsUsed: number;
}

// ── In-memory builders for Super Admin dashboard state ──────────────
// These power the satellite queue simulation, audit trail, invoices,
// backups, internal staff, and SMS snapshots shown in the Super Admin UI.
// Tenant data itself comes from the API via dataCache.

const TENANT_SEED: Array<Partial<Tenant> & { company: string; region: string }> = [
  { company: 'Atlantic Liquid Bulk', region: 'EMEA', plan: 'Enterprise', status: 'active', contactEmail: 'fleet.ops@atlanticliquidbulk.com', seats: { used: 412, max: 500 }, vessels: { used: 38, max: 80 }, storageGb: { used: 742, max: 1000 }, modules: ['voyage_logging', 'crew_matrix', 'electronic_logbooks', 'advanced_analytics', 'satellite_sync', 'risk_assessment'], mfaEnforced: true, createdAt: '2022-03-14T09:20:00Z', contractExpires: '2026-09-30T00:00:00Z', monthlyRevenue: 14500 },
  { company: 'Pacific Horizon Cargo', region: 'APAC', plan: 'Professional', status: 'active', contactEmail: 'it.director@pacifichorizon.com', seats: { used: 87, max: 100 }, vessels: { used: 19, max: 20 }, storageGb: { used: 218, max: 250 }, modules: ['voyage_logging', 'crew_matrix', 'electronic_logbooks', 'satellite_sync'], mfaEnforced: true, createdAt: '2023-01-22T14:05:00Z', contractExpires: '2026-08-12T00:00:00Z', monthlyRevenue: 4200 },
  { company: 'Nordic Reef Shipping', region: 'EMEA', plan: 'Professional', status: 'trial', contactEmail: 'dpa@nordicreef.no', seats: { used: 41, max: 100 }, vessels: { used: 6, max: 20 }, storageGb: { used: 88, max: 250 }, modules: ['voyage_logging', 'crew_matrix', 'satellite_sync', 'risk_assessment'], mfaEnforced: false, createdAt: '2025-11-02T08:00:00Z', contractExpires: '2026-02-01T00:00:00Z', monthlyRevenue: 0 },
  { company: 'Crescent Marine Logistics', region: 'MEA', plan: 'Standard', status: 'suspended', contactEmail: 'admin@crescentmarine.ae', seats: { used: 22, max: 25 }, vessels: { used: 6, max: 5 }, storageGb: { used: 49, max: 50 }, modules: ['voyage_logging', 'electronic_logbooks'], mfaEnforced: false, createdAt: '2024-06-18T11:45:00Z', contractExpires: '2026-07-25T00:00:00Z', monthlyRevenue: 1200 },
  { company: 'Polaris Tanker Group', region: 'AMER', plan: 'Professional', status: 'archived', contactEmail: 'ops@polaristanker.com', seats: { used: 0, max: 100 }, vessels: { used: 0, max: 20 }, storageGb: { used: 0, max: 250 }, modules: ['voyage_logging', 'crew_matrix'], mfaEnforced: true, createdAt: '2021-02-10T09:00:00Z', contractExpires: '2026-01-15T00:00:00Z', monthlyRevenue: 3800 },
];

function buildTenants(): Tenant[] {
  return TENANT_SEED.map((seed, i) => {
    const id = `T-${(1000 + i).toString()}`;
    const plan = seed.plan!;
    const d = PLAN_DEFAULTS[plan];
    return {
      id, company: seed.company, contactEmail: seed.contactEmail!, plan,
      status: seed.status!, seats: { used: seed.seats!.used, max: seed.seats!.max || d.seats },
      vessels: { used: seed.vessels!.used, max: seed.vessels!.max || d.vessels },
      storageGb: { used: seed.storageGb!.used, max: seed.storageGb!.max || d.storageGb },
      modules: seed.modules!, mfaEnforced: seed.mfaEnforced!, createdAt: seed.createdAt!,
      contractExpires: seed.contractExpires!, monthlyRevenue: seed.monthlyRevenue!,
      region: seed.region!, docTrees: ['sms', 'fleet_circulars', 'flag_state'] as DocTreeKind[],
      guardrails: { workspaceFrozen: false, maxSubfolderDepth: 3, maxUploadSizeMb: 25 } as TenantGuardrails,
      demoTenantId: null,
    } as Tenant;
  });
}

function bytesToGb(bytes: number | undefined): number {
  return Math.round(((bytes ?? 0) / (1024 ** 3)) * 100) / 100;
}

const SHIP_NAMES = ['VALLE STAR', 'MAERSK VOYAGER', 'PACIFIC HORIZON', 'NORDIC BREEZE', 'CRESCENT TRADER', 'ATLAS EXPLORER', 'OCEAN PRIDE', 'STELLA SPIRIT'];

function pick<T>(arr: T[], i: number): T { return arr[i % arr.length]; }
function isoDaysAgo(days: number, hour = 10): string { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(hour, Math.floor(Math.random() * 60), 0, 0); return d.toISOString(); }
function isoHoursAgo(hours: number): string { return new Date(Date.now() - hours * 3600000).toISOString(); }
function isoMinutesAgo(mins: number): string { return new Date(Date.now() - mins * 60000).toISOString(); }

function buildSatellitePayloads(): SatellitePayload[] {
  const out: SatellitePayload[] = [];
  const statuses: SatellitePayload['status'][] = ['syncing', 'queued', 'processed', 'failed'];
  for (let i = 0; i < 14; i++) {
    const ship = pick(SHIP_NAMES, i);
    const status = pick(statuses, i * 3 + 1);
    out.push({ id: `${ship.split(' ')[0]}-LOG-${1000 + i}.json`, vessel: ship, tenantId: `T-${1000 + (i % 4)}`, sizeKb: 12 + ((i * 37) % 480), node: pick(['Starlink', 'VSAT', 'FBB'] as const, i), status, progress: status === 'syncing' ? 20 + ((i * 13) % 70) : status === 'processed' ? 100 : 0, receivedAt: isoMinutesAgo(i * 4 + 2) });
  }
  return out;
}

let docSeq = 0;
function doc(label: string, parentId: string | null, kind: 'folder' | 'document', contentKind?: 'rich_text' | 'pdf', content?: string): DocumentNode {
  docSeq += 1;
  return { id: `doc-${docSeq}-${Math.random().toString(36).slice(2, 6)}`, label, kind, parentId, contentKind, content, version: '1.0.0', updatedAt: new Date(Date.now() - docSeq * 3600000).toISOString(), children: [] };
}
function folder(label: string, parentId: string | null, children: DocumentNode[]): DocumentNode { const f = doc(label, parentId, 'folder'); f.children = children; return f; }

function buildMasterDocTree(kind: DocTreeKind): DocumentNode {
  const root = doc(kind === 'sms' ? 'SMS Documents' : kind === 'fleet_circulars' ? 'Fleet Circulars' : 'Flag State Documents', null, 'folder');
  if (kind === 'sms') {
    root.children = [
      folder('Deck Procedures', root.id, [doc('Mooring Operations Manual', root.id, 'document', 'rich_text', '## Mooring Operations\n\nAll mooring operations shall comply with…'), doc('Berthing Safety Checklist', root.id, 'document', 'pdf', 'berthing-safety-checklist.pdf')]),
      folder('Engine Procedures', root.id, [doc('Bunker Transfer Procedure', root.id, 'document', 'rich_text', '## Bunker Transfer\n\nPre-transfer checks…'), doc('Main Engine Lube Oil Routine', root.id, 'document', 'pdf', 'lube-oil-routine.pdf')]),
      folder('Emergency Preparedness', root.id, [doc('Fire Drill Sequence', root.id, 'document', 'rich_text', '## Fire Drill\n\nMuster stations and duties…'), doc('SOPEP Activation Steps', root.id, 'document', 'pdf', 'sopep-activation.pdf')]),
    ];
  } else if (kind === 'fleet_circulars') {
    root.children = [folder('Company Fleet Directives', root.id, [doc('Fleet Safety Circular Q2-2026', root.id, 'document', 'rich_text', '## Fleet Safety Circular\n\nEffective immediately…'), doc('Navigation Policy Update', root.id, 'document', 'pdf', 'nav-policy-2026.pdf')]), folder('Crew & Manning Circulars', root.id, [doc('Rest Hour Compliance Notice', root.id, 'document', 'rich_text', '## Rest Hours\n\nAll vessels must…')])];
  } else {
    root.children = [folder('Liberia Registry', root.id, [doc('Liberian Flag State Requirements', root.id, 'document', 'pdf', 'liberia-requirements.pdf'), doc('Annual Flag State Inspection Guide', root.id, 'document', 'rich_text', '## Flag State Inspection\n\nPreparation checklist…')]), folder('Marshall Islands Registry', root.id, [doc('MI-SMS Framework Requirements', root.id, 'document', 'pdf', 'mi-sms-framework.pdf')])];
  }
  return root;
}

function cloneDocTree(node: DocumentNode, forTenant = false): DocumentNode {
  return { ...node, id: forTenant ? `${node.id}-clone` : node.id, approvalState: forTenant ? 'approved' : undefined, syncState: forTenant ? 'synced' : undefined, creatorEmail: forTenant ? 'sms@superadmin.platform' : undefined, children: node.children.map((c) => cloneDocTree(c, forTenant)) };
}

function addDocChild(node: DocumentNode, parentId: string, child: DocumentNode): DocumentNode {
  if (node.id === parentId) { node.children.push(child); return node; }
  node.children = node.children.map((c) => addDocChild(c, parentId, child));
  return node;
}
function removeDocNode(node: DocumentNode, id: string): DocumentNode {
  node.children = node.children.filter((c) => c.id !== id).map((c) => removeDocNode(c, id));
  return node;
}
function renameDocNode(node: DocumentNode, id: string, label: string): DocumentNode {
  if (node.id === id) node.label = label;
  node.children = node.children.map((c) => renameDocNode(c, id, label));
  return node;
}
function updateDocContent(node: DocumentNode, id: string, content: string, contentKind: 'rich_text' | 'pdf'): DocumentNode {
  if (node.id === id) { node.content = content; node.contentKind = contentKind; node.updatedAt = new Date().toISOString(); }
  node.children = node.children.map((c) => updateDocContent(c, id, content, contentKind));
  return node;
}

const AUDIT_ACTIONS: Array<{ category: AuditEvent['category']; action: string; severity: AuditEvent['severity']; impersonation?: boolean }> = [
  { category: 'auth', action: 'Sign-in succeeded', severity: 'info' },
  { category: 'auth', action: 'MFA challenge passed', severity: 'info' },
  { category: 'impersonation', action: 'Login As — impersonation started', severity: 'critical', impersonation: true },
  { category: 'impersonation', action: 'Impersonation session ended', severity: 'warning', impersonation: true },
  { category: 'tenant', action: 'Tenant suspended', severity: 'warning' },
  { category: 'tenant', action: 'Tenant activated', severity: 'info' },
  { category: 'tenant', action: 'Plan tier upgraded', severity: 'info' },
  { category: 'sms', action: 'Master SMS push staged', severity: 'warning' },
  { category: 'sms', action: 'Folder created: "Emergency Procedures"', severity: 'info' },
  { category: 'sms', action: 'Document renamed: "Mooring Manual" → "Mooring Operations Manual"', severity: 'info' },
  { category: 'sms', action: 'PDF uploaded: "berthing-safety-checklist.pdf" (2.3MB)', severity: 'info' },
  { category: 'sms', action: 'Folder deleted: "Draft Procedures" (3 documents removed)', severity: 'warning' },
  { category: 'sms', action: 'Document content edited: "Safety Policy v2"', severity: 'info' },
  { category: 'sms', action: 'DPA approved: "Emergency Response Plan" (delta v3.1.0 → v3.2.0)', severity: 'warning' },
  { category: 'billing', action: 'Invoice generated', severity: 'info' },
  { category: 'billing', action: 'Contract renewal email sent', severity: 'info' },
  { category: 'backup', action: 'Manual snapshot triggered', severity: 'info' },
  { category: 'backup', action: 'Isolated restore executed', severity: 'critical' },
  { category: 'security', action: 'Account password reset issued', severity: 'warning' },
  { category: 'security', action: 'Account locked by admin', severity: 'warning' },
  { category: 'security', action: 'Global MFA enforcement toggled', severity: 'warning' },
  { category: 'system', action: 'Maintenance banner published', severity: 'info' },
];

const ACTORS = [SUPER_ADMIN_ID, 'PA-014', 'GS-022', 'PA-007'];
const IPS = ['10.42.1.8', '10.42.1.12', '172.16.8.4', '10.0.0.55', '203.0.113.7'];

function buildAuditLog(tenants: Tenant[], count = 26): AuditEvent[] {
  const out: AuditEvent[] = [];
  for (let i = 0; i < count; i++) {
    const tpl = pick(AUDIT_ACTIONS, i * 5 + 2);
    const tenant = pick(tenants, i + 1);
    out.push({ id: uid('aud'), ts: isoHoursAgo(i * 3 + 1), actor: pick(ACTORS, i), category: tpl.category, action: tpl.action, target: tpl.category === 'tenant' || tpl.category === 'billing' || tpl.category === 'backup' ? tenant.company : tpl.impersonation ? tenant.contactEmail : 'platform', companyId: tenant.id, ip: pick(IPS, i), scope: tpl.category, severity: tpl.severity, impersonation: tpl.impersonation });
  }
  return out.sort((a, b) => +new Date(b.ts) - +new Date(a.ts));
}

function buildInvoices(tenants: Tenant[]): Invoice[] {
  const out: Invoice[] = [];
  const statuses: Invoice['status'][] = ['paid', 'paid', 'processing', 'overdue', 'draft'];
  tenants.forEach((t, ti) => { for (let m = 0; m < 3; m++) { out.push({ id: `INV-${20260000 + ti * 100 + m}`, tenantId: t.id, company: t.company, amount: t.monthlyRevenue || PLAN_DEFAULTS[t.plan as PlanTier].monthly, currency: 'USD', period: ['June 2026', 'May 2026', 'April 2026'][m], issued: isoDaysAgo(m * 30 + 5), status: pick(statuses, ti + m) }); } });
  return out.sort((a, b) => +new Date(b.issued) - +new Date(a.issued));
}

function buildBackups(tenants: Tenant[]): BackupSnapshot[] {
  const out: BackupSnapshot[] = [];
  tenants.forEach((t, ti) => { for (let d = 0; d < 7; d++) { out.push({ id: `SNP-${ti}${d}-${Math.random().toString(36).slice(2, 6)}`, tenantId: t.id, company: t.company, takenAt: isoDaysAgo(d, 2 + ti), sizeGb: +(t.storageGb.used * 0.04 + d * 0.3).toFixed(2), type: d === 3 ? 'manual' : 'auto', status: d === 6 ? 'expired' : 'completed', expiry: isoDaysAgo(d - 30, 2), reason: d === 3 ? 'Pre SMS push v2.4 staging' : undefined }); } });
  return out.sort((a, b) => +new Date(b.takenAt) - +new Date(a.takenAt));
}

function buildInternalUsers(): InternalUser[] {
  return [
    { id: 'SA-001', name: SUPER_ADMIN_NAME, email: 'ellis.hawthorne@maritime-platform.io', role: 'Super-Admin', status: 'active', lastActive: isoMinutesAgo(3), mfa: true },
    { id: 'PA-014', name: 'Morgan Whitfield', email: 'm.whitfield@maritime-platform.io', role: 'Platform Auditor', status: 'active', lastActive: isoMinutesAgo(40), mfa: true },
    { id: 'PA-007', name: 'Priya Raghunathan', email: 'p.raghunathan@maritime-platform.io', role: 'Platform Auditor', status: 'active', lastActive: isoHoursAgo(5), mfa: true },
    { id: 'GS-022', name: 'Theo Marchetti', email: 't.marchetti@maritime-platform.io', role: 'Global Support Staff', status: 'active', lastActive: isoHoursAgo(2), mfa: false },
    { id: 'GS-031', name: 'Aiko Tanaka', email: 'a.tanaka@maritime-platform.io', role: 'Global Support Staff', status: 'locked', lastActive: isoDaysAgo(9), mfa: false },
    { id: 'PA-019', name: 'Darius Okafor', email: 'd.okafor@maritime-platform.io', role: 'Platform Auditor', status: 'invited', lastActive: isoDaysAgo(1), mfa: false },
  ];
}

function buildSystemRoles(): SshRole[] {
  return [
    { id: 'role-company-admin', name: 'Company Admin (Shore)', description: 'Full tenant administration, vessel provisioning, user creation, and drafting SMS revisions.', permissions: ['Full tenant administration', 'Vessel provisioning', 'User creation (Shore / Ship / Crew)', 'Draft SMS document revisions', 'Create & edit fleet circulars'], scope: 'tenant', system: true },
    { id: 'role-dpa', name: 'DPA / Marine Superintendent (Shore)', description: 'Verification cockpit, SMS review queue, fleet circular distribution, and official DPA approval/push rights.', permissions: ['Dedicated SMS approval queue', 'Review SMS revisions uploaded by Company Admin', 'Distribute fleet circulars', 'Approve & Push to Fleet', 'Reject & return to Company Admin'], scope: 'tenant', system: true },
    { id: 'role-ship-command', name: 'Ship Command (Master & Chief Engineer)', description: 'Read-only pipeline for active DPA-approved SMS manuals, local master logging, and vessel execution controls.', permissions: ['Search & view DPA-approved SMS manuals', 'Download operational baselines', 'Print active manuals', 'Local master logging', 'Vessel execution controls'], scope: 'tenant', system: true },
    { id: 'role-ship-officers', name: 'Shipboard Officers (Chief Mate, 2nd Engineer, Duty Officers)', description: 'Search, view, download active operational checklists, and log safety routines.', permissions: ['Search active operational checklists', 'View DPA-approved documents', 'Download operational baselines', 'Log safety routines'], scope: 'tenant', system: true },
    { id: 'role-ship-crew', name: 'Shipboard Crew & Ratings (Bosun, AB, Oiler, Crew)', description: 'Read-only access to safety manuals, emergency procedures, and fleet circulars with controlled print/view permissions.', permissions: ['View safety manuals (read-only)', 'View emergency procedures', 'View fleet circulars', 'Controlled print of approved materials'], scope: 'tenant', system: true },
  ];
}

function buildErrorLogs(): ErrorLog[] {
  return [
    { id: uid('err'), ts: isoMinutesAgo(8), level: 'error', source: 'sync-gateway', message: 'VSAT handshake timeout for STELLA SPIRIT', tenantId: 'T-1003', payload: '{"code":"VH_TIMEOUT","node":"VSAT-12","retry":3}' },
    { id: uid('err'), ts: isoHoursAgo(1), level: 'warn', source: 'auth-service', message: 'Rate limit threshold reached for tenant T-1001', tenantId: 'T-1001', payload: '{"window":"60s","attempts":482,"limit":450}' },
    { id: uid('err'), ts: isoHoursAgo(3), level: 'critical', source: 'db-pool', message: 'Connection pool saturation on shard eu-west-1b', tenantId: null, payload: '{"shard":"eu-west-1b","active":98,"max":100,"waitMs":4200}' },
    { id: uid('err'), ts: isoHoursAgo(6), level: 'error', source: 'pdf-renderer', message: 'Invoice PDF render failed for INV-20260002', tenantId: 'T-1001', payload: '{"invoice":"INV-20260002","reason":"font_missing"}' },
    { id: uid('err'), ts: isoDaysAgo(1, 14), level: 'warn', source: 'edge-cache', message: 'Cache miss spike on /api/sms/tree', tenantId: null, payload: '{"route":"/api/sms/tree","missRate":0.62}' },
  ];
}

function buildSmsSnapshots(tenants: Tenant[]): SmsSnapshot[] {
  const out: SmsSnapshot[] = [];
  tenants.forEach((t, ti) => { for (let d = 0; d < 3; d++) { out.push({ id: `snp-sms-${ti}-${d}-${Math.random().toString(36).slice(2, 6)}`, tenantId: t.id, company: t.company, takenAt: isoDaysAgo(d, ti * 2), label: d === 0 ? 'Today — auto snapshot' : d === 1 ? 'Yesterday — auto snapshot' : `${d} days ago — manual pre-edit`, docClones: { sms: cloneDocTree(t.docClones.sms, true), fleet_circulars: cloneDocTree(t.docClones.fleet_circulars, true), flag_state: cloneDocTree(t.docClones.flag_state, true) } }); } });
  return out;
}

interface Toast { id: string; title: string; message?: string; tone: 'info' | 'success' | 'warning' | 'danger'; }

interface State {
  tenants: Tenant[];
  satellite: SatellitePayload[];
  masterDocTrees: Record<DocTreeKind, DocumentNode>;
  smsPushVersion: string;
  tierConfigs: TierConfig[];
  audit: AuditEvent[];
  invoices: Invoice[];
  backups: BackupSnapshot[];
  internalUsers: InternalUser[];
  systemRoles: SshRole[];
  errorLogs: ErrorLog[];
  maintenance: MaintenanceBanner | null;
  impersonation: ImpersonationState;
  globalMfaEnforced: boolean;
  globalGuardrails: TenantGuardrails;
  smsSnapshots: SmsSnapshot[];
  toasts: Toast[];
  theme: 'light' | 'dark';
}

type Action =
  | { type: 'TOAST_ADD'; toast: Toast } | { type: 'TOAST_DISMISS'; id: string } | { type: 'THEME_SET'; theme: 'light' | 'dark' }
  | { type: 'MAINTENANCE_REMOTE'; banner: MaintenanceBanner | null }
  | { type: 'TENANTS_HYDRATE'; rows: HydratedTenantRow[] }
  | { type: 'TENANT_CREATE'; tenant: Tenant } | { type: 'TENANT_UPDATE'; id: string; patch: Partial<Tenant> } | { type: 'TENANT_SET_STATUS'; id: string; status: TenantStatus }
  | { type: 'TENANT_DELETE'; id: string } | { type: 'TENANT_SET_PLAN'; id: string; plan: PlanTier } | { type: 'TENANT_TOGGLE_MODULE'; id: string; module: ModuleKey }
  | { type: 'TENANT_TOGGLE_MODULE_REMOTE'; id: string; module: ModuleKey; enabled: boolean } | { type: 'TIER_CONFIG_UPDATE'; index: number; patch: Partial<TierConfig> }
  | { type: 'SATELLITE_TICK'; payloads: SatellitePayload[] } | { type: 'SMS_PUSH'; version: string; targets: string[] }
  | { type: 'DOC_ADD'; tree: DocTreeKind; parentId: string; node: DocumentNode } | { type: 'DOC_RENAME'; tree: DocTreeKind; nodeId: string; label: string }
  | { type: 'DOC_DELETE'; tree: DocTreeKind; nodeId: string } | { type: 'DOC_UPDATE_CONTENT'; tree: DocTreeKind; nodeId: string; content: string; contentKind: 'rich_text' | 'pdf' }
  | { type: 'BACKUP_ADD'; snapshot: BackupSnapshot } | { type: 'BACKUP_RESTORE'; snapshotId: string } | { type: 'BACKUP_DELETE'; snapshotId: string }
  | { type: 'INVOICE_ADD'; invoice: Invoice } | { type: 'USER_RESET_PASSWORD'; id: string } | { type: 'USER_LOCK_TOGGLE'; id: string }
  | { type: 'USER_INVITE'; user: InternalUser } | { type: 'USER_EDIT'; id: string; name: string; email: string; role: InternalUser['role'] }
  | { type: 'USER_DELETE'; id: string; mode: 'soft' | 'hard' } | { type: 'MFA_GLOBAL_TOGGLE'; enforced: boolean }
  | { type: 'IMPERSONATE_START'; tenantId: string } | { type: 'IMPERSONATE_END' } | { type: 'AUDIT_ADD'; event: AuditEvent }
  | { type: 'TENANT_FREEZE'; id: string; frozen: boolean } | { type: 'TENANT_ROLLBACK'; snapshotId: string }
  | { type: 'GUARDRAILS_UPDATE'; id: string; patch: Partial<TenantGuardrails> } | { type: 'GUARDRAILS_GLOBAL_UPDATE'; patch: Partial<TenantGuardrails> };

const initialTenants = buildTenants();
const masterDocTrees = { sms: buildMasterDocTree('sms'), fleet_circulars: buildMasterDocTree('fleet_circulars'), flag_state: buildMasterDocTree('flag_state') };
const tenantsWithClones = initialTenants.map((t) => ({ ...t, docClones: { sms: cloneDocTree(masterDocTrees.sms, true), fleet_circulars: cloneDocTree(masterDocTrees.fleet_circulars, true), flag_state: cloneDocTree(masterDocTrees.flag_state, true) } } as Tenant));
const initialState: State = {
  tenants: tenantsWithClones,
  satellite: buildSatellitePayloads(),
  masterDocTrees,
  smsPushVersion: '2.4.0', tierConfigs: DEFAULT_TIER_CONFIGS.map((t) => ({ ...t })),
  audit: buildAuditLog(tenantsWithClones), invoices: buildInvoices(tenantsWithClones), backups: buildBackups(tenantsWithClones),
  internalUsers: buildInternalUsers(), systemRoles: buildSystemRoles(), errorLogs: buildErrorLogs(),
  maintenance: null, // populated by MaintenanceBanner's poll against the real backend
  impersonation: { active: false, tenantId: null, startedAt: null },
  globalMfaEnforced: true, globalGuardrails: { workspaceFrozen: false, maxSubfolderDepth: 4, maxUploadSizeMb: 50 },
  smsSnapshots: buildSmsSnapshots(tenantsWithClones), toasts: [],
  theme: (typeof localStorage !== 'undefined' && localStorage.getItem('mpc-theme') === 'dark') ? 'dark' : 'light',
};

function applyTierLimits(tenants: Tenant[], tierConfigs: TierConfig[], planFor?: { id: string; plan: PlanTier }): Tenant[] {
  return tenants.map((t) => {
    const plan = planFor && planFor.id === t.id ? planFor.plan : t.plan;
    const cfg = tierConfigs.find((c) => c.name === plan) ?? { name: plan, vessels: t.vessels.max, seats: t.seats.max, storageGb: t.storageGb.max, monthly: t.monthlyRevenue, annual: 0 };
    return { ...t, plan, vessels: { ...t.vessels, max: cfg.vessels || t.vessels.max }, seats: { ...t.seats, max: cfg.seats || t.seats.max }, storageGb: { ...t.storageGb, max: cfg.storageGb || t.storageGb.max }, monthlyRevenue: cfg.monthly || t.monthlyRevenue };
  });
}

function pushAudit(state: State, event: Omit<AuditEvent, 'id' | 'ts' | 'actor'> & { actor?: string }): State {
  const full: AuditEvent = { id: uid('aud'), ts: new Date().toISOString(), actor: event.actor ?? SUPER_ADMIN_ID, ...event };
  return { ...state, audit: [full, ...state.audit].slice(0, 400) };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'TOAST_ADD': return { ...state, toasts: [...state.toasts, action.toast] };
    case 'TOAST_DISMISS': return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'THEME_SET': return { ...state, theme: action.theme };
    case 'MAINTENANCE_REMOTE': return { ...state, maintenance: action.banner };
    case 'TENANTS_HYDRATE': {
      const existingIds = new Set(state.tenants.map((t) => t.id));
      const merged = state.tenants.map((t) => {
        const row = action.rows.find((r) => r.id === t.id);
        if (!row) return t;
        return {
          ...t,
          tenantNo: row.tenant_no,
          company: row.company, contactEmail: row.contact_email,
          plan: row.plan as PlanTier, status: row.status as TenantStatus, region: row.region,
          mfaEnforced: row.mfa_enforced, modules: row.modules as ModuleKey[],
          monthlyRevenue: Number(row.monthly_revenue), createdAt: row.created_at, contractExpires: row.contract_expires,
          vessels: { used: row.vesselsUsed, max: row.vessels_max },
          seats: { used: row.seatsUsed, max: row.seats_max },
          storageGb: { used: bytesToGb(row.storage_bytes_used), max: row.storage_gb_max },
        };
      });
      const newOnes: Tenant[] = action.rows.filter((r) => !existingIds.has(r.id)).map((row) => ({
        id: row.id, tenantNo: row.tenant_no, company: row.company, contactEmail: row.contact_email,
        companyEmail: '', companyMailPassword: '',
        plan: row.plan as PlanTier, status: row.status as TenantStatus,
        seats: { used: row.seatsUsed, max: row.seats_max },
        vessels: { used: row.vesselsUsed, max: row.vessels_max },
        storageGb: { used: bytesToGb(row.storage_bytes_used), max: row.storage_gb_max },
        modules: row.modules as ModuleKey[], mfaEnforced: row.mfa_enforced,
        createdAt: row.created_at, contractExpires: row.contract_expires,
        monthlyRevenue: Number(row.monthly_revenue), region: row.region,
        docTrees: ['sms', 'fleet_circulars', 'flag_state'] as DocTreeKind[],
        docClones: {
          sms: cloneDocTree(state.masterDocTrees.sms, true),
          fleet_circulars: cloneDocTree(state.masterDocTrees.fleet_circulars, true),
          flag_state: cloneDocTree(state.masterDocTrees.flag_state, true),
        },
        guardrails: { workspaceFrozen: false, maxSubfolderDepth: 3, maxUploadSizeMb: 25 },
        demoTenantId: null,
      }));
      return { ...state, tenants: [...merged, ...newOnes] };
    }
    case 'TENANT_CREATE': { const next = pushAudit(state, { category: 'tenant', action: `Tenant provisioned: ${action.tenant.company}`, target: action.tenant.company, companyId: action.tenant.id, ip: '10.42.1.8', scope: 'tenant', severity: 'info' }); return { ...next, tenants: [action.tenant, ...state.tenants] }; }
    case 'TENANT_UPDATE': { const tenant = state.tenants.find((t) => t.id === action.id); const next = pushAudit(state, { category: 'tenant', action: `Tenant edited: ${tenant?.company ?? action.id}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'tenant', severity: 'info' }); return { ...next, tenants: state.tenants.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)) }; }
    case 'TENANT_SET_STATUS': { const tenant = state.tenants.find((t) => t.id === action.id); const next = pushAudit(state, { category: 'tenant', action: `Tenant ${action.status}: ${tenant?.company ?? action.id}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'tenant', severity: action.status === 'suspended' ? 'warning' : 'info' }); return { ...next, tenants: state.tenants.map((t) => (t.id === action.id ? { ...t, status: action.status } : t)) }; }
    case 'TENANT_DELETE': { const t = state.tenants.find((x) => x.id === action.id); const next = pushAudit(state, { category: 'tenant', action: `Tenant permanently deleted: ${t?.company ?? action.id}`, target: t?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'tenant', severity: 'critical' }); return { ...next, tenants: state.tenants.filter((x) => x.id !== action.id), backups: state.backups.filter((b) => b.tenantId !== action.id) }; }
    case 'TENANT_SET_PLAN': { const tenant = state.tenants.find((t) => t.id === action.id); const next = pushAudit(state, { category: 'tenant', action: `Plan tier changed to ${action.plan}: ${tenant?.company ?? action.id}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'billing', severity: 'info' }); return { ...next, tenants: applyTierLimits(state.tenants, state.tierConfigs, { id: action.id, plan: action.plan }) }; }
    case 'TENANT_TOGGLE_MODULE': { const tenant = state.tenants.find((t) => t.id === action.id); const has = tenant?.modules.includes(action.module); const next = pushAudit(state, { category: 'tenant', action: `Module ${has ? 'revoked' : 'granted'}: ${action.module}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'tenant', severity: 'info' }); return { ...next, tenants: state.tenants.map((t) => t.id === action.id ? { ...t, modules: has ? t.modules.filter((m) => m !== action.module) : [...t.modules, action.module] } : t) }; }
    case 'TENANT_TOGGLE_MODULE_REMOTE': return { ...state, tenants: state.tenants.map((t) => t.id === action.id ? { ...t, modules: action.enabled ? t.modules.includes(action.module) ? t.modules : [...t.modules, action.module] : t.modules.filter((m) => m !== action.module) } : t) };
    case 'TIER_CONFIG_UPDATE': { const tierConfigs = state.tierConfigs.map((t, i) => (i === action.index ? { ...t, ...action.patch } : t)); const tenants = applyTierLimits(state.tenants, tierConfigs); const changedTier = tierConfigs[action.index]; const next = pushAudit(state, { category: 'billing', action: `Tier config updated: ${changedTier.name}`, target: changedTier.name, companyId: null, ip: '10.42.1.8', scope: 'billing', severity: 'info' }); return { ...next, tierConfigs, tenants }; }
    case 'SATELLITE_TICK': return { ...state, satellite: action.payloads };
    case 'SMS_PUSH': { const targets = action.targets; const tenants = state.tenants.map((t) => targets.includes(t.id) ? { ...t, docTrees: ['sms', 'fleet_circulars', 'flag_state'] as DocTreeKind[], docClones: { sms: cloneDocTree(state.masterDocTrees.sms, true), fleet_circulars: cloneDocTree(state.masterDocTrees.fleet_circulars, true), flag_state: cloneDocTree(state.masterDocTrees.flag_state, true) } } : t); const next = pushAudit(state, { category: 'sms', action: `Flexible template push ${action.version} cloned to ${targets.length} tenant(s)`, target: 'platform', companyId: null, ip: '10.42.1.8', scope: 'sms', severity: 'warning' }); return { ...next, tenants, smsPushVersion: action.version }; }
    case 'DOC_ADD': { const root = state.masterDocTrees[action.tree]; const updated = addDocChild(structuredClone(root), action.parentId, action.node); const next = pushAudit(state, { category: 'sms', action: `Document node added: ${action.node.label} (${action.tree})`, target: action.tree, companyId: null, ip: '10.42.1.8', scope: 'sms', severity: 'info' }); return { ...next, masterDocTrees: { ...state.masterDocTrees, [action.tree]: updated } }; }
    case 'DOC_RENAME': { const root = state.masterDocTrees[action.tree]; const updated = renameDocNode(structuredClone(root), action.nodeId, action.label); return { ...state, masterDocTrees: { ...state.masterDocTrees, [action.tree]: updated } }; }
    case 'DOC_DELETE': { const root = state.masterDocTrees[action.tree]; const updated = removeDocNode(structuredClone(root), action.nodeId); const next = pushAudit(state, { category: 'sms', action: `Document node deleted (${action.tree})`, target: action.tree, companyId: null, ip: '10.42.1.8', scope: 'sms', severity: 'warning' }); return { ...next, masterDocTrees: { ...state.masterDocTrees, [action.tree]: updated } }; }
    case 'DOC_UPDATE_CONTENT': { const root = state.masterDocTrees[action.tree]; const updated = updateDocContent(structuredClone(root), action.nodeId, action.content, action.contentKind); const next = pushAudit(state, { category: 'sms', action: `Document content updated (${action.tree})`, target: action.tree, companyId: null, ip: '10.42.1.8', scope: 'sms', severity: 'info' }); return { ...next, masterDocTrees: { ...state.masterDocTrees, [action.tree]: updated } }; }
    case 'BACKUP_ADD': { const next = pushAudit(state, { category: 'backup', action: `Manual snapshot triggered: ${action.snapshot.company}`, target: action.snapshot.company, companyId: action.snapshot.tenantId, ip: '10.42.1.8', scope: 'backup', severity: 'info' }); return { ...next, backups: [action.snapshot, ...state.backups] }; }
    case 'BACKUP_RESTORE': { const snap = state.backups.find((b) => b.id === action.snapshotId); const next = pushAudit(state, { category: 'backup', action: `Isolated restore executed: ${snap?.company ?? action.snapshotId}`, target: snap?.company ?? action.snapshotId, companyId: snap?.tenantId ?? null, ip: '10.42.1.8', scope: 'backup', severity: 'critical' }); return next; }
    case 'BACKUP_DELETE': { const snap = state.backups.find((b) => b.id === action.snapshotId); const next = pushAudit(state, { category: 'backup', action: `Backup snapshot deleted: ${snap?.id ?? action.snapshotId}`, target: snap?.id ?? action.snapshotId, companyId: snap?.tenantId ?? null, ip: '10.42.1.8', scope: 'backup', severity: 'critical' }); return { ...next, backups: state.backups.filter((b) => b.id !== action.snapshotId) }; }
    case 'INVOICE_ADD': { const next = pushAudit(state, { category: 'billing', action: `Invoice generated: ${action.invoice.id}`, target: action.invoice.company, companyId: action.invoice.tenantId, ip: '10.42.1.8', scope: 'billing', severity: 'info' }); return { ...next, invoices: [action.invoice, ...state.invoices] }; }
    case 'USER_RESET_PASSWORD': { const u = state.internalUsers.find((x) => x.id === action.id); const next = pushAudit(state, { category: 'security', action: `Password reset issued: ${u?.email ?? action.id}`, target: u?.email ?? action.id, companyId: null, ip: '10.42.1.8', scope: 'security', severity: 'warning' }); return next; }
    case 'USER_LOCK_TOGGLE': { const u = state.internalUsers.find((x) => x.id === action.id); const locked = u?.status === 'locked'; const next = pushAudit(state, { category: 'security', action: `Account ${locked ? 'unlocked' : 'locked'}: ${u?.email ?? action.id}`, target: u?.email ?? action.id, companyId: null, ip: '10.42.1.8', scope: 'security', severity: 'warning' }); return { ...next, internalUsers: state.internalUsers.map((x) => x.id === action.id ? { ...x, status: locked ? 'active' : 'locked' } : x) }; }
    case 'USER_INVITE': { const next = pushAudit(state, { category: 'security', action: `Internal staff invited: ${action.user.email}`, target: action.user.email, companyId: null, ip: '10.42.1.8', scope: 'security', severity: 'info' }); return { ...next, internalUsers: [action.user, ...state.internalUsers] }; }
    case 'USER_EDIT': { const u = state.internalUsers.find((x) => x.id === action.id); const next = pushAudit(state, { category: 'security', action: `Staff account edited: ${u?.email ?? action.id} → ${action.email} (${action.role})`, target: action.email, companyId: null, ip: '10.42.1.8', scope: 'security', severity: 'warning' }); return { ...next, internalUsers: state.internalUsers.map((x) => x.id === action.id ? { ...x, name: action.name, email: action.email, role: action.role } : x) }; }
    case 'USER_DELETE': { const u = state.internalUsers.find((x) => x.id === action.id); const verb = action.mode === 'soft' ? 'revoked & archived' : 'permanently removed'; const next = pushAudit(state, { category: 'security', action: `Staff account ${verb}: ${u?.email ?? action.id}`, target: u?.email ?? action.id, companyId: null, ip: '10.42.1.8', scope: 'security', severity: 'critical' }); if (action.mode === 'soft') return { ...next, internalUsers: state.internalUsers.map((x) => x.id === action.id ? { ...x, status: 'locked' as const, mfa: false } : x) }; return { ...next, internalUsers: state.internalUsers.filter((x) => x.id !== action.id) }; }
    case 'MFA_GLOBAL_TOGGLE': { const next = pushAudit(state, { category: 'security', action: `Global MFA enforcement ${action.enforced ? 'enabled' : 'disabled'}`, target: 'platform', companyId: null, ip: '10.42.1.8', scope: 'security', severity: 'warning' }); return { ...next, globalMfaEnforced: action.enforced }; }
    case 'IMPERSONATE_START': { const tenant = state.tenants.find((t) => t.id === action.tenantId); const next = pushAudit(state, { category: 'impersonation', action: `Login As — impersonation started: ${tenant?.company ?? action.tenantId}`, target: tenant?.contactEmail ?? action.tenantId, companyId: action.tenantId, ip: '10.42.1.8', scope: 'impersonation', severity: 'critical', impersonation: true }); return { ...next, impersonation: { active: true, tenantId: action.tenantId, startedAt: new Date().toISOString() } }; }
    case 'IMPERSONATE_END': { const next = pushAudit(state, { category: 'impersonation', action: 'Impersonation session ended', target: state.impersonation.tenantId ?? 'platform', companyId: state.impersonation.tenantId, ip: '10.42.1.8', scope: 'impersonation', severity: 'warning', impersonation: true }); return { ...next, impersonation: { active: false, tenantId: null, startedAt: null } }; }
    case 'TENANT_FREEZE': { const tenant = state.tenants.find((t) => t.id === action.id); const next = pushAudit(state, { category: 'sms', action: `Workspace ${action.frozen ? 'frozen' : 'unfrozen'}: ${tenant?.company ?? action.id}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'sms', severity: action.frozen ? 'critical' : 'warning' }); return { ...next, tenants: state.tenants.map((t) => t.id === action.id ? { ...t, guardrails: { ...(t.guardrails ?? { workspaceFrozen: false, maxSubfolderDepth: 3, maxUploadSizeMb: 25 }), workspaceFrozen: action.frozen } } : t) }; }
    case 'TENANT_ROLLBACK': { const snap = state.smsSnapshots.find((s) => s.id === action.snapshotId); if (!snap) return state; const tenants = state.tenants.map((t) => t.id === snap.tenantId ? { ...t, docClones: { sms: cloneDocTree(snap.docClones.sms, true), fleet_circulars: cloneDocTree(snap.docClones.fleet_circulars, true), flag_state: cloneDocTree(snap.docClones.flag_state, true) } } : t); const next = pushAudit(state, { category: 'sms', action: `SMS tree rollback to snapshot: ${snap.label} (${snap.company})`, target: snap.company, companyId: snap.tenantId, ip: '10.42.1.8', scope: 'sms', severity: 'critical' }); return { ...next, tenants }; }
    case 'GUARDRAILS_UPDATE': { const tenant = state.tenants.find((t) => t.id === action.id); const next = pushAudit(state, { category: 'sms', action: `Guardrails updated: ${tenant?.company ?? action.id}`, target: tenant?.company ?? action.id, companyId: action.id, ip: '10.42.1.8', scope: 'sms', severity: 'warning' }); return { ...next, tenants: state.tenants.map((t) => t.id === action.id ? { ...t, guardrails: { ...(t.guardrails ?? { workspaceFrozen: false, maxSubfolderDepth: 3, maxUploadSizeMb: 25 }), ...action.patch } } : t) }; }
    case 'GUARDRAILS_GLOBAL_UPDATE': { const next = pushAudit(state, { category: 'sms', action: `Global guardrails updated`, target: 'Platform-wide', companyId: null, ip: 'local', scope: 'platform', severity: 'warning' }); return { ...next, globalGuardrails: { ...state.globalGuardrails, ...action.patch } }; }
    case 'AUDIT_ADD': return { ...state, audit: [action.event, ...state.audit].slice(0, 400) };
    default: return state;
  }
}

interface StoreCtx extends State { dispatch: React.Dispatch<Action>; toast: (t: Omit<Toast, 'id'>) => void; dismissToast: (id: string) => void; }
const Ctx = createContext<StoreCtx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const root = document.documentElement;
    if (state.theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try { localStorage.setItem('mpc-theme', state.theme); } catch { /* ignore */ }
  }, [state.theme]);

  useEffect(() => {
    const off = onSyncEvent((evt: SyncEvent) => {
      if (evt.type === 'AUDIT_LOGGED') {
        const p = evt.payload as { actorEmail: string; category: string; action: string; target?: string; severity?: 'info' | 'warning' | 'critical'; location?: string };
        dispatch({ type: 'AUDIT_ADD', event: { id: uid('evt'), ts: new Date().toISOString(), actor: p.actorEmail, category: (p.category as AuditCategory) ?? 'system', action: p.action, target: p.target ?? '', companyId: evt.tenantId, ip: 'remote', scope: p.location ?? 'tenant', severity: p.severity ?? 'info' } });
      } else if (evt.type === 'FEATURE_FLAGS_CHANGED' && evt.tenantId) {
        const p = evt.payload as { featureKey?: string; enabled?: boolean };
        if (p.featureKey && typeof p.enabled === 'boolean') dispatch({ type: 'TENANT_TOGGLE_MODULE_REMOTE', id: evt.tenantId, module: p.featureKey as ModuleKey, enabled: p.enabled });
      }
    });
    return off;
  }, []);

  useEffect(() => {
    const handle = setInterval(() => {
      dispatch({ type: 'SATELLITE_TICK', payloads: state.satellite.map((p) => {
        if (p.status === 'syncing') { const progress = Math.min(100, p.progress + 6 + Math.random() * 10); return progress >= 100 ? { ...p, progress: 100, status: 'processed' as const } : { ...p, progress }; }
        if (p.status === 'queued' && Math.random() > 0.7) return { ...p, status: 'syncing' as const, progress: 5 };
        return p;
      }) });
    }, 2200);
    return () => clearInterval(handle);
  }, [state.satellite]);

  const value = useMemo<StoreCtx>(() => ({
    ...state, dispatch,
    toast: (t) => { const id = uid('toast'); dispatch({ type: 'TOAST_ADD', toast: { ...t, id } }); setTimeout(() => dispatch({ type: 'TOAST_DISMISS', id }), 4200); },
    dismissToast: (id) => dispatch({ type: 'TOAST_DISMISS', id }),
  }), [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

export { SUPER_ADMIN_ID, SUPER_ADMIN_NAME };
