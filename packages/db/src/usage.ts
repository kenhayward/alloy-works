import {
  daysToCount,
  MEASURED_OPERATIONS,
  USAGE_KEPT_DAYS,
  type UsageMeasure,
} from '@alloy-works/domain';
import { sql, type RawBuilder } from 'kysely';
import type { TenantTransaction } from './tables.js';

/** A measure's amount on a UTC day (ADR-0100). */
export interface UsageDay {
  /** `YYYY-MM-DD`. */
  readonly day: string;
  readonly measure: UsageMeasure;
  readonly amount: number;
}

const utcDay = (column: RawBuilder<unknown>) =>
  sql`to_char((${column} at time zone 'utc')::date, 'YYYY-MM-DD')`;

/** A day's first instant in UTC, whatever the session's time zone. */
const start = (day: string) => sql`(${day}::timestamp at time zone 'utc')`;

const REFERENCE_SEARCHES = MEASURED_OPERATIONS['searchReferenceSource']!;

/** What happened each day, from each record's own table: `[day, amount]` rows in `[from, to)`. */
const COUNTS: Record<
  Exclude<UsageMeasure, `${string}Bytes`>,
  (from: string, to: string) => RawBuilder<{ day: string; amount: string }>
> = {
  publications: (from, to) => sql`
    select ${utcDay(sql.ref('published_at'))} as day, count(*) as amount from publication
    where published_at >= ${start(from)} and published_at < ${start(to)} group by 1`,
  assets: (from, to) => sql`
    select ${utcDay(sql.ref('finished_at'))} as day, count(*) as amount from asset_upload
    where state = 'ready' and finished_at >= ${start(from)} and finished_at < ${start(to)} group by 1`,
  mail: (from, to) => sql`
    select ${utcDay(sql.ref('created_at'))} as day, count(*) as amount from email_delivery
    where state = 'sent' and created_at >= ${start(from)} and created_at < ${start(to)} group by 1`,
  webhooks: (from, to) => sql`
    select ${utcDay(sql.ref('created_at'))} as day, count(*) as amount from webhook_delivery
    where state = 'delivered' and created_at >= ${start(from)} and created_at < ${start(to)} group by 1`,
  translationJobs: (from, to) => sql`
    select ${utcDay(sql.ref('at'))} as day, count(*) as amount from translation_job
    where at >= ${start(from)} and at < ${start(to)} group by 1`,
  // Answered searches: neither the caller's mistake, the server's, nor refused by the environment.
  referenceSearches: (from, to) => sql`
    select ${utcDay(sql.ref('at'))} as day,
      sum(requests - client_errors - server_errors - refused) as amount
    from capability_usage
    where capability = ${REFERENCE_SEARCHES} and at >= ${start(from)} and at < ${start(to)} group by 1`,
  embeddingRuns: (from, to) => sql`
    select ${utcDay(sql.ref('started_at'))} as day, count(*) as amount from generation_run
    where purpose = 'embedding' and started_at >= ${start(from)} and started_at < ${start(to)} group by 1`,
  queryMs: (from, to) => sql`
    select ${utcDay(sql.ref('at'))} as day, sum(duration_ms) as amount from query_run
    where at >= ${start(from)} and at < ${start(to)} group by 1`,
};

/** What is held now, each owner's recorded size (ADR-0100, decision 4). */
const SAMPLES: Record<Extract<UsageMeasure, `${string}Bytes`>, RawBuilder<{ amount: string }>> = {
  databaseBytes: sql`
    select coalesce(sum(pg_total_relation_size(c.oid)), 0) as amount from pg_class c
    where c.relnamespace = current_schema()::regnamespace and c.relkind in ('r', 'm')`,
  publicationBytes: sql`select coalesce(sum(bytes), 0) as amount from publication_output`,
  assetBytes: sql`
    select (select coalesce(sum(bytes), 0) from asset_upload where state = 'ready')
      + (select coalesce(sum(bytes), 0) from asset_derivative) as amount`,
  // An abandoned or failed import has removed its objects (IMP-008).
  importBytes: sql`
    select (select coalesce(sum(bytes), 0) from import where state not in ('abandoned', 'failed'))
      + (select coalesce(sum(a.bytes), 0) from import_asset a join import i on i.id = a.import_id
         where i.state not in ('abandoned', 'failed')) as amount`,
  exportBytes: sql`
    select (select coalesce(sum(bytes), 0) from tenant_export where state = 'done')
      + (select coalesce(sum(bytes), 0) from audit_export where state = 'done') as amount`,
};

const dayOf = (at: Date) => at.toISOString().slice(0, 10);

/**
 * Counts the environment's usage (ADR-0100): once a UTC day, the days `daysToCount` names from each
 * record's own table, and today's samples; days past 13 months forgotten. Answers whether it counted,
 * or had already today.
 */
export async function countUsage(trx: TenantTransaction, now: Date = new Date()): Promise<boolean> {
  const today = dayOf(now);
  const done = await trx
    .selectFrom('usage_day')
    .select('day')
    .where('day', '=', today)
    .where('measure', '=', 'databaseBytes')
    .executeTakeFirst();
  if (done) return false;
  const last = await sql<{ day: string | null }>`
    select to_char(max(day), 'YYYY-MM-DD') as day from usage_day where day < ${today}::date`.execute(
    trx,
  );
  const days = daysToCount(last.rows[0]?.day ?? null, today);
  if (days.length > 0) {
    const from = days[0]!;
    const measures = Object.keys(COUNTS) as (keyof typeof COUNTS)[];
    await trx
      .deleteFrom('usage_day')
      .where('day', '>=', from)
      .where('day', '<', today)
      .where('measure', 'in', measures)
      .execute();
    for (const measure of measures) {
      const { rows } = await COUNTS[measure](from, today).execute(trx);
      const counted = rows.filter((row) => Number(row.amount) > 0);
      if (counted.length === 0) continue;
      await trx
        .insertInto('usage_day')
        .values(counted.map((row) => ({ day: row.day, measure, amount: Number(row.amount) })))
        .execute();
    }
  }
  for (const [measure, held] of Object.entries(SAMPLES)) {
    const { rows } = await held.execute(trx);
    await trx
      .insertInto('usage_day')
      .values({ day: today, measure, amount: Number(rows[0]?.amount ?? 0) })
      .onConflict((conflict) =>
        conflict
          .columns(['day', 'measure'])
          .doUpdateSet((row) => ({ amount: row.ref('excluded.amount') })),
      )
      .execute();
  }
  await sql`delete from usage_day where day < ${today}::date - ${USAGE_KEPT_DAYS}::int`.execute(
    trx,
  );
  return true;
}

/** Each measure's amount by day, from `from` to `to` inclusive (`YYYY-MM-DD`), by day then measure. */
export async function usageDays(
  trx: TenantTransaction,
  from: string,
  to: string,
): Promise<UsageDay[]> {
  const { rows } = await sql<{ day: string; measure: UsageMeasure; amount: string }>`
    select to_char(day, 'YYYY-MM-DD') as day, measure, amount from usage_day
    where day >= ${from}::date and day <= ${to}::date order by day, measure`.execute(trx);
  return rows.map((row) => ({ day: row.day, measure: row.measure, amount: Number(row.amount) }));
}
