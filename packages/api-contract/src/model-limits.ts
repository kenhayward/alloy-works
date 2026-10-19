import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid, PersonView } from './schemas.js';

/** The most runs an hour a limit may allow, as `RUNS_AN_HOUR_MOST` says. */
const PerHour = z.number().int().min(1).max(100_000);

export const ModelLimitBody = z.object({
  perHour: PerHour.nullable().describe('Runs an hour each person may start; null lifts the limit'),
});
export type ModelLimitBody = z.infer<typeof ModelLimitBody>;

export const PersonLimitParams = z.object({ principal: LowercaseUuid });

export const PersonLimitBody = z.object({
  perHour: PerHour.nullable().describe(
    "Runs an hour this person may start, in place of the environment's; null removes it",
  ),
});
export type PersonLimitBody = z.infer<typeof PersonLimitBody>;

/** A run refused for its person's hourly limit (GEN-035), saying when one is free again. */
export const RateLimitedRefusal = ErrorBody.extend({
  resetsAt: z.string().describe('When the person may start a run again'),
});

/** The answer each route that starts a run gives a person over their limit. */
export const rateLimited = {
  description: '`model_rate_limited`: the caller has started as many runs this hour as they may',
  schema: RateLimitedRefusal,
} as const;

export const ModelLimitsView = z.object({
  perHour: z.number().int().nullable().describe("The environment's limit; null, unlimited"),
  people: z
    .array(z.object({ person: PersonView, perHour: z.number().int() }))
    .describe('Each person with a limit of their own, the latest set first'),
});

const administer = {
  check: 'permission',
  permission: 'administer',
  target: { tenant: true },
} as const;
const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller does not administer this environment',
  schema: ErrorBody,
} as const;

/**
 * Rate limits (generation.md, "Cost"; the G6 plan, G6-A; GEN-035): how many model runs each person may
 * start an hour, the environment's and one person's own. A run over it is refused with
 * `model_rate_limited` and when one is free again.
 */
export const modelLimitRoutes = {
  getModelLimits: {
    operationId: 'getModelLimits',
    method: 'GET',
    path: '/v1/model-limits',
    summary: 'How many model runs each person may start an hour',
    tenantScoped: true,
    access: administer,
    responses: {
      200: { description: 'The limits', schema: ModelLimitsView },
      401: unauthenticated,
      403: forbidden,
    },
  },
  setModelLimit: {
    operationId: 'setModelLimit',
    method: 'PUT',
    path: '/v1/model-limits',
    summary: "Set the environment's runs an hour per person",
    tenantScoped: true,
    access: administer,
    body: ModelLimitBody,
    responses: {
      200: { description: 'Set, in force from the next run', schema: ModelLimitsView },
      400: { description: 'A limit not a whole number from 1 to 100000', schema: ErrorBody },
      401: unauthenticated,
      403: forbidden,
    },
  },
  setPersonLimit: {
    operationId: 'setPersonLimit',
    method: 'PUT',
    path: '/v1/model-limits/people/{principal}',
    summary: "Set one person's runs an hour, in place of the environment's",
    tenantScoped: true,
    access: administer,
    params: PersonLimitParams,
    body: PersonLimitBody,
    responses: {
      200: { description: 'Set, in force from their next run', schema: ModelLimitsView },
      400: { description: 'A limit not a whole number from 1 to 100000', schema: ErrorBody },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'No person in this environment by that id', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
