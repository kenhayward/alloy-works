import { sql } from 'kysely';
import { recordEvent } from './audit.js';
import { personView, type PersonView } from './person-view.js';
import type { TenantTransaction } from './tables.js';

/**
 * Rate limits (generation.md, "Cost"; the G6 plan, G6-A; GEN-035): how many runs a person may start
 * an hour, the environment's and one person's own. Who may set one is the route's to decide; every
 * one set is audited. Counted over the requester's runs, the endpoint test's excluded.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The most a limit may be. */
export const RUNS_AN_HOUR_MOST = 100_000;

export interface GenerationLimits {
  /** The environment's runs an hour per person; null, unlimited. */
  readonly perHour: number | null;
  readonly people: readonly { readonly person: PersonView; readonly perHour: number }[];
}

/** Whether this schema holds limits: one before 0132 has none, and nothing is limited. */
async function limitsStored(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{ found: boolean }>`
    select to_regclass(current_schema() || '.generation_limit') is not null as found`.execute(trx);
  return rows[0]?.found === true;
}

export async function readGenerationLimits(trx: TenantTransaction): Promise<GenerationLimits> {
  if (!(await limitsStored(trx))) return { perHour: null, people: [] };
  const tenant = await sql<{ per_hour: number | null }>`
    select per_hour from generation_limit`.execute(trx);
  const people = await sql<{
    principal_id: string;
    per_hour: number;
    display_name: string | null;
    kind: string | null;
  }>`
    select l.principal_id, l.per_hour, p.display_name, p.kind
      from generation_limit_person l join principal p on p.id = l.principal_id
     order by l.set_at desc, l.principal_id`.execute(trx);
  return {
    perHour: tenant.rows[0]?.per_hour ?? null,
    people: people.rows.map((row) => ({
      person: personView(row.principal_id, row.display_name, row.kind),
      perHour: row.per_hour,
    })),
  };
}

/** Sets the environment's limit; null lifts it. */
export async function setGenerationLimit(
  trx: TenantTransaction,
  perHour: number | null,
  by: string,
): Promise<void> {
  await sql`insert into generation_limit (only_one, per_hour, set_by) values (true, ${perHour}, ${by})
    on conflict (only_one) do update set per_hour = excluded.per_hour, set_by = excluded.set_by,
      set_at = now()`.execute(trx);
  await recordEvent(trx, {
    kind: 'generation.limit_set',
    subject: { kind: 'tenant' },
    detail: { perHour },
  });
}

/** Sets one person's own limit; null removes it, the environment's then theirs. False: no such person. */
export async function setPersonLimit(
  trx: TenantTransaction,
  principal: string,
  perHour: number | null,
  by: string,
): Promise<boolean> {
  if (!UUID.test(principal)) return false;
  const { rows } = await sql<{
    id: string;
  }>`select id from principal where id = ${principal}`.execute(trx);
  if (rows.length === 0) return false;
  if (perHour === null) {
    await sql`delete from generation_limit_person where principal_id = ${principal}`.execute(trx);
  } else {
    await sql`insert into generation_limit_person (principal_id, per_hour, set_by)
      values (${principal}, ${perHour}, ${by})
      on conflict (principal_id) do update set per_hour = excluded.per_hour,
        set_by = excluded.set_by, set_at = now()`.execute(trx);
  }
  await recordEvent(trx, {
    kind: 'generation.limit_set',
    subject: { kind: 'principal', id: principal },
    detail: { perHour },
  });
  return true;
}

/** Removes a person's own limit as they are erased. */
export async function erasePersonLimit(trx: TenantTransaction, principal: string): Promise<void> {
  if (!(await limitsStored(trx))) return;
  await sql`delete from generation_limit_person where principal_id = ${principal}`.execute(trx);
}

/**
 * Whether a person is over their hourly limit, and when a run is theirs again: undefined where they
 * may start one. With `lock`, it holds the person's lock to the transaction's end, so runs started at
 * once are counted one after another (G6-A).
 */
export async function rateRefusal(
  trx: TenantTransaction,
  principal: string,
  options: { readonly lock?: boolean } = {},
): Promise<{ readonly perHour: number; readonly resetsAt: Date } | undefined> {
  if (!UUID.test(principal) || !(await limitsStored(trx))) return undefined;
  if (options.lock === true) {
    await sql`select pg_advisory_xact_lock(hashtextextended('generation_limit:' || ${principal}, 0))`.execute(
      trx,
    );
  }
  const { rows } = await sql<{ per_hour: number | null }>`
    select coalesce(
      (select per_hour from generation_limit_person where principal_id = ${principal}),
      (select per_hour from generation_limit)) as per_hour`.execute(trx);
  const perHour = rows[0]?.per_hour ?? null;
  if (perHour === null) return undefined;
  const counted = await sql<{ started_at: Date }>`
    select started_at from generation_run
     where requested_by = ${principal} and purpose <> 'test'
       and started_at > now() - interval '1 hour'
     order by started_at`.execute(trx);
  const count = counted.rows.length;
  if (count < perHour) return undefined;
  // Free again once enough of the oldest have aged out that one more fits.
  const freeing = counted.rows[count - perHour]!;
  return { perHour, resetsAt: new Date(new Date(freeing.started_at).getTime() + 3_600_000) };
}
