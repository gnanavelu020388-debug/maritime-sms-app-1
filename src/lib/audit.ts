import { postSyncEvent } from './syncChannel';
import { apiCreateAuditLog } from './api';
import { prependCachedAuditLog } from './dataCache';
import type { AuditLogRow } from './supabase';

interface LogPayload {
  tenantId?: string | null;
  actorEmail: string;
  category: string;
  action: string;
  target?: string;
  location?: string;
  severity?: 'info' | 'warning' | 'critical';
  // Real field-level before/after state, shown verbatim in the Security
  // view's "Field-Level Audit Delta" panel instead of a guessed diff.
  // Omit for actions with no natural before/after (creates, logins, etc).
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

// BroadcastChannel deliberately never delivers a message back to the
// channel object that sent it (spec behavior), and postSyncEvent/onSyncEvent
// share one singleton channel — so postSyncEvent below reaches every OTHER
// open tab but never this one. This same-tab CustomEvent is what gives the
// tab that actually performed the action its own instant feedback.
export const AUDIT_LOCAL_EVENT = 'mpc-audit-logged';

export async function logAudit({ tenantId, actorEmail, category, action, target, location, severity = 'info', before, after }: LogPayload) {
  const payload = { actorEmail, category, action, target, location, severity, before, after };

  // Audit logging is treated as instant/local-first, same as the two events
  // below: the tab that performed the action shouldn't wait on the network
  // round trip just to see its own entry in the tenant Audit Log tab, and
  // persistence to the server happens after, best-effort. The endpoint only
  // ever returns {success, id} anyway, not the inserted row, so there's
  // nothing worth waiting for to build this from. Cross-tab listeners (see
  // AUDIT_LOGGED below) build their own copy from the broadcast payload,
  // since this cache write only touches the tab that made it.
  if (tenantId) {
    const row: AuditLogRow = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tenant_id: tenantId, actor_user_id: null, actor_email: actorEmail, category, action,
      target: target ?? null, ip_address: null, location: location ?? null, severity,
      before_data: before ?? null, after_data: after ?? null, created_at: new Date().toISOString(),
    };
    prependCachedAuditLog(tenantId, row);
  }
  try {
    postSyncEvent({ type: 'AUDIT_LOGGED', tenantId: tenantId ?? null, payload });
  } catch {
    // cross-tab broadcast should never block the user flow
  }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUDIT_LOCAL_EVENT, { detail: { tenantId: tenantId ?? null, payload } }));
    }
  } catch {
    // same-tab notification should never block the user flow
  }
  try {
    await apiCreateAuditLog({
      tenant_id: tenantId ?? null,
      actor_email: actorEmail,
      category,
      action,
      target: target ?? null,
      severity,
      before_data: before ?? null,
      after_data: after ?? null,
    });
  } catch {
    // persistence is best-effort — audit logging should never block the user flow
  }
}
