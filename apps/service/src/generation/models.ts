import { createHash, randomUUID } from 'node:crypto';

import type {
  ModelEndpointAnswer,
  ModelEndpointBody,
  ModelEndpointList,
  ModelEndpointParams,
  ModelEndpointView,
  ModelKeyBody,
  ModelRouteBody,
  ModelRouteList,
  ModelRouteParams,
  ModelTestAnswer,
} from '@alloy-works/api-contract';
import {
  changeModelEndpoint,
  endRun,
  listModelEndpoints,
  listModelRoutes,
  makeModelEndpoint,
  modelKeyState,
  readModelEndpoint,
  recordEndpointTest,
  retireModelEndpoint,
  setModelCredential,
  routeEmbedding,
  setModelRoute,
  startRun,
  usableModelKey,
  type EndpointWritten,
  type StoredModelEndpoint,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import {
  ROUTED_PURPOSES,
  canonicalCall,
  type GenerationFailure,
  type ModelCall,
} from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';

import { notFound, type Authorised } from '../access.js';
import { AfterCommit } from '../after-commit.js';
import { contextOf } from '../audit.js';
import { createConnectorClient, type Answered } from '../data/connector.js';
import type { ConnectorOptions } from '../data/connections.js';
import { AppError } from '../errors.js';

/**
 * The model endpoint routes (generation.md, "Endpoints"; the G1 plan, G1-I): a tenant's endpoints,
 * their keys, routes and tests, each act its administrator's. With the connection routes, the only
 * callers of the connector (DAT-089; G1-L), and each only on a person's request.
 */

/** A test's deadline: one short reply. */
const TEST_DEADLINE_MS = 30_000;

/** The test's one message, fixed: what is asked is never the administrator's. */
const TEST_CALL = (model: string): ModelCall => ({
  model,
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Reply with the single word: ready.' }] },
  ],
  parameters: { maxTokens: 16 },
});

/** What each failure says to an administrator, in the product's words alone (G1-E). */
const FAILURE_WORDS: Readonly<Record<GenerationFailure['code'], string>> = {
  model_unavailable: 'The endpoint did not answer, refused the key, or failed.',
  model_mismatch: 'The endpoint answered as a model other than the one it names.',
  context_too_large: 'The endpoint said what it was sent is more than the model accepts.',
  timeout: 'The endpoint did not finish in time.',
  connector_error: 'The connector failed while it called the endpoint.',
  connector_busy: 'The connector is calling as many models as it may at once. Try again shortly.',
  connector_unavailable: 'The connector could not be reached.',
};

const REASON_WORDS: Readonly<Record<NonNullable<GenerationFailure['reason']>, string>> = {
  unreachable: 'The endpoint could not be reached.',
  key_refused: 'The endpoint refused the key.',
  rate_limited: 'The endpoint is limiting how often it is called. Try again shortly.',
  failed: 'The endpoint failed to answer.',
};

const failureView = (failure: GenerationFailure) => ({
  code: failure.code,
  ...(failure.reason === undefined ? {} : { reason: failure.reason }),
  message:
    failure.reason === undefined ? FAILURE_WORDS[failure.code] : REASON_WORDS[failure.reason],
});

/** Millionths of a currency's unit, written to six places. */
const priced = (micros: bigint | null) => {
  if (micros === null) return null;
  const whole = micros / 1_000_000n;
  const part = (micros % 1_000_000n).toString().padStart(6, '0');
  return `${whole}.${part}`;
};

async function endpointView(
  trx: TenantTransaction,
  endpoint: StoredModelEndpoint,
): Promise<ModelEndpointView> {
  const key = await modelKeyState(trx, endpoint);
  return {
    name: endpoint.name,
    protocol: endpoint.protocol,
    baseUrl: endpoint.baseUrl,
    model: endpoint.model,
    contextWindow: endpoint.contextWindow,
    priceIn: endpoint.priceIn,
    priceOut: endpoint.priceOut,
    ...(endpoint.priceCached === undefined ? {} : { priceCached: endpoint.priceCached }),
    currency: endpoint.currency,
    boundary: endpoint.boundary,
    id: endpoint.id,
    madeAt: endpoint.madeAt.toISOString(),
    changedAt: endpoint.changedAt.toISOString(),
    retiredAt: endpoint.retiredAt?.toISOString() ?? null,
    key: key.set
      ? {
          set: true,
          setBy: key.setBy,
          setAt: key.setAt.toISOString(),
          needsSetting: key.needsSetting,
        }
      : { set: false },
  };
}

