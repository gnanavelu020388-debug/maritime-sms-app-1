import { isDemoMode, getEffectiveDemoVessels, DEMO_TENANTS } from './demoData';

void isDemoMode;

export interface SmsProfile {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface SmsProfileWithVessels extends SmsProfile {
  vesselIds: string[];
  vesselCount: number;
}

function lsKey(tenantId: string) {
  return `sms-profiles-${tenantId}`;
}

function lsAssignmentsKey(tenantId: string) {
  return `sms-profile-assignments-${tenantId}`;
}

function readLsProfiles(tenantId: string): SmsProfile[] {
  try {
    const raw = localStorage.getItem(lsKey(tenantId));
    if (raw) return JSON.parse(raw) as SmsProfile[];
  } catch { /* ignore */ }
  const seeded = seedDefaultProfiles(tenantId);
  writeLsProfiles(tenantId, seeded);
  return seeded;
}

function seedDefaultProfiles(tenantId: string): SmsProfile[] {
  const now = '2025-03-10T00:00:00Z';
  const universal: SmsProfile = {
    id: `profile-universal-${tenantId}`,
    tenant_id: tenantId,
    name: 'Universal Fleet Baseline',
    version: '1.0.0',
    is_default: true,
    created_at: now,
    updated_at: now,
  };
  const tenantName = DEMO_TENANTS.find((t) => t.id === tenantId)?.company ?? '';
  let secondName = 'Fleet SMS Profile';
  if (tenantName.includes('Atlantic') || tenantName.includes('Tanker')) secondName = 'Tanker Fleet SMS';
  else if (tenantName.includes('Pacific')) secondName = 'Bulk Carrier SMS';
  else if (tenantName.includes('Nordic')) secondName = 'Reefer Fleet SMS';
  else if (tenantName.includes('Crescent')) secondName = 'General Cargo SMS';

  const second: SmsProfile = {
    id: `profile-bulk-${tenantId}`,
    tenant_id: tenantId,
    name: secondName,
    version: '1.0.0',
    is_default: false,
    created_at: now,
    updated_at: now,
  };
  return [universal, second];
}

function writeLsProfiles(tenantId: string, profiles: SmsProfile[]) {
  localStorage.setItem(lsKey(tenantId), JSON.stringify(profiles));
}

type DemoAssignments = Record<string, string>;

function seedDefaultAssignments(tenantId: string): DemoAssignments {
  const universalId = `profile-universal-${tenantId}`;
  const vesselIds = getEffectiveDemoVessels(tenantId).map((v) => v.id);
  const assignments: DemoAssignments = {};
  for (const vid of vesselIds) {
    assignments[vid] = universalId;
  }
  return assignments;
}

function readLsAssignments(tenantId: string): DemoAssignments {
  try {
    const raw = localStorage.getItem(lsAssignmentsKey(tenantId));
    if (!raw) {
      const seeded = seedDefaultAssignments(tenantId);
      writeLsAssignments(tenantId, seeded);
      return seeded;
    }
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const migrated: DemoAssignments = {};
      for (const [vid, val] of Object.entries(parsed)) {
        if (Array.isArray(val)) {
          if (val.length > 0) migrated[vid] = val[0];
        } else if (typeof val === 'string') {
          migrated[vid] = val;
        }
      }
      const liveVesselIds = new Set(getEffectiveDemoVessels(tenantId).map((v) => v.id));
      const universalId = `profile-universal-${tenantId}`;
      for (const vid of liveVesselIds) {
        if (!(vid in migrated)) migrated[vid] = universalId;
      }
      return migrated;
    }
  } catch { /* ignore */ }
  return {};
}

function writeLsAssignments(tenantId: string, assignments: DemoAssignments) {
  localStorage.setItem(lsAssignmentsKey(tenantId), JSON.stringify(assignments));
}

export async function loadProfiles(tenantId: string): Promise<SmsProfileWithVessels[]> {
  const profiles = readLsProfiles(tenantId);
  const assignments = readLsAssignments(tenantId);
  const liveVesselIds = new Set(getEffectiveDemoVessels(tenantId).map((v) => v.id));
  return profiles.map((p) => {
    const vesselIds = Object.entries(assignments)
      .filter(([vid, pid]) => pid === p.id && liveVesselIds.has(vid))
      .map(([vid]) => vid);
    return { ...p, vesselIds, vesselCount: vesselIds.length };
  });
}

export async function createProfile(tenantId: string, name: string): Promise<SmsProfile | null> {
  const profiles = readLsProfiles(tenantId);
  const profile: SmsProfile = {
    id: `profile-${Date.now()}`,
    tenant_id: tenantId,
    name,
    version: '1.0.0',
    is_default: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  profiles.push(profile);
  writeLsProfiles(tenantId, profiles);
  return profile;
}

export async function deleteProfile(tenantId: string, profileId: string): Promise<boolean> {
  const profiles = readLsProfiles(tenantId).filter((p) => p.id !== profileId);
  writeLsProfiles(tenantId, profiles);
  const assignments = readLsAssignments(tenantId);
  for (const [vid, pid] of Object.entries(assignments)) {
    if (pid === profileId) delete assignments[vid];
  }
  writeLsAssignments(tenantId, assignments);
  return true;
}

export async function bumpProfileVersion(tenantId: string, profileId: string, newVersion: string): Promise<void> {
  const profiles = readLsProfiles(tenantId);
  const idx = profiles.findIndex((p) => p.id === profileId);
  if (idx >= 0) {
    profiles[idx].version = newVersion;
    profiles[idx].updated_at = new Date().toISOString();
    writeLsProfiles(tenantId, profiles);
  }
}

export async function setProfileVessels(tenantId: string, profileId: string, vesselIds: string[]): Promise<boolean> {
  const assignments = readLsAssignments(tenantId);
  for (const [vid, pid] of Object.entries(assignments)) {
    if (pid === profileId) delete assignments[vid];
  }
  for (const vid of vesselIds) {
    assignments[vid] = profileId;
  }
  writeLsAssignments(tenantId, assignments);
  return true;
}

export async function assignVesselToProfile(tenantId: string, profileId: string, vesselId: string): Promise<boolean> {
  const assignments = readLsAssignments(tenantId);
  if (!profileId) {
    delete assignments[vesselId];
  } else {
    assignments[vesselId] = profileId;
  }
  writeLsAssignments(tenantId, assignments);
  return true;
}

export async function getProfileForVessel(tenantId: string, vesselId: string): Promise<SmsProfile | null> {
  const profiles = readLsProfiles(tenantId);
  const assignments = readLsAssignments(tenantId);
  const assignedPid = assignments[vesselId];
  if (assignedPid) {
    const assigned = profiles.find((p) => p.id === assignedPid);
    if (assigned) return assigned;
  }
  return profiles[0] ?? null;
}

export async function getVesselsForTenant(tenantId: string): Promise<{ id: string; name: string; vessel_type: string | null }[]> {
  return getEffectiveDemoVessels(tenantId).map((v) => ({
    id: v.id, name: v.name, vessel_type: v.vessel_type,
  }));
}

export async function getVesselProfileMap(tenantId: string): Promise<Record<string, string>> {
  return readLsAssignments(tenantId);
}

export async function countApprovedDocsForProfile(_tenantId: string, _profileId: string | null, _sinceISO?: string): Promise<number> {
  return 0;
}
