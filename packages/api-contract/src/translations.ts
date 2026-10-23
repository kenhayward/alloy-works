import { TRANSLATION_STATUSES } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';
import { LineParams, TransitionParams } from './workflows.js';

/**
 * **Translation** (docs/design/translation.md; the TR plan): a component's variant in a language is a
 * line of its own, each knowing the source version it translates, out of date the moment the source
 * changes.
 */

export const TranslationBody = z.strictObject({
  language: z
    .string()
    .min(2)
    .max(35)
    .describe("The variant's BCP 47 tag, such as `fr-FR`: not the source's own, and not one begun"),
});
export type TranslationBody = z.infer<typeof TranslationBody>;

export const TranslationStatusView = z.object({
  status: z
    .enum(TRANSLATION_STATUSES)
    .describe(
      'The declared set (LOC-030): untranslated until its first cut; out of date the moment the source changes after what it translates',
    ),
  retranslate: z
    .boolean()
    .optional()
    .describe(
      'Out of date: whether any source change since needs retranslating, as its author declared (LOC-015)',
    ),
});

export const TranslationView = z.object({
  line: z.uuid().describe('Its language line: open it as any line, `?line=`'),
  language: z.string(),
  head: z
    .object({ id: z.uuid(), number: z.string() })
    .nullable()
    .describe('Its newest version recorded against a source, or null while untranslated'),
  translates: z
    .object({ id: z.uuid(), number: z.string() })
    .nullable()
    .describe('The source version that head translates, or null'),
  status: TranslationStatusView,
});
export type TranslationView = z.infer<typeof TranslationView>;

export const TranslationsView = z.object({
  source: z.object({
    language: z.string().describe("The source's language, its main line's"),
    latest: z.object({ id: z.uuid(), number: z.string() }).describe("The source's latest version"),
  }),
  translations: z
    .array(TranslationView)
    .describe('Each open translation, by language; a component has few'),
});
export type TranslationsView = z.infer<typeof TranslationsView>;

export const MarkCurrentBody = z.strictObject({
  translates: LowercaseUuid.describe(
    "The source version the translator was shown, which must be the source's latest",
  ),
});
export type MarkCurrentBody = z.infer<typeof MarkCurrentBody>;

export const SourceChangesView = z.object({
  translates: z.object({ id: z.uuid(), number: z.string() }),
  current: z.object({ id: z.uuid(), number: z.string() }),
  changes: z
    .array(
      z.object({
        block: z.string(),
        change: z
          .enum(['added', 'changed', 'removed'])
          .describe(
            'Against the source the translation translates: in the latest alone, in both and differing, or in the earlier alone',
          ),
        words: z
          .string()
          .describe(
            "The block's words in the latest source, or in the earlier where it was removed",
          ),
      }),
    )
    .describe("Each source block changed since, in the latest source's order, then those removed"),
});
export type SourceChangesView = z.infer<typeof SourceChangesView>;

export const SourceChangeParams = z.object({ id: z.uuid(), version: z.uuid() });
export type SourceChangeParams = z.infer<typeof SourceChangeParams>;

export const SourceChangeBody = z.strictObject({
  retranslate: z
    .boolean()
    .describe('Whether the change this version made needs retranslating (LOC-015, LOC-031)'),
});
export type SourceChangeBody = z.infer<typeof SourceChangeBody>;

export const SourceChangeView = z.object({ version: z.uuid(), retranslate: z.boolean() });

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such component, or open translation of it, the caller may read',
  schema: ErrorBody,
} as const;
const forbiddenEdit = {
  description: 'The caller may read the component but may not edit it',
  schema: ErrorBody,
} as const;
const read = { check: 'permission', permission: 'read', target: { artifact: 'id' } } as const;
const edit = { check: 'permission', permission: 'edit', target: { artifact: 'id' } } as const;

export const translationRoutes = {
  listComponentTranslations: {
    operationId: 'listComponentTranslations',
    method: 'GET',
    path: '/v1/components/{id}/translations',
    summary: "List a component's translations, each with its status",
    tenantScoped: true,
    access: read,
    params: TransitionParams,
    responses: {
      200: { description: 'Its source and translations', schema: TranslationsView },
      401: unauthenticated,
      403: { description: 'The caller may not read this component', schema: ErrorBody },
      404: notFound,
    },
  },
  beginComponentTranslation: {
    operationId: 'beginComponentTranslation',
    method: 'POST',
    path: '/v1/components/{id}/translations',
    summary: "Begin a component's translation into a language",
    tenantScoped: true,
    access: edit,
    params: TransitionParams,
    body: TranslationBody,
    responses: {
      200: { description: 'The translation begun, untranslated', schema: TranslationView },
      400: {
        description:
          'translation_language_invalid: not a BCP 47 tag; translation_same_language: the source is in it already',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: forbiddenEdit,
      404: notFound,
      409: {
        description:
          'translation_exists: one is begun in that language; translation_needs_revision: the source has no designated revision to translate from; line_name_taken: a divergent line has the tag as its name',
        schema: ErrorBody,
      },
    },
  },
  markComponentTranslationCurrent: {
    operationId: 'markComponentTranslationCurrent',
    method: 'POST',
    path: '/v1/components/{id}/translations/{line}/current',
    summary: "Mark a component's translation current with its source, cutting no version",
    tenantScoped: true,
    access: edit,
    params: LineParams,
    body: MarkCurrentBody,
    responses: {
      200: { description: 'Marked, and its status now', schema: TranslationView },
      401: unauthenticated,
      403: forbiddenEdit,
      404: notFound,
      409: {
        description:
          'translation_source_stale: the source moved on since the translator saw it; translation_untranslated: nothing is translated yet to mark',
        schema: ErrorBody,
      },
    },
  },
  getComponentTranslationChanges: {
    operationId: 'getComponentTranslationChanges',
    method: 'GET',
    path: '/v1/components/{id}/translations/{line}/source-changes',
    summary: "Say which of a component's source blocks changed since its translation",
    tenantScoped: true,
    access: read,
    params: LineParams,
    responses: {
      200: {
        description: 'The two source versions, and each block between them',
        schema: SourceChangesView,
      },
      401: unauthenticated,
      403: { description: 'The caller may not read this component', schema: ErrorBody },
      404: {
        description:
          'No such component, or open translation of it with anything translated, the caller may read',
        schema: ErrorBody,
      },
    },
  },
  declareComponentSourceChange: {
    operationId: 'declareComponentSourceChange',
    method: 'PUT',
    path: '/v1/components/{id}/versions/{version}/retranslate',
    summary: "Declare whether a component's version needs retranslating",
    tenantScoped: true,
    access: edit,
    params: SourceChangeParams,
    body: SourceChangeBody,
    responses: {
      200: { description: 'Declared', schema: SourceChangeView },
      401: unauthenticated,
      403: forbiddenEdit,
      404: {
        description: 'No such component, or version of its main line, the caller may read',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
