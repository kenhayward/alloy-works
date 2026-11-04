import { decide, GRACE_DAYS, type Permission, type TenantState } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFacts } from './access-facts.js';
import { recordEvent } from './audit.js';
import { excludeDeletionDependants } from './deletion.js';
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
  wanted: 'active' | 'suspended' | 'closing' | 'cancelled' | 'retained' | 'deleting',
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

/** What a person's or a job's taken work would lose to the clock, moved on by how long it stood (TL-D). */
const moveClocksOn = async (trx: TenantTransaction, since: Date): Promise<number> => {
  const { rows } = await sql<{ seconds: number }>`
    select greatest(0, ceil(extract(epoch from now() - ${since}::timestamptz)))::int as seconds`.execute(
    trx,
  );
  const seconds = rows[0]!.seconds;
  const later = sql`make_interval(secs => ${seconds})`;
  // One finished while it stood has its days from now, and none is ever finished in time to come.
  await sql`update webhook_delivery
       set created_at = created_at + ${later},
           first_attempt_at = first_attempt_at + ${later}
     where state = 'pending'`.execute(trx);
  await sql`update webhook_subscription set failing_since = failing_since + ${later}
     where failing_since is not null`.execute(trx);
  await sql`update import set touched_at = touched_at + ${later}
     where state in ('awaiting', 'reading', 'proposed')`.execute(trx);
  await sql`update tenant_export
       set finished_at = finished_at + (now() - greatest(finished_at, ${since}::timestamptz))
     where state = 'done'`.execute(trx);
  return seconds;
};

/**
 * Lifts a suspension (ADM-028). What would be taken away by the clock is as old as when the suspension
 * began, so it costs nobody their work (TL-D): a webhook still being tried, a subscription's failing
 * days, a proposal, an export. What falls due on a date, a review or a retention, acts on lifting.
 */
export async function resumeTenant(trx: TenantTransaction, tenant: Tenant): Promise<void> {
  const since = await change(trx, tenant, 'active', null);
  const seconds = await moveClocksOn(trx, since);
  await recordEvent(trx, { kind: 'tenant.resumed', detail: { suspendedSeconds: seconds } });
}

/** A tenant's state as its own role may read it. */
export interface OwnTenantState {
  readonly state: TenantState;
  readonly since: Date;
  readonly closingBy: 'person' | 'operator' | null;
  readonly graceEndsAt: Date | null;
}

export async function ownTenantState(trx: TenantTransaction): Promise<OwnTenantState> {
  const { rows } = await sql<{
    state: TenantState;
    state_since: Date;
    closing_by: 'person' | 'operator' | null;
    grace_ends_at: Date | null;
  }>`select state, state_since, closing_by, grace_ends_at from platform.own_tenant_state()`.execute(
    trx,
  );
  const row = rows[0]!;
  return {
    state: row.state,
    since: row.state_since,
    closingBy: row.closing_by,
    graceEndsAt: row.grace_ends_at,
  };
}

/**
 * Whether a person may enter a tenant closing or retained (TL-A): what they hold at the environment,
 * since those who hold it are who must decide, take the export, or answer for a hold.
 */
export async function mayEnterWhileClosing(
  trx: TenantTransaction,
  principalId: string,
): Promise<boolean> {
  const facts = await loadFacts(trx, principalId, { kind: 'tenant' });
  if (!facts) return false;
  const holds = (permission: Permission) => decide(permission, facts).allowed;
  return (
    holds('close_environment') ||
    holds('hold') ||
    (holds('export_environment') && holds('export_audit'))
  );
}

/** What a closure was begun with (ADM-029): an export taken, one refused, or the operator's notice. */
export type ClosureOffer =
  { readonly export: string } | { readonly declined: true } | { readonly notice: string };

/**
 * Begins 30 days of grace (ADM-030). Whoever may not enter loses their session here, in the same act,
 * rather than at the next thing they try (TL-A).
 */
export async function startClosing(
  trx: TenantTransaction,
  tenant: Tenant,
  offer: ClosureOffer,
): Promise<void> {
  await change(trx, tenant, 'closing', 'notice' in offer ? offer.notice : null);
  const own = await ownClosure(trx, tenant);
  await recordEvent(trx, {
    kind: 'tenant.closing',
    detail: { graceEndsAt: own.toISOString(), ...offer },
  });
  const { rows: people } = await sql<{ principal_id: string }>`
    select distinct principal_id from session`.execute(trx);
  for (const { principal_id } of people) {
    if (!(await mayEnterWhileClosing(trx, principal_id))) {
      await trx.deleteFrom('session').where('principal_id', '=', principal_id).execute();
    }
  }
}

