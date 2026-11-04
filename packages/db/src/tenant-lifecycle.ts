import {
  decide,
  GRACE_DAYS,
  type AuditContext,
  type Permission,
  type TenantState,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFacts } from './access-facts.js';
import { AUDIT_SETTING, auditContextSetting, recordEvent } from './audit.js';
import { assertTenantRole, tenantNames } from './names.js';
import { excludeDeletionDependants } from './deletion.js';
import { PURGE_ATTEMPTS } from './tenant-purge.js';
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
/** Whether somebody outside this tenant could lift a suspension of it, other than the operator. */
export async function hasOrganisationToLift(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql`
    select 1 from platform.own_organisation_tenant()`.execute(trx);
  return rows.length > 0;
}

export async function suspendTenant(
  trx: TenantTransaction,
  tenant: Tenant,
  reason: string,
): Promise<void> {
  await change(trx, tenant, 'suspended', reason);
  await recordEvent(trx, { kind: 'tenant.suspended', detail: { reason } });
  await alsoInOrganisationLog(trx, tenant, 'suspended', reason);
}

type Named = Pick<Tenant, 'schema' | 'role'>;

/**
 * Work in another tenant, within this transaction, then back: both logs or neither (TL-L). The one
 * place a transaction changes role twice, and any login reaches only what it is already a member of.
 */
async function within<T>(
  trx: TenantTransaction,
  other: Named,
  context: AuditContext,
  work: () => Promise<T>,
): Promise<T> {
  const { rows } = await sql<{ role: string; path: string; audit: string | null }>`
    select current_user::text as role, current_setting('search_path') as path,
           current_setting(${AUDIT_SETTING}, true) as audit`.execute(trx);
  const was = rows[0]!;
  await sql`set local role ${sql.id(assertTenantRole(other.role))}`.execute(trx);
  await sql`select set_config('search_path', ${`${assertTenantRole(other.schema)}, extensions`}, true),
    set_config(${AUDIT_SETTING}, ${auditContextSetting(context)}, true)`.execute(trx);
  const answer = await work();
  await sql`set local role ${sql.id(assertTenantRole(was.role))}`.execute(trx);
  await sql`select set_config('search_path', ${was.path}, true),
    set_config(${AUDIT_SETTING}, ${was.audit ?? ''}, true)`.execute(trx);
  return answer;
}

/** Who the transaction is acting for, as an organisation's log may say it: never a person's name. */
const actingAs = async (trx: TenantTransaction): Promise<'environment' | 'operator' | 'system'> => {
  const { rows } = await sql<{ kind: string | null }>`
    select nullif(current_setting(${AUDIT_SETTING}, true), '')::jsonb ->> 'actorKind' as kind`.execute(
    trx,
  );
  const kind = rows[0]?.kind;
  if (kind === 'vendor') return 'operator';
  return kind === 'person' || kind === 'token' ? 'environment' : 'system';
};

type TenantChange =
  'suspended' | 'resumed' | 'closing' | 'closure_cancelled' | 'retained' | 'closed';

/**
 * A change to this tenant, in its organisation's log, which is what remains of it after it has gone
 * (TL-J, TL-L). Where it has no organisation's tenant, the tenant's own log is all there is.
 */
async function alsoInOrganisationLog(
  trx: TenantTransaction,
  tenant: Tenant,
  what: TenantChange,
  reason?: string,
): Promise<void> {
  const { rows } = await sql<{ schema_name: string; role_name: string; tenant_name: string }>`
    select schema_name, role_name, tenant_name
      from platform.organisation_log_of_own_tenant()`.execute(trx);
  const organisation = rows[0];
  if (!organisation) return;
  const by = await actingAs(trx);
  await within(
    trx,
    { schema: organisation.schema_name, role: organisation.role_name },
    { actorKind: 'system' },
    () =>
      recordEvent(
        trx,
        {
          kind: 'organisation.changed',
          subject: { kind: 'tenant' },
          detail: { tenant: tenant.id, change: what, by, ...(reason ? { reason } : {}) },
        },
        [{ role: 'subject', text: organisation.tenant_name }],
      ),
  );
}

/** What an organisation sees of its tenants: state and addresses, and never content (IAM-069). */
export interface OrganisationTenant {
  readonly id: string;
  readonly name: string;
  readonly state: TenantState;
  readonly since: Date;
  readonly closingBy: 'person' | 'operator' | null;
  readonly suspendedBy: 'person' | 'operator' | null;
  readonly graceEndsAt: Date | null;
  readonly hostnames: readonly string[];
}

