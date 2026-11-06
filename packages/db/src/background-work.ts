import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/** How a run of background work in one tenant ended (the DG plan, DG-G). */
export type BackgroundOutcome = 'succeeded' | 'failed' | 'paused';

export interface BackgroundRun {
  /** The sweep or loop, by its function's name. */
  readonly work: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly outcome: BackgroundOutcome;
  /** A code alone, when it failed. */
  readonly failure?: string;
}

export interface BackgroundWork {
  readonly work: string;
  readonly outcome: BackgroundOutcome;
  readonly lastStartedAt: Date;
  readonly lastFinishedAt: Date;
  readonly failure: string | null;
  readonly failedAt: Date | null;
  readonly failures: number;
  readonly nextDueAt: Date | null;
}

/**
 * Records a run (pre-flight 9): one row per kind of work, the last failure kept after it clears, and
 * next due read from the gap between this run's start and the last's.
 */
export async function recordBackgroundWork(
  trx: TenantTransaction,
  run: BackgroundRun,
): Promise<void> {
  const failed = run.outcome === 'failed';
  const failure = failed ? (run.failure ?? 'failed') : null;
  await sql`
    insert into background_work
      (work, started_at, finished_at, outcome, failure, failed_at, failures)
    values (${run.work}, ${run.startedAt}, ${run.finishedAt}, ${run.outcome}, ${failure},
            ${failed ? run.finishedAt : null}, ${failed ? 1 : 0})
    on conflict (work) do update set
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      outcome = excluded.outcome,
      failure = coalesce(excluded.failure, background_work.failure),
      failed_at = coalesce(excluded.failed_at, background_work.failed_at),
      failures = case excluded.outcome
                   when 'failed' then background_work.failures + 1
                   when 'paused' then background_work.failures
                   else 0 end,
      next_due_at = case when excluded.started_at > background_work.started_at
                         then excluded.started_at + (excluded.started_at - background_work.started_at)
                         else background_work.next_due_at end`.execute(trx);
}

/** Every kind of work this tenant has seen run, by name. */
export async function backgroundWork(trx: TenantTransaction): Promise<BackgroundWork[]> {
  const rows = await trx.selectFrom('background_work').selectAll().orderBy('work').execute();
  return rows.map((row) => ({
    work: row.work,
    outcome: row.outcome,
    lastStartedAt: row.started_at,
    lastFinishedAt: row.finished_at,
    failure: row.failure,
    failedAt: row.failed_at,
    failures: row.failures,
    nextDueAt: row.next_due_at,
  }));
}
