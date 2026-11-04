import {
  PURGE_WAIT_MS,
  type JobQueue,
  type PurgeReport,
  type StewardDatabase,
  type Tenant,
} from '@alloy-works/db';

/**
 * **Deleting a tenant** (tenant-lifecycle.md, TL-I, TL-J). Each stage repeats safely, in order, so a
 * purge stopped anywhere finishes when taken again, and the report is what was found by looking.
 */

/** What the store does for a purge: only the steward holds the administrative credential. */
export interface PurgeStore {
  removeCredential(tenant: Tenant): Promise<void>;
  deleteObjects(tenant: Tenant): Promise<void>;
  remaining(tenant: Tenant): Promise<Pick<PurgeReport, 'objects' | 'credentialPresent'>>;
}

export interface PurgeLog {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
}

export interface PurgeDeps {
  readonly queue: JobQueue;
  readonly steward: StewardDatabase;
  readonly store: PurgeStore;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly log: PurgeLog;
  /** Given in tests. */
  readonly now?: () => number;
}

const finished = (report: PurgeReport) =>
  !report.schemaPresent &&
  report.roles === 0 &&
  report.hostnames === 0 &&
  report.jobs === 0 &&
  report.objects === 0 &&
  !report.credentialPresent;

class PurgeIncomplete extends Error {
  readonly code = 'purge_incomplete';
}

const reasonFor = (error: unknown) => {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'failed';
};

/** A purge, if one is due. The steward's loop is this function and a wait. */
export async function processNextPurge(
  deps: PurgeDeps,
): Promise<'idle' | 'waiting' | 'done' | 'retry' | 'failed'> {
  const job = await deps.queue.claim({
    workerId: deps.workerId,
    leaseMs: deps.leaseMs,
    kinds: ['tenant_purge'],
  });
  if (!job) return 'idle';
  const being = await deps.steward.deleting(job.tenantId);
  if (!being) {
    // Queued by a tenant for itself, or finished by another's run: nothing here to do.
    await deps.queue.complete(job);
    return 'done';
  }
  const { tenant, since } = being;
  try {
    await deps.steward.removeHostnames(tenant);
    // Whatever was in flight when deletion began has a lease to finish in.
    const left = since.getTime() + PURGE_WAIT_MS - (deps.now?.() ?? Date.now());
    if (left > 0) {
      await deps.queue.postpone(job, left);
      return 'waiting';
    }
    await deps.store.removeCredential(tenant);
    await deps.store.deleteObjects(tenant);
    await deps.steward.dropTenantDatabase(tenant);
    const report: PurgeReport = {
      ...(await deps.steward.whatRemains(tenant)),
      ...(await deps.store.remaining(tenant)),
    };
    if (!finished(report)) throw new PurgeIncomplete('A purge left something behind');
    await deps.steward.recordDeleted(tenant, report);
    deps.log.info({ tenant: tenant.id }, 'a tenant has been deleted');
    return 'done';
  } catch (error) {
    deps.log.error({ tenant: tenant.id, reason: reasonFor(error) }, 'a purge did not finish');
    return deps.queue.fail(job, reasonFor(error));
  }
}

/**
 * Queues again a purge that gave up, and alarms at one past IAM-086's day: a job that stopped silently
 * would break the promise with nobody knowing.
 */
export async function sweepStuckPurges(deps: Pick<PurgeDeps, 'steward' | 'log'>): Promise<number> {
  const { requeued, overdue } = await deps.steward.requeueStuckPurges();
  for (const tenant of overdue) {
    deps.log.error({ tenant }, 'a tenant is past the day it had to be deleted in');
  }
  return requeued;
}