export async function organisationTenants(
  trx: TenantTransaction,
): Promise<readonly OrganisationTenant[]> {
  const { rows } = await sql<{
    id: string;
    name: string;
    state: TenantState;
    state_since: Date;
    closing_by: 'person' | 'operator' | null;
    suspended_by: 'person' | 'operator' | null;
    grace_ends_at: Date | null;
    hostnames: string[];
  }>`select id, name, state, state_since, closing_by, suspended_by, grace_ends_at, hostnames
       from platform.organisation_tenants()`.execute(trx);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    state: row.state,
    since: row.state_since,
    closingBy: row.closing_by,
    suspendedBy: row.suspended_by,
    graceEndsAt: row.grace_ends_at,
    hostnames: row.hostnames,
  }));
}

/** A tenant of this organisation by id, or nothing: another's is no different from one not there. */
const organisationsOwn = async (trx: TenantTransaction, id: string) => {
  const found = (await organisationTenants(trx)).find((each) => each.id === id);
  if (!found) return undefined;
  const names = tenantNames(id);
  return { id, name: found.name, schema: names.schema, role: names.role };
};

const FROM_ORGANISATION: AuditContext = { actorKind: 'organisation' };

/**
 * An organisation's act on one of its tenants (TL-L), from a transaction in the organisation's tenant,
 * whose context names the person: an event there, and one in the target saying only that it was them.
 */
const eventInOrganisation = (
  trx: TenantTransaction,
  target: { readonly id: string; readonly name: string },
  change: TenantChange,
  reason?: string,
) =>
  recordEvent(
    trx,
    {
      kind: 'organisation.changed',
      subject: { kind: 'tenant' },
      detail: { tenant: target.id, change, by: 'organisation', ...(reason ? { reason } : {}) },
    },
    [{ role: 'subject', text: target.name }],
  );

export async function suspendFromOrganisation(
  trx: TenantTransaction,
  id: string,
  reason: string,
): Promise<'done' | 'missing'> {
  const target = await organisationsOwn(trx, id);
  if (!target) return 'missing';
  await change(trx, target, 'suspended', reason);
  const organisationEvent = await eventInOrganisation(trx, target, 'suspended', reason);
  await within(trx, target, FROM_ORGANISATION, () =>
    recordEvent(trx, { kind: 'tenant.suspended', detail: { reason, organisationEvent } }),
  );
  return 'done';
}

export async function liftFromOrganisation(
  trx: TenantTransaction,
  id: string,
): Promise<'done' | 'missing'> {
  const target = await organisationsOwn(trx, id);
  if (!target) return 'missing';
  const since = await change(trx, target, 'active', null);
  const organisationEvent = await eventInOrganisation(trx, target, 'resumed');
  await within(trx, target, FROM_ORGANISATION, async () => {
    const suspendedSeconds = await moveClocksOn(trx, since);
    await recordEvent(trx, {
      kind: 'tenant.resumed',
      detail: { suspendedSeconds, organisationEvent },
    });
  });
  return 'done';
}

export async function cancelClosureFromOrganisation(
  trx: TenantTransaction,
  id: string,
): Promise<'done' | 'missing'> {
  const target = await organisationsOwn(trx, id);
  if (!target) return 'missing';
  const since = await change(trx, target, 'cancelled', null);
  const organisationEvent = await eventInOrganisation(trx, target, 'closure_cancelled');
  await within(trx, target, FROM_ORGANISATION, async () => {
    if ((await ownTenantState(trx)).state === 'active') await moveClocksOn(trx, since);
    await recordEvent(trx, { kind: 'tenant.closure_cancelled', detail: { organisationEvent } });
  });
  return 'done';
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
  await alsoInOrganisationLog(trx, tenant, 'resumed');
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
  await alsoInOrganisationLog(trx, tenant, 'closing');
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
  await alsoInOrganisationLog(trx, tenant, 'closure_cancelled');
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
      await alsoInOrganisationLog(trx, tenant, 'retained');
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
  await alsoInOrganisationLog(trx, tenant, 'closed');
  // The steward's from here (TL-I). In this transaction, so deletion never begins with nobody to do it.
  await sql`insert into platform.job (tenant_id, kind, max_attempts)
            values (${tenant.id}, 'tenant_purge', ${PURGE_ATTEMPTS})`.execute(trx);
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
