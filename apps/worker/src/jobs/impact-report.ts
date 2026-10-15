import {
  failJob,
  finishJob,
  impact,
  mayStillRead,
  progressJob,
  startJob,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import { JobRefused } from '../refusal.js';
import type { JobHandler } from '../worker.js';

/** No cap: a report is the complete answer, bounded by its depth alone (REL-032). */
const UNCAPPED = Number.POSITIVE_INFINITY;

/**
 * **The impact report** (REL-032, REL-050; the R3 plan, R3-F): what a change to its subject reaches,
 * uncapped, as its requester, to the depth asked. Each depth walked records its progress and hears a
 * cancel in a transaction of its own, so a poll sees it and a cancel stops it there; a cancelled report
 * keeps nothing. The result is JSON Lines in the tenant's store, nearest first. A retried attempt
 * starts again.
 */
export function impactReportJob(deps: {
  readonly db: TenantDatabase;
  readonly stores: ObjectStores;
}): JobHandler {
  return {
    async run(tenant, job) {
      if (job.subjectId === null) return;
      const id = job.subjectId;
      const started = await deps.db.withTenant(tenant, (trx) => startJob(trx, id));
      // Cancelled before it ran, or finished by an attempt before this one.
      if (!started) return;
      const depth = started.parameters.depth;
      // Its requester may have lost the subject since they asked: a report is their reading of it.
      const readable = await deps.db.withTenant(tenant, (trx) =>
        mayStillRead(trx, started.requestedBy, started.subject),
      );
      if (!readable)
        throw new JobRefused('subject_unreadable', 'The requester may no longer read the subject.');
      const walked = await deps.db.withTenant(tenant, (trx) =>
        impact(trx, started.requestedBy, started.subject, depth, UNCAPPED, (done) =>
          deps.db.withTenant(tenant, (step) =>
            progressJob(step, id, { done, of: depth, unit: 'depth' }),
          ),
        ),
      );
      const outcome = {
        depthsWalked: walked.depths,
        depthsAsked: depth,
        reached: walked.reached.length,
        cut: walked.cut,
      };
      // Stopped by a cancel at a step, or one asked for since its last: nothing is kept.
      const goOn =
        !walked.stopped &&
        (await deps.db.withTenant(tenant, (trx) =>
          progressJob(trx, id, { done: walked.depths, of: depth, unit: 'depth' }),
        ));
      let kept: { key: string; sha256: string; bytes: number } | null = null;
      if (goOn) {
        const lines = walked.reached.map((each) =>
          JSON.stringify({
            id: each.id,
            kind: each.kind,
            title: each.title,
            depth: each.depth,
            via: each.via,
          }),
        );
        const store = await deps.db.withTenant(tenant, (trx) => deps.stores.forTenant(trx, tenant));
        const put = await store.put(
          Buffer.from(lines.map((line) => `${line}\n`).join('')),
          'application/x-ndjson',
        );
        kept = { key: put.key, sha256: put.sha256, bytes: put.size };
      }
      await deps.db.withTenant(tenant, (trx) => finishJob(trx, id, outcome, kept));
    },

    async failed(tenant, job, cause) {
      if (job.subjectId === null) return;
      const code =
        cause instanceof Error &&
        'code' in cause &&
        typeof cause.code === 'string' &&
        /^[a-z][a-z_]*$/.test(cause.code)
          ? cause.code
          : 'job_failed';
      await deps.db.withTenant(tenant, (trx) =>
        failJob(trx, job.subjectId!, {
          code,
          message: 'The report could not be made. Ask for it again.',
        }),
      );
    },
  };
}
