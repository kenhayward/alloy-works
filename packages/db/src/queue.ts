import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { PlatformTables, TenantTransaction } from './tables.js';

/** The kinds of work there are. A worker refuses a kind it does not know. */
export type JobKind = 'sample_pdf';

/** What a worker is told: whose work, of what kind, about which id. Never any content. */
export interface Job {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly subjectId: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/** Waking a worker that is waiting rather than polling. The payload is empty, so it carries nothing. */
export const JOB_CHANNEL = 'aw_jobs';

/**
 * Queues work from inside the tenant's own transaction, so the job exists exactly when the row it is
 * about does. The tenant comes from the role doing the insert: a row naming another tenant is
 * refused by the queue's row-level security, not by this function.
 */
export async function enqueueJob(
  trx: TenantTransaction,
  kind: JobKind,
  subjectId: string,
): Promise<void> {
  await sql`insert into platform.job (tenant_id, kind, subject_id)
            values (substring(current_user::text from 3), ${kind}, ${subjectId}::uuid)`.execute(
    trx,
  );
  await sql`select pg_notify(${JOB_CHANNEL}, '')`.execute(trx);
}

export interface JobQueue {
  /** One job, held for `leaseMs`; undefined when there is nothing to do. */
  claim(options: { readonly workerId: string; readonly leaseMs: number }): Promise<Job | undefined>;
  complete(job: Job): Promise<void>;
  /** Retries while attempts remain; says which it did. The reason is a kind, never a message. */
  fail(
    job: Job,
    reason: string,
    options?: { readonly retryInMs?: number },
  ): Promise<'retry' | 'failed'>;
  /** Jobs whose claims ran out with no attempts left: their workers never came back. */
  abandoned(): Promise<Job[]>;
  close(): Promise<void>;
}

interface JobRow {
  id: string;
  tenant_id: string;
  kind: string;
  subject_id: string | null;
  attempts: number;
  max_attempts: number;
}

const asJob = (row: JobRow): Job => ({
  id: row.id,
  tenantId: row.tenant_id,
  kind: row.kind,
  subjectId: row.subject_id,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
});

/** The queue as a worker sees it. It logs in as `aw_worker`, which can reach no tenant table. */
export function createJobQueue(url: string): JobQueue {
  const db = new Kysely<PlatformTables>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }),
  });

  return {
    async claim({ workerId, leaseMs }) {
      // SKIP LOCKED so two workers take different jobs rather than taking turns, and a lease so a
      // job a worker dies holding comes back by itself.
      const { rows } = await sql<JobRow>`
        update platform.job as j
           set attempts = j.attempts + 1,
               locked_by = ${workerId},
               locked_until = now() + make_interval(secs => ${leaseMs / 1000}::double precision)
         where j.id = (
           select id from platform.job
            where finished_at is null and failed_at is null
              and attempts < max_attempts
              and run_after <= now()
              and (locked_until is null or locked_until < now())
            order by run_after, id
            for update skip locked
            limit 1)
        returning j.id, j.tenant_id, j.kind, j.subject_id, j.attempts, j.max_attempts`.execute(db);
      return rows[0] && asJob(rows[0]);
    },

    async complete(job) {
      await sql`update platform.job
                   set finished_at = now(), locked_until = null
                 where id = ${job.id}::bigint`.execute(db);
    },

    async fail(job, reason, options = {}) {
      const done = job.attempts >= job.maxAttempts;
      if (done) {
        await sql`update platform.job
                     set failed_at = now(), locked_until = null, last_error = ${reason}
                   where id = ${job.id}::bigint`.execute(db);
        return 'failed';
      }
      const retryInMs = options.retryInMs ?? 1000 * 2 ** job.attempts;
      await sql`update platform.job
                   set locked_until = null,
                       last_error = ${reason},
                       run_after = now() + make_interval(secs => ${retryInMs / 1000}::double precision)
                 where id = ${job.id}::bigint`.execute(db);
      return 'retry';
    },

    async abandoned() {
      const { rows } = await sql<JobRow>`
        update platform.job
           set failed_at = now(), locked_until = null, last_error = 'abandoned'
         where finished_at is null and failed_at is null
           and attempts >= max_attempts
           and locked_until < now()
        returning id, tenant_id, kind, subject_id, attempts, max_attempts`.execute(db);
      return rows.map(asJob);
    },

    close: () => db.destroy(),
  };
}
