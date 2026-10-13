import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** Setting or clearing one keep (the DL plan, DL-G): by a kind, a space or both, never neither. */
export const RetentionBody = z
  .strictObject({
    kind: z
      .enum(['component', 'document'])
      .nullable()
      .describe('The kind it keeps; null for every kind in the space'),
    space: LowercaseUuid.nullable().describe(
      'The space whose content it keeps, by its id; null for the kind in every space',
    ),
    days: z
      .int()
      .min(1)
      .max(36_500)
      .nullable()
      .describe('The minimum in days, from the latest version, before deletion; null clears it'),
  })
  .refine((body) => body.kind !== null || body.space !== null, {
    message: 'Name a kind, a space or both',
  });
export type RetentionBody = z.infer<typeof RetentionBody>;

/** A keep in force. */
export const KeepView = z.object({
  kind: z.enum(['component', 'document']).nullable().describe('null: every kind in the space'),
  space: z
    .object({ id: z.string(), name: z.string() })
    .nullable()
    .describe('null: the kind in every space'),
  days: z.int().describe('The minimum in days, from the latest version'),
  by: z.object({
    id: z.string(),
    name: z
      .string()
      .nullable()
      .describe('Their display name, or address; null where neither is known'),
  }),
  at: z.string().describe('When it was set'),
});
export type KeepView = z.infer<typeof KeepView>;

export const RetentionView = z.object({
  keeps: z
    .array(KeepView)
    .describe(
      "The keeps in force, each kind's first, then by space. Every one reaching an artifact applies and the longest wins",
    ),
});
export type RetentionView = z.infer<typeof RetentionView>;

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

/** Retention keeps (lifecycle.md, "Retention"; the DL plan, DL-G), each an environment administrator's. */
export const retentionRoutes = {
  getRetention: {
    operationId: 'getRetention',
    method: 'GET',
    path: '/v1/retention',
    summary: 'The retention keeps in force',
    tenantScoped: true,
    access: administer,
    responses: {
      200: { description: 'The keeps in force', schema: RetentionView },
      401: unauthenticated,
      403: forbidden,
    },
  },
  setRetention: {
    operationId: 'setRetention',
    method: 'PUT',
    path: '/v1/retention',
    summary: 'Set or clear a retention keep for a kind, a space, or a kind in a space',
    tenantScoped: true,
    access: administer,
    body: RetentionBody,
    responses: {
      200: { description: 'Set, or cleared; the keeps in force after it', schema: RetentionView },
      400: {
        description: 'Neither a kind nor a space, or days outside 1 to 36500',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
      404: { description: 'No such space in this environment', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
