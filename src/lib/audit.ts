import { postSyncEvent } from './syncChannel';

interface LogPayload {
  tenantId?: string | null;
  actorEmail: string;
  category: string;
  action: string;
  target?: string;
  location?: string;
  severity?: 'info' | 'warning' | 'critical';
}

export async function logAudit({ tenantId, actorEmail, category, action, target, location, severity = 'info' }: LogPayload) {
  try {
    postSyncEvent({
      type: 'AUDIT_LOGGED',
      tenantId: tenantId ?? null,
      payload: { actorEmail, category, action, target, location, severity },
    });
  } catch {
    // audit logging should never block the user flow
  }
}