/** The grace period's end: read by the steward as well, whose role is the tenant's here. */
const ownClosure = async (trx: TenantTransaction, tenant: Tenant): Promise<Date> => {
  const { rows } = await sql<{ grace_ends_at: Date }>`
    select grace_ends_at from platform.own_tenant_state()`.execute(trx);
  const ends = rows[0]?.grace_ends_at;
  if (!ends) throw new Error(`${tenant.id} has no grace period`);
  return ends;
};

/**
 * Gives up a closure, at any point before deletion begins, and nothing is lost (ADM-030). What the
 * clock would have taken has its time back, an export kept for the closure among it.
 */
export async function cancelClosing(trx: TenantTransaction, tenant: Tenant): Promise<void> {
  const since = await change(trx, tenant, 'cancelled', null);
  // Back to a suspension, the time is credited when that is lifted, from when it began.
  if ((await ownTenantState(trx)).state === 'active') await moveClocksOn(trx, since);
  await recordEvent(trx, { kind: 'tenant.closure_cancelled' });
}

/**
 * Moves a closing tenant on, once its 30 days are over (TL-G, TL-H): to `retained` while anything is
 * held, whatever else that keeps, and to `deleting` once nothing is. Under the lock a hold shares, so a
 * hold placed as this runs either stops it or is refused, and is never reported placed and then purged.
 * Answers the state it left the tenant in.
 */
export async function advanceClosure(
  trx: TenantTransaction,
  tenant: Tenant,
): Promise<'closing' | 'retained' | 'deleting'> {
  await excludeDeletionDependants(trx);
  const own = await ownTenantState(trx);
  if (own.state !== 'closing' && own.state !== 'retained') {
    throw new TenantStateRefused(`The tenant is ${own.state}`);
  }
  if (own.state === 'closing' && (own.graceEndsAt?.getTime() ?? Infinity) > Date.now()) {
    return 'closing';
  }
  const { rows } = await sql<{ holds: number }>`
    select count(*)::int as holds from legal_hold h
     where not exists (select from legal_hold_release r where r.hold_id = h.id)`.execute(trx);
  const holds = rows[0]!.holds;
  if (holds > 0) {
    if (own.state === 'closing') {
      await change(trx, tenant, 'retained', null);
      await recordEvent(trx, { kind: 'tenant.retained', detail: { holds } });
    }
    return 'retained';
  }
  const { rows: taken } = await sql<{ taken: boolean }>`
    select exists (select 1 from tenant_export
                    where scope = 'tenant' and state = 'done'
                      and requested_at >= ${own.graceEndsAt}::timestamptz
                                          - make_interval(days => ${GRACE_DAYS + 1})) as taken`.execute(
    trx,
  );
  await change(trx, tenant, 'deleting', null);
  await recordEvent(trx, { kind: 'tenant.closed', detail: { exportTaken: taken[0]!.taken } });
  return 'deleting';
}

/** What a page needs to say where an environment stands (TL-E). */
export async function closureFacts(
  trx: TenantTransaction,
): Promise<OwnTenantState & { readonly name: string; readonly holds: number }> {
  const own = await ownTenantState(trx);
  const profile = await trx.selectFrom('profile').select('display_name').executeTakeFirstOrThrow();
  const { rows } = await sql<{ holds: number }>`
    select count(*)::int as holds from legal_hold h
     where not exists (select from legal_hold_release r where r.hold_id = h.id)`.execute(trx);
  return { ...own, name: profile.display_name, holds: rows[0]!.holds };
}

/**
 * Whether this is a whole export asked for within the last so many hours (ADM-029): the moment it holds,
 * which no clock moves, as a suspension or a cancelled closure moves its `finished_at`.
 */
export async function isRecentWholeExport(
  trx: TenantTransaction,
  id: string,
  hours: number,
): Promise<boolean> {
  const { rows } = await sql<{ id: string }>`
    select id from tenant_export
     where id = ${id} and scope = 'tenant' and state = 'done'
       and requested_at >= now() - make_interval(hours => ${hours})`.execute(trx);
  return rows.length > 0;
}
