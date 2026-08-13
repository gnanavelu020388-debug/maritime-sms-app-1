import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { getToken as getAuthToken } from './authToken';

export type NetworkMode = 'online' | 'offline';

export interface QueuedAction {
  id: string;
  path: string;
  method: string;
  body: unknown;
  queuedAt: number;
  description?: string;
  /** Auth token active when this action was queued — flushed only under the same session. */
  token: string | null;
}

export interface NetworkContextValue {
  mode: NetworkMode;
  online: boolean;
  checking: boolean;
  lastChecked: string | null;
  pendingActions: number;
  queuedActions: QueuedAction[];
  setMode: (mode: NetworkMode) => void;
  toggleMode: () => void;
  checkHealth: () => Promise<boolean>;
  flushQueue: () => Promise<{ synced: number; failed: number }>;
  clearQueue: () => void;
}

const CLOUD_BASE = import.meta.env.VITE_API_BASE || '/api';
const LOCAL_BASE = import.meta.env.VITE_LOCAL_API_BASE || 'http://localhost:8080/api';

const HEALTH_PATH = '/health';
const HEALTH_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 30_000;

const NetworkContext = createContext<NetworkContextValue | null>(null);

let activeBase: string = CLOUD_BASE;

export function getApiBase(): string {
  return activeBase;
}

function loadStoredMode(): NetworkMode {
  try {
    const stored = localStorage.getItem('mpc-network-mode');
    if (stored === 'offline' || stored === 'online') return stored;
  } catch { /* ignore */ }
  return 'online';
}

function loadQueuedActions(): QueuedAction[] {
  try {
    const raw = localStorage.getItem('mpc-offline-queue');
    if (raw) return JSON.parse(raw) as QueuedAction[];
  } catch { /* ignore */ }
  return [];
}

function saveQueuedActions(actions: QueuedAction[]): void {
  try {
    localStorage.setItem('mpc-offline-queue', JSON.stringify(actions));
  } catch { /* ignore */ }
}

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<NetworkMode>(loadStoredMode);
  const [online, setOnline] = useState<boolean>(true);
  const [checking, setChecking] = useState<boolean>(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [queuedActions, setQueuedActions] = useState<QueuedAction[]>(loadQueuedActions);
  const modeRef = useRef<NetworkMode>(mode);
  const onlineRef = useRef<boolean>(online);

  useEffect(() => { modeRef.current = mode; activeBase = mode === 'offline' ? LOCAL_BASE : CLOUD_BASE; }, [mode]);
  useEffect(() => { onlineRef.current = online; }, [online]);

  const persistMode = useCallback((m: NetworkMode) => {
    setModeState(m);
    try { localStorage.setItem('mpc-network-mode', m); } catch { /* ignore */ }
    activeBase = m === 'offline' ? LOCAL_BASE : CLOUD_BASE;
    console.log(`[NetworkContext] mode set to ${m.toUpperCase()} — base=${activeBase}`);
  }, []);

  const checkHealth = useCallback(async (): Promise<boolean> => {
    setChecking(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
      const res = await fetch(`${CLOUD_BASE}${HEALTH_PATH}`, { signal: controller.signal });
      clearTimeout(timeout);
      const ok = res.ok;
      setOnline(ok);
      setLastChecked(new Date().toISOString());
      console.log(`[NetworkContext] health check → ${ok ? 'ONLINE' : 'OFFLINE'} (${res.status})`);
      return ok;
    } catch (err) {
      setOnline(false);
      setLastChecked(new Date().toISOString());
      console.log(`[NetworkContext] health check failed → OFFLINE (${(err as Error).message})`);
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  // ── Auto-failover: poll health and switch to offline if cloud is down ──
  useEffect(() => {
    void checkHealth();
    const interval = setInterval(async () => {
      const cloudReachable = await checkHealth();
      if (!cloudReachable && modeRef.current === 'online') {
        console.log('[NetworkContext] auto-failover: cloud unreachable → switching to OFFLINE');
        persistMode('offline');
      } else if (cloudReachable && modeRef.current === 'offline' && modeRef.current !== 'online') {
        // Don't auto-switch back to online — let user confirm via banner
        console.log('[NetworkContext] cloud restored — awaiting user confirmation to go ONLINE');
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkHealth, persistMode]);

  const setMode = useCallback((m: NetworkMode) => {
    persistMode(m);
  }, [persistMode]);

  const toggleMode = useCallback(() => {
    const next: NetworkMode = modeRef.current === 'online' ? 'offline' : 'online';
    persistMode(next);
  }, [persistMode]);

  const enqueueAction = useCallback((action: Omit<QueuedAction, 'id' | 'queuedAt' | 'token'>) => {
    const queued: QueuedAction = {
      ...action,
      id: `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      queuedAt: Date.now(),
      token: getAuthToken(),
    };
    setQueuedActions((prev) => {
      const next = [...prev, queued];
      saveQueuedActions(next);
      return next;
    });
    console.log(`[NetworkContext] queued offline action: ${action.method} ${action.path}`);
  }, []);

  const clearQueue = useCallback(() => {
    setQueuedActions([]);
    saveQueuedActions([]);
  }, []);

  const flushQueue = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    const current = [...queuedActions];
    if (current.length === 0) return { synced: 0, failed: 0 };

    const token = getAuthToken();
    let synced = 0;
    let failed = 0;
    const remaining: QueuedAction[] = [];

    // Actions queued under a different (or no longer active) session must never
    // fire under the current user's identity — drop them instead of flushing.
    const stale = current.filter((a) => a.token !== token);
    if (stale.length > 0) {
      console.warn(`[NetworkContext] dropping ${stale.length} queued action(s) from a different session`);
    }
    const own = current.filter((a) => a.token === token);

    for (const action of own) {
      try {
        const res = await fetch(`${CLOUD_BASE}${action.path}`, {
          method: action.method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: action.body ? JSON.stringify(action.body) : undefined,
        });
        if (res.ok) {
          synced++;
          console.log(`[NetworkContext] flushed: ${action.method} ${action.path} → ${res.status}`);
        } else {
          failed++;
          remaining.push(action);
          console.error(`[NetworkContext] flush failed: ${action.method} ${action.path} → ${res.status}`);
        }
      } catch (err) {
        failed++;
        remaining.push(action);
        console.error(`[NetworkContext] flush error: ${action.method} ${action.path}`, err);
      }
    }

    setQueuedActions(remaining);
    saveQueuedActions(remaining);
    console.log(`[NetworkContext] queue flush complete: ${synced} synced, ${failed} failed, ${remaining.length} remaining`);
    return { synced, failed };
  }, [queuedActions]);

  // ── Expose enqueue + flush to the API client via a global ref ────────
  useEffect(() => {
    (window as Record<string, unknown>).__networkEnqueueAction = enqueueAction;
    (window as Record<string, unknown>).__networkFlushQueue = flushQueue;
    (window as Record<string, unknown>).__networkMode = () => modeRef.current;
  }, [enqueueAction, flushQueue]);

  const value: NetworkContextValue = {
    mode,
    online,
    checking,
    lastChecked,
    pendingActions: queuedActions.length,
    queuedActions,
    setMode,
    toggleMode,
    checkHealth,
    flushQueue,
    clearQueue,
  };

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork must be used within NetworkProvider');
  return ctx;
}

export { CLOUD_BASE, LOCAL_BASE };
