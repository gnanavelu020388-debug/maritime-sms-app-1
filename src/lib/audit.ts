import { postSyncEvent } from './syncChannel';
import { apiCreateAuditLog } from './api';

interface LogPayload {
  tenantId?: string | null;
  actorEmail: string;
  category: string;
  action: string;
  target?: string;
  location?: string;
  severity?: 'info' | 'warning' | 'critical';
}

// BroadcastChannel deliberately never delivers a message back to the
// channel object that sent it (spec behavior), and postSyncEvent/onSyncEvent
// share one singleton channel — so postSyncEvent below reaches every OTHER
// open tab but never this one. This same-tab CustomEvent is what gives the
// tab that actually performed the action its own instant feedback.
export const AUDIT_LOCAL_EVENT = 'mpc-audit-logged';

export async function logAudit({ tenantId, actorEmail, category, action, target, location, severity = 'info' }: LogPayload) {
  const payload = { actorEmail, category, action, target, location, severity };
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
    });
  } catch {
    // persistence is best-effort — audit logging should never block the user flow
  }
}
