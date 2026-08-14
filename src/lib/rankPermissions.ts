/**
 * Rank-Based RBAC Permission System — Granular Action Model
 *
 * Each platform module has a set of named actions (booleans). Company Admins
 * toggle individual actions per rank in a hierarchical checkbox configurator.
 *
 * App IDs are now 1:1 with Super Admin feature-flag ModuleKeys, so the
 * Permissions Matrix dynamically shows exactly the modules licensed for the
 * tenant by the Super Admin Tenant Feature Matrix.
 *
 * On login, the user's rank_permissions are injected into the auth context
 * (simulating JWT claims) so vessel-side apps can dynamically hide/disable
 * unauthorized navigation items, buttons, and management views.
 */

import { useEffect, useState } from 'react';
import { type Rank, ALL_RANKS, CORE_RANKS } from './supabase';
import { MODULE_KEYS, MODULE_LABELS, type ModuleKey } from './featureFlags';
import * as api from './api';
import { onSyncEvent } from './syncChannel';

// ── Custom Rank Definitions ──────────────────────────────────────────

export interface RankDef {
  rank: string;
  description: string;
  is_custom: boolean;
  created_at?: string;
}

export const DEFAULT_RANK_DESCRIPTIONS: Record<string, string> = {
  Master: 'Full command authority — all apps, all approvals',
  'Chief Engineer': 'Engine department head — engineering + rest hour oversight',
  'Chief Mate': 'Deck department head — cargo + rest hour oversight',
  'Second Engineer': 'Engine officer — own rest hours + operational logs',
  Bosun: 'Deck crew supervisor — own rest hours + deck operations',
  AB: 'Able Seaman — own rest hours + galley view only',
  Oiler: 'Engine room rating — own rest hours + galley view only',
  Cook: 'Chief Cook — galley operations + own rest hours',
  Crew: 'General crew — own rest hours only',
  DPA: 'Designated Person Ashore — SMS oversight and approvals',
};

function defaultRankDefs(): RankDef[] {
  return ALL_RANKS.map((r) => ({
    rank: r,
    description: DEFAULT_RANK_DESCRIPTIONS[r] ?? '',
    is_custom: false,
  }));
}

interface RankDefRow {
  rank: string;
  description: string | null;
  is_custom: boolean;
  created_at: string;
}

export async function getDemoCustomRanks(tenantId: string): Promise<RankDef[]> {
  const rows = await api.apiGetRankDefs<RankDefRow>(tenantId);
  return rows.filter((r) => r.is_custom).map((r) => ({ rank: r.rank, description: r.description ?? '', is_custom: r.is_custom, created_at: r.created_at }));
}

