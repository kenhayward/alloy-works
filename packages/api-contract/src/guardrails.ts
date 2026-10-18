import { GUARDRAIL_SIDES, guardrailSchema } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const GuardrailParams = z.object({ id: LowercaseUuid });

export const GuardrailBody = guardrailSchema;
export type GuardrailBody = z.infer<typeof GuardrailBody>;

export const GuardrailView = z.object({
  id: z.string(),
  phrase: z.string(),
  applies: z.enum(GUARDRAIL_SIDES),
  reason: z.string(),
  madeAt: z.string(),
  retiredAt: z.string().nullable(),
});

export const GuardrailList = z.object({
  items: z
    .array(GuardrailView)
    .describe('Every rule, those in force first: an environment’s own list, never paged'),
});

export const GuardrailListQuery = z.object({
  retired: z.enum(['true', 'false']).optional().describe('`true` lists the retired too'),
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
 * Guardrails (generation.md, "Guardrails"; the G5 plan, G5-F): phrases an environment forbids in what
 * a model is sent and what it returns, each with its reason, administered and audited. No rule reaches
 * what the assistant may do: that floor is the product's.
 */
export const guardrailRoutes = {
  listGuardrails: {
    operationId: 'listGuardrails',
    method: 'GET',
    path: '/v1/guardrails',
    summary: 'The environment’s guardrails',
    tenantScoped: true,
    access: administer,
    query: GuardrailListQuery,
    responses: {
      200: { description: 'The guardrails', schema: GuardrailList },
      401: unauthenticated,
      403: forbidden,
    },
  },
  setGuardrail: {
    operationId: 'setGuardrail',
    method: 'POST',
    path: '/v1/guardrails',
    summary: 'Forbid a phrase in what a model is sent, what it returns, or both',
    tenantScoped: true,
    access: administer,
    body: GuardrailBody,
    responses: {
      200: { description: 'Set, in force from the next call', schema: GuardrailView },
      400: {
        description: 'A phrase or reason empty, too long, or holding a control character',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
    },
  },
  retireGuardrail: {
    operationId: 'retireGuardrail',
    method: 'POST',
    path: '/v1/guardrails/{id}/retirement',
    summary: 'Retire a guardrail, kept as the reason any run it refused was',
    tenantScoped: true,
    access: administer,
    params: GuardrailParams,
    responses: {
      200: { description: 'Retired', schema: GuardrailView },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'No guardrail in force by that id', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
