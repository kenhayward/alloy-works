import type { RetentionBody, RetentionView } from '@alloy-works/api-contract';
import { listKeeps, setKeep, type TenantTransaction } from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { AppError } from './errors.js';

/** The keeps in force, as the API shows them. */
async function retentionView(trx: TenantTransaction): Promise<RetentionView> {
  return {
    keeps: (await listKeeps(trx)).map((keep) => ({
      kind: keep.kind,
      space: keep.space && { ...keep.space },
      days: keep.days,
      by: { ...keep.by },
      at: keep.at.toISOString(),
    })),
  };
}

/**
 * Reading, setting and clearing retention keeps (lifecycle.md, "Retention"; the DL plan, Task 2),
 * each decided on `administer` at the tenant before it runs.
 */
export function retentionHandlers() {
  return {
    getRetention: async (_request: FastifyRequest, { trx }: Authorised) => retentionView(trx),

    setRetention: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const body = request.body as RetentionBody;
      const answer = await setKeep(trx, { ...body, by: principalId });
      if (answer.answer === 'space.missing') throw notFound();
      if (answer.answer === 'key.invalid' || answer.answer === 'days.invalid') {
        throw new AppError(400, 'invalid_request', 'Name a kind or a space, and 1 to 36500 days.');
      }
      return retentionView(trx);
    },
  };
}
