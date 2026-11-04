import { sql } from 'kysely';
import { recordEvent } from './audit.js';
import type { Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';

/**
 * Changing a tenant's state (tenant-lifecycle.md, TL-A). In the tenant's transaction, so a change and
 * the event recording it are one; `platform.change_tenant_state` decides who may ask.
 */

/** The function refused: a change this state does not allow, or a tenant that is not there. */
export class TenantStateRefused extends Error {}

/** `AW001` a login that may not ask, `AW002` a change that does not apply: see 0004_tenant_state. */
const refusedCodes: ReadonlySet<string> = new Set(['AW001', 'AW002']);

const change = async (
  trx: TenantTransaction,
  tenant: Tenant,
  wanted: 'active' | 'suspended',
  reason: string | null,
): Promise<Date> => {
  try {
    const { rows } = await sql<{ since: Date }>`
      select platform.change_tenant_state(${tenant.id}, ${wanted}, ${reason}) as since`.execute(trx);
    return rows[0]!.since;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== undefined && refusedCodes.has(code)) {
      throw new TenantStateRefused((error as Error).message);
    }
    throw error;
  }
};

/** Stops everything in a tenant (ADM-028), recording why. Nothing in it changes. */
export async function suspendTenant(
  trx: TenantTransaction,
  tenant: Tenant,
  reason: string,
): Promise<void> {
  await change(trx, tenant, 'suspended', reason);
  await recordEvent(trx, { kind: 'tenant.suspended', detail: { reason } });
}

/**
 * Lifts a suspension (ADM-028). A webhook still being tried loses no time to it (ADM-045): it is as
 * old, and as near giving up, as when the suspension began.
 */
export async function resumeTenant(trx: TenantTransaction, tenant: Tenant): Promise<void> {
  const since = await change(trx, tenant, 'active', null);
  const seconds = Math.max(0, Math.round((Date.now() - since.getTime()) / 1000));
  await sql`
    update webhook_delivery
       set created_at = created_at + make_interval(secs => ${seconds}),
           first_attempt_at = first_attempt_at + make_interval(secs => ${seconds})
     where state = 'pending'`.execute(trx);
  await recordEvent(trx, { kind: 'tenant.resumed', detail: { suspendedSeconds: seconds } });
}
