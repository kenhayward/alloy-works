import { z } from 'zod';
import { BaselineParams } from './baselines.js';
import { ComponentParams } from './components.js';
import { DocumentParams } from './documents.js';
import { pageQuery, nextCursor } from './listing.js';
import { PersonView, ErrorBody, LowercaseUuid } from './schemas.js';

/** Where a thread stands (collaboration.md, Threads; COL-012), checked by the service against the version. */
const ThreadAnchorBody = z
  .record(z.string(), z.unknown())
  .describe(
    "Where it stands: `{ kind: 'span', block, quote, before }` (a block's text, at most 500 characters, with at most 200 before it), `{ kind: 'cell', table, block }` (a table's cell by its first block), `{ kind: 'component' }`, or `{ kind: 'node', node }` (a document's outline node)",
  );

/** A comment's text: words and mentions, never markup (TH-B). */
const CommentPartsBody = z
  .array(z.record(z.string(), z.unknown()))
  .max(500)
  .describe(
    '`{ text }` and `{ mention }` parts, in order: 1 to 4,000 characters of words with no control character but a line feed, and at most 20 mentions, each a person by id',
  );

export const StartThreadBody = z.strictObject({
  version: LowercaseUuid.describe('The version the anchor was taken on, one of this artifact’s'),
  anchor: ThreadAnchorBody,
  parts: CommentPartsBody.describe('Its first comment'),
});
export type StartThreadBody = z.infer<typeof StartThreadBody>;

export const CommentBody = z.strictObject({ parts: CommentPartsBody });
export type CommentBody = z.infer<typeof CommentBody>;

export const ThreadParams = z.object({ id: LowercaseUuid });
export type ThreadParams = z.infer<typeof ThreadParams>;

export const CommentParams = z.object({ id: LowercaseUuid, comment: LowercaseUuid });
export type CommentParams = z.infer<typeof CommentParams>;

export const ThreadListQuery = z.strictObject({
  ...pageQuery,
  state: z
    .enum(['open', 'resolved'])
    .optional()
    .describe('Only open, or only resolved; both when omitted'),
  author: LowercaseUuid.optional().describe('Only those this person started'),
  since: z.iso
    .datetime({ offset: true })
    .optional()
    .describe('Only those with a comment after this instant'),
});
export type ThreadListQuery = z.infer<typeof ThreadListQuery>;

const Person = PersonView;

/** A thread as a list shows it (COL-018). */
export const ThreadSummaryView = z.object({
  id: LowercaseUuid,
  on: z.object({ id: LowercaseUuid, kind: z.enum(['component', 'document']) }),
  anchor: z.record(z.string(), z.unknown()),
  madeAgainst: LowercaseUuid.describe('The version it was started on'),
  startedBy: Person,
  startedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  comments: z.int().positive(),
  lastAt: z.iso.datetime().describe('When its latest comment was added'),
  orphaned: z
    .boolean()
    .describe(
      'Its anchor no longer stands (COL-017): in a component’s list, on its latest version; in a document’s, a node on the latest outline and a component’s anchor on every version its occurrences resolve to',
    ),
  places: z
    .array(z.object({ node: z.string(), orphaned: z.boolean() }))
    .optional()
    .describe(
      'In a document’s list, a component’s thread: each occurrence placing it, and whether it stands there',
    ),
});
export type ThreadSummaryView = z.infer<typeof ThreadSummaryView>;

export const ThreadList = z.object({ threads: z.array(ThreadSummaryView), next: nextCursor });
export type ThreadList = z.infer<typeof ThreadList>;

/** A thread read whole: every comment, and every text each has had (COL-014, COL-051). */
export const ThreadView = z.object({
  id: LowercaseUuid,
  on: z.object({ id: LowercaseUuid, kind: z.enum(['component', 'document']) }),
  anchor: z.record(z.string(), z.unknown()),
  madeAgainst: LowercaseUuid,
  startedBy: Person,
  startedAt: z.iso.datetime(),
  resolution: z.object({ by: Person, at: z.iso.datetime() }).nullable(),
  comments: z.array(
    z.object({
      id: LowercaseUuid,
      author: Person,
      at: z.iso.datetime(),
      texts: z
        .array(
          z.object({ parts: z.array(z.record(z.string(), z.unknown())), at: z.iso.datetime() }),
        )
        .describe('Every text it has had, the latest last'),
    }),
  ),
  untold: z
    .array(LowercaseUuid)
    .optional()
    .describe(
      'On a comment just written: those it names who may not read what the thread is on, and so were told nothing (COL-015)',
    ),
});
export type ThreadView = z.infer<typeof ThreadView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const cannotComment = {
  description: 'The caller may read what the thread is on but may not comment on it',
  schema: ErrorBody,
} as const;
const noThread = {
  description: 'No such thread in this environment, or one on something the caller may not read',
  schema: ErrorBody,
} as const;
const resolved = {
  description: '`thread_resolved`: the thread is resolved, and takes nothing more',
  schema: ErrorBody,
} as const;
const startRefusals = {
  description:
    '`version_not_held`: the version is not one of this artifact’s; `anchor_invalid`: the anchor does not stand on that version; `parts_invalid`: the comment cannot be stored, or names somebody this environment does not hold',
  schema: ErrorBody,
} as const;

