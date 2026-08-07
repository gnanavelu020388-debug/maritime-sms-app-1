import { bumpVersion, buildAndStoreDelta } from './deltaPackager';
import { getDemoTenant, demoUpdateTenantSmsVersion } from './demoData';
import { postSyncEvent } from './syncChannel';

export async function deployBaseline(
  tenantId: string,
  deployedByEmail: string,
): Promise<string | null> {
  const tenant = getDemoTenant(tenantId);
  const newVersion = bumpVersion(tenant.sms_version);
  await demoUpdateTenantSmsVersion(tenantId, newVersion);
  postSyncEvent({
    type: 'SMS_UPDATED',
    tenantId,
    payload: { action: 'baseline_deployed', version: newVersion },
  });
  return newVersion;
}
