import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/** A connection's runs in a period (the DG plan, pre-flight 12): how Diagnostics shows a source down. */
export interface ConnectionRuns {
  readonly connection: string;
  readonly runs: number;
  readonly failed: number;
  /** Failed by `timeout`: the query timing out ADM-037 names. */
  readonly timedOut: number;
  readonly lastRunAt: Date;
  /** Whether its latest run failed: the source down, as far as the product knows (ADM-021). */
  readonly lastFailed: boolean;
  /** The latest failure's code. */
  readonly lastFailure: string | null;
}

/** Every connection run on since `since`, by id; throttled runs are not the source's doing. */
export async function connectionRunsSince(
  trx: TenantTransaction,
  since: Date,
): Promise<ConnectionRuns[]> {
  const { rows } = await sql<{
    connection: string;
    runs: string;
    failed: string;
    timed_out: string;
    last_run_at: Date;
    last_outcome: string;
    last_failure: string | null;
  }>`
    select connection_id as connection,
           count(*) as runs,
           count(*) filter (where outcome = 'failed') as failed,
           count(*) filter (where outcome = 'failed' and failure = 'timeout') as timed_out,
           max(at) as last_run_at,
           (array_agg(outcome order by at desc, id desc))[1] as last_outcome,
           (array_agg(failure order by at desc, id desc)
              filter (where outcome = 'failed'))[1] as last_failure
      from query_run
     where connection_id is not null and at >= ${since} and outcome <> 'throttled'
     group by connection_id
     order by connection_id`.execute(trx);
  return rows.map((row) => ({
    connection: row.connection,
    runs: Number(row.runs),
    failed: Number(row.failed),
    timedOut: Number(row.timed_out),
    lastRunAt: row.last_run_at,
    lastFailed: row.last_outcome === 'failed',
    lastFailure: row.last_failure,
  }));
}
