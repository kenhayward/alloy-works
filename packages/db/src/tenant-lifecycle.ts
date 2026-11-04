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
      select platform.change_tenant_state(${tenant.id}, ${wanted}, ${reason}) as since`.execute(
      trx,
    );
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
 * Lifts a suspension (ADM-028). What would be taken away by the clock is as old as when the suspension
 * began, so it costs nobody their work (TL-D): a webhook still being tried, a subscription's failing
 * days, a proposal, an export. What falls due on a date, a review or a retention, acts on lifting.
 */
export async function resumeTenant(trx: TenantTransaction, tenant: Tenant): Promise<void> {
  const since = await change(trx, tenant, 'active', null);
  const { rows } = await sql<{ seconds: number }>`
    select greatest(0, ceil(extract(epoch from now() - ${since}::timestamptz)))::int as seconds`.execute(
    trx,
  );
  const seconds = rows[0]!.seconds;
  const later = sql`make_interval(secs => ${seconds})`;
  await sql`update webhook_delivery
       set created_at = created_at + ${later},
           first_attempt_at = first_attempt_at + ${later}
     where state = 'pending'`.execute(trx);
  await sql`update webhook_subscription set failing_since = failing_since + ${later}
     where failing_since is not null`.execute(trx);
  await sql`update import set touched_at = touched_at + ${later}
     where state in ('awaiting', 'reading', 'proposed')`.execute(trx);
  await sql`update tenant_export set finished_at = finished_at + ${later}
     where state = 'done'`.execute(trx);
  await recordEvent(trx, { kind: 'tenant.resumed', detail: { suspendedSeconds: seconds } });
}
