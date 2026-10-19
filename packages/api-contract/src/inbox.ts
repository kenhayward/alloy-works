import { z } from 'zod';
import { nextCursor, pageQuery } from './listing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

export const InboxQuery = z.strictObject({
  ...pageQuery,
  unread: z.enum(['true']).optional().describe('Only those not yet read'),
});
export type InboxQuery = z.infer<typeof InboxQuery>;

export const NotificationParams = z.object({ id: LowercaseUuid });
export type NotificationParams = z.infer<typeof NotificationParams>;

const Place = z.object({
  id: LowercaseUuid,
  title: z
    .string()
    .nullable()
    .describe('Its title, to a reader of it now alone; null to anybody else'),
  state: z
    .object({ key: z.string(), name: z.string() })
    .nullable()
    .describe('Its workflow state now (LIF-005), to a reader of it alone; null to anybody else'),
});

/** One notification (COL-063): what happened, by whom, where - never the text (COL-036). */
export const NotificationView = z.object({
  id: LowercaseUuid,
  kind: z.enum(['mention', 'reply', 'resolution', 'round', 'digest', 'budget']),
  actor: z
    .object({
      id: LowercaseUuid,
      name: z.string().nullable(),
      external: z.literal(true).optional().describe('From outside the organisation (IAM-045)'),
    })
    .nullable()
    .describe('Who did it; null on a digest, or where the caller may no longer read what it is on'),
  thread: LowercaseUuid.nullable().describe(
    'The thread; null on a digest, or where the caller may no longer read what it is on',
  ),
  round: LowercaseUuid.nullable().describe(
    'The round a person was named a reviewer on (RR-H); null otherwise, or where the caller may no longer read its document',
  ),
  on: Place.nullable().describe('What the thread is on, or the round’s document; null on a digest'),
  counts: z
    .object({
      mention: z.int().nonnegative(),
      reply: z.int().nonnegative(),
      resolution: z.int().nonnegative(),
      round: z.int().nonnegative().describe('Rounds you were named a reviewer on'),
      threads: z.array(LowercaseUuid),
      rounds: z.array(LowercaseUuid),
      places: z.array(Place),
    })
    .nullable()
    .describe(
      'A digest’s: how many of each kind, and on which threads and where, of those the caller may still read (COL-035)',
    ),
  budget: z
    .object({
      threshold: z.int().describe('The percent of the limit crossed'),
      currency: z.string(),
      spent: z.string().describe('What the month had cost when it was crossed, to six places'),
      limit: z.string().describe('The limit, to six places'),
      month: z.string().describe('The month, `YYYY-MM`, UTC'),
    })
    .nullable()
    .describe(
      'A model budget’s alert (ADM-034): how much of it this month has spent; null otherwise',
    ),
  at: z.iso.datetime(),
  read: z.boolean(),
});
export type NotificationView = z.infer<typeof NotificationView>;

export const InboxView = z.object({
  notifications: z.array(NotificationView),
  unread: z.int().nonnegative().describe('How many are unread, of all of them'),
  next: nextCursor,
});
export type InboxView = z.infer<typeof InboxView>;

const Cadence = z.enum(['at_once', 'daily', 'never']);

/** How often a person is told of each kind (COL-034). */
export const InboxPreferences = z.strictObject({
  mention: Cadence.describe('When a comment names you; at once unless chosen'),
  reply: Cadence.describe('A reply on a thread you have commented on; at once unless chosen'),
  resolution: Cadence.describe('A thread you have commented on resolved; daily unless chosen'),
  round: Cadence.describe('Named a reviewer on a round; at once unless chosen'),
});
export type InboxPreferences = z.infer<typeof InboxPreferences>;

export const InboxPreferencesBody = InboxPreferences.partial();
export type InboxPreferencesBody = z.infer<typeof InboxPreferencesBody>;

