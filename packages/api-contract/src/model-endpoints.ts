import {
  GENERATION_FAILURE_CODES,
  ROUTED_PURPOSES,
  UNAVAILABLE_REASONS,
  modelEndpointSchema,
  modelKeySchema,
} from '@alloy-works/domain';
import { z } from 'zod';

import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/**
 * A tenant's model endpoints and routes (generation.md, "Endpoints"; the G1 plan, G1-I): made,
 * changed, retired, keyed and tested by whoever administers the environment. A key is written and
 * never answered.
 */
export const ModelEndpointParams = z.object({ id: LowercaseUuid });
export type ModelEndpointParams = z.infer<typeof ModelEndpointParams>;

export const ModelRouteParams = z.object({ purpose: z.enum(ROUTED_PURPOSES) });
export type ModelRouteParams = z.infer<typeof ModelRouteParams>;

/** The domain's settings, with examples a reader can try: a base URL and a currency are checked. */
const settings = modelEndpointSchema.extend({
  baseUrl: modelEndpointSchema.shape.baseUrl.meta({ examples: ['https://api.anthropic.com'] }),
  model: modelEndpointSchema.shape.model.meta({ examples: ['claude-sonnet-5-5'] }),
  currency: modelEndpointSchema.shape.currency.meta({ examples: ['USD'] }),
});

export const ModelEndpointBody = settings.describe(
  "An endpoint's settings: its protocol, where it answers, the model, how many tokens it accepts, its prices per million tokens, and whether it sits outside the environment's data boundary",
);
export type ModelEndpointBody = z.infer<typeof ModelEndpointBody>;

export const ModelKeyBody = z.strictObject({
  key: modelKeySchema.describe(
    "The provider account's key: sent in the protocol's own header, sealed by the connector, and never answered by any route",
  ),
});
export type ModelKeyBody = z.infer<typeof ModelKeyBody>;

export const ModelRouteBody = z.strictObject({
  endpoint: LowercaseUuid.nullable().describe(
    'The endpoint this purpose goes to, or null for none',
  ),
});
export type ModelRouteBody = z.infer<typeof ModelRouteBody>;

const KeyState = z
  .discriminatedUnion('set', [
    z.object({ set: z.literal(false) }),
    z.object({
      set: z.literal(true),
      setBy: z.string().nullable(),
      setAt: z.string(),
      needsSetting: z
        .boolean()
        .describe(
          'The base URL moved to another host after the key was set: set it again to use it',
        ),
    }),
  ])
  .describe('Whether a key is set, never the key');

export const ModelEndpointView = settings.extend({
  id: z.string(),
  madeAt: z.string(),
  changedAt: z.string(),
  retiredAt: z.string().nullable(),
  key: KeyState,
});
export type ModelEndpointView = z.infer<typeof ModelEndpointView>;

export const ModelEndpointAnswer = z.object({ endpoint: ModelEndpointView });
export type ModelEndpointAnswer = z.infer<typeof ModelEndpointAnswer>;

export const ModelEndpointList = z.object({ items: z.array(ModelEndpointView) });
export type ModelEndpointList = z.infer<typeof ModelEndpointList>;

export const ModelRouteView = z.object({
  purpose: z.enum(ROUTED_PURPOSES),
  endpoint: z.string().nullable(),
  setBy: z.string().nullable(),
  setAt: z.string().nullable(),
});
export const ModelRouteList = z.object({ items: z.array(ModelRouteView) });
export type ModelRouteList = z.infer<typeof ModelRouteList>;

export const ModelFailure = z.object({
  code: z.enum(GENERATION_FAILURE_CODES),
  reason: z.enum(UNAVAILABLE_REASONS).optional(),
  message: z.string(),
});

export const ModelTestAnswer = z.object({
  run: z.string().describe('The run the test was recorded as'),
  outcome: z.enum(['passed', 'failed']),
  reply: z.string().optional().describe('What the model answered, as it streamed'),
  model: z.string().optional().describe('The model the reply named, with its release'),
  tokensIn: z.number().int().nullable(),
  tokensOut: z.number().int().nullable(),
  cost: z
    .string()
    .nullable()
    .describe(
      "What it cost, in the endpoint's currency, to six places, or null where no tokens were reported",
    ),
  ms: z.number().int(),
  failure: ModelFailure.optional(),
});
export type ModelTestAnswer = z.infer<typeof ModelTestAnswer>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may not administer this environment',
  schema: ErrorBody,
} as const;
const missing = { description: 'No such endpoint in this environment', schema: ErrorBody } as const;
const ADMINISTER = {
  check: 'permission',
  permission: 'administer',
  target: { tenant: true },
} as const;

