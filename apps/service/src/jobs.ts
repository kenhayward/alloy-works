import type {
  ImpactReportBody,
  ImpactReportParams,
  JobDownload,
  JobParams,
  JobView,
} from '@alloy-works/api-contract';
import {
  cancelJob,
  readJob,
  submitImpactReport,
  type StoredJob,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { AppError, storageUnavailable } from './errors.js';
import { DOWNLOAD_SECONDS } from './publishing.js';
import type { SessionPrincipal } from './sessions.js';

export function jobView(job: StoredJob): JobView {
  return {
    id: job.id,
    kind: job.kind,
    subject: job.subject,
    parameters: { ...job.parameters },
    state: job.state,
    requestedAt: job.requestedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    progress: job.progress && { ...job.progress },
    cancelRequested: job.cancelRequested,
    failure: job.failure && { ...job.failure },
    outcome: job.outcome && { ...job.outcome },
    result: job.result && { bytes: job.result.bytes, sha256: job.result.sha256 },
  };
}

/** Jobs through the API (API-040 to API-043; the R3 plan, R3-B to R3-D), each its requester's. */
export function jobHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
  objects: ObjectStores | undefined,
) {
  const mine = (request: FastifyRequest) => ({
    id: (request.params as JobParams).id,
    by: principalOf(request).principalId,
  });
  return {
    submitImpactReport: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<JobView> => {
      const { id } = request.params as ImpactReportParams;
      const { depth } = request.body as ImpactReportBody;
      return jobView(await submitImpactReport(trx, { by: principalId, subject: id, depth }));
    },

    getJob: async (request: FastifyRequest): Promise<JobView> => {
      const { id, by } = mine(request);
      const job = await db.withTenant(tenantOf(request), (trx) => readJob(trx, id, by));
      if (!job) throw notFound();
      return jobView(job);
    },

    cancelJob: async (request: FastifyRequest): Promise<JobView> => {
      const { id, by } = mine(request);
      const answer = await db.withTenant(tenantOf(request), (trx) => cancelJob(trx, id, by));
      if (answer.answer === 'missing') throw notFound();
      if (answer.answer === 'finished') {
        throw new AppError(409, 'job_finished', 'This job has finished already.');
      }
      return jobView(answer.job);
    },

    downloadJob: async (request: FastifyRequest): Promise<JobDownload> => {
      const { id, by } = mine(request);
      return db.withTenant(tenantOf(request), async (trx) => {
        const job = await readJob(trx, id, by);
        if (!job) throw notFound();
        if (job.state !== 'succeeded' || job.result === null) {
          throw new AppError(409, 'job_not_ready', 'This job has no result: it has not succeeded.');
        }
        if (!objects) throw storageUnavailable();
        const store = await objects.forTenant(trx, tenantOf(request));
        return {
          download: await store.signedLink(
            job.result.key,
            DOWNLOAD_SECONDS,
            `${job.kind.replace('_', '-')}-${id}.jsonl`,
          ),
        };
      });
    },
  };
}
