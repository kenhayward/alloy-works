import { randomUUID } from 'node:crypto';

import type { EmbeddingConfirmationBody } from '@alloy-works/api-contract';
import {
  confirmEmbedding,
  embeddingFreshness,
  embeddingStatus,
  endRun,
  isDimensions,
  readModelEndpoint,
  recordGenerationRun,
  startRun,
  usableModelKey,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { modelDeadlineMs, type EmbedAnswer, type GenerationFailure } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';

import { type Authorised } from '../access.js';
import { contextOf } from '../audit.js';
import { createConnectorClient } from '../data/connector.js';
import type { ConnectorOptions } from '../data/connections.js';
import { AppError } from '../errors.js';
import { failureView } from './models.js';
import { microsText } from './money.js';

/**
 * Embedding a corpus, costed and confirmed (the G7 plan, G7-J; GEN-044): the model that serves meaning
 * and the one waiting, what it would cost to embed every latest text it lacks, and an administrator's
 * confirmation, which first embeds one sample to learn the model's dimensions. Nothing is embedded
 * for a model before it is confirmed.
 */

/** What the sample embeds, to learn a model's dimensions: invented, and nobody's content. */
const SAMPLE = 'Alloy Works asks this model how long its vectors are.';

async function view(trx: TenantTransaction) {
  const status = await embeddingStatus(trx);
  const named = async (id: string | null) => {
    const endpoint = id === null ? undefined : await readModelEndpoint(trx, id);
    return endpoint
      ? {
          id: endpoint.id,
          name: endpoint.name,
          boundary: endpoint.boundary,
          retired: endpoint.retiredAt !== null,
        }
      : null;
  };
  const pending = status.pending;
  const pendingEndpoint =
    pending?.endpointId == null ? undefined : await readModelEndpoint(trx, pending.endpointId);
  return {
    serving: status.serving && {
      model: status.serving.model,
      dims: status.serving.dims,
      endpoint: await named(status.serving.endpointId),
    },
    pending: pending && {
      model: pending.model,
      dims: pending.dims,
      endpoint: await named(pending.endpointId),
      confirmed: pending.confirmedAt !== null,
      texts: pending.texts,
      missing: pending.missing,
      // About four characters a token, at the endpoint's input price: approximate (G7-J).
      estimate: {
        tokens: pending.tokens,
        cost:
          pendingEndpoint === undefined
            ? null
            : microsText(BigInt(Math.round(pending.tokens * pendingEndpoint.priceIn))),
        currency: pendingEndpoint?.currency ?? null,
      },
    },
  };
}

export function embeddingHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  connector: ConnectorOptions | undefined,
) {
  const client = connector ? createConnectorClient(connector) : undefined;
  return {
    getEmbedding: async (_request: FastifyRequest, { trx }: Authorised) => view(trx),

    // Meaning's lag over the last seven days (the FR plan, FR-E; SCH-067).
    getMeaningFreshness: async (_request: FastifyRequest, { trx }: Authorised) =>
      embeddingFreshness(trx),

    confirmEmbedding: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { model } = request.body as EmbeddingConfirmationBody;
      const status = await embeddingStatus(trx);
      if (status.pending?.model !== model || status.pending.confirmedAt !== null) {
        throw new AppError(
          409,
          'embedding_not_pending',
          'No model by that name waits to be confirmed.',
        );
      }
      const endpoint =
        status.pending.endpointId === null
          ? undefined
          : await readModelEndpoint(trx, status.pending.endpointId);
      const sealed =
        endpoint && endpoint.retiredAt === null ? await usableModelKey(trx, endpoint) : undefined;
      if (!endpoint || sealed === undefined) {
        throw new AppError(409, 'endpoint_unusable', 'The endpoint is retired, or has no key set.');
      }
      if (!client) {
        throw new AppError(503, 'connector_unavailable', 'The connector could not be reached.');
      }
      // One sample, a run of the administrator's, to learn how long the model's vectors are (G7-D).
      // Its own transactions, so the sample's run is kept whether or not the model is confirmed; each
      // as the administrator, so the run's event names them.
      const tenant = tenantOf(request);
      const context = contextOf(request);
      const run = await db.withTenant(
        tenant,
        (inner) =>
          startRun(inner, {
            purpose: 'embedding',
            endpoint,
            parameters: { inputs: 1, model, sample: true },
            contextDigest: '0'.repeat(64),
            by: principalId,
          }),
        context,
      );
      let failure: GenerationFailure = { code: 'connector_error' };
      let answer: EmbedAnswer | undefined;
      try {
        const answered = await client.embed({
          requestId: randomUUID(),
          tenant: tenant.id,
          endpoint: { id: endpoint.id, protocol: endpoint.protocol, baseUrl: endpoint.baseUrl },
          sealed,
          call: { model, inputs: [SAMPLE] },
          deadlineMs: modelDeadlineMs(endpoint),
        });
        if ('answer' in answered) answer = answered.answer;
        else failure = { code: answered.refused.code };
        if (answer?.type === 'failed') failure = answer.failure;
      } finally {
        // Never left running, whatever became of the call.
        await db.withTenant(
          tenant,
          async (inner) => {
            const recorded = await endRun(
              inner,
              run,
              answer?.type === 'embedded'
                ? {
                    outcome: 'finished',
                    model: answer.model,
                    usage: answer.usage ? { in: answer.usage.in, out: 0 } : null,
                  }
                : { outcome: failure.code },
            );
            await recordGenerationRun(inner, recorded);
            return recorded;
          },
          context,
        );
      }
      const dims = answer?.type === 'embedded' ? (answer.vectors[0]?.length ?? 0) : 0;

      if (answer?.type !== 'embedded') {
        throw new AppError(
          409,
          'embedding_unavailable',
          `The model did not answer a sample: ${failureView(failure).message}`,
        );
      }
      if (!isDimensions(dims)) {
        throw new AppError(
          409,
          'embedding_dimensions_unsupported',
          `The model's vectors have ${dims} dimensions; meaning is searched in 384, 768, 1024, 1536 or 3072.`,
        );
      }
      await confirmEmbedding(trx, { model, dims, by: principalId });
      return view(trx);
    },
  };
}