/** One thing waiting on the caller that they may resolve (home.md, Needs your attention). */
export const AttentionItemView = z.object({
  kind: z
    .enum([
      'publish_failed',
      'review_overdue',
      'changes_not_in_version',
      'published_earlier',
      'connection_untested',
      'review_due',
    ])
    .describe(
      'What waits: your latest attempt to publish a document failed; a review escalated to you is overdue; a component holds changes of yours not in a version; a document was last published from an earlier version than its latest; a connection has not been tested since its credential was set; a review you own falls due',
    ),
  artifact: z.object({
    id: LowercaseUuid,
    kind: z.enum(['document', 'component', 'connection']),
    title: z.string().nullable().describe('Its title or name, as you read it now'),
  }),
  reason: z
    .string()
    .optional()
    .describe(
      'A failed publish’s: the code of its first failure, as the publication request names it',
    ),
  reviewBy: z.iso
    .date()
    .optional()
    .describe('A review’s: the day it is to be reviewed by (LIF-017)'),
  state: z
    .object({ key: z.string(), name: z.string() })
    .nullable()
    .describe("A component's or a document's workflow state now (LIF-005); null for a connection"),
  request: LowercaseUuid.optional().describe(
    'A failed publish’s: the publication request that failed, which you read with every failure at `GET /v1/publication-requests/{id}`',
  ),
});
export type AttentionItemView = z.infer<typeof AttentionItemView>;

export const AttentionView = z.object({
  items: z
    .array(AttentionItemView)
    .describe('One per artifact, the most pressing kind first, newest first within it; at most 20'),
  total: z.int().nonnegative().describe('How many wait, of all of them'),
});
export type AttentionView = z.infer<typeof AttentionView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
/** A person's inbox is theirs in a signed-in window, never a token's (the TH final review). */
const tokenNotAllowed = {
  description:
    'token_not_allowed: the inbox is a signed-in person’s, never a token’s, whose scopes it could not keep',
  schema: ErrorBody,
} as const;
const notYours = {
  description: 'No notification of the caller’s by that id: nobody reads another’s',
  schema: ErrorBody,
} as const;

/** What waits on a signed-in person, never a token's (the HM plan, HM-A). */
const attentionTokenNotAllowed = {
  description:
    'token_not_allowed: what waits is a signed-in person’s, never a token’s, whose scopes it could not keep',
  schema: ErrorBody,
} as const;

/**
 * The inbox (collaboration.md, The inbox; the TH plan, Task 2) and what waits (home.md): the caller's
 * own alone.
 */
export const inboxRoutes = {
  getAttention: {
    operationId: 'getAttention',
    method: 'GET',
    path: '/v1/me/attention',
    summary: 'What waits on the caller that they may resolve',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    responses: {
      200: { description: 'What waits, and how many', schema: AttentionView },
      401: unauthenticated,
      403: attentionTokenNotAllowed,
    },
  },
  listInbox: {
    operationId: 'listInbox',
    method: 'GET',
    path: '/v1/inbox',
    summary: 'The caller’s notifications, newest first',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    query: InboxQuery,
    responses: {
      200: { description: 'A page of them', schema: InboxView },
      400: {
        description: '`invalid_request`: a cursor this listing did not give out',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: tokenNotAllowed,
    },
  },
  markNotificationRead: {
    operationId: 'markNotificationRead',
    method: 'POST',
    path: '/v1/inbox/{id}/read',
    summary: 'Mark one of the caller’s notifications read',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    params: NotificationParams,
    responses: {
      204: { description: 'Read' },
      401: unauthenticated,
      403: tokenNotAllowed,
      404: notYours,
    },
  },
  deleteNotification: {
    operationId: 'deleteNotification',
    method: 'DELETE',
    path: '/v1/inbox/{id}',
    summary: 'Delete one of the caller’s notifications',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    params: NotificationParams,
    responses: {
      204: { description: 'Deleted' },
      401: unauthenticated,
      403: tokenNotAllowed,
      404: notYours,
    },
  },
  getInboxPreferences: {
    operationId: 'getInboxPreferences',
    method: 'GET',
    path: '/v1/inbox/preferences',
    summary: 'How often the caller is told of each kind',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    responses: {
      200: { description: 'Each kind’s cadence', schema: InboxPreferences },
      401: unauthenticated,
      403: tokenNotAllowed,
    },
  },
  setInboxPreferences: {
    operationId: 'setInboxPreferences',
    method: 'PUT',
    path: '/v1/inbox/preferences',
    summary: 'Choose how often the caller is told of each kind',
    tenantScoped: true,
    access: { check: 'session', credential: 'session' },
    body: InboxPreferencesBody,
    responses: {
      200: { description: 'Each kind’s cadence, as now chosen', schema: InboxPreferences },
      401: unauthenticated,
      403: tokenNotAllowed,
    },
  },
} as const;
