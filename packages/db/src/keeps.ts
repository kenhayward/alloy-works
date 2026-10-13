import { sql } from 'kysely';
import { labelled, labels, recordEvent } from './audit.js';
import { shareDeletion } from './deletion.js';
import type { TenantTransaction } from './tables.js';

/**
 * **Retention keeps** (lifecycle.md, "Retention"; the DL plan, DL-G): a minimum, in days, declared by
 * a tenant administrator per kind, per space, or per kind in a space. Every keep reaching an artifact
 * applies, and the longest wins: deletion is refused until it has passed since the latest version.
 * Insert-only (0086): the latest row per key is in force, null days clearing it. Who may - `administer`
 * at the tenant - is the caller's to decide. Not `retention.ts`, which is iterations'.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The kinds a keep names: those that delete (DL-A). */
export const KEPT_KINDS = ['component', 'document'] as const;
export type KeptKind = (typeof KEPT_KINDS)[number];

/** What a keep is declared for: a kind, a space, or a kind in a space, never neither. */
export interface KeepKey {
  readonly kind: KeptKind | null;
  readonly space: string | null;
}

/** The longest keep a schema stores (0086): a hundred years. */
export const MAX_KEEP_DAYS = 36_500;

/** Whether this tenant stores keeps yet (0086): a migration's test runs today's code on older ones. */
async function keepsStored(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('retention_keep') is not null as present`.execute(trx);
  return rows[0]?.present === true;
}

/** Each key's latest row, as a subquery: the keeps in force are those with days. */
const LATEST = sql`(select distinct on (kind, space_id) kind, space_id, days, by, at
  from retention_keep order by kind, space_id, id desc)`;

export type KeepAnswer = {
  readonly answer: 'changed' | 'unchanged' | 'key.invalid' | 'days.invalid' | 'space.missing';
};

/**
 * Sets a keep, or clears it with null days (LIF-019). Setting what is in force changes nothing and
 * records nothing. Audited as `retention.changed`, `{ kind, space, days }`, with the space's name.
 */
export async function setKeep(
  trx: TenantTransaction,
  input: KeepKey & { readonly days: number | null; readonly by: string },
): Promise<KeepAnswer> {
  const { kind, space, days } = input;
  if (kind === null && space === null) return { answer: 'key.invalid' };
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > MAX_KEEP_DAYS)) {
    return { answer: 'days.invalid' };
  }
  // A deletion's dependant (DL-D): set before a delete reads the keeps, or after it. Then the keeps'
  // own lock, so two changes at once each see the other.
  await shareDeletion(trx);
  await sql`select pg_advisory_xact_lock(hashtextextended('alloy-works:retention:' || current_schema(), 0))`.execute(
    trx,
  );
  let spaceName: string | null = null;
  if (space !== null) {
    const row = UUID.test(space)
      ? await trx.selectFrom('space').select('name').where('id', '=', space).executeTakeFirst()
      : undefined;
    if (!row) return { answer: 'space.missing' };
    spaceName = row.name;
  }
  const current = await trx
    .selectFrom('retention_keep')
    .select('days')
    .where(kind === null ? sql<boolean>`kind is null` : sql<boolean>`kind = ${kind}`)
    .where(space === null ? sql<boolean>`space_id is null` : sql<boolean>`space_id = ${space}`)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  if ((current?.days ?? null) === days) return { answer: 'unchanged' };
  await trx
    .insertInto('retention_keep')
    .values({ kind, space_id: space, days, by: input.by })
    .execute();
  await recordEvent(
    trx,
    {
      kind: 'retention.changed',
      subject: { kind: 'retention' },
      space,
      detail: { kind, space, days },
    },
    labels(labelled('space', spaceName, space)),
  );
  return { answer: 'changed' };
}

/** A keep in force, as Administration lists it. */
export interface Keep {
  readonly kind: KeptKind | null;
  readonly space: { readonly id: string; readonly name: string } | null;
  readonly days: number;
  readonly by: { readonly id: string; readonly name: string | null };
  readonly at: Date;
}

/** The keeps in force: each kind's first, then by space and kind. */
export async function listKeeps(trx: TenantTransaction): Promise<readonly Keep[]> {
  if (!(await keepsStored(trx))) return [];
  const { rows } = await sql<{
    kind: KeptKind | null;
    space_id: string | null;
    space_name: string | null;
    days: number;
    by: string;
    by_name: string | null;
    at: Date;
  }>`select k.kind, k.space_id, s.name as space_name, k.days, k.by,
            coalesce(p.display_name, p.email) as by_name, k.at
       from ${LATEST} k
       left join space s on s.id = k.space_id
       join principal p on p.id = k.by
      where k.days is not null
      order by k.space_id is not null, s.name, k.space_id, k.kind nulls first`.execute(trx);
  return rows.map((row) => ({
    kind: row.kind,
    space: row.space_id === null ? null : { id: row.space_id, name: row.space_name! },
    days: row.days,
    by: { id: row.by, name: row.by_name },
    at: row.at,
  }));
}

/**
 * When the longest keep reaching the artifact passes: its latest version's time and the keep's days,
 * whether or not that is past. Undefined where no keep reaches it.
 */
export async function keptUntil(
  trx: TenantTransaction,
  artifactId: string,
): Promise<Date | undefined> {
  return (await keep(trx, artifactId))?.until;
}

/** When the longest keep on it passes, while it has not yet (DL-G); undefined once it has, or none. */
export async function keptNow(
  trx: TenantTransaction,
  artifactId: string,
): Promise<Date | undefined> {
  const found = await keep(trx, artifactId);
  return found?.live ? found.until : undefined;
}

async function keep(
  trx: TenantTransaction,
  artifactId: string,
): Promise<{ until: Date; live: boolean } | undefined> {
  if (!UUID.test(artifactId) || !(await keepsStored(trx))) return undefined;
  // A day as 24 hours, so a keep's end is the same whatever the session's zone.
  const { rows } = await sql<{ until: Date | null; live: boolean | null }>`
    with reach as (
      select max(k.days) as days from ${LATEST} k, artifact a
       where a.id = ${artifactId} and k.days is not null
         and (k.kind is null or k.kind = a.kind)
         and (k.space_id is null or k.space_id = a.space_id)
    ), latest as (
      select v.created_at from artifact_version v where v.artifact_id = ${artifactId}
       order by v.revision_no desc, v.version_no desc limit 1
    )
    select latest.created_at + make_interval(hours => reach.days * 24) as until,
           latest.created_at + make_interval(hours => reach.days * 24) > clock_timestamp() as live
      from reach, latest where reach.days is not null`.execute(trx);
  const row = rows[0];
  return row?.until ? { until: row.until, live: row.live === true } : undefined;
}
