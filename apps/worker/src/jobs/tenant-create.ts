import {
  copySharedProviders,
  type JobQueue,
  type Tenant,
  type TenantDatabase,
  type TenantMaker,
  type TenantRequest,
} from '@alloy-works/db';

/**
 * **Making a tenant, and keeping its shared providers current** (tenant-lifecycle.md, TL-M, TL-N): the
 * steward's, since only it can make a role and holds the store's administrative credential.
 */

export interface MakingLog {
  info(details: object, message: string): void;
  error(details: object, message: string): void;
}

export interface MakingDeps {
  readonly maker: TenantMaker;
  /** The steward's login, in a tenant as that tenant's role. */
  readonly db: TenantDatabase;
  readonly queue: JobQueue;
  /** A tenant's own store credential, sealed into it. */
  readonly setUpStore: (tenant: Tenant) => Promise<void>;
  readonly sealingKey: Buffer;
  readonly workerId: string;
  readonly leaseMs: number;
  readonly log: MakingLog;
}

const reasonFor = (error: unknown) => {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^[a-z0-9_]{1,64}$/i.test(code) ? code : 'failed';
};

/** Copies what its organisation shares: done before the invitation, which names the ways it may be claimed. */
const copyInto = async (deps: MakingDeps, request: TenantRequest, tenant: Tenant) => {
  if (request.kind === 'organisation') return;
  const { organisation } = await deps.maker.family(request.organisationId);
  if (organisation) await copySharedProviders(deps.db, deps.sealingKey, organisation, [tenant]);
};

/** A request, if one is due. Each stage repeats safely, so one stopped anywhere is taken again. */
export async function processNextRequest(
  deps: MakingDeps,
): Promise<'idle' | 'done' | 'retry' | 'failed'> {
  const request = await deps.maker.claim(deps.leaseMs);
  if (!request) return 'idle';
  try {
    const tenant = await deps.maker.build(request);
    await deps.setUpStore(tenant);
    await copyInto(deps, request, tenant);
    await deps.maker.invite(request, tenant);
    await deps.maker.finish(request, tenant);
    deps.log.info({ tenant: tenant.id }, 'a tenant has been made');
    return 'done';
  } catch (error) {
    // A reason, never a message: a message may carry the address.
    deps.log.error(
      { tenant: request.tenantId, reason: reasonFor(error) },
      'making a tenant did not finish',
    );
    return (await deps.maker.giveUpIfSpent(request)) ? 'failed' : 'retry';
  }
}

/** A job to bring every copy into line with what the organisation shares (TL-M). */
export async function processNextProviderCopy(
  deps: MakingDeps,
): Promise<'idle' | 'done' | 'retry' | 'failed'> {
  const job = await deps.queue.claim({
    workerId: deps.workerId,
    leaseMs: deps.leaseMs,
    kinds: ['provider_share'],
  });
  if (!job) return 'idle';
  try {
    const family = await deps.maker.family(await deps.maker.organisationOf(job.tenantId));
    if (family.organisation?.id === job.tenantId) {
      const { copied, passedOver } = await copySharedProviders(
        deps.db,
        deps.sealingKey,
        family.organisation,
        family.tenants,
      );
      deps.log.info({ tenant: job.tenantId, copied, passedOver }, 'shared providers are copied');
    }
    await deps.queue.complete(job);
    return 'done';
  } catch (error) {
    deps.log.error(
      { tenant: job.tenantId, reason: reasonFor(error) },
      'copying shared providers did not finish',
    );
    return deps.queue.fail(job, reasonFor(error));
  }
}
