import { createHash, randomUUID } from 'node:crypto';

import {
  endRun,
  keepQueryEmbedding,
  rateRefusal,
  readModelEndpoint,
  readQueryEmbedding,
  recordGenerationRun,
  searchMeaning,
  servingEmbedding,
  startRun,
  usableModelKey,
  type MeaningFilters,
  type MeaningHit,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { EMBED_INPUT_CHARS_MOST, parseQuery, modelDeadlineMs } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';

import { contextOf } from '../audit.js';
import { createConnectorClient } from '../data/connector.js';
import type { ConnectorOptions } from '../data/connections.js';

/**
 * A search's meaning (search.md, "Meaning"; the G7 plan, G7-G and G7-H), asked only as a person
 * searches: their words embedded by the serving model through the connector - a run of theirs,
 * kept a day as their own query vector, so a repeated search calls nothing - then the passages
 * nearest it over what they may read. Words alone where nothing is to be embedded, nothing serves,
 * or the model does not answer, the answer saying which.
 */

export type MeaningState = 'used' | 'unavailable' | 'unconfigured' | 'skipped';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * How long a search's embedding may take before search answers by words alone: the model's own
 * timeout where that is shorter.
 */
const QUERY_EMBED_MS = 10_000;

/** How long a model that failed a search is left alone, so no search waits on it again at once. */
const FAILED_FOR_MS = 30_000;

export function meaningSearcher(db: TenantDatabase, connector: ConnectorOptions | undefined) {
  const client = connector ? createConnectorClient(connector) : undefined;
  // Each tenant's model that failed a search, and when: words alone until it may be asked again.
  const failed = new Map<string, number>();
  return async (
    request: FastifyRequest,
    tenant: Tenant,
    principal: string,
    input: {
      readonly q: string;
      readonly latest: boolean;
      readonly filters: MeaningFilters;
    },
  ): Promise<{ readonly state: MeaningState; readonly hits: readonly MeaningHit[] }> => {
    const parsed = parseQuery(input.q);
    const words = parsed.outcome === 'query' ? parsed.words.trim() : '';
    // Meaning is the latest's, and of free words: a scoped term, an exclusion or a filter alone is
    // words' (G7-G).
    if (!input.latest || words === '') return { state: 'skipped', hits: [] };
    const context = contextOf(request);
    const ready = await db.withTenant(
      tenant,
      async (trx) => {
        const serving = await servingEmbedding(trx);
        if (!serving) return undefined;
        const hash = sha256(words);
        const cached = await readQueryEmbedding(trx, principal, hash, serving.model);
        const endpoint = cached ? undefined : await readModelEndpoint(trx, serving.endpointId);
        const sealed =
          endpoint && endpoint.retiredAt === null ? await usableModelKey(trx, endpoint) : undefined;
        return { serving, hash, cached, endpoint, sealed };
      },
      context,
    );
    if (!ready) return { state: 'unconfigured', hits: [] };
    let vector = ready.cached;
    if (vector === undefined) {
      if (!client || !ready.endpoint || ready.sealed === undefined) {
        return { state: 'unavailable', hits: [] };
      }
      const since = failed.get(tenant.id);
      if (since !== undefined && Date.now() - since < FAILED_FOR_MS) {
        return { state: 'unavailable', hits: [] };
      }
      // A search's embedding is a run of the searcher's, within their hourly limit (GEN-035).
      if (await db.withTenant(tenant, (trx) => rateRefusal(trx, principal), context)) {
        return { state: 'unavailable', hits: [] };
      }
      const endpoint = ready.endpoint;
      const run = await db.withTenant(
        tenant,
        (trx) =>
          startRun(trx, {
            purpose: 'embedding',
            endpoint,
            parameters: { inputs: 1, model: ready.serving.model, query: true },
            contextDigest: ready.hash,
            by: principal,
          }),
        context,
      );
      const answered = await client.embed({
        requestId: randomUUID(),
        tenant: tenant.id,
        endpoint: { id: endpoint.id, protocol: endpoint.protocol, baseUrl: endpoint.baseUrl },
        sealed: ready.sealed,
        call: { model: ready.serving.model, inputs: [words.slice(0, EMBED_INPUT_CHARS_MOST)] },
        deadlineMs: modelDeadlineMs(endpoint, QUERY_EMBED_MS),
      });
      const answer = 'answer' in answered ? answered.answer : undefined;
      const fits = answer?.type === 'embedded' && answer.vectors[0]?.length === ready.serving.dims;
      await db.withTenant(
        tenant,
        async (trx) => {
          if (fits) {
            await keepQueryEmbedding(trx, {
              requester: principal,
              hash: ready.hash,
              model: ready.serving.model,
              dims: ready.serving.dims,
              vector: answer.vectors[0]!,
            });
          }
          const ended = await endRun(
            trx,
            run,
            fits
              ? {
                  outcome: 'finished',
                  model: answer.model,
                  usage: answer.usage ? { in: answer.usage.in, out: 0 } : null,
                }
              : {
                  outcome:
                    answer?.type === 'failed'
                      ? answer.failure.code
                      : 'refused' in answered
                        ? answered.refused.code
                        : 'model_mismatch',
                },
          );
          await recordGenerationRun(trx, ended);
        },
        context,
      );
      if (!fits) {
        failed.set(tenant.id, Date.now());
        return { state: 'unavailable', hits: [] };
      }
      failed.delete(tenant.id);
      vector = answer.vectors[0]!;
    }
    const found = vector;
    const hits = await db.withTenant(
      tenant,
      (trx) =>
        searchMeaning(trx, principal, {
          vector: found,
          model: ready.serving.model,
          dims: ready.serving.dims,
          filters: input.filters,
        }),
      context,
    );
    return { state: 'used', hits: hits ?? [] };
  };
}
