/**
 * Persists the DPA's currently-selected fleet profile (the "Profile:"
 * dropdown in the SMS Approvals queue) so other views — like the DPA
 * Dashboard's pending-approvals counter — stay scoped to the same profile
 * instead of drifting out of sync with what the queue actually shows.
 */

const EVENT_NAME = 'dpa-profile-selection-changed';

function storageKey(tenantId: string): string {
  return `dpa_active_profile_${tenantId}`;
}

export function getSelectedProfileId(tenantId: string): string | null {
  try {
    return localStorage.getItem(storageKey(tenantId));
  } catch {
    return null;
  }
}

export function setSelectedProfileId(tenantId: string, profileId: string | null): void {
  try {
    if (profileId) localStorage.setItem(storageKey(tenantId), profileId);
    else localStorage.removeItem(storageKey(tenantId));
  } catch {
    // ignore (private browsing / storage disabled)
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { tenantId, profileId } }));
}

/** Fires when the selected profile changes, in this tab (custom event) or another tab (storage event). */
export function onSelectedProfileChange(tenantId: string, listener: (profileId: string | null) => void): () => void {
  function handleCustom(e: Event) {
    const detail = (e as CustomEvent).detail as { tenantId: string; profileId: string | null };
    if (detail.tenantId === tenantId) listener(detail.profileId);
  }
  function handleStorage(e: StorageEvent) {
    if (e.key === storageKey(tenantId)) listener(e.newValue);
  }
  window.addEventListener(EVENT_NAME, handleCustom);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(EVENT_NAME, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
}
