import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { PageQuery } from './components.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

const reason = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .describe(
    'Why, trimmed, 1 to 2000 characters. Shown only in Administration, never in the audit log',
  );

/** Placing a hold: on an artifact or on a space, never both, and why (the AH plan, AH-F). */
export const HoldBody = z.strictObject({
  target: z
    .union([
      z.strictObject({
        artifact: LowercaseUuid.describe('A component, document, publication or asset, by its id'),
      }),
      z.strictObject({
        space: LowercaseUuid.describe('A space, by its id: holds every artifact in it'),
      }),
    ])
    .describe('What to hold: an artifact, or a space and everything in it'),
  reason,
});
export type HoldBody = z.infer<typeof HoldBody>;

export const ReleaseHoldBody = z.strictObject({ reason });
export type ReleaseHoldBody = z.infer<typeof ReleaseHoldBody>;

export const HoldParams = z.object({ id: LowercaseUuid });
export type HoldParams = z.infer<typeof HoldParams>;

const Person = z.object({
  id: z.string(),
  name: z
    .string()
    .nullable()
    .describe('Their display name, or address; null where neither is known'),
});

export const HoldView = z.object({
  id: z.string(),
  target: z.object({
    kind: z.enum(['component', 'document', 'publication', 'asset', 'space']),
    id: z.string(),
    title: z.string().nullable().describe('Its title or name now; null where it has none'),
  }),
  reason: z.string().describe('Why it was placed'),
  appliedBy: Person,
  appliedAt: z.string().describe('When it was placed'),
  released: z
    .object({
      reason: z.string().describe('Why it was released'),
      by: Person,
      at: z.string(),
    })
    .nullable()
    .describe('Its release; null while it is in force'),
});
export type HoldView = z.infer<typeof HoldView>;

export const HoldList = z.object({
  items: z.array(HoldView),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
  total: z.number().int().describe('How many holds there are in all, released ones too'),
});
export type HoldList = z.infer<typeof HoldList>;

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
  description: 'The caller may not administer this environment',
  schema: ErrorBody,
} as const;

/** Legal holds (lifecycle.md; the AH plan, AH-F to AH-I), each an environment administrator's. */
export const holdRoutes = {
  placeHold: {
    operationId: 'placeHold',
    method: 'POST',
    path: '/v1/holds',
    summary: 'Place a legal hold on an artifact or a space',
    tenantScoped: true,
    access: administer,
    body: HoldBody,
    responses: {
      200: { description: 'Placed, and in force', schema: HoldView },
      400: { description: 'No target, two, or an empty reason', schema: ErrorBody },
      401: unauthenticated,
      403: forbidden,
      404: {
        description: 'No such artifact or space in this environment, or an artifact no hold takes',
        schema: ErrorBody,
      },
    },
  },
  releaseHold: {
    operationId: 'releaseHold',
    method: 'POST',
    path: '/v1/holds/{id}/release',
    summary: 'Release a legal hold',
    tenantScoped: true,
    access: administer,
    params: HoldParams,
    body: ReleaseHoldBody,
    responses: {
      200: { description: 'Released', schema: HoldView },
      400: { description: 'An empty reason', schema: ErrorBody },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'No such hold in this environment', schema: ErrorBody },
      409: { description: 'hold_released: it was released already', schema: ErrorBody },
    },
  },
  listHolds: {
    operationId: 'listHolds',
    method: 'GET',
    path: '/v1/holds',
    summary: 'Every legal hold, in force or released, newest first',
    tenantScoped: true,
    access: administer,
    query: PageQuery,
    responses: {
      200: { description: 'A page of holds', schema: HoldList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
    },
  },
} as const satisfies Record<string, RouteContract>;