export function useRanksForTenant(tenantId: string | null | undefined): {
  ranks: RankDef[];
  loading: boolean;
  refresh: () => void;
} {
  const [ranks, setRanks] = useState<RankDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!tenantId) { setRanks([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.apiGetRankDefs<RankDefRow>(tenantId)
      .then((rows) => {
        if (cancelled) return;
        const overrides = new Map(rows.map((r) => [r.rank, r]));
        const merged: RankDef[] = defaultRankDefs().map((d) => {
          const o = overrides.get(d.rank);
          return o ? { rank: o.rank, description: o.description ?? d.description, is_custom: o.is_custom, created_at: o.created_at } : d;
        });
        for (const r of rows) {
          if (!merged.some((m) => m.rank === r.rank)) {
            merged.push({ rank: r.rank, description: r.description ?? '', is_custom: r.is_custom, created_at: r.created_at });
          }
        }
        setRanks(merged);
      })
      .catch(() => { if (!cancelled) setRanks(defaultRankDefs()); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, tick]);

  return { ranks, loading, refresh: () => setTick((t) => t + 1) };
}

export async function saveCustomRank(
  tenantId: string,
  rank: string,
  description: string,
): Promise<{ error: string | null }> {
  try {
    await api.apiCreateRankDef(tenantId, { rank, description });
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save rank' };
  }
}

export async function updateCustomRank(
  tenantId: string,
  oldRank: string,
  newRank: string,
  description: string,
): Promise<{ error: string | null }> {
  try {
    await api.apiUpdateRankDef(tenantId, oldRank, { rank: newRank, description });
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to update rank' };
  }
}

export async function deleteCustomRank(
  tenantId: string,
  rank: string,
): Promise<{ error: string | null }> {
  try {
    await api.apiDeleteRankDef(tenantId, rank);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to delete rank' };
  }
}

// ── App IDs are now ModuleKey — 1:1 with Super Admin feature flags ──

export type AppId = ModuleKey;

export const APP_IDS: AppId[] = [...MODULE_KEYS] as AppId[];

export const APP_LABELS: Record<AppId, string> = Object.fromEntries(
  MODULE_KEYS.map((k) => [k, MODULE_LABELS[k].label]),
) as Record<AppId, string>;

/** Returns the modules licensed for the tenant (enabled in Super Admin Feature Matrix). */
export function appsForTenant(enabledModules: Set<ModuleKey>): AppId[] {
  return MODULE_KEYS.filter((m) => enabledModules.has(m)) as AppId[];
}

/** Returns the modules NOT licensed for the tenant — shown as "Unlicensed by Super Admin". */
export function unlicensedApps(enabledModules: Set<ModuleKey>): AppId[] {
  return MODULE_KEYS.filter((m) => !enabledModules.has(m)) as AppId[];
}

// ── Action definitions per module ────────────────────────────────────
// Each action has a key (stored in DB), a human label, and an optional
// `note` (e.g. "Only Master can approve").

export interface ActionDef {
  key: string;
  label: string;
  note?: string;
}

function genericActions(): ActionDef[] {
  return [
    { key: 'view', label: 'View Records' },
    { key: 'edit', label: 'Edit / Create Records' },
    { key: 'approve', label: 'Approve / Sign Off', note: 'Typically Master / DPA only' },
    { key: 'manage', label: 'Manage Configuration', note: 'Administrative control' },
  ];
}

export const APP_ACTIONS: Record<AppId, ActionDef[]> = {
  sms_documentation: [
    { key: 'view', label: 'View SMS Documents' },
    { key: 'search', label: 'Search & Filter Manuals' },
    { key: 'print', label: 'Print Manuals' },
    { key: 'edit', label: 'Edit SMS Documents', note: 'DPA / shoreside only' },
    { key: 'upload', label: 'Upload New Documents', note: 'DPA / shoreside only' },
    { key: 'approve', label: 'Approve SMS Revisions', note: 'DPA only' },
  ],
  rest_hours: [
    { key: 'view_own', label: 'View Own Work/Rest Hours' },
    { key: 'log_own', label: 'Log Own Work/Rest Hours' },
    { key: 'view_others', label: 'View Other Crew Hours' },
    { key: 'edit_others', label: 'Edit Other Crew Hours', note: 'Typically officers only' },
    { key: 'approve_others', label: 'Approve Rest Hour Compliance', note: 'Typically Master / Chief Mate only' },
  ],
  haccp_galley: [
    { key: 'view_inventory', label: 'View Inventory & Stores' },
    { key: 'log_daily_meals', label: 'Log Daily Meals' },
    { key: 'draft_requisitions', label: 'Draft Food Requisitions' },
    { key: 'approve_food_orders', label: 'Approve Food Orders', note: 'Typically Master only' },
    { key: 'manage_stores', label: 'Manage Stores & Suppliers' },
  ],
  certification_manager: [
    { key: 'view', label: 'View Certificates' },
    { key: 'add', label: 'Add New Certificates' },
    { key: 'edit', label: 'Edit Certificate Details' },
    { key: 'revoke', label: 'Revoke Certificates', note: 'DPA / Master only' },
    { key: 'verify', label: 'Verify Certificate Compliance', note: 'DPA only' },
  ],
  satellite_sync: genericActions(),
  voyage_logging: genericActions(),
  crew_matrix: genericActions(),
  electronic_logbooks: genericActions(),
  advanced_analytics: [
    { key: 'view', label: 'View Dashboards & Reports' },
    { key: 'export', label: 'Export Reports' },
    { key: 'configure', label: 'Configure KPIs & Alerts', note: 'Administrative control' },
  ],
  risk_assessment: [
    { key: 'view', label: 'View Risk Assessments' },
    { key: 'edit', label: 'Create / Edit Assessments' },
    { key: 'approve', label: 'Approve Risk Assessments', note: 'Master / DPA only' },
    { key: 'close', label: 'Close Out Assessments', note: 'Master / DPA only' },
  ],
};

// ── Types ────────────────────────────────────────────────────────────

export type ActionMap = Record<string, boolean>;

export interface AppPermission {
  visible: boolean;
  actions: ActionMap;
}

export type RankPermissionMap = Partial<Record<AppId, AppPermission>>;

export interface RankPermissionRow {
  id: string;
  tenant_id: string;
  rank: string;
  apps: RankPermissionMap;
  updated_by: string | null;
  updated_at: string;
}

// ── Action presets per module (for quick-set buttons) ────────────────

export interface ActionPreset {
  label: string;
  actions: ActionMap;
}

function genericPresets(): ActionPreset[] {
  return [
    { label: 'Full Access', actions: { view: true, edit: true, approve: true, manage: true } },
    { label: 'Edit All', actions: { view: true, edit: true, approve: false, manage: false } },
    { label: 'View Only', actions: { view: true, edit: false, approve: false, manage: false } },
    { label: 'Hidden', actions: { view: false, edit: false, approve: false, manage: false } },
  ];
}

export const APP_PRESETS: Record<AppId, ActionPreset[]> = {
  sms_documentation: [
    { label: 'Full Access', actions: { view: true, search: true, print: true, edit: true, upload: true, approve: true } },
    { label: 'View Only', actions: { view: true, search: true, print: true, edit: false, upload: false, approve: false } },
    { label: 'Hidden', actions: { view: false, search: false, print: false, edit: false, upload: false, approve: false } },
  ],
  rest_hours: [
    { label: 'Approve All', actions: { view_own: true, log_own: true, view_others: true, edit_others: true, approve_others: true } },
    { label: 'Edit All', actions: { view_own: true, log_own: true, view_others: true, edit_others: true, approve_others: false } },
    { label: 'Own Log Only', actions: { view_own: true, log_own: true, view_others: false, edit_others: false, approve_others: false } },
    { label: 'Hidden', actions: { view_own: false, log_own: false, view_others: false, edit_others: false, approve_others: false } },
  ],
  haccp_galley: [
    { label: 'Full Admin', actions: { view_inventory: true, log_daily_meals: true, draft_requisitions: true, approve_food_orders: true, manage_stores: true } },
    { label: 'Cook Operational', actions: { view_inventory: true, log_daily_meals: true, draft_requisitions: true, approve_food_orders: false, manage_stores: false } },
    { label: 'View Menu Only', actions: { view_inventory: true, log_daily_meals: false, draft_requisitions: false, approve_food_orders: false, manage_stores: false } },
    { label: 'Hidden', actions: { view_inventory: false, log_daily_meals: false, draft_requisitions: false, approve_food_orders: false, manage_stores: false } },
  ],
  certification_manager: [
    { label: 'Full Admin', actions: { view: true, add: true, edit: true, revoke: true, verify: true } },
    { label: 'View Only', actions: { view: true, add: false, edit: false, revoke: false, verify: false } },
    { label: 'Hidden', actions: { view: false, add: false, edit: false, revoke: false, verify: false } },
  ],
  satellite_sync: genericPresets(),
  voyage_logging: genericPresets(),
  crew_matrix: genericPresets(),
  electronic_logbooks: genericPresets(),
  advanced_analytics: [
    { label: 'Full Access', actions: { view: true, export: true, configure: true } },
    { label: 'View & Export', actions: { view: true, export: true, configure: false } },
    { label: 'View Only', actions: { view: true, export: false, configure: false } },
    { label: 'Hidden', actions: { view: false, export: false, configure: false } },
  ],
  risk_assessment: [
    { label: 'Full Access', actions: { view: true, edit: true, approve: true, close: true } },
    { label: 'Edit All', actions: { view: true, edit: true, approve: false, close: false } },
    { label: 'View Only', actions: { view: true, edit: false, approve: false, close: false } },
    { label: 'Hidden', actions: { view: false, edit: false, approve: false, close: false } },
  ],
};

// ── Empty action map helper ──────────────────────────────────────────

export function emptyActionsFor(app: AppId): ActionMap {
  const map: ActionMap = {};
  for (const a of APP_ACTIONS[app]) map[a.key] = false;
  return map;
}

export function allTrueActionsFor(app: AppId): ActionMap {
  const map: ActionMap = {};
  for (const a of APP_ACTIONS[app]) map[a.key] = true;
  return map;
}

// ── Default permissions per rank ─────────────────────────────────────

/** Generate a "Full Access" permission for a module. */
function fullAccess(app: AppId): AppPermission {
  return { visible: true, actions: allTrueActionsFor(app) };
}

/** Generate a "View Only" permission for a module. */
function viewOnly(app: AppId): AppPermission {
  const actions = emptyActionsFor(app);
  const firstAction = APP_ACTIONS[app][0];
  if (firstAction) actions[firstAction.key] = true;
  return { visible: true, actions };
}

/** Generate a "Hidden" permission for a module. */
function hidden(app: AppId): AppPermission {
  return { visible: false, actions: emptyActionsFor(app) };
}

/** Build a full default permission map for a rank from a recipe. */
function buildRank(
  recipe: Partial<Record<AppId, 'full' | 'view' | 'hidden'>>,
): RankPermissionMap {
  const map: RankPermissionMap = {};
  for (const app of MODULE_KEYS) {
    const level = recipe[app];
    if (level === 'full') map[app] = fullAccess(app);
    else if (level === 'view') map[app] = viewOnly(app);
    else map[app] = hidden(app);
  }
  return map;
}

export const DEFAULT_RANK_PERMISSIONS: Record<string, RankPermissionMap> = {
  Master: buildRank({
    sms_documentation: 'full',
    rest_hours: 'full',
    haccp_galley: 'full',
    certification_manager: 'full',
    satellite_sync: 'full',
    voyage_logging: 'full',
    crew_matrix: 'full',
    electronic_logbooks: 'full',
    advanced_analytics: 'full',
    risk_assessment: 'full',
  }),
  'Chief Engineer': buildRank({
    sms_documentation: 'view',
    rest_hours: 'full',
    haccp_galley: 'view',
    certification_manager: 'view',
    satellite_sync: 'view',
    voyage_logging: 'view',
    crew_matrix: 'view',
    electronic_logbooks: 'full',
    advanced_analytics: 'view',
    risk_assessment: 'view',
  }),
  'Chief Mate': buildRank({
    sms_documentation: 'view',
    rest_hours: 'full',
    haccp_galley: 'view',
    certification_manager: 'view',
    satellite_sync: 'view',
    voyage_logging: 'full',
    crew_matrix: 'view',
    electronic_logbooks: 'view',
    advanced_analytics: 'view',
    risk_assessment: 'view',
  }),
  'Second Engineer': buildRank({
    rest_hours: 'view',
    electronic_logbooks: 'view',
  }),
  Bosun: buildRank({
    rest_hours: 'view',
  }),
  AB: buildRank({
    rest_hours: 'view',
    haccp_galley: 'view',
  }),
  Oiler: buildRank({
    rest_hours: 'view',
    haccp_galley: 'view',
  }),
  Cook: buildRank({
    rest_hours: 'view',
    haccp_galley: 'full',
  }),
  Crew: buildRank({
    rest_hours: 'view',
  }),
  DPA: buildRank({
    sms_documentation: 'full',
    certification_manager: 'view',
    risk_assessment: 'view',
    advanced_analytics: 'view',
  }),
};

// ── Normalize: fill missing actions with false, merge defaults ───────

function normalizePerms(perms: RankPermissionMap | null | undefined): RankPermissionMap {
  const result: RankPermissionMap = {};
  for (const app of MODULE_KEYS) {
    const existing = perms?.[app];
    if (existing) {
      const actions: ActionMap = {};
      for (const def of APP_ACTIONS[app]) {
        actions[def.key] = existing.actions?.[def.key] ?? false;
      }
      result[app] = { visible: existing.visible ?? false, actions };
    } else {
      result[app] = { visible: false, actions: emptyActionsFor(app) };
    }
  }
  return result;
}

// ── Hook: load all rank permissions for a tenant ─────────────────────

export function useRankPermissions(tenantId: string | null | undefined): {
  permissions: Record<string, RankPermissionMap>;
  loading: boolean;
  refresh: () => void;
} {
  const [permissions, setPermissions] = useState<Record<string, RankPermissionMap>>({});
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!tenantId) { setPermissions({}); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.apiGetRankPermissions<{ rank: string; apps: RankPermissionMap }>(tenantId)
      .then((rows) => {
        if (cancelled) return;
        const overrides = new Map(rows.map((r) => [r.rank, r.apps]));
        const map: Record<string, RankPermissionMap> = {};
        for (const rank of Object.keys(DEFAULT_RANK_PERMISSIONS)) {
          map[rank] = normalizePerms(overrides.get(rank) ?? DEFAULT_RANK_PERMISSIONS[rank]);
        }
        for (const [rank, apps] of overrides) {
          if (!(rank in map)) map[rank] = normalizePerms(apps);
        }
        setPermissions(map);
      })
      .catch(() => {
        if (cancelled) return;
        const map: Record<string, RankPermissionMap> = {};
        for (const rank of Object.keys(DEFAULT_RANK_PERMISSIONS)) map[rank] = normalizePerms(DEFAULT_RANK_PERMISSIONS[rank]);
        setPermissions(map);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, tick]);

  const refresh = () => setTick((t) => t + 1);

  // Live sync: another tab/role (e.g. Company Admin editing the Permissions
  // Matrix) saving rank permissions for this tenant should refresh them here
  // without a manual reload — matters most for the Vessel Portal launchpad.
  useEffect(() => {
    if (!tenantId) return;
    const off = onSyncEvent((evt) => {
      if (evt.tenantId !== tenantId) return;
      if (evt.type === 'PERMISSIONS_UPDATED') refresh();
    });
    return off;
  }, [tenantId]);

  return { permissions, loading, refresh };
}

// ── Hook: load a single rank's permissions (for vessel-side SSO) ─────

export function usePermissionsForRank(
  tenantId: string | null | undefined,
  rank: Rank | null | undefined,
): RankPermissionMap | null {
  const { permissions } = useRankPermissions(tenantId);
  if (!rank) return null;
  return permissions[rank] ?? normalizePerms(DEFAULT_RANK_PERMISSIONS[rank]) ?? null;
}

// ── Save a single rank's permissions ─────────────────────────────────

export async function saveRankPermission(
  tenantId: string,
  rank: string,
  perms: RankPermissionMap,
): Promise<{ error: string | null }> {
  try {
    await api.apiUpdateRankPermission(tenantId, rank, perms);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save permissions' };
  }
}

// ── Permission helpers (consumed by vessel-side apps) ────────────────

export function isAppVisible(perms: RankPermissionMap | null, app: AppId): boolean {
  return perms?.[app]?.visible ?? false;
}

export function canDo(
  perms: RankPermissionMap | null,
  app: AppId,
  actionKey: string,
): boolean {
  const appPerm = perms?.[app];
  if (!appPerm || !appPerm.visible) return false;
  return appPerm.actions?.[actionKey] ?? false;
}

export function getAppActions(perms: RankPermissionMap | null, app: AppId): ActionMap {
  return perms?.[app]?.actions ?? emptyActionsFor(app);
}

// ── Crew registration status ─────────────────────────────────────────

export const CREW_STATUS = {
  PENDING_SIGN_ON: 'pending_sign_on',
  ACTIVE: 'active',
  INVITED: 'invited',
  LOCKED: 'locked',
  INACTIVE: 'inactive',
} as const;

export function canAuthenticate(status: string | null | undefined): boolean {
  if (!status) return false;
  return status === 'active' || status === 'invited';
}

export { CORE_RANKS };
