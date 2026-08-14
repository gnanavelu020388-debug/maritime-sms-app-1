/**
 * Shoreside Role & Permission System
 *
 * Mirrors the shipboard rankPermissions system but for shore-based staff
 * (DPA, HSQE Manager, Technical Superintendent, Fleet Manager, Company Admin).
 *
 * Shoreside roles have administrative action privileges rather than
 * app-visibility toggles. Actions include SMS approvals, document editing,
 * fleet compliance oversight, etc.
 */

import { useEffect, useState } from 'react';

import { MODULE_KEYS, MODULE_LABELS, type ModuleKey } from './featureFlags';
import * as api from './api';
import { onSyncEvent, postSyncEvent } from './syncChannel';

// ── Shoreside Role Definitions ───────────────────────────────────────

export interface ShoreRoleDef {
  role: string;
  description: string;
  is_custom: boolean;
  created_at?: string;
}

export const DEFAULT_SHORE_ROLES: ShoreRoleDef[] = [
  { role: 'Designated Person Ashore (DPA)', description: 'SMS oversight, revision approvals, regulatory liaison', is_custom: false },
  { role: 'HSQE Manager', description: 'Health, Safety, Quality & Environmental compliance management', is_custom: false },
  { role: 'Technical Superintendent', description: 'Vessel technical oversight, maintenance coordination', is_custom: false },
  { role: 'Fleet Manager', description: 'Fleet operations, crew coordination, voyage planning', is_custom: false },
  { role: 'Company Admin', description: 'Full company management — users, fleet, billing, security', is_custom: false },
];

export const DEFAULT_SHORE_ROLE_DESCRIPTIONS: Record<string, string> = {
  'Designated Person Ashore (DPA)': 'SMS oversight, revision approvals, regulatory liaison',
  'HSQE Manager': 'Health, Safety, Quality & Environmental compliance management',
  'Technical Superintendent': 'Vessel technical oversight, maintenance coordination',
  'Fleet Manager': 'Fleet operations, crew coordination, voyage planning',
  'Company Admin': 'Full company management — users, fleet, billing, security',
};

// ── Shoreside Administrative Actions ─────────────────────────────────

export interface ShoreActionDef {
  key: string;
  label: string;
  note?: string;
  group?: string;
}

export const SHORE_ACTIONS: ShoreActionDef[] = [
  // ── Accordion A: System & Fleet Governance ──
  { key: 'manage_crew', label: 'Manage Crew Roster & Sign-On', group: 'governance' },
  { key: 'manage_vessels', label: 'Manage Vessel Profiles & Fleet Scope', group: 'governance' },
  { key: 'manage_permissions', label: 'Manage Role & Permissions Matrix', group: 'governance' },
  { key: 'manage_security', label: 'Security Settings Management', group: 'governance' },
  { key: 'view_audit', label: 'View Audit & Compliance Ledger', group: 'governance' },
  // ── Accordion B: SMS Governance ──
  { key: 'approve_sms', label: 'Approve SMS Revisions (DPA / Chief Executive Authority)', note: 'DPA / Company Admin only', group: 'sms' },
  { key: 'edit_sms', label: 'Edit SMS Manual Sections & Policy Content', group: 'sms' },
  { key: 'upload_sms', label: 'Upload New SMS Manuals, Forms & Circulars', group: 'sms' },
  { key: 'deploy_sms', label: 'Deploy Approved Revisions to Fleet Vessels', group: 'sms' },
];

// ── Accordion group definitions for UI rendering ──

export type ShoreAccordionGroup = 'governance' | 'sms' | 'modules';

export const SHORE_ACCORDION_GROUPS: { key: ShoreAccordionGroup; label: string; description: string }[] = [
  { key: 'governance', label: 'System & Fleet Governance', description: 'Administrative privileges for company and fleet management' },
  { key: 'sms', label: 'Safety Management System (SMS) Governance', description: 'SMS revision, editing, upload, and fleet deployment authority' },
  { key: 'modules', label: 'Platform Module Permissions', description: 'Granular per-module access across all tenant-enabled apps' },
];

export function shoreActionsByGroup(group: ShoreAccordionGroup): ShoreActionDef[] {
  if (group === 'modules') return [];
  return SHORE_ACTIONS.filter((a) => (a as ShoreActionDef & { group?: string }).group === group);
}

// ── Platform Module Access Actions (View / Edit / Full Control) ──────
// For each platform module, a shore role can be granted view, edit, or
// full control access. Keys follow the pattern `mod:<moduleKey>:<level>`.

export type ShoreModuleAccessLevel = 'view' | 'edit' | 'full';

export interface ShoreModuleActionDef {
  moduleKey: ModuleKey;
  moduleLabel: string;
  level: ShoreModuleAccessLevel;
  key: string;
  label: string;
}