const startThread = (kind: 'component' | 'document') =>
  ({
    method: 'POST',
    path: `/v1/${kind}s/{id}/threads`,
    summary: `Start a thread on this ${kind}, with its first comment`,
    tenantScoped: true,
    access: { check: 'permission', permission: 'comment', target: { artifact: 'id' } },
    params: kind === 'component' ? ComponentParams : DocumentParams,
    body: StartThreadBody,
    responses: {
      200: { description: 'Started', schema: ThreadView },
      400: startRefusals,
      401: unauthenticated,
      403: cannotComment,
      404: {
        description: `No such ${kind} in this environment, or none the caller may read`,
        schema: ErrorBody,
      },
    },
  }) as const;

const listThreads = (kind: 'component' | 'document') =>
  ({
    method: 'GET',
    path: `/v1/${kind}s/{id}/threads`,
    summary:
      kind === 'component'
        ? 'The threads on this component, newest first'
        : 'The threads on this document and on each component it places that the caller may read, newest first',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: kind === 'component' ? ComponentParams : DocumentParams,
    query: ThreadListQuery,
    responses: {
      200: { description: 'A page of them', schema: ThreadList },
      400: {
        description: '`invalid_request`: a cursor this listing did not give out',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'Never answered: a reader reads its threads', schema: ErrorBody },
      404: {
        description: `No such ${kind} in this environment, or none the caller may read`,
        schema: ErrorBody,
      },
    },
  }) as const;

/** Threads (collaboration.md, Threads; the TH plan, Task 1). */
export const threadRoutes = {
  startComponentThread: { operationId: 'startComponentThread', ...startThread('component') },
  startDocumentThread: { operationId: 'startDocumentThread', ...startThread('document') },
  listComponentThreads: { operationId: 'listComponentThreads', ...listThreads('component') },
  listDocumentThreads: { operationId: 'listDocumentThreads', ...listThreads('document') },
  listBaselineThreads: {
    operationId: 'listBaselineThreads',
    method: 'GET',
    path: '/v1/baselines/{id}/threads',
    summary:
      'The threads on a baseline’s document and the components it pins that the caller may read, judged against the pins, newest first',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { baseline: 'id' } },
    params: BaselineParams,
    query: ThreadListQuery,
    responses: {
      200: { description: 'A page of them', schema: ThreadList },
      400: {
        description: '`invalid_request`: a cursor this listing did not give out',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'Never answered: a reader reads its threads', schema: ErrorBody },
      404: {
        description: 'No such baseline in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  getThread: {
    operationId: 'getThread',
    method: 'GET',
    path: '/v1/threads/{id}',
    summary: 'A thread, every comment and every text each has had',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { thread: 'id' } },
    params: ThreadParams,
    responses: {
      200: { description: 'The thread', schema: ThreadView },
      401: unauthenticated,
      403: { description: 'Never answered: a reader reads its threads', schema: ErrorBody },
      404: noThread,
    },
  },
  addComment: {
    operationId: 'addComment',
    method: 'POST',
    path: '/v1/threads/{id}/comments',
    summary: 'Reply to a thread',
    tenantScoped: true,
    access: { check: 'permission', permission: 'comment', target: { thread: 'id' } },
    params: ThreadParams,
    body: CommentBody,
    responses: {
      200: { description: 'Added', schema: ThreadView },
      400: {
        description:
          '`parts_invalid`: the comment cannot be stored, or names somebody this environment does not hold',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: cannotComment,
      404: noThread,
      409: resolved,
    },
  },
  editComment: {
    operationId: 'editComment',
    method: 'PUT',
    path: '/v1/threads/{id}/comments/{comment}',
    summary: 'Give one’s own comment a new text, keeping every earlier one',
    tenantScoped: true,
    access: { check: 'permission', permission: 'comment', target: { thread: 'id' } },
    params: CommentParams,
    body: CommentBody,
    responses: {
      200: { description: 'Edited', schema: ThreadView },
      400: {
        description:
          '`parts_invalid`: the comment cannot be stored, or names somebody this environment does not hold',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description:
          '`comment_not_yours`: the comment is somebody else’s; or the caller may not comment here',
        schema: ErrorBody,
      },
      404: { description: 'No such thread, or no such comment on it', schema: ErrorBody },
      409: resolved,
    },
  },
  resolveThread: {
    operationId: 'resolveThread',
    method: 'POST',
    path: '/v1/threads/{id}/resolution',
    summary: 'Resolve a thread, once',
    tenantScoped: true,
    access: { check: 'permission', permission: 'comment', target: { thread: 'id' } },
    params: ThreadParams,
    responses: {
      200: { description: 'Resolved', schema: ThreadView },
      401: unauthenticated,
      403: cannotComment,
      404: noThread,
      409: resolved,
    },
  },
} as const;
