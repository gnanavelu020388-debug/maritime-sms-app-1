/**
 * Session security hooks for shipboard portals:
 * - useInactivityLogout: auto-logout after configurable idle period
 * - useSessionGuard: single concurrent login enforcement via session tokens
 * - useTenantSecuritySettings: read per-tenant security config
 */

import { useEffect, useRef, useState } from 'react';
import * as api from './api';

export interface TenantSecuritySettings {
  inactivity_timeout_minutes: number;
  enforce_single_session: boolean;
}

export interface SessionTokenRow {
  user_id: string;
  session_token: string;
  device_info: string | null;
  updated_at: string;
}

const DEFAULT_SECURITY: TenantSecuritySettings = {
  inactivity_timeout_minutes: 15,
  enforce_single_session: true,
};

export function useTenantSecuritySettings(tenantId: string | null | undefined): {
  settings: TenantSecuritySettings | null;
  loading: boolean;
} {
  const [settings, setSettings] = useState<TenantSecuritySettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) { setSettings(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    api.apiGetTenantSecuritySettings<TenantSecuritySettings>(tenantId)
      .then((s) => { if (!cancelled) setSettings(s); })
      .catch(() => { if (!cancelled) setSettings(DEFAULT_SECURITY); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tenantId]);

  return { settings, loading };
}

// ── Inactivity auto-logout ───────────────────────────────────────────

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click',
];

export function useInactivityLogout(
  timeoutMinutes: number | null | undefined,
  onTimeout: () => void,
  enabled: boolean = true,
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(onTimeout);
  callbackRef.current = onTimeout;

  useEffect(() => {
    if (!enabled || !timeoutMinutes || timeoutMinutes <= 0) return;

    const ms = timeoutMinutes * 60 * 1000;

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => callbackRef.current(), ms);
    };

    resetTimer();

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, resetTimer, { passive: true });
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, resetTimer);
      }
    };
  }, [timeoutMinutes, enabled]);
}

// ── Concurrent login prevention (single session enforcement) ─────────

function generateSessionToken(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const activeSessions = new Map<string, { token: string; updatedAt: string }>();

export function generateDemoSessionToken(userId: string): string {
  const token = generateSessionToken();
  activeSessions.set(userId, { token, updatedAt: new Date().toISOString() });
  return token;
}

function getActiveSessionToken(userId: string): string | null {
  return activeSessions.get(userId)?.token ?? null;
}

export async function registerSessionToken(
  userId: string,
  deviceInfo?: string,
): Promise<string | null> {
  const localToken = generateSessionToken();
  activeSessions.set(userId, { token: localToken, updatedAt: new Date().toISOString() });
  try {
    await api.apiRegisterSession(deviceInfo || 'Unknown');
  } catch { /* non-fatal */ }
  return localToken;
}

export async function clearSessionToken(userId: string): Promise<void> {
  activeSessions.delete(userId);
}

export function useSessionGuard(
  userId: string | null | undefined,
  localToken: string | null,
  enforced: boolean,
  onConflict: () => void,
): void {
  const conflictRef = useRef(onConflict);
  conflictRef.current = onConflict;

  useEffect(() => {
    if (!userId || !localToken || !enforced) return;

    const interval = setInterval(() => {
      const currentToken = getActiveSessionToken(userId);
      if (currentToken && currentToken !== localToken) {
        conflictRef.current();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [userId, localToken, enforced]);
}