function buildModuleActionKey(moduleKey: ModuleKey, level: ShoreModuleAccessLevel): string {
  return `mod:${moduleKey}:${level}`;
}

export const SHORE_MODULE_ACTIONS: ShoreModuleActionDef[] = MODULE_KEYS.flatMap((mk) => {
  const label = MODULE_LABELS[mk].label;
  return [
    { moduleKey: mk, moduleLabel: label, level: 'view' as const, key: buildModuleActionKey(mk, 'view'), label: `${label} — View` },
    { moduleKey: mk, moduleLabel: label, level: 'edit' as const, key: buildModuleActionKey(mk, 'edit'), label: `${label} — Edit` },
    { moduleKey: mk, moduleLabel: label, level: 'full' as const, key: buildModuleActionKey(mk, 'full'), label: `${label} — Full Control` },
  ];
});

/** All shore action keys (admin + module access) for normalize/dirty-check. */
export const ALL_SHORE_ACTION_KEYS: string[] = [
  ...SHORE_ACTIONS.map((a) => a.key),
  ...SHORE_MODULE_ACTIONS.map((a) => a.key),
];

/** Check if a shore action key is a module access key. */
export function isModuleActionKey(key: string): boolean {
  return key.startsWith('mod:');

}

/** Parse a module action key back into its parts. */
export function parseModuleActionKey(key: string): { moduleKey: ModuleKey; level: ShoreModuleAccessLevel } | null {
  if (!key.startsWith('mod:')) return null;
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  return { moduleKey: parts[1] as ModuleKey, level: parts[2] as ShoreModuleAccessLevel };
}

/** Group module actions by module key for UI rendering. */
export function shoreModuleActionsByModule(): { moduleKey: ModuleKey; moduleLabel: string; actions: ShoreModuleActionDef[] }[] {
  return MODULE_KEYS.map((mk) => ({
    moduleKey: mk,
    moduleLabel: MODULE_LABELS[mk].label,
    actions: SHORE_MODULE_ACTIONS.filter((a) => a.moduleKey === mk),
  }));
}

export type ShoreActionMap = Record<string, boolean>;

export interface ShorePermission {
  actions: ShoreActionMap;
}

export type ShorePermissionMap = Record<string, boolean>;

// ── Default permissions per shore role ───────────────────────────────

// ── Helper: build module access keys for a role ──────────────────────

function moduleAccess(moduleKey: ModuleKey, level: ShoreModuleAccessLevel): string {
  return `mod:${moduleKey}:${level}`;
}

/** Grant view+edit for a module (no full control). */
function moduleEdit(moduleKey: ModuleKey): Record<string, boolean> {
  return { [moduleAccess(moduleKey, 'view')]: true, [moduleAccess(moduleKey, 'edit')]: true, [moduleAccess(moduleKey, 'full')]: false };
}

/** Grant view only for a module. */
function moduleView(moduleKey: ModuleKey): Record<string, boolean> {
  return { [moduleAccess(moduleKey, 'view')]: true, [moduleAccess(moduleKey, 'edit')]: false, [moduleAccess(moduleKey, 'full')]: false };
}

/** Grant full control for a module. */
function moduleFull(moduleKey: ModuleKey): Record<string, boolean> {
  return { [moduleAccess(moduleKey, 'view')]: true, [moduleAccess(moduleKey, 'edit')]: true, [moduleAccess(moduleKey, 'full')]: true };
}

/** Grant full control for all modules. */
function allModulesFull(): Record<string, boolean> {
  const r: Record<string, boolean> = {};
  for (const mk of MODULE_KEYS) Object.assign(r, moduleFull(mk));
  return r;
}

