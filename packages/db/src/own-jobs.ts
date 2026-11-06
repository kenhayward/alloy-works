import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/** Where a job is (the DG plan, pre-flight 8): waiting includes one waiting to be tried again. */
export type QueueState = 'waiting' | 'running' | 'done' | 'failed';

export interface OwnJobs {
  readonly kind: string;
  readonly state: QueueState;
  readonly jobs: number;
  readonly firstAt: Date;
  readonly lastAt: Date;
  /** The latest failure's code, for failed jobs alone. */
  readonly lastError: string | null;
}

/**
 * This environment's jobs by kind and state, since `since` or still to do, through the definer that
 * keeps the queue itself closed (ADR-0098): counts, times and codes, never a subject.
 */
export async function ownJobs(trx: TenantTransaction, since: Date): Promise<OwnJobs[]> {
  const { rows } = await sql<{
    kind: string;
    state: QueueState;
    jobs: string;
    first_at: Date;
    last_at: Date;
    last_error: string | null;
  }>`select * from platform.own_jobs(${since})`.execute(trx);
  return rows.map((row) => ({
    kind: row.kind,
    state: row.state,
    jobs: Number(row.jobs),
    firstAt: row.first_at,
    lastAt: row.last_at,
    lastError: row.last_error,
  }));
}
