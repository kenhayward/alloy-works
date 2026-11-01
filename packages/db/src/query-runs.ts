import { runsAtOnce } from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/** An act that runs a query (the R18 plan, R18-D). */
export type QueryAct = 'sample' | 'resolve' | 'check' | 'creation' | 'vocabulary';

export interface QueryRun {
  readonly act: QueryAct;
  readonly principal: string | null;
  /** The connection it ran on; none for a stored result queried as a source (0117; R21-A). */
  readonly connection: string | null;
  /** The query definition it ran; none for a sample of a draft not yet saved. */
  readonly queryDefinition: string | null;
  /** The document it ran for; a creation's by the id it makes. */
  readonly document: string | null;
  readonly durationMs: number;
  readonly rows: number | null;
  readonly bytes: number | null;
  readonly outcome: 'ran' | 'failed' | 'throttled';
  readonly failure: string | null;
}

export interface StoredQueryRun extends QueryRun {
  readonly id: string;
  readonly at: Date;
}

/**
 * **Takes a slot for a run** (DAT-071; the R18 plan, R18-B), or answers none where the tenant's runs
 * at once are all in flight. Under the tenant's advisory lock, so any number of service instances share
 * the count; a slot whose lease lapsed - its process died - is cleared first. Given back by
 * `giveQuerySlot` once the run is answered.
 */
export async function takeQuerySlot(
  trx: TenantTransaction,
  input: { readonly leaseMs: number },
): Promise<string | undefined> {
  await sql`select pg_advisory_xact_lock(hashtextextended(current_schema() || ':query_slot', 0))`.execute(
    trx,
  );
  const limit = (await concurrentRuns(trx)) ?? runsAtOnce.default;
  await trx
    .deleteFrom('query_slot')
    .where('lease_until', '<=', sql<Date>`now()`)
    .execute();
  const { count } = await trx
    .selectFrom('query_slot')
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .executeTakeFirstOrThrow();
  if (Number(count) >= limit) return undefined;
  const row = await trx
    .insertInto('query_slot')
    .values({ lease_until: sql<Date>`now() + make_interval(secs => ${input.leaseMs / 1000})` })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Gives a slot back; one already lapsed and cleared is nothing to give. */
export async function giveQuerySlot(trx: TenantTransaction, slot: string): Promise<void> {
  await trx.deleteFrom('query_slot').where('id', '=', slot).execute();
}

/** The tenant's runs at once, null where it has not lowered the default. */
async function concurrentRuns(trx: TenantTransaction): Promise<number | null> {
  const row = await trx
    .selectFrom('data_policy')
    .select(sql<number | null>`(to_jsonb(data_policy) ->> 'concurrent_runs')::integer`.as('n'))
    .executeTakeFirst();
  return row?.n ?? null;
}

/** Records a run (DAT-053; R18-D), throttled ones too. */
export async function recordQueryRun(trx: TenantTransaction, run: QueryRun): Promise<string> {
  const row = await trx
    .insertInto('query_run')
    .values({
      act: run.act,
      principal_id: run.principal,
      connection_id: run.connection,
      query_definition_id: run.queryDefinition,
      document_id: run.document,
      duration_ms: Math.max(0, Math.round(run.durationMs)),
      row_count: run.rows,
      bytes: run.bytes,
      outcome: run.outcome,
      failure: run.failure,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface UsageTotal {
  readonly id: string;
  readonly title: string | null;
  readonly runs: number;
  readonly failed: number;
  readonly throttled: number;
  readonly durationMs: number;
  readonly rows: number;
  readonly bytes: number;
}

/** The runs in a period (R18-E), totalled by query definition and by document, most time first. */
export async function queryUsage(
  trx: TenantTransaction,
  period: { readonly from: Date; readonly to: Date },
): Promise<{ readonly byQueryDefinition: UsageTotal[]; readonly byDocument: UsageTotal[] }> {
  const totals = async (column: 'query_definition_id' | 'document_id') => {
    const rows = await trx
      .selectFrom('query_run as r')
      .select([
        `r.${column} as id`,
        sql<string>`count(*)`.as('runs'),
        sql<string>`count(*) filter (where r.outcome = 'failed')`.as('failed'),
        sql<string>`count(*) filter (where r.outcome = 'throttled')`.as('throttled'),
        sql<string>`coalesce(sum(r.duration_ms), 0)`.as('duration'),
        sql<string>`coalesce(sum(r.row_count), 0)`.as('rows'),
        sql<string>`coalesce(sum(r.bytes), 0)`.as('bytes'),
        sql<string | null>`(select v.content ->> 'title' from artifact_version v
          where v.artifact_id = r.${sql.ref(column)}
          order by v.revision_no desc, v.version_no desc limit 1)`.as('title'),
      ])
      .where('r.at', '>=', period.from)
      .where('r.at', '<', period.to)
      .where(`r.${column}`, 'is not', null)
      .groupBy(`r.${column}`)
      .orderBy(sql`sum(r.duration_ms)`, 'desc')
      .execute();
    return rows.map((row) => ({
      id: row.id as string,
      title: row.title,
      runs: Number(row.runs),
      failed: Number(row.failed),
      throttled: Number(row.throttled),
      durationMs: Number(row.duration),
      rows: Number(row.rows),
      bytes: Number(row.bytes),
    }));
  };
  return {
    byQueryDefinition: await totals('query_definition_id'),
    byDocument: await totals('document_id'),
  };
}

/** The most runs one CSV holds: a period holding more is asked for in parts (the final review). */
export const QUERY_RUNS_MOST = 100_000;

/** Every run in a period, oldest first, for the CSV (R18-E); at most `limit`. */
export async function queryRunsBetween(
  trx: TenantTransaction,
  period: { readonly from: Date; readonly to: Date; readonly limit?: number },
): Promise<StoredQueryRun[]> {
  const rows = await trx
    .selectFrom('query_run')
    .selectAll()
    .where('at', '>=', period.from)
    .where('at', '<', period.to)
    .orderBy('at')
    .orderBy('id')
    .limit(period.limit ?? QUERY_RUNS_MOST)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    act: row.act as QueryAct,
    principal: row.principal_id,
    connection: row.connection_id,
    queryDefinition: row.query_definition_id,
    document: row.document_id,
    durationMs: row.duration_ms,
    rows: row.row_count,
    bytes: row.bytes === null ? null : Number(row.bytes),
    outcome: row.outcome as QueryRun['outcome'],
    failure: row.failure,
  }));
}

/** Sweeps every run older than 13 months (R18-D), answering how many went. */
export async function sweepQueryRuns(trx: TenantTransaction): Promise<number> {
  const gone = await trx
    .deleteFrom('query_run')
    .where('at', '<=', sql<Date>`now() - interval '13 months'`)
    .executeTakeFirst();
  return Number(gone.numDeletedRows);
}
