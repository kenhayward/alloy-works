import { termSchema } from '@alloy-works/domain';
import { z } from 'zod';
import { ComponentParams, SpaceParams, VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { listingQuery, listingTotal, nextCursor } from './listing.js';
import { ErrorBody, LowercaseUuid, SPACE_ARCHIVED } from './schemas.js';
import {
  GateView,
  TransitionView,
  WorkflowRevisionView,
  WorkflowStandingView,
} from './workflows.js';

export const TermParams = z.object({ id: LowercaseUuid });
export type TermParams = z.infer<typeof TermParams>;

/** A term version (terms.md, "The term"; the TM plan, TM-A), the domain's own shape. */
export const CreateTermBody = z.strictObject({ term: termSchema });
export type CreateTermBody = z.infer<typeof CreateTermBody>;

/** A term's next version: the whole term, from the version it was opened at. */
export const TermVersionBody = z.strictObject({ openedFrom: LowercaseUuid, term: termSchema });
export type TermVersionBody = z.infer<typeof TermVersionBody>;

export const TermView = z.object({
  id: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  term: termSchema,
  archived: z.boolean().describe('Whether it is archived: left out of the listing'),
  deprecated: z
    .boolean()
    .describe("Whether it is deprecated: its workflow's state keyed `deprecated` (LIB-049)"),
  mayEdit: z.boolean().describe('Whether the caller may cut its next version: edit on it'),
  mayRetire: z.boolean().describe('Whether the caller may archive it: retire on it'),
  state: WorkflowStandingView,
  transitions: z
    .array(TransitionView)
    .describe('The workflow transitions the caller may take from its state now, in order'),
  gates: z.array(GateView).describe('Each gate from its state, decided by its approvers'),
  revision: WorkflowRevisionView,
});
export type TermView = z.infer<typeof TermView>;

export const TermSummary = z.object({
  id: z.string(),
  label: z.string().describe('Its preferred label in its base language'),
  abbreviation: z.string().nullable().describe('Its abbreviation in its base language'),
  term: termSchema,
  version: z.object({ id: z.string(), number: z.string() }),
  changedAt: z.string().describe('When its latest version was made'),
  state: z
    .object({ key: z.string(), name: z.string(), approved: z.boolean() })
    .nullable()
    .describe('Its workflow state now: draft, approved or deprecated as seeded'),
});

export const TermList = z.object({
  items: z.array(TermSummary),
  next: nextCursor,
  total: listingTotal,
});

export const TermListQuery = z.object({
  ...listingQuery(['label', 'changed'], 'label'),
  archived: z.enum(['true']).optional().describe('List only the archived'),
});
export type TermListQuery = z.infer<typeof TermListQuery>;

export const TermUsesView = z.object({
  named: z.array(z.object({ id: z.string(), title: z.string() })),
  unreadable: z.boolean().describe('Whether a component the caller may not read uses it too'),
});
export type TermUsesView = z.infer<typeof TermUsesView>;

export const SKOS_FORMATS = ['json-ld', 'turtle'] as const;

/** The most an import's text may be, in characters. */
export const TERM_IMPORT_MOST = 5_000_000;
/** The most an import's body may be as sent, in bytes: 5 MiB, refused `413` past it. */
export const TERM_IMPORT_BODY_MOST = 5 * 1024 * 1024;
/** The most concepts one import takes (the TM plan, TM-J). */
export const TERM_IMPORT_CONCEPTS_MOST = 2000;
/** The most things not represented an import answers, each named; the rest are counted. */
export const UNREPRESENTED_LISTED_MOST = 1000;

export const ImportTermsBody = z.strictObject({
  format: z.enum(SKOS_FORMATS),
  text: z.string().min(1).max(TERM_IMPORT_MOST),
  base: z
    .string()
    .max(35)
    .optional()
    .describe(
      'The base language a concept takes where it has a preferred label in it; `en` absent',
    ),
});
export type ImportTermsBody = z.infer<typeof ImportTermsBody>;

export const ImportedTermView = z.object({
  key: z.string().describe("The concept's identity in the file"),
  outcome: z.enum(['created', 'merged', 'refused']),
  term: TermSummary.pick({ id: true, label: true }).nullable(),
  merged: z
    .array(z.string())
    .describe('What the matching term lacked and was given: labels, definitions and relations'),
  message: z.string().nullable().describe('Why it was refused'),
});

export const UnrepresentedView = z.object({
  concept: z.string().nullable().describe('The concept it was stated of; null for a subject'),
  what: z.enum(['subject', 'predicate', 'label', 'language', 'relation', 'value']),
  detail: z.string().describe('What it was, as the file said it'),
});

export const TermImportAnswer = z.object({
  concepts: z.array(ImportedTermView),
  unrepresented: z
    .array(UnrepresentedView)
    .describe('What no term could hold, in the order the file gives it, at most 1,000 named'),
  unrepresentedTotal: z.int().describe('How many things no term could hold, named or not'),
});
export type TermImportAnswer = z.infer<typeof TermImportAnswer>;

export const TermExportAnswer = z.object({
  format: z.literal('json-ld'),
  text: z.string().describe('The terms as SKOS in JSON-LD, in the compact form terms.md documents'),
});

export const TermArchivalAnswer = z.object({
  archived: z.boolean().describe('Whether it is archived now'),
});

/** A term refused: by its shape, each problem named, or as it now stands. */
export const TermRefusal = ErrorBody.extend({
  problems: z
    .array(z.object({ rule: z.literal('term_invalid'), path: z.string(), message: z.string() }))
    .optional(),
  current: TermView.optional(),
});

/** The terms a component's editor uses, once each (the TM plan, TMc). */
export const TermStandingPreviewBody = z.strictObject({
  terms: z.array(z.string().min(1).max(200)).max(500).describe('Each term the component uses'),
});
export type TermStandingPreviewBody = z.infer<typeof TermStandingPreviewBody>;

export const TermStandingPreview = z.object({
  terms: z
    .array(
      z.object({
        standing: z
          .enum(['approved', 'draft', 'deprecated', 'unavailable'])
          .describe("unavailable where it is no term of the component's space the caller may read"),
        label: z.string().nullable().describe('Its preferred label in its base language'),
        replacedBy: z
          .object({ id: z.string(), label: z.string().nullable() })
          .nullable()
          .describe(
            "A deprecated term's replacement, its label null where the caller may not read it",
          ),
      }),
    )
    .describe('Each term asked, in order (LIB-018)'),
});
export type TermStandingPreview = z.infer<typeof TermStandingPreview>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such term in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const spaceNotFound = {
  description: 'No such space in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const termRefused = {
  description:
    '`term_invalid`: a shape a term does not hold, a base language with no label, or a relation or replacement naming no term of the space, itself, a cycle or a chain past five, each problem named',
  schema: TermRefusal,
} as const;
const retire = { check: 'permission', permission: 'retire', target: { artifact: 'id' } } as const;
const read = { check: 'permission', permission: 'read', target: { artifact: 'id' } } as const;
const readSpace = { check: 'permission', permission: 'read', target: { space: 'space' } } as const;
const editSpace = { check: 'permission', permission: 'edit', target: { space: 'space' } } as const;

/**
 * Terms (terms.md; the TM plan, TM-A, TM-J): `edit` in the space makes, changes and imports them;
 * `read` shows and exports them; `retire` archives one nothing uses. Their workflow moves are the
 * workflow routes'.
 */
export const termRoutes = {
  listTerms: {
    operationId: 'listTerms',
    method: 'GET',
    path: '/v1/spaces/{space}/terms',
    summary: "The space's terms the caller may read, each with its standing",
    tenantScoped: true,
    access: readSpace,
    params: SpaceParams,
    query: TermListQuery,
    responses: {
      200: { description: 'A page of terms', schema: TermList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a space the caller may not read is not found',
        schema: ErrorBody,
      },
      404: spaceNotFound,
    },
  },
  createTerm: {
    operationId: 'createTerm',
    method: 'POST',
    path: '/v1/spaces/{space}/terms',
    summary: 'Make a term in this space, in draft',
    tenantScoped: true,
    access: editSpace,
    params: SpaceParams,
    body: CreateTermBody,
    responses: {
      200: { description: 'Made at version 0.1', schema: TermView },
      400: termRefused,
      401: unauthenticated,
      403: { description: 'The caller may not edit in the space', schema: ErrorBody },
      404: spaceNotFound,
      409: { description: SPACE_ARCHIVED, schema: ErrorBody },
    },
  },
  importTerms: {
    operationId: 'importTerms',
    method: 'POST',
    path: '/v1/spaces/{space}/terms/import',
    summary: 'Import SKOS, as JSON-LD or Turtle, as terms of this space',
    tenantScoped: true,
    access: editSpace,
    params: SpaceParams,
    body: ImportTermsBody,
    bodyMaxBytes: TERM_IMPORT_BODY_MOST,
    responses: {
      200: {
        description: 'What became of each concept, and what no term could hold',
        schema: TermImportAnswer,
      },
      400: {
        description:
          '`import_unreadable`: the text does not read as the format. `import_too_many`: it holds more than 2,000 concepts or 200,000 statements',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'The caller may not edit in the space', schema: ErrorBody },
      404: spaceNotFound,
      409: { description: SPACE_ARCHIVED, schema: ErrorBody },
      413: { description: 'The body is larger than 5 MiB', schema: ErrorBody },
    },
  },
  exportTerms: {
    operationId: 'exportTerms',
    method: 'GET',
    path: '/v1/spaces/{space}/terms/export',
    summary: "The space's terms the caller may read, as SKOS in JSON-LD",
    tenantScoped: true,
    access: readSpace,
    params: SpaceParams,
    responses: {
      200: { description: 'The terms as JSON-LD', schema: TermExportAnswer },
      401: unauthenticated,
      403: {
        description: 'Never answered: a space the caller may not read is not found',
        schema: ErrorBody,
      },
      404: spaceNotFound,
    },
  },
  getTerm: {
    operationId: 'getTerm',
    method: 'GET',
    path: '/v1/terms/{id}',
    summary: 'A term at its latest version, with its standing',
    tenantScoped: true,
    access: read,
    params: TermParams,
    responses: {
      200: { description: 'The term', schema: TermView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a term the caller may not read is not found',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  recordTermVersion: {
    operationId: 'recordTermVersion',
    method: 'POST',
    path: '/v1/terms/{id}/versions',
    summary: "Cut a term's next version from the one the caller opened",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: TermParams,
    body: TermVersionBody,
    responses: {
      200: {
        description:
          'The term at its latest version: the one cut, or the one before where nothing changed',
        schema: TermView,
      },
      400: termRefused,
      401: unauthenticated,
      403: { description: 'The caller may read the term but may not edit it', schema: ErrorBody },
      404: notFound,
      409: {
        description:
          '`version_precondition`: the term has a newer version than the one named, answered with it; ' +
          SPACE_ARCHIVED,
        schema: TermRefusal,
      },
    },
  },
  getTermUses: {
    operationId: 'getTermUses',
    method: 'GET',
    path: '/v1/terms/{id}/uses',
    summary: 'Where a term is used: the components whose latest version marks words as it',
    tenantScoped: true,
    access: read,
    params: TermParams,
    responses: {
      200: {
        description: 'The components using it the caller may read, and whether there are more',
        schema: TermUsesView,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a term the caller may not read is not found',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  archiveTerm: {
    operationId: 'archiveTerm',
    method: 'POST',
    path: '/v1/terms/{id}/archive',
    summary: 'Archive a term nothing uses',
    tenantScoped: true,
    access: retire,
    params: TermParams,
    responses: {
      200: {
        description: 'Archived, or already so, which changes nothing',
        schema: TermArchivalAnswer,
      },
      401: unauthenticated,
      403: { description: 'The caller may read the term but may not retire it', schema: ErrorBody },
      404: notFound,
      409: {
        description: "`term_used`: a component's latest version uses it",
        schema: ErrorBody,
      },
    },
  },
  unarchiveTerm: {
    operationId: 'unarchiveTerm',
    method: 'POST',
    path: '/v1/terms/{id}/unarchive',
    summary: 'Unarchive a term',
    tenantScoped: true,
    access: retire,
    params: TermParams,
    responses: {
      200: {
        description: 'Unarchived, or already so, which changes nothing',
        schema: TermArchivalAnswer,
      },
      401: unauthenticated,
      403: { description: 'The caller may read the term but may not retire it', schema: ErrorBody },
      404: notFound,
    },
  },
  previewComponentTerms: {
    operationId: 'previewComponentTerms',
    method: 'POST',
    path: '/v1/components/{id}/terms/preview',
    summary: 'The standing of each term a component uses, as its editor flags them',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ComponentParams,
    body: TermStandingPreviewBody,
    responses: {
      200: { description: "Each term's standing, in order", schema: TermStandingPreview },
      401: unauthenticated,
      403: {
        description: 'Never answered: a component the caller may not read is not found',
        schema: ErrorBody,
      },
      404: {
        description: 'No such component in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
