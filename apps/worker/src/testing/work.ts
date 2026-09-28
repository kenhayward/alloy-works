import type { Job, JobQueue } from '@alloy-works/db';
import { processNext, type JobHandler, type WorkerDeps } from '../worker.js';

/**
 * `processNext` for a suite about something other than the check: every publication it records
 * queues a `check_pdf` (W14.1, W-B), which would otherwise be the next job taken, ahead of the one the
 * test is waiting on. Each check met is run by `check`, and passed over; the outcome answered is that
 * of the first job of any other kind, or `idle`.
 */
export async function processNextBesideChecks(
  deps: WorkerDeps,
  check: JobHandler,
): Promise<Awaited<ReturnType<typeof processNext>>> {
  for (;;) {
    let taken: Job | undefined;
    const queue: JobQueue = {
      ...deps.queue,
      claim: async (options) => (taken = await deps.queue.claim(options)),
    };
    const outcome = await processNext({
      ...deps,
      queue,
      handlers: { ...deps.handlers, check_pdf: check },
    });
    if (taken?.kind !== 'check_pdf') return outcome;
  }
}