function written(answer: EndpointWritten): StoredModelEndpoint {
  switch (answer.answer) {
    case 'written':
      return answer.endpoint;
    case 'endpoint.missing':
      throw notFound();
    case 'name.taken':
      throw new AppError(409, 'endpoint_name_taken', 'Another endpoint in use has this name.');
    case 'endpoint.retired':
      throw new AppError(
        409,
        'endpoint_retired',
        'This endpoint is retired, so it changes no more.',
      );
    case 'protocol.fixed':
      throw new AppError(
        409,
        'endpoint_protocol_fixed',
        "An endpoint's protocol never changes: make an endpoint of the other protocol.",
      );
  }
}

const unusable = () =>
  new AppError(
    409,
    'endpoint_unusable',
    'This endpoint is retired, or has no key set for where it points.',
  );

async function routesView(trx: TenantTransaction): Promise<ModelRouteList> {
  const routes = new Map((await listModelRoutes(trx)).map((route) => [route.purpose, route]));
  return {
    items: ROUTED_PURPOSES.map((purpose) => {
      const route = routes.get(purpose);
      return {
        purpose,
        endpoint: route?.endpointId ?? null,
        setBy: route?.setBy ?? null,
        setAt: route?.setAt.toISOString() ?? null,
      };
    }),
  };
}

