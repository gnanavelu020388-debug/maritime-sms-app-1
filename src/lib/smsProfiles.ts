import { getEffectiveDemoVessels, getEffectiveDemoSmsDocs } from './demoData';
import { refreshTenantData } from './dataCache';
import {
  apiGetSmsProfiles, apiCreateSmsProfile, apiUpdateSmsProfile, apiDeleteSmsProfile,
  apiGetProfileVessels, apiAssignProfileVessel, apiUnassignProfileVessel,
} from './api';

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

export async function loadProfiles(tenantId: string): Promise<SmsProfileWithVessels[]> {
  const profiles = await apiGetSmsProfiles<SmsProfile>(tenantId);
  const liveVesselIds = new Set(getEffectiveDemoVessels(tenantId).map((v) => v.id));
  return Promise.all(profiles.map(async (p) => {
    const vesselIds = (await apiGetProfileVessels(tenantId, p.id)).filter((vid) => liveVesselIds.has(vid));
    return { ...p, vesselIds, vesselCount: vesselIds.length };
  }));
}

export async function createProfile(tenantId: string, name: string): Promise<SmsProfile | null> {
  try {
    return await apiCreateSmsProfile<SmsProfile>(tenantId, { name });
  } catch {
    return null;
  }
}

export async function deleteProfile(tenantId: string, profileId: string): Promise<boolean> {
  try {
    await apiDeleteSmsProfile(tenantId, profileId);
    return true;
  } catch {
    return false;
  }
}

export async function bumpProfileVersion(tenantId: string, profileId: string, newVersion: string): Promise<void> {
  await apiUpdateSmsProfile(tenantId, profileId, { version: newVersion });
}

export async function getVesselProfileMap(tenantId: string): Promise<Record<string, string>> {
  const profiles = await apiGetSmsProfiles<SmsProfile>(tenantId);
  const map: Record<string, string> = {};
  await Promise.all(profiles.map(async (p) => {
    const vesselIds = await apiGetProfileVessels(tenantId, p.id);
    vesselIds.forEach((vid) => { map[vid] = p.id; });
  }));
  return map;
}

export async function setProfileVessels(tenantId: string, profileId: string, vesselIds: string[]): Promise<boolean> {
  const current = await apiGetProfileVessels(tenantId, profileId);
  const currentSet = new Set(current);
  const nextSet = new Set(vesselIds);
  await Promise.all([
    ...current.filter((v) => !nextSet.has(v)).map((v) => apiUnassignProfileVessel(tenantId, profileId, v)),
    ...vesselIds.filter((v) => !currentSet.has(v)).map((v) => apiAssignProfileVessel(tenantId, profileId, v)),
  ]);
  return true;
}

export async function assignVesselToProfile(tenantId: string, profileId: string, vesselId: string): Promise<boolean> {
  const map = await getVesselProfileMap(tenantId);
  const currentProfileId = map[vesselId];
  if (currentProfileId && currentProfileId !== profileId) {
    await apiUnassignProfileVessel(tenantId, currentProfileId, vesselId);
  }
  if (profileId) {
    await apiAssignProfileVessel(tenantId, profileId, vesselId);
  }
  return true;
}

export async function getProfileForVessel(tenantId: string, vesselId: string): Promise<SmsProfile | null> {
  const profiles = await apiGetSmsProfiles<SmsProfile>(tenantId);
  for (const p of profiles) {
    const vesselIds = await apiGetProfileVessels(tenantId, p.id);
    if (vesselIds.includes(vesselId)) return p;
  }
  return null;
}

export async function getVesselsForTenant(tenantId: string): Promise<{ id: string; name: string; vessel_type: string | null }[]> {
  return getEffectiveDemoVessels(tenantId).map((v) => ({
    id: v.id, name: v.name, vessel_type: v.vessel_type,
  }));
}

// Real count of approved SMS documents visible to a vessel's profile
// (profile-specific docs, plus fleet-wide docs with no profile_id — same
// visibility rule as getEffectiveDemoSmsDocs) that were approved since the
// vessel's last sync. Refreshes the cache first so a doc approved moments
// ago by the DPA is counted, not just what was cached at page load.
export async function countApprovedDocsForProfile(tenantId: string, profileId: string | null, sinceISO?: string): Promise<number> {
  await refreshTenantData(tenantId).catch(() => {});
  const docs = getEffectiveDemoSmsDocs(tenantId);
  const since = sinceISO ? new Date(sinceISO).getTime() : 0;
  return docs.filter((d) =>
    d.node_kind === 'document' &&
    d.approval_state === 'approved' &&
    (d.profile_id === null || d.profile_id === profileId) &&
    new Date(d.updated_at).getTime() > since,
  ).length;
}
