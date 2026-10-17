import {
  failJob,
  finishJob,
  makeCohortRow,
  pendingRows,
  progressJob,
  readCohort,
  startJob,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import type { JobHandler } from '../worker.js';

/**
 * **A cohort's run** (REU-031, REU-033, REU-035; the R7 plan, R7-E, R7-F): each of its pending rows
 * made into a document from the cohort's one resolution, each in a transaction of its own, so a row
 * that fails leaves nothing and the run goes on - or stops there, the rows after it waiting, where the
 * requester asked (TPL-047); its progress kept, and a cancel heard, between rows.
 * The report is JSON Lines in the tenant's store, one line for every row of the cohort. A retried
 * attempt carries on from the rows still pending.
 */
export function cohortJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
}): JobHandler {
  return {
    async run(tenant, job) {
      if (job.subjectId === null) return;
      const id = job.subjectId;
      const started = await deps.db.withTenant(tenant, (trx) => startJob(trx, id));
      if (!started) return;
      const cohort = await deps.db.withTenant(tenant, (trx) => readCohort(trx, started.subject));
      if (!cohort) throw new Error(`The cohort ${started.subject} is gone`);
      // A run that stopped at a failed row, as asked, and is tried again before Rerun: it makes none of
      // the rows waiting after it (the final review).
      const rows =
        cohort.onFailure === 'stop' && cohort.stoppedAt !== null
          ? []
          : await deps.db.withTenant(tenant, (trx) => pendingRows(trx, cohort.id));
      const of = started.parameters.rows ?? rows.length;
      let made = 0;
      let failed = 0;
      let goOn = true;
      // Where the requester asked it to stop at a failed row, the rows after it wait (TPL-047).
      let stoppedAt: number | null = cohort.stoppedAt;
      for (const [at, row] of rows.entries()) {
        const outcome = await deps.db.withTenant(tenant, (trx) => makeCohortRow(trx, cohort, row));
        if (outcome === 'made') made += 1;
        if (outcome === 'failed') failed += 1;
        goOn = await deps.db.withTenant(tenant, (trx) =>
          progressJob(trx, id, { done: made + failed, of, unit: 'row' }),
        );
        if (!goOn) break;
        // Stopped only where a row waits after it: the last row failing ends the run all the same.
        if (outcome === 'failed' && cohort.onFailure === 'stop' && at < rows.length - 1) {
          stoppedAt = row;
          break;
        }
      }
      let kept: { key: string; sha256: string; bytes: number } | null = null;
      if (goOn) {
        const after = (await deps.db.withTenant(tenant, (trx) => readCohort(trx, cohort.id)))!;
        const lines = after.rows.map((each) =>
          JSON.stringify({
            row: each.row,
            state: each.state,
            document: each.document,
            failure: each.failure,
          }),
        );
        const store = await deps.db.withTenant(tenant, (trx) => deps.stores.forTenant(trx, tenant));
        const put = await store.put(
          Buffer.from(lines.map((line) => `${line}\n`).join('')),
          'application/x-ndjson',
        );
        kept = { key: put.key, sha256: put.sha256, bytes: put.size };
      }
      await deps.db.withTenant(tenant, (trx) =>
        finishJob(trx, id, { made, failed, of, onFailure: cohort.onFailure, stoppedAt }, kept),
      );
    },

    async failed(tenant, job) {
      if (job.subjectId === null) return;
      await deps.db.withTenant(tenant, (trx) =>
        failJob(trx, job.subjectId!, {
          code: 'job_failed',
          message:
            'The cohort could not be finished. The rows not yet made are kept; run them again.',
        }),
      );
    },
  };
}
