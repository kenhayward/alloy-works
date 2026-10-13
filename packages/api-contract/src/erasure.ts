import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** A person, by their principal's id. */
export const ErasureParams = z.object({ id: LowercaseUuid });
export type ErasureParams = z.infer<typeof ErasureParams>;

/** Why erasing a person is refused (the ER plan, ER-C): every reason, not the first. */
export const ErasureRefusalView = z.object({
  code: z
    .enum(['granted', 'self', 'service'])
    .describe(
      'granted: a grant names them, `grants` saying how many; remove their access first. self: nobody erases themselves. service: a service principal is no person',
    ),
  grants: z.int().positive().optional().describe('granted: how many grants name them'),
});
export type ErasureRefusalView = z.infer<typeof ErasureRefusalView>;

/** What erasing a person takes, what stays, and what refuses it now (VER-038; ER-B). */
export const ErasureView = z.object({
  person: z.object({
    id: z.string(),
    kind: z.enum(['user', 'service', 'external']),
    invited: z
      .boolean()
      .describe('Invited and never signed in: erasing withdraws the invitation, and them with it'),
    erased: z.boolean().describe('Whether they are erased now'),
  }),
  erases: z
    .object({
      sessions: z.int().nonnegative().describe('Sessions ended'),
      tokens: z.int().nonnegative().describe('API tokens revoked'),
      memberships: z.int().nonnegative().describe('Group memberships removed'),
      invitation: z.boolean().describe('Whether an invitation holding their address is removed'),
      labels: z
        .int()
        .nonnegative()
        .describe(
          'Audit log labels naming them now, each taking a fixed word; those the erasure itself records are erased too',
        ),
    })
    .describe(
      'What goes: their name, which becomes "Erased person", their address, and every audit label naming them, with their access',
    ),
  remains: z
    .object({
      events: z.int().nonnegative().describe('Audit events recorded against them, by id'),
    })
    .describe(
      "What stays: their id and their provider's identifier for them, which refuses any later sign-in; every event against the id; what they wrote, titles, comments and messages; what a data source recorded seeing them as, no longer shown; audit exports made before; and the erasure's own event",
    ),
  refusals: z
    .array(ErasureRefusalView)
    .describe('Everything refusing erasure now; empty where they may be erased, or are erased'),
});
export type ErasureView = z.infer<typeof ErasureView>;

export const Erased = z.object({
  erased: z.literal(true),
  labels: z
    .int()
    .nonnegative()
    .describe('How many audit labels this erasure erased; 0 where they were erased already'),
});
export type Erased = z.infer<typeof Erased>;

/** An erasure refused: every reason. */
export const ErasureRefused = ErrorBody.extend({
  refusals: z.array(ErasureRefusalView).optional().describe('erasure_refused: every reason'),
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
  description: 'The caller may not administer this environment',
  schema: ErrorBody,
} as const;
const forbiddenOrToken = {
  description:
    'The caller may not administer this environment; or token_not_allowed: a token never erases',
  schema: ErrorBody,
} as const;
const missing = { description: 'No such person in this environment', schema: ErrorBody } as const;

/** Erasing a person (lifecycle.md, "Erasure"; the ER plan, ER-A to ER-F), an environment administrator's. */
export const erasureRoutes = {
  getErasure: {
    operationId: 'getErasure',
    method: 'GET',
    path: '/v1/principals/{id}/erasure',
    summary: 'What erasing a person takes, what stays, and what refuses it',
    tenantScoped: true,
    access: administer,
    params: ErasureParams,
    responses: {
      200: { description: 'What erasing them would do now', schema: ErasureView },
      401: unauthenticated,
      403: forbidden,
      404: missing,
    },
  },
  erasePrincipal: {
    operationId: 'erasePrincipal',
    method: 'POST',
    path: '/v1/principals/{id}/erase',
    summary: 'Erase a person: their name, address and audit labels, and their access',
    tenantScoped: true,
    // A person at the keyboard, never a token: erasure cannot be undone (the ER final review).
    access: { ...administer, changesAccess: true, credential: 'session' },
    params: ErasureParams,
    responses: {
      200: { description: 'Erased, or erased already', schema: Erased },
      401: unauthenticated,
      403: forbiddenOrToken,
      404: missing,
      409: {
        description: 'erasure_refused: a grant names them, they are the caller, or a service',
        schema: ErasureRefused,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
