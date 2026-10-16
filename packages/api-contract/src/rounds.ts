import { z } from 'zod';
import { DocumentParams } from './documents.js';
import { PersonView, ErrorBody, LowercaseUuid } from './schemas.js';

const Person = PersonView;

export const RoundParams = z.object({ id: LowercaseUuid });
export type RoundParams = z.infer<typeof RoundParams>;

export const OpenRoundBody = z.strictObject({
  title: z.string().min(1).max(200).describe('1 to 200 characters'),
  scope: z
    .array(z.string().regex(/^[a-z2-7]{26}$/))
    .max(200)
    .optional()
    .describe('Outline nodes, each with what is beneath it; the whole document where omitted'),
  dueAt: z.iso.datetime({ offset: true }).describe('When the reviews are due, after now'),
  baseline: LowercaseUuid.optional().describe(
    'A baseline of the document, which the reviewers read in place of the document as it moves',
  ),
  reviewers: z
    .array(LowercaseUuid)
    .min(1)
    .max(50)
    .describe('1 to 50 people, each able to comment or suggest on the document'),
});
export type OpenRoundBody = z.infer<typeof OpenRoundBody>;

export const CompleteReviewBody = z.strictObject({
  outcome: z
    .enum(['commented', 'nothing_to_say'])
    .describe('Finished with comments, or with nothing to say (COL-032)'),
});
export type CompleteReviewBody = z.infer<typeof CompleteReviewBody>;

/** One reviewer on a round, where they stand (COL-029). */
const ReviewerView = z.object({
  person: Person,
  state: z.enum(['not_started', 'in_progress', 'complete']),
  outcome: z.enum(['commented', 'nothing_to_say']).optional().describe('A completion’s'),
  at: z.iso.datetime().optional().describe('When they completed'),
  mayReview: z
    .boolean()
    .describe(
      'Whether they may still comment or suggest on the document: one who may not stays as they were',
    ),
  threads: z
    .number()
    .int()
    .describe(
      'Threads they started on the document since the round opened, that the caller may read',
    ),
  suggestions: z
    .number()
    .int()
    .describe('Suggestions they made on it since the round opened, that the caller may read'),
});

/** A round, its reviewers by state, and whether everybody has reviewed (COL-028, COL-030). */
export const RoundView = z.object({
  id: LowercaseUuid,
  document: LowercaseUuid,
  title: z.string(),
  scope: z.array(z.string()).describe('Outline nodes; empty for the whole document'),
  dueAt: z.iso.datetime(),
  baseline: LowercaseUuid.nullable(),
  madeAgainst: LowercaseUuid.describe('The document version it opened on, or the baseline’s'),
  openedBy: Person,
  openedAt: z.iso.datetime(),
  closed: z.object({ by: Person, at: z.iso.datetime() }).nullable(),
  reviewers: z.array(ReviewerView),
  complete: z.number().int(),
  of: z.number().int(),
  everybody: z.boolean().describe('Whether every reviewer has said they are complete (COL-030)'),
  mayClose: z.boolean().describe('Whether the caller may close it'),
  reviewing: z.boolean().describe('Whether the caller is one of its reviewers and may review'),
});
export type RoundView = z.infer<typeof RoundView>;

export const RoundList = z.object({ rounds: z.array(RoundView) });
export type RoundList = z.infer<typeof RoundList>;

/** A round refused, with what its refusal names (the RR plan, RR-B). */
export const RoundRefusal = ErrorBody.extend({
  nodes: z.array(z.string()).optional().describe('round_scope_invalid: the nodes it does not have'),
  count: z
    .number()
    .int()
    .optional()
    .describe(
      'round_reviewers_invalid: how many named may not review it - not people, or unable to comment or suggest, or to read all it covers',
    ),
});

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const noRound = {
  description: 'No such round in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const closedAlready = {
  description: '`round_closed`: the round is closed, and takes nothing more',
  schema: ErrorBody,
} as const;
const roundTarget = { round: 'id' } as const;

