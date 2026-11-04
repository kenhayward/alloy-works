import { TENANT_STATES } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

/** Closing this environment (ADM-029, ADM-030; tenant-lifecycle.md, TL-E to TL-H). */

export const ClosureView = z.object({
  state: z.enum(TENANT_STATES).describe('Where this environment is in its life'),
  name: z.string().describe('Its name, which closing asks to have typed'),
  since: z.iso.datetime().describe('When it came to be in this state'),
  graceEndsAt: z.iso
    .datetime()
    .nullable()
    .describe(
      'When closing can no longer be cancelled, unless a hold keeps it; null if not closing',
    ),
  closedBy: z
    .enum(['person', 'operator'])
    .nullable()
    .describe("Who began a closure: only the operator may cancel the operator's"),
  holds: z
    .number()
    .int()
    .nonnegative()
    .describe('Legal holds in force, each of which keeps it all'),
  graceDays: z.number().int().positive(),
  deletionDays: z.number().int().positive(),
  effects: z
    .record(z.string(), z.string())
    .describe('What stops and what continues while it closes (ADM-045)'),
  mayCancel: z.boolean().describe('Whether the one asking may give the closure up'),
});
export type ClosureView = z.infer<typeof ClosureView>;

export const ClosureBody = z
  .strictObject({
    name: z.string().describe("This environment's name, typed"),
    export: z
      .uuid()
      .optional()
      .describe('A whole export asked for in the last 24 hours, and finished'),
    declined: z.literal(true).optional().describe('Whoever closes it refuses the export offered'),
  })
  .describe('An answer about the export is required: an export taken, or one declined');
export type ClosureBody = z.infer<typeof ClosureBody>;

const CLOSING = {
  check: 'permission',
  permission: 'close_environment',
  target: { tenant: true },
  recentSignIn: 600,
  credential: 'session',
} as const;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

const forbidden = {
  description:
    '`close_environment`, or to begin one also `export_environment` and `export_audit`, is not held at this environment, or the sign-in is older than ten minutes, or the operator began this closure',
  schema: ErrorBody,
} as const;

export const closureRoutes = {
  getClosure: {
    operationId: 'getClosure',
    method: 'GET',
    path: '/v1/closure',
    summary: 'Where this environment is in its life, and what closing it would do',
    tenantScoped: true,
    openWhileClosing: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'Its state', schema: ClosureView },
      401: unauthenticated,
      403: { description: '`close_environment` is not held here', schema: ErrorBody },
    },
  },
  startClosure: {
    operationId: 'startClosure',
    method: 'POST',
    path: '/v1/closure',
    summary: 'Close this environment, beginning its grace period',
    tenantScoped: true,
    access: CLOSING,
    idempotencyKey: false,
    body: ClosureBody,
    responses: {
      200: { description: 'Closing', schema: ClosureView },
      401: unauthenticated,
      403: forbidden,
      409: { description: 'It is not somewhere it can be closed from', schema: ErrorBody },
      422: {
        description: 'The name does not match, or the export was neither answered for nor recent',
        schema: ErrorBody,
      },
    },
  },
  cancelClosure: {
    operationId: 'cancelClosure',
    method: 'DELETE',
    path: '/v1/closure',
    summary: 'Give up closing this environment, while that can still be done',
    tenantScoped: true,
    openWhileClosing: true,
    access: CLOSING,
    idempotencyKey: false,
    responses: {
      200: { description: 'Back as it was', schema: ClosureView },
      401: unauthenticated,
      403: forbidden,
      409: { description: 'It is not closing, or deletion has begun', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