export function modelEndpointHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  connector?: ConnectorOptions,
) {
  const client = connector ? createConnectorClient(connector) : undefined;

  function connected() {
    if (!client) {
      throw new AppError(503, 'connector_unavailable', FAILURE_WORDS.connector_unavailable);
    }
    return client;
  }

  function answered<T>(answer: Answered<T>): T {
    if ('refused' in answer) {
      throw new AppError(503, answer.refused.code, FAILURE_WORDS[answer.refused.code]);
    }
    return answer.answer;
  }

  async function held(trx: TenantTransaction, id: string): Promise<StoredModelEndpoint> {
    const endpoint = await readModelEndpoint(trx, id);
    if (!endpoint) throw notFound();
    return endpoint;
  }

  return {
    listModelEndpoints: async (
      _request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ModelEndpointList> => {
      const endpoints = await listModelEndpoints(trx);
      const items: ModelEndpointView[] = [];
      for (const endpoint of endpoints) items.push(await endpointView(trx, endpoint));
      return { items };
    },

    makeModelEndpoint: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ModelEndpointAnswer> => {
      const body = request.body as ModelEndpointBody;
      const made = written(await makeModelEndpoint(trx, body, principalId));
      return { endpoint: await endpointView(trx, made) };
    },

    getModelEndpoint: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ModelEndpointAnswer> => {
      const { id } = request.params as ModelEndpointParams;
      return { endpoint: await endpointView(trx, await held(trx, id)) };
    },

    changeModelEndpoint: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ModelEndpointAnswer> => {
      const { id } = request.params as ModelEndpointParams;
      const changed = written(
        await changeModelEndpoint(trx, id, request.body as ModelEndpointBody),
      );
      return { endpoint: await endpointView(trx, changed) };
    },

    retireModelEndpoint: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<ModelEndpointAnswer> => {
      const { id } = request.params as ModelEndpointParams;
      return { endpoint: await endpointView(trx, written(await retireModelEndpoint(trx, id))) };
    },

    setModelEndpointKey: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ModelEndpointAnswer> => {
      const { id } = request.params as ModelEndpointParams;
      const endpoint = await held(trx, id);
      if (endpoint.retiredAt !== null) {
        throw new AppError(
          409,
          'endpoint_retired',
          'This endpoint is retired, so it takes no key.',
        );
      }
      const { key } = request.body as ModelKeyBody;
      // Sealed by the connector with a key the service never holds, for this endpoint and the host
      // it points at; only what comes back is kept. Sealing reaches no endpoint, so it is asked in
      // the deciding transaction, with the write it answers (G1-B).
      const { sealed } = answered(
        await connected().sealModel({
          tenant: tenantOf(request).id,
          endpoint: { id: endpoint.id, protocol: endpoint.protocol, baseUrl: endpoint.baseUrl },
          secret: key,
        }),
      );
      await setModelCredential(trx, endpoint, sealed, principalId);
      return { endpoint: await endpointView(trx, endpoint) };
    },

    testModelEndpoint: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as ModelEndpointParams;
      const endpoint = await held(trx, id);
      if (endpoint.retiredAt !== null) throw unusable();
      const sealed = await usableModelKey(trx, endpoint);
      if (sealed === undefined) throw unusable();
      const asking = connected();
      const tenant = tenantOf(request);
      const context = contextOf(request);
      // Decided and read here; the endpoint is called once this transaction, and its lock on access,
      // is let go, as a connection's test is (the D1 fix, C4).
      return new AfterCommit(async (): Promise<ModelTestAnswer> => {
        const call = TEST_CALL(endpoint.model);
        const digest = createHash('sha256').update(canonicalCall(call), 'utf8').digest('hex');
        const run = await db.withTenant(
          tenant,
          (inner) =>
            startRun(inner, {
              purpose: 'test',
              endpoint,
              parameters: call.parameters,
              contextDigest: digest,
              by: principalId,
            }),
          context,
        );
        const started = Date.now();
        let reply = '';
        const answer = await asking.model(
          {
            requestId: randomUUID(),
            tenant: tenant.id,
            endpoint: { id: endpoint.id, protocol: endpoint.protocol, baseUrl: endpoint.baseUrl },
            sealed,
            call,
            deadlineMs: TEST_DEADLINE_MS,
          },
          (event) => {
            if (event.type === 'text') reply += event.text;
          },
        );
        const ms = Date.now() - started;
        const last =
          'refused' in answer
            ? ({ type: 'failed', failure: { code: answer.refused.code } } as const)
            : answer.answer;
        const ended = await db
          .withTenant(
            tenant,
            async (inner) => {
              const recorded = await endRun(
                inner,
                run,
                last.type === 'ended'
                  ? { outcome: 'finished', model: last.model, usage: last.usage }
                  : { outcome: last.failure.code },
              );
              await recordEndpointTest(
                inner,
                endpoint.id,
                run,
                last.type === 'ended' ? 'passed' : 'failed',
              );
              if (recorded.alertFailed) request.log.error('a budget alert could not be sent');
              return recorded;
            },
            context,
          )
          .catch(async (error: unknown) => {
            // Its run is never left running: ended as the connector's failure, best effort, and the
            // test's own failure answered (the final review).
            await db
              .withTenant(
                tenant,
                (inner) => endRun(inner, run, { outcome: 'connector_error' }),
                context,
              )
              .catch(() => undefined);
            throw error;
          });
        return last.type === 'ended'
          ? {
              run,
              outcome: 'passed',
              reply,
              model: last.model,
              tokensIn: ended.tokensIn,
              tokensOut: ended.tokensOut,
              cost: priced(ended.costMicros),
              ms,
            }
          : {
              run,
              outcome: 'failed',
              tokensIn: null,
              tokensOut: null,
              cost: null,
              ms,
              failure: failureView(last.failure),
            };
      });
    },

    listModelRoutes: async (_request: FastifyRequest, { trx }: Authorised) => routesView(trx),

    setModelRoute: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<ModelRouteList> => {
      const { purpose } = request.params as ModelRouteParams;
      const { endpoint: id } = request.body as ModelRouteBody;
      if (id !== null) {
        const endpoint = await readModelEndpoint(trx, id, true);
        if (!endpoint) throw notFound();
        if (endpoint.retiredAt !== null) throw unusable();
        if ((await usableModelKey(trx, endpoint)) === undefined) throw unusable();
        // Embedding speaks OpenAI's `/embeddings` alone, which self-hosted servers speak too (G7-A).
        if (purpose === 'embedding' && endpoint.protocol !== 'openai') {
          throw new AppError(
            409,
            'embedding_unsupported',
            'Embedding needs an endpoint speaking the OpenAI protocol.',
          );
        }
      }
      await setModelRoute(trx, purpose, id, principalId);
      // A model the store does not serve waits for an administrator's confirmation (G7-J).
      if (purpose === 'embedding') {
        const routed = id === null ? undefined : await readModelEndpoint(trx, id);
        await routeEmbedding(trx, routed ? { id: routed.id, model: routed.model } : null);
      }
      return routesView(trx);
    },
  };
}