export const DEFAULT_SHORE_PERMISSIONS: Record<string, ShorePermissionMap> = {
  'Designated Person Ashore (DPA)': {
    approve_sms: true,
    edit_sms: true,
    upload_sms: true,
    deploy_sms: true,
    manage_crew: false,
    manage_vessels: false,
    manage_permissions: false,
    view_audit: true,
    manage_security: false,
    ...moduleFull('sms_documentation'),
    ...moduleView('certification_manager'),
    ...moduleView('risk_assessment'),
    ...moduleView('advanced_analytics'),
    ...moduleView('rest_hours'),
    ...moduleView('haccp_galley'),
    ...moduleView('satellite_sync'),
    ...moduleView('voyage_logging'),
    ...moduleView('crew_matrix'),
    ...moduleView('electronic_logbooks'),
  },
  'HSQE Manager': {
    approve_sms: false,
    edit_sms: true,
    upload_sms: true,
    deploy_sms: false,
    manage_crew: false,
    manage_vessels: false,
    manage_permissions: false,
    view_audit: true,
    manage_security: false,
    ...moduleEdit('sms_documentation'),
    ...moduleFull('risk_assessment'),
    ...moduleFull('certification_manager'),
    ...moduleView('voyage_logging'),
    ...moduleView('rest_hours'),
    ...moduleView('haccp_galley'),
    ...moduleView('satellite_sync'),
    ...moduleView('crew_matrix'),
    ...moduleView('electronic_logbooks'),
    ...moduleView('advanced_analytics'),
  },
  'Technical Superintendent': {
    approve_sms: false,
    edit_sms: false,
    upload_sms: false,
    deploy_sms: false,
    manage_crew: false,
    manage_vessels: true,
    manage_permissions: false,
    view_audit: true,
    manage_security: false,
    ...moduleFull('certification_manager'),
    ...moduleFull('risk_assessment'),
    ...moduleView('voyage_logging'),
    ...moduleView('electronic_logbooks'),
    ...moduleView('sms_documentation'),
    ...moduleView('rest_hours'),
    ...moduleView('haccp_galley'),
    ...moduleView('satellite_sync'),
    ...moduleView('crew_matrix'),
    ...moduleView('advanced_analytics'),
  },
  'Fleet Manager': {
    approve_sms: false,
    edit_sms: false,
    upload_sms: false,
    deploy_sms: false,
    manage_crew: true,
    manage_vessels: true,
    manage_permissions: false,
    view_audit: true,
    manage_security: false,
    ...moduleEdit('sms_documentation'),
    ...moduleEdit('certification_manager'),
    ...moduleEdit('voyage_logging'),
    ...moduleEdit('electronic_logbooks'),
    ...moduleView('risk_assessment'),
    ...moduleView('advanced_analytics'),
    ...moduleView('rest_hours'),
    ...moduleView('haccp_galley'),
    ...moduleView('satellite_sync'),
    ...moduleEdit('crew_matrix'),
  },
  'Company Admin': {
    approve_sms: true,
    edit_sms: true,
    upload_sms: true,
    deploy_sms: true,
    manage_crew: true,
    manage_vessels: true,
    manage_permissions: true,
    view_audit: true,
    manage_security: true,
    ...allModulesFull(),
  },
};

/** DPA Full Authority preset: all admin actions true + all modules full control. */
export function dpaFullAuthority(): ShorePermissionMap {
  const r: ShorePermissionMap = {};
  for (const a of SHORE_ACTIONS) r[a.key] = true;
  for (const mk of MODULE_KEYS) Object.assign(r, moduleFull(mk));
  return r;
}

// ── Fleet Assignment Scope ───────────────────────────────────────────

export type FleetScope = 'global' | 'specific';

export const FLEET_SCOPE_OPTIONS: { value: FleetScope; label: string; description: string }[] = [
  { value: 'global', label: 'All Fleets / Global Company Access', description: 'Access to all vessels across the company (DPA, Company Admin)' },
  { value: 'specific', label: 'Specific Sub-Fleets / Vessels', description: 'Restricted to selected vessels only (Technical Superintendents)' },
];

// ── Normalize helper ─────────────────────────────────────────────────

function emptyShoreActions(): ShoreActionMap {
  const map: ShoreActionMap = {};
  for (const key of ALL_SHORE_ACTION_KEYS) map[key] = false;
  return map;
}

function normalizeShorePerms(perms: ShorePermissionMap | null | undefined): ShorePermissionMap {
  const result: ShorePermissionMap = {};
  for (const key of ALL_SHORE_ACTION_KEYS) {
    result[key] = perms?.[key] ?? false;
  }
  return result;
}

// ── Hook: load all shore role definitions for a tenant ───────────────

interface ShoreRoleDefRow {
  role: string;
  description: string | null;
  is_custom: boolean;
  created_at: string;
}

