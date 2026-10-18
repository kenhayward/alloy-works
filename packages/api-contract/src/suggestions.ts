import { z } from 'zod';
import { ComponentParams } from './components.js';
import { DocumentParams } from './documents.js';
import { nextCursor, pageQuery } from './listing.js';
import { EditingRefusal } from './editing.js';
import { PersonView, ErrorBody, LowercaseUuid } from './schemas.js';

export const MakeSuggestionBody = z.strictObject({
  version: LowercaseUuid.describe('The version the draft was opened from, one of this component’s'),
  content: z
    .record(z.string(), z.unknown())
    .describe('The draft whole: a content document, as a save of the component would send it'),
});
export type MakeSuggestionBody = z.infer<typeof MakeSuggestionBody>;

export const SuggestionParams = z.object({ id: LowercaseUuid });
export type SuggestionParams = z.infer<typeof SuggestionParams>;

export const SuggestionListQuery = z.strictObject({
  ...pageQuery,
  state: z
    .enum(['pending', 'resolved'])
    .optional()
    .describe('Only pending, or only resolved; both when omitted'),
  author: LowercaseUuid.optional().describe('Only those this person made'),
});
export type SuggestionListQuery = z.infer<typeof SuggestionListQuery>;

const Person = PersonView;

/** A place a suggestion no longer fits the current version, and why (COL-052). */
const StalePlace = z.object({
  block: z
    .string()
    .nullable()
    .describe('The top-level block, or null for the document’s own members'),
  member: z.enum(['title', 'language', 'direction']).optional(),
  why: z
    .enum(['changed', 'gone', 'anchor_gone', 'invalid'])
    .describe(
      '`changed`: somebody changed it since; `gone`: it is no longer there; `anchor_gone`: the block a suggested block follows is gone; `invalid`: the whole would not be a content document',
    ),
  problem: z.string().optional(),
});

/** A suggestion as a list shows it (COL-021, COL-022, COL-052). */
export const SuggestionSummaryView = z.object({
  id: LowercaseUuid,
  component: LowercaseUuid,
  madeAgainst: LowercaseUuid.describe('The version it was made against'),
  madeBy: Person,
  madeAt: z.iso.datetime(),
  generated: z
    .boolean()
    .describe(
      'Whether a run of the assistant proposed it: marked generated until it is resolved (GEN-022)',
    ),
  state: z.enum(['pending', 'accepted', 'rejected', 'withdrawn']),
  stale: z
    .array(StalePlace)
    .nullable()
    .describe(
      'A pending one’s places where it no longer fits the current version, computed now; empty where it applies, null once resolved',
    ),
  resolution: z
    .object({ by: Person, at: z.iso.datetime(), version: LowercaseUuid.nullable() })
    .nullable()
    .describe('Who resolved it and when; for an acceptance, the version it stands in'),
});
export type SuggestionSummaryView = z.infer<typeof SuggestionSummaryView>;

export const SuggestionList = z.object({
  suggestions: z.array(SuggestionSummaryView),
  next: nextCursor,
});
export type SuggestionList = z.infer<typeof SuggestionList>;

/** A suggestion with what its redline is drawn from (SG-I). */
export const SuggestionView = SuggestionSummaryView.extend({
  drawnOver: z
    .object({ version: LowercaseUuid, content: z.record(z.string(), z.unknown()) })
    .describe(
      'What it is drawn over: the current version where a pending one applies, else the version it was made against',
    ),
  drawn: z
    .record(z.string(), z.unknown())
    .describe('What it would make: the merge where a pending one applies, else the draft as sent'),
});
export type SuggestionView = z.infer<typeof SuggestionView>;

export const ResolveSuggestionsBody = z.strictObject({
  act: z.enum(['accept', 'reject']),
  scope: z
    .string()
    .regex(/^artifact:[0-9a-f-]{36}$/)
    .describe('`artifact:<id>`: a component, or a document and every component it places'),
  author: LowercaseUuid.optional().describe('Only those this person made'),
});
export type ResolveSuggestionsBody = z.infer<typeof ResolveSuggestionsBody>;

export const ResolvedSuggestions = z.object({
  resolved: z.array(
    z.object({
      suggestion: LowercaseUuid,
      version: LowercaseUuid.nullable().describe('For an acceptance, the version it stands in'),
    }),
  ),
  left: z
    .array(
      z.object({
        suggestion: LowercaseUuid,
        why: z
          .enum(['stale', 'lock_held', 'edits_pending', 'not_permitted', 'values_invalid'])
          .describe('Why it stays pending'),
        stale: z.array(StalePlace).optional(),
        holder: Person.optional().describe('lock_held: who holds the component'),
      }),
    )
    .describe('Each it left pending, and why (SG-H)'),
});
export type ResolvedSuggestions = z.infer<typeof ResolvedSuggestions>;

/** A refusal of a resolving act, with what a client needs to act on it. */
export const SuggestionRefusal = EditingRefusal.pick({
  code: true,
  message: true,
  traceId: true,
  rule: true,
  holder: true,
  expectedRelease: true,
  failures: true,
}).extend({
  stale: z.array(StalePlace).optional().describe('suggestion_stale: each place it no longer fits'),
});
export type SuggestionRefusal = z.infer<typeof SuggestionRefusal>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const noSuggestion = {
  description:
    'No such suggestion in this environment, or one on a component the caller may not read',
  schema: ErrorBody,
} as const;
const resolvedAlready = {
  description: '`suggestion_resolved`: it is accepted, rejected or withdrawn already',
  schema: ErrorBody,
} as const;
const held = {
  description:
    '`lock_held`: somebody else holds the component, named with when it is expected to release; `suggestion_resolved`: resolved already',
  schema: SuggestionRefusal,
} as const;

