import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Spend as a trend (generation.md, "Cost"; the G6 plan, G6-F; towards ADM-033): model runs by UTC
 * month and purpose, their tokens and cost by currency, and query runs by month, over the months
 * asked, the oldest first. Runs are never deleted, so every month the tenant has run is here; query
 * runs are kept 13 months.
 */

export const USAGE_MONTHS_MOST = 13;

export interface ModelMonth {
  readonly month: string;
  readonly purpose: string;
  readonly runs: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensCached: number;
  readonly costs: readonly { readonly currency: string; readonly micros: bigint }[];
}

export interface QueryMonth {
  readonly month: string;
  readonly runs: number;
  readonly rows: number;
  readonly bytes: number;
}

export async function usageByMonth(
  trx: TenantTransaction,
  months: number,
): Promise<{ readonly models: ModelMonth[]; readonly queries: QueryMonth[] }> {
  const count = Math.max(1, Math.min(USAGE_MONTHS_MOST, Math.trunc(months)));
  const since = sql`(date_trunc('month', now() at time zone 'utc')
    - make_interval(months => ${count - 1})) at time zone 'utc'`;
  const { rows: model } = await sql<{
    month: string;
    purpose: string;
    currency: string;
    runs: string;
    tokens_in: string | null;
    tokens_out: string | null;
    tokens_cached: string | null;
    micros: string | null;
  }>`
    select to_char(started_at at time zone 'utc', 'YYYY-MM') as month, purpose,
           endpoint ->> 'currency' as currency, count(*) as runs,
           sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out,
           sum((to_jsonb(generation_run) ->> 'tokens_cached')::integer) as tokens_cached,
           sum(cost_micros) as micros
      from generation_run
     where started_at >= ${since} and outcome <> 'running'
     group by 1, 2, 3 order by 1, 2, 3`.execute(trx);
  const models = new Map<string, ModelMonth & { costs: { currency: string; micros: bigint }[] }>();
  for (const row of model) {
    const key = `${row.month} ${row.purpose}`;
    const was = models.get(key) ?? {
      month: row.month,
      purpose: row.purpose,
      runs: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokensCached: 0,
      costs: [],
    };
    models.set(key, {
      ...was,
      runs: was.runs + Number(row.runs),
      tokensIn: was.tokensIn + Number(row.tokens_in ?? 0),
      tokensOut: was.tokensOut + Number(row.tokens_out ?? 0),
      tokensCached: was.tokensCached + Number(row.tokens_cached ?? 0),
      costs: [...was.costs, { currency: row.currency, micros: BigInt(row.micros ?? '0') }],
    });
  }
  const { rows: query } = await sql<{ month: string; runs: string; rows: string; bytes: string }>`
    select to_char(at at time zone 'utc', 'YYYY-MM') as month, count(*) as runs,
           coalesce(sum(row_count), 0) as rows, coalesce(sum(bytes), 0) as bytes
      from query_run where at >= ${since}
     group by 1 order by 1`.execute(trx);
  return {
    models: [...models.values()],
    queries: query.map((row) => ({
      month: row.month,
      runs: Number(row.runs),
      rows: Number(row.rows),
      bytes: Number(row.bytes),
    })),
  };
}
