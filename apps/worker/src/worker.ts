import type { Job, JobQueue, Tenant, TenantDatabase } from '@alloy-works/db';

/** What a kind of work knows how to do, and what to do when it has failed for the last time. */
export interface JobHandler {
  run(tenant: Tenant, job: Job): Promise<void>;
  failed(tenant: Tenant, job: Job): Promise<void>;
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
}

/** The kind of failure and nothing more: a message could carry content. */
function reasonFor(error: unknown): string {
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

  const job = await deps.queue.claim({ workerId: deps.workerId, leaseMs: deps.leaseMs });
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

  try {
    await handler.run(tenant, job);
    await deps.queue.complete(job);
    deps.log.info({ job: job.id, kind: job.kind, tenant: tenant.id }, 'job done');
    return 'done';
  } catch (error) {
    const reason = reasonFor(error);
    const outcome = await deps.queue.fail(job, reason);
    deps.log.warn(
      { job: job.id, kind: job.kind, tenant: tenant.id, reason, outcome },
      'job did not finish',
    );
    if (outcome === 'failed') await handler.failed(tenant, job);
    return outcome;
  }
}