/** Suggestions (collaboration.md, Suggestions; the SG plan, Task 2). */
export const suggestionRoutes = {
  makeSuggestion: {
    operationId: 'makeSuggestion',
    method: 'POST',
    path: '/v1/components/{id}/suggestions',
    summary: 'Suggest a change to this component: a draft of it, kept beside it',
    tenantScoped: true,
    access: { check: 'permission', permission: 'suggest', target: { artifact: 'id' } },
    params: ComponentParams,
    body: MakeSuggestionBody,
    responses: {
      200: { description: 'Made, or the same draft made before', schema: SuggestionView },
      400: {
        description:
          '`content_invalid`: the draft is not a document this product can store; `version_not_held`: the version is not one of this component’s; `suggestion_empty`: the draft is that version; `suggestion_limit`: the caller has 20 pending here',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description:
          'The caller may read the component but may not suggest to it; `definition_unreadable`: a bound table names a column of a query definition the caller may not read',
        schema: ErrorBody,
      },
      404: {
        description: 'No such component in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: {
        description:
          '`suggestion_resolved`: the caller sent this very draft before, and it has been resolved',
        schema: ErrorBody,
      },
    },
  },
  listComponentSuggestions: {
    operationId: 'listComponentSuggestions',
    method: 'GET',
    path: '/v1/components/{id}/suggestions',
    summary: 'The suggestions on this component, newest first',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ComponentParams,
    query: SuggestionListQuery,
    responses: {
      200: { description: 'A page of them', schema: SuggestionList },
      400: {
        description: '`invalid_request`: a cursor this listing did not give out',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'Never answered: a reader reads its suggestions', schema: ErrorBody },
      404: {
        description: 'No such component in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  listDocumentSuggestions: {
    operationId: 'listDocumentSuggestions',
    method: 'GET',
    path: '/v1/documents/{id}/suggestions',
    summary: 'The suggestions on every component this document places that the caller may read',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    query: SuggestionListQuery,
    responses: {
      200: { description: 'A page of them', schema: SuggestionList },
      400: {
        description: '`invalid_request`: a cursor this listing did not give out',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'Never answered: a reader reads its suggestions', schema: ErrorBody },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  getSuggestion: {
    operationId: 'getSuggestion',
    method: 'GET',
    path: '/v1/suggestions/{id}',
    summary: 'A suggestion, and what its redline is drawn from',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { suggestion: 'id' } },
    params: SuggestionParams,
    responses: {
      200: { description: 'The suggestion', schema: SuggestionView },
      401: unauthenticated,
      403: { description: 'Never answered: a reader reads its suggestions', schema: ErrorBody },
      404: noSuggestion,
    },
  },
  acceptSuggestion: {
    operationId: 'acceptSuggestion',
    method: 'POST',
    path: '/v1/suggestions/{id}/acceptance',
    summary: 'Accept a suggestion: apply it to the component as it is now, as your version',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { suggestion: 'id' } },
    params: SuggestionParams,
    responses: {
      200: { description: 'Accepted', schema: SuggestionView },
      400: {
        description: '`values_invalid`: a fixed value differs from its default now',
        schema: SuggestionRefusal,
      },
      401: unauthenticated,
      403: {
        description:
          'The caller may read the component but may not edit it; `definition_unreadable`: the merge names a column of a query definition the caller may not read',
        schema: ErrorBody,
      },
      404: noSuggestion,
      409: {
        description:
          '`lock_held`: somebody else holds the component, named with when it is expected to release; `edits_pending`: the caller holds it with saved work after the current version; `suggestion_stale`: it no longer fits, each place in `stale`; `suggestion_resolved`: resolved already',
        schema: SuggestionRefusal,
      },
    },
  },
  rejectSuggestion: {
    operationId: 'rejectSuggestion',
    method: 'POST',
    path: '/v1/suggestions/{id}/rejection',
    summary: 'Reject a suggestion',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { suggestion: 'id' } },
    params: SuggestionParams,
    responses: {
      200: { description: 'Rejected', schema: SuggestionView },
      401: unauthenticated,
      403: {
        description: 'The caller may read the component but may not edit it',
        schema: ErrorBody,
      },
      404: noSuggestion,
      409: held,
    },
  },
  withdrawSuggestion: {
    operationId: 'withdrawSuggestion',
    method: 'POST',
    path: '/v1/suggestions/{id}/withdrawal',
    summary: 'Withdraw your own suggestion',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { suggestion: 'id' } },
    params: SuggestionParams,
    responses: {
      200: { description: 'Withdrawn, and kept', schema: SuggestionView },
      401: unauthenticated,
      403: {
        description: '`suggestion_not_yours`: somebody else made it',
        schema: ErrorBody,
      },
      404: noSuggestion,
      409: resolvedAlready,
    },
  },
  resolveSuggestions: {
    operationId: 'resolveSuggestions',
    method: 'POST',
    path: '/v1/suggestions/resolutions',
    summary:
      'Accept or reject every pending suggestion on a component or a document, or one person’s',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { body: 'scope' } },
    body: ResolveSuggestionsBody,
    responses: {
      200: {
        description: 'Each resolved, and each left pending with why',
        schema: ResolvedSuggestions,
      },
      400: {
        description:
          '`suggestion_scope`: more than 200 pending in scope, or the scope is not a component or a document',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'Never answered: each is decided by its component', schema: ErrorBody },
      404: {
        description:
          'No such component or document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
} as const;
