import { z } from 'zod';
import { pageQuery } from './listing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

const Instant = z.string().datetime({ offset: true });

export const AuditListQuery = z.object({
  ...pageQuery,
  actor: LowercaseUuid.optional().describe('Only what this principal did'),
  kind: z
    .string()
    .max(64)
    .regex(/^[a-z][a-z_]*(\.[a-z_]*)?$/, 'Expected a kind, or its family and a dot')
    .optional()
    .describe('Only events of this kind, `space.renamed`, or of its family, `space.`'),
  from: Instant.optional().describe('Only events at or after this instant'),
  to: Instant.optional().describe('Only events at or before this instant, to the millisecond'),
  subject: LowercaseUuid.optional().describe('Only events about this thing, by its id'),
  space: LowercaseUuid.optional().describe('Only events in this space'),
});
export type AuditListQuery = z.infer<typeof AuditListQuery>;

export const AuditLabelView = z.object({
  text: z.string().describe("The name or title as it was, or `erased` once a person's are"),
  erased: z.boolean(),
});

export const AuditEventView = z.object({
  sequence: z
    .string()
    .describe("The event's place in the log: order is the sequence's, never the time's"),
  at: z.string().describe('When, in UTC'),
  kind: z.string(),
  actorKind: z.enum(['person', 'token', 'system', 'vendor', 'anonymous']),
  actor: z.string().nullable().describe('The principal who acted, by session or by token'),
  token: z.string().nullable().describe('The token they acted by, where they did'),
  subject: z
    .object({ kind: z.string(), id: z.string().nullable(), version: z.string().nullable() })
    .nullable()
    .describe('What it was about, and the version acted on'),
  space: z.string().nullable(),
  outcome: z.enum(['done', 'refused']),
  detail: z
    .record(z.string(), z.unknown())
    .describe("Identifiers, names, codes and rules, by the kind's own shape; never a value"),
  traceId: z.string().nullable().describe("The request's trace id"),
  labels: z
    .record(z.string(), AuditLabelView)
    .describe(
      'By role - `actor`, `subject`, `space` and others - kept for when the originals are gone',
    ),
});
export type AuditEventView = z.infer<typeof AuditEventView>;

export const AuditList = z.object({
  items: z.array(AuditEventView),
  next: z.string().nullable().describe('The cursor for the next page, or null at the end'),
});
export type AuditList = z.infer<typeof AuditList>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const forbidden = {
  description: 'The caller may not administer this environment',
  schema: ErrorBody,
} as const;

/**
 * The audit log (audit.md, "Reading and export"): read by whoever may administer the environment, a
 * token holding `administer` as a person does (AU-G).
 */
export const auditRoutes = {
  listAuditEvents: {
    operationId: 'listAuditEvents',
    method: 'GET',
    path: '/v1/audit',
    summary: "The environment's audit log, newest first, filtered, a page at a time",
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    query: AuditListQuery,
    responses: {
      200: { description: 'A page of events, each with its labels', schema: AuditList },
      400: {
        description:
          'audit_filter_invalid: a kind the log does not hold, or from after to. invalid_request: a cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbidden,
    },
  },
} as const;
