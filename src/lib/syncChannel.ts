/**
 * Cross-window BroadcastChannel for real-time state sync.
 *
 * All three platform windows (Super Admin, Company Admin, Vessel Portal)
 * listen on this channel so that state changes in one tab immediately
 * propagate to every other open tab — no manual page refresh required.
 */

const CHANNEL_NAME = 'maritime_platform_sync';

export type SyncEventType =
  | 'SMS_UPDATED'
  | 'CREW_UPDATED'
  | 'VESSELS_UPDATED'
  | 'AUDIT_LOGGED'
  | 'PROFILES_UPDATED'
  | 'FEATURE_FLAGS_CHANGED'
  | 'PERMISSIONS_UPDATED';

export interface SyncEvent {
  type: SyncEventType;
  tenantId: string | null;
  payload: unknown;
}

type Listener = (event: SyncEvent) => void;

let channel: BroadcastChannel | null = null;
const listeners: Set<Listener> = new Set();

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (e: MessageEvent) => {
      const data = e.data as SyncEvent;
      if (data && data.type) {
        listeners.forEach((fn) => fn(data));
      }
    };
  }
  return channel;
}

/** Broadcast a sync event to all other open tabs/windows. */
export function postSyncEvent(event: SyncEvent): void {
  const ch = getChannel();
  if (!ch) return;
  ch.postMessage(event);
}

/** Subscribe to incoming sync events from other tabs. Returns an unsubscribe function. */
export function onSyncEvent(listener: Listener): () => void {
  getChannel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Broadcast that a tenant's feature flags changed so other windows (Company Admin,
 * Vessel Portal) re-fetch and update their module visibility in real time. */
export function publishFeatureFlagsChanged(tenantId: string): void {
  postSyncEvent({ type: 'FEATURE_FLAGS_CHANGED', tenantId, payload: { tenantId } });
}
