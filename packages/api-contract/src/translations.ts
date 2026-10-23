import { TRANSLATION_STATUSES } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';
import { SpaceParams } from './components.js';
import { DocumentParams } from './documents.js';
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
    from: z
      .object({ id: z.uuid(), number: z.string() })
      .describe(
        "The version a translation is made against: the source's latest approved revision, else its latest version",
      ),
  }),
  translations: z
    .array(TranslationView)
    .describe('Each open translation, by language; a component has few'),
});
export type TranslationsView = z.infer<typeof TranslationsView>;

export const MarkCurrentBody = z.strictObject({
  translates: LowercaseUuid.describe(
    "The source version it now translates: a version of its source's main line, normally the one `source.from` names",
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

export const SpaceTranslationsView = z.object({
  items: z
    .array(
      z.object({
        component: z.object({ id: z.uuid(), title: z.string() }),
        translations: z.array(TranslationView),
      }),
    )
    .describe(
      'Each component of the space the caller may read that has a translation, by title, with each translation and its status',
    ),
  capped: z
    .boolean()
    .describe('Whether more components have translations than the 500 a report names (API-058)'),
});
export type SpaceTranslationsView = z.infer<typeof SpaceTranslationsView>;

export const TranslationJobBody = z.strictObject({
  language: z
    .string()
    .min(2)
    .max(35)
    .describe('The BCP 47 tag the components are to be translated into, such as `fr-FR`'),
  vendor: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Who the job goes to, as the maker names them; nothing is sent to them by the product',
    ),
});
export type TranslationJobBody = z.infer<typeof TranslationJobBody>;

export const TranslationJobParams = z.object({ id: z.uuid(), job: z.uuid() });
export type TranslationJobParams = z.infer<typeof TranslationJobParams>;

export const TranslationJobView = z.object({
  id: z.uuid(),
  language: z.string(),
  vendor: z.string().nullable(),
  by: z.uuid(),
  at: z.iso.datetime({ offset: true }),
  closed: z
    .object({ by: z.uuid(), at: z.iso.datetime({ offset: true }) })
    .nullable()
    .describe('Who closed it and when, ending what was still out; null while open'),
  items: z
    .array(
      z.object({
        component: z.object({ id: z.uuid(), title: z.string() }),
        line: z
          .uuid()
          .nullable()
          .describe('Its translation, a line of the component; null where not sent'),
        source: z
          .object({ id: z.uuid(), number: z.string() })
          .nullable()
          .describe('The source version sent, which what comes back translates'),
        notSent: z
          .enum(['needs_revision', 'not_editable'])
          .nullable()
          .describe(
            'Why it was listed and not sent: the source has no designated revision to translate from, or the maker may not edit it',
          ),
        outcome: z
          .enum(['returned', 'held', 'refused'])
          .nullable()
          .describe('What came back of it; null while it is out'),
      }),
    )
    .describe(
      'Each component the job lists that the caller may read, in the order the document places them',
    ),
});
export type TranslationJobView = z.infer<typeof TranslationJobView>;

export const TranslationJobsView = z.object({
  jobs: z.array(TranslationJobView).describe("The document's jobs, newest first, at most 50"),
});
export type TranslationJobsView = z.infer<typeof TranslationJobsView>;

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
const documentEdit = {
  description: 'The caller may read the document but may not edit it',
  schema: ErrorBody,
} as const;
const jobMissing = {
  description: 'No such document, or job of it, the caller may read',
  schema: ErrorBody,
} as const;
const read = { check: 'permission', permission: 'read', target: { artifact: 'id' } } as const;
const edit = { check: 'permission', permission: 'edit', target: { artifact: 'id' } } as const;

export const translationRoutes = {
  getSpaceTranslations: {
    operationId: 'getSpaceTranslations',
    method: 'GET',
    path: '/v1/spaces/{space}/translations',
    summary: "Report a space's translations, each with its status",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { space: 'space' } },
    params: SpaceParams,
    responses: {
      200: { description: "The space's translated components", schema: SpaceTranslationsView },
      401: unauthenticated,
      403: { description: 'The caller may not read this space', schema: ErrorBody },
      404: { description: 'No such space the caller may read', schema: ErrorBody },
    },
  },
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
      400: {
        description: 'translation_source_invalid: a version that is no version of its source',
        schema: ErrorBody,
      },
      409: {
        description: 'translation_untranslated: nothing is translated yet to mark',
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
  listDocumentTranslationJobs: {
    operationId: 'listDocumentTranslationJobs',
    method: 'GET',
    path: '/v1/documents/{id}/translation-jobs',
    summary: "List a document's translation jobs",
    tenantScoped: true,
    access: read,
    params: DocumentParams,
    responses: {
      200: { description: 'Its jobs, newest first', schema: TranslationJobsView },
      401: unauthenticated,
      403: { description: 'The caller may not read this document', schema: ErrorBody },
      404: { description: 'No such document the caller may read', schema: ErrorBody },
    },
  },
  makeDocumentTranslationJob: {
    operationId: 'makeDocumentTranslationJob',
    method: 'POST',
    path: '/v1/documents/{id}/translation-jobs',
    summary: "Send a document's components needing a language as a translation job",
    tenantScoped: true,
    access: edit,
    params: DocumentParams,
    body: TranslationJobBody,
    responses: {
      200: { description: 'The job made, each component it lists', schema: TranslationJobView },
      400: { description: 'translation_language_invalid: not a BCP 47 tag', schema: ErrorBody },
      401: unauthenticated,
      403: documentEdit,
      404: { description: 'No such document the caller may read', schema: ErrorBody },
      409: {
        description:
          'translation_nothing_to_send: no component it places needs translating into the language that the caller may send',
        schema: ErrorBody,
      },
    },
  },
  downloadDocumentTranslationJob: {
    operationId: 'downloadDocumentTranslationJob',
    method: 'GET',
    path: '/v1/documents/{id}/translation-jobs/{job}/file',
    summary: "Download a translation job's XLIFF 2.1 file",
    tenantScoped: true,
    access: edit,
    params: TranslationJobParams,
    responses: {
      200: {
        description: 'The file, one `<file>` a component sent and one `<unit>` a text',
        binary: { contentTypes: ['application/xliff+xml'] },
      },
      401: unauthenticated,
      403: documentEdit,
      404: jobMissing,
    },
  },
  closeDocumentTranslationJob: {
    operationId: 'closeDocumentTranslationJob',
    method: 'POST',
    path: '/v1/documents/{id}/translation-jobs/{job}/close',
    summary: 'Close a translation job, ending what is still out',
    tenantScoped: true,
    access: edit,
    params: TranslationJobParams,
    responses: {
      200: { description: 'The job, closed', schema: TranslationJobView },
      401: unauthenticated,
      403: documentEdit,
      404: jobMissing,
      409: { description: 'translation_job_closed: it is closed already', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
