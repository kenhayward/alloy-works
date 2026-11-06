import { recordBackgroundWork, type Tenant, type TenantDatabase } from '@alloy-works/db';
import { reasonFor, type WorkerLog } from './worker.js';

/** What a step answers when the tenant's state holds the work (ADM-045, EI-M): paused, not failing. */
export const PAUSED: unique symbol = Symbol('paused');

/**
 * Runs a kind of background work in each live tenant, or in those given, and records each tenant's run
 * (the DG plan, DG-G): when it started and finished, and whether it succeeded, failed by its code or
 * was paused. A tenant that fails is logged and passed over, and the rest are run. A record that cannot
 * be written is logged and never stops the work. Answers what each tenant's step answered.
 */
export async function inEachTenant<T>(
  db: TenantDatabase,
  log: WorkerLog,
  work: string,
  step: (tenant: Tenant) => Promise<T | typeof PAUSED>,
  tenants?: readonly Tenant[],
): Promise<T[]> {
  const answered: T[] = [];
  for (const tenant of tenants ?? (await db.liveTenants())) {
    const startedAt = new Date();
    let outcome: 'succeeded' | 'failed' | 'paused' = 'succeeded';
    let failure: string | undefined;
    try {
      const answer = await step(tenant);
      if (answer === PAUSED) outcome = 'paused';
      else answered.push(answer);
    } catch (error) {
      outcome = 'failed';
      failure = reasonFor(error);
      log.error({ tenant: tenant.id, work, err: error }, 'background work failed in a tenant');
    }
    await db
      .withTenant(
        tenant,
        (trx) =>
          recordBackgroundWork(trx, {
            work,
            startedAt,
            finishedAt: new Date(),
            outcome,
            ...(failure === undefined ? {} : { failure }),
          }),
        { actorKind: 'system' },
      )
      .catch((error: unknown) =>
        log.warn({ tenant: tenant.id, work, err: error }, 'background work was not recorded'),
      );
  }
  return answered;
}