export function useShoreRolesForTenant(tenantId: string | null | undefined): {
  roles: ShoreRoleDef[];
  loading: boolean;
  refresh: () => void;
} {
  const [roles, setRoles] = useState<ShoreRoleDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!tenantId) { setRoles([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.apiGetShoreRoleDefs<ShoreRoleDefRow>(tenantId)
      .then((rows) => {
        if (cancelled) return;
        const overrides = new Map(rows.map((r) => [r.role, r]));
        const merged: ShoreRoleDef[] = DEFAULT_SHORE_ROLES.map((d) => {
          const o = overrides.get(d.role);
          return o ? { role: o.role, description: o.description ?? d.description, is_custom: o.is_custom, created_at: o.created_at } : d;
        });
        for (const r of rows) {
          if (!merged.some((m) => m.role === r.role)) {
            merged.push({ role: r.role, description: r.description ?? '', is_custom: r.is_custom, created_at: r.created_at });
          }
        }
        setRoles(merged);
      })
      .catch(() => { if (!cancelled) setRoles(DEFAULT_SHORE_ROLES); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, tick]);

  return { roles, loading, refresh: () => setTick((t) => t + 1) };
}

// ── Hook: load all shore role permissions for a tenant ───────────────

export function useShoreRolePermissions(tenantId: string | null | undefined): {
  permissions: Record<string, ShorePermissionMap>;
  loading: boolean;
  refresh: () => void;
} {
  const [permissions, setPermissions] = useState<Record<string, ShorePermissionMap>>({});
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!tenantId) { setPermissions({}); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.apiGetShoreRolePermissions<{ role: string; actions: ShorePermissionMap }>(tenantId)
      .then((rows) => {
        if (cancelled) return;
        const overrides = new Map(rows.map((r) => [r.role, r.actions]));
        const map: Record<string, ShorePermissionMap> = {};
        for (const role of Object.keys(DEFAULT_SHORE_PERMISSIONS)) {
          map[role] = normalizeShorePerms(overrides.get(role) ?? DEFAULT_SHORE_PERMISSIONS[role]);
        }
        for (const [role, perms] of overrides) {
          if (!(role in map)) map[role] = normalizeShorePerms(perms);
        }
        setPermissions(map);
      })
      .catch(() => {
        if (cancelled) return;
        const map: Record<string, ShorePermissionMap> = {};
        for (const role of Object.keys(DEFAULT_SHORE_PERMISSIONS)) map[role] = normalizeShorePerms(DEFAULT_SHORE_PERMISSIONS[role]);
        setPermissions(map);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId, tick]);

  const refresh = () => setTick((t) => t + 1);

  // Live sync: another tab/role saving shore-role permissions for this tenant
  // should refresh them here without a manual reload.
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

// ── Save a single shore role's permissions ───────────────────────────

export async function saveShoreRolePermission(
  tenantId: string,
  role: string,
  perms: ShorePermissionMap,
): Promise<{ error: string | null }> {
  try {
    await api.apiUpdateShoreRolePermission(tenantId, role, perms);
    postSyncEvent({ type: 'PERMISSIONS_UPDATED', tenantId, payload: { role } });
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save permissions' };
  }
}

// ── CRUD for custom shore role definitions ───────────────────────────

export async function saveCustomShoreRole(
  tenantId: string,
  role: string,
  description: string,
): Promise<{ error: string | null }> {
  try {
    await api.apiCreateShoreRoleDef(tenantId, { role, description });
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save role' };
  }
}

export async function updateCustomShoreRole(
  tenantId: string,
  oldRole: string,
  newRole: string,
  description: string,
): Promise<{ error: string | null }> {
  try {
    await api.apiUpdateShoreRoleDef(tenantId, oldRole, { role: newRole, description });
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to update role' };
  }
}

export async function deleteCustomShoreRole(
  tenantId: string,
  role: string,
): Promise<{ error: string | null }> {
  try {
    await api.apiDeleteShoreRoleDef(tenantId, role);
    return { error: null };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to delete role' };
  }
}

// ── Permission helpers ───────────────────────────────────────────────

export function canDoShore(
  perms: ShorePermissionMap | null,
  actionKey: string,
): boolean {
  if (!perms) return false;
  return perms[actionKey] ?? false;
}

/**
 * Resolve a user's auth rank to the matching shore role name used as key in
 * DEFAULT_SHORE_PERMISSIONS. The demo DPA user has rank 'DPA' but the
 * permissions map uses the full label 'Designated Person Ashore (DPA)'.
 */
export function resolveShoreRoleName(rank: string | null | undefined): string {
  if (!rank) return 'Designated Person Ashore (DPA)';
  // Exact match against defined shore roles
  const exact = DEFAULT_SHORE_ROLES.find((r) => r.role === rank);
  if (exact) return exact.role;
  // Common abbreviations
  if (rank.toUpperCase() === 'DPA') return 'Designated Person Ashore (DPA)';
  // Fallback: try case-insensitive partial match
  const partial = DEFAULT_SHORE_ROLES.find((r) =>
    r.role.toLowerCase().includes(rank.toLowerCase()) ||
    rank.toLowerCase().includes(r.role.toLowerCase().split(' ')[0]),
  );
  return partial?.role ?? 'Designated Person Ashore (DPA)';
}

// The shore permission map for a specific role (merged defaults +
// overrides) is now always sourced from useShoreRolePermissions(tenantId)
// — a synchronous, tenant-blind getter can't reflect a Company Admin's
// saved overrides, which was the whole point of the Permissions Matrix.

export { emptyShoreActions, normalizeShorePerms };
