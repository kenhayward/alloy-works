import type { Job, JobKind, JobQueue, Measuring, Tenant, TenantDatabase } from '@alloy-works/db';
import { JOB_CAPABILITIES } from '@alloy-works/domain';
import { JobRefused } from './refusal.js';

/** What a kind of work knows how to do, and what to do when it has failed for the last time. */
export interface JobHandler {
  run(tenant: Tenant, job: Job): Promise<void>;
  /** `cause` is what the last attempt threw; absent for a job whose worker never came back. */
  failed(tenant: Tenant, job: Job, cause?: unknown): Promise<void>;
}

/** As much of a logger as the worker uses; pino is one. */
export interface WorkerLog {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
  error(details: object, message: string): void;
}

export interface WorkerDeps {
  readonly queue: JobQueue;
  readonly db: TenantDatabase;
  readonly handlers: Readonly<Record<string, JobHandler>>;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly log: WorkerLog;
  /** Each job counted under its kind of work (the DG plan, DG-C); none, nothing counted. */
  readonly measuring?: Pick<Measuring, 'record'>;
}

/** Every kind of job is a kind of work, checked here against the queue's list. */
const CAPABILITY_OF: Readonly<Record<JobKind, string>> = JOB_CAPABILITIES;

/** The kind of failure and nothing more: a message could carry content. */
export function reasonFor(error: unknown): string {
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(code)) return code;
  return 'failed';
}

/**
 * One job, if there is one: claim it, do all of its work inside its tenant, and say how it went.
 * The loop in main.ts is this function and a wait; everything worth testing is here.
 */
export async function processNext(deps: WorkerDeps): Promise<'idle' | 'done' | 'retry' | 'failed'> {
  // Jobs whose workers took them and never came back, before claiming anything new.
  for (const job of await deps.queue.abandoned()) {
    deps.log.warn({ job: job.id, kind: job.kind, tenant: job.tenantId }, 'job abandoned');
    const tenant = await deps.db.tenant(job.tenantId);
    if (tenant) await deps.handlers[job.kind]?.failed(tenant, job);
  }

  // Only the kinds this worker runs: a kind it does not know waits for a worker that does, as one
  // older than the job's kind would otherwise fail it.
  const job = await deps.queue.claim({
    workerId: deps.workerId,
    leaseMs: deps.leaseMs,
    kinds: Object.keys(deps.handlers),
  });
  if (!job) return 'idle';

  const tenant = await deps.db.tenant(job.tenantId);
  const handler = deps.handlers[job.kind];
  if (!tenant || !handler) {
    // Nothing to retry: the tenant has gone, or this worker does not know the kind.
    await deps.queue.fail(
      { ...job, attempts: job.maxAttempts },
      tenant ? 'unknown_kind' : 'no_tenant',
    );
    deps.log.error({ job: job.id, kind: job.kind, tenant: job.tenantId }, 'job cannot be run');
    return 'failed';
  }

  const started = performance.now();
  const measured = (status: number) =>
    deps.measuring?.record(tenant, CAPABILITY_OF[job.kind as JobKind] ?? 'Other work', {
      status,
      ms: performance.now() - started,
      refused: false,
    });
  try {
    await handler.run(tenant, job);
    measured(200);
    await deps.queue.complete(job);
    deps.log.info({ job: job.id, kind: job.kind, tenant: tenant.id }, 'job done');
    return 'done';
  } catch (error) {
    const reason = reasonFor(error);
    // Refused on its merits: the same input fails the same way, so it is finished now (issue #146).
    const refused = error instanceof JobRefused;
    // Refused on its input, as a route's 4xx; anything else, as the service failing.
    measured(refused ? 422 : 500);
    const outcome = await deps.queue.fail(
      refused ? { ...job, attempts: job.maxAttempts } : job,
      reason,
    );
    deps.log.warn(
      { job: job.id, kind: job.kind, tenant: tenant.id, reason, outcome },
      'job did not finish',
    );
    if (outcome === 'failed') await handler.failed(tenant, job, error);
    return outcome;
  }
}