/** Review rounds (collaboration.md, Review rounds; the RR plan, Task 2). */
export const roundRoutes = {
  openRound: {
    operationId: 'openRound',
    method: 'POST',
    path: '/v1/documents/{id}/rounds',
    summary: 'Open a review round on this document: its reviewers, its scope and its due date',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: DocumentParams,
    body: OpenRoundBody,
    responses: {
      200: { description: 'Opened, and each reviewer told', schema: RoundView },
      400: {
        description:
          '`round_scope_invalid`: a node the document does not have; `round_reviewers_invalid`: a reviewer who may not review it, counted; `round_due_invalid`: due before now; `round_baseline_missing`: no such baseline of this document',
        schema: RoundRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not edit it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  listRounds: {
    operationId: 'listRounds',
    method: 'GET',
    path: '/v1/documents/{id}/rounds',
    summary: 'The review rounds on this document, newest first',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: { description: 'Every round', schema: RoundList },
      401: unauthenticated,
      403: { description: 'Never answered: a reader reads its rounds', schema: ErrorBody },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  getRound: {
    operationId: 'getRound',
    method: 'GET',
    path: '/v1/rounds/{id}',
    summary: 'A review round, each reviewer by state, and whether everybody has reviewed',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: roundTarget },
    params: RoundParams,
    responses: {
      200: { description: 'The round', schema: RoundView },
      401: unauthenticated,
      403: { description: 'Never answered: a reader reads its rounds', schema: ErrorBody },
      404: noRound,
    },
  },
  closeRound: {
    operationId: 'closeRound',
    method: 'POST',
    path: '/v1/rounds/{id}/closure',
    summary: 'Close a review round, for good',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: roundTarget },
    params: RoundParams,
    responses: {
      200: { description: 'Closed, or closed already', schema: RoundView },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not edit it',
        schema: ErrorBody,
      },
      404: noRound,
    },
  },
  startReview: {
    operationId: 'startReview',
    method: 'POST',
    path: '/v1/rounds/{id}/start',
    summary: 'Say you have started your review in this round',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: roundTarget },
    params: RoundParams,
    responses: {
      200: { description: 'Started, or started already', schema: RoundView },
      401: unauthenticated,
      403: { description: 'Never answered: one not reviewing is not found', schema: ErrorBody },
      404: {
        description:
          'No such round, none the caller may read, or one they are not reviewing or may no longer review',
        schema: ErrorBody,
      },
      409: closedAlready,
    },
  },
  completeReview: {
    operationId: 'completeReview',
    method: 'POST',
    path: '/v1/rounds/{id}/completion',
    summary: 'Say you have finished your review, with comments or with nothing to say',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: roundTarget },
    params: RoundParams,
    body: CompleteReviewBody,
    responses: {
      200: { description: 'Complete', schema: RoundView },
      401: unauthenticated,
      403: { description: 'Never answered: one not reviewing is not found', schema: ErrorBody },
      404: {
        description:
          'No such round, none the caller may read, or one they are not reviewing or may no longer review',
        schema: ErrorBody,
      },
      409: {
        description:
          '`round_closed`: closed; `review_complete`: the caller has completed already - reopen to change how',
        schema: ErrorBody,
      },
    },
  },
  reopenReview: {
    operationId: 'reopenReview',
    method: 'POST',
    path: '/v1/rounds/{id}/reopening',
    summary: 'Take back your completion while the round is open',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: roundTarget },
    params: RoundParams,
    responses: {
      200: { description: 'In progress again', schema: RoundView },
      401: unauthenticated,
      403: { description: 'Never answered: one not reviewing is not found', schema: ErrorBody },
      404: {
        description:
          'No such round, none the caller may read, or one they are not reviewing or may no longer review',
        schema: ErrorBody,
      },
      409: {
        description: '`round_closed`: closed; `review_not_complete`: the caller has not completed',
        schema: ErrorBody,
      },
    },
  },
} as const;