export const modelEndpointRoutes = {
  listModelEndpoints: {
    operationId: 'listModelEndpoints',
    method: 'GET',
    path: '/v1/model-endpoints',
    summary: "The environment's model endpoints, those in use first",
    tenantScoped: true,
    access: ADMINISTER,
    responses: {
      200: {
        description: 'Every endpoint, each with whether its key is set',
        schema: ModelEndpointList,
      },
      401: unauthenticated,
      403: forbidden,
    },
  },
  makeModelEndpoint: {
    operationId: 'makeModelEndpoint',
    method: 'POST',
    path: '/v1/model-endpoints',
    summary: 'Make a model endpoint, saying whether it sits outside the data boundary',
    tenantScoped: true,
    access: ADMINISTER,
    body: ModelEndpointBody,
    responses: {
      200: { description: 'Made, with no key yet', schema: ModelEndpointAnswer },
      400: { description: 'Settings that are not valid', schema: ErrorBody },
      401: unauthenticated,
      403: forbidden,
      409: {
        description: '`endpoint_name_taken`: another endpoint in use has this name',
        schema: ErrorBody,
      },
    },
  },
  getModelEndpoint: {
    operationId: 'getModelEndpoint',
    method: 'GET',
    path: '/v1/model-endpoints/{id}',
    summary: 'A model endpoint, and whether its key is set',
    tenantScoped: true,
    access: ADMINISTER,
    params: ModelEndpointParams,
    responses: {
      200: { description: 'The endpoint', schema: ModelEndpointAnswer },
      401: unauthenticated,
      403: forbidden,
      404: missing,
    },
  },
  changeModelEndpoint: {
    operationId: 'changeModelEndpoint',
    method: 'PUT',
    path: '/v1/model-endpoints/{id}',
    summary: "Change a model endpoint's settings; its protocol stays",
    tenantScoped: true,
    access: ADMINISTER,
    params: ModelEndpointParams,
    body: ModelEndpointBody,
    responses: {
      200: { description: 'Changed', schema: ModelEndpointAnswer },
      400: { description: 'Settings that are not valid', schema: ErrorBody },
      401: unauthenticated,
      403: forbidden,
      404: missing,
      409: {
        description:
          '`endpoint_name_taken`, `endpoint_retired`, or `endpoint_protocol_fixed`: a protocol never changes',
        schema: ErrorBody,
      },
    },
  },
  retireModelEndpoint: {
    operationId: 'retireModelEndpoint',
    method: 'POST',
    path: '/v1/model-endpoints/{id}/retirement',
    summary: 'Retire a model endpoint: every purpose routed to it goes nowhere',
    tenantScoped: true,
    access: ADMINISTER,
    params: ModelEndpointParams,
    responses: {
      200: {
        description: 'Retired; kept, so the runs it made still name it',
        schema: ModelEndpointAnswer,
      },
      401: unauthenticated,
      403: forbidden,
      404: missing,
    },
  },
  setModelEndpointKey: {
    operationId: 'setModelEndpointKey',
    method: 'PUT',
    path: '/v1/model-endpoints/{id}/key',
    summary: "Set or replace a model endpoint's key, sealed by the connector and never answered",
    tenantScoped: true,
    access: ADMINISTER,
    params: ModelEndpointParams,
    body: ModelKeyBody,
    idempotencyKey: false,
    responses: {
      200: { description: 'Set: who set it and when, never the key', schema: ModelEndpointAnswer },
      400: {
        description: 'A key that is not printable ASCII of up to 4,096 bytes',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
      404: missing,
      409: { description: '`endpoint_retired`: a retired endpoint takes none', schema: ErrorBody },
      503: { description: '`connector_unavailable` or `connector_busy`', schema: ErrorBody },
    },
  },
  testModelEndpoint: {
    operationId: 'testModelEndpoint',
    method: 'POST',
    path: '/v1/model-endpoints/{id}/test',
    summary:
      'Test a model endpoint with one short call, recorded as a run with its tokens and cost',
    tenantScoped: true,
    access: ADMINISTER,
    params: ModelEndpointParams,
    idempotencyKey: false,
    responses: {
      200: {
        description:
          'Its reply, the model it named, its tokens, cost and time; or how it failed: `model_unavailable` with a reason, `model_mismatch`, `context_too_large` or `timeout`, never another endpoint tried',
        schema: ModelTestAnswer,
      },
      401: unauthenticated,
      403: forbidden,
      404: missing,
      409: {
        description: '`endpoint_unusable`: retired, or with no key set for where it points',
        schema: ErrorBody,
      },
      503: { description: '`connector_unavailable` or `connector_busy`', schema: ErrorBody },
    },
  },
  listModelRoutes: {
    operationId: 'listModelRoutes',
    method: 'GET',
    path: '/v1/model-routes',
    summary: 'Which model endpoint each purpose goes to',
    tenantScoped: true,
    access: ADMINISTER,
    responses: {
      200: { description: 'Every purpose, and its endpoint or none', schema: ModelRouteList },
      401: unauthenticated,
      403: forbidden,
    },
  },
  setModelRoute: {
    operationId: 'setModelRoute',
    method: 'PUT',
    path: '/v1/model-routes/{purpose}',
    summary: 'Send a purpose to a model endpoint, or to none',
    tenantScoped: true,
    access: ADMINISTER,
    params: ModelRouteParams,
    body: ModelRouteBody,
    responses: {
      200: { description: 'Every purpose, as now routed', schema: ModelRouteList },
      400: { description: 'A purpose or an endpoint that is not one', schema: ErrorBody },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'The endpoint named is not one of this environment', schema: ErrorBody },
      409: {
        description:
          '`endpoint_unusable`: the endpoint is retired, or has no key set for where it points; `embedding_unsupported`: embedding routed to an endpoint not speaking the OpenAI protocol',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
