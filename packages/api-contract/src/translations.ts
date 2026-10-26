import { TRANSLATION_CONFLICTS, TRANSLATION_STATUSES } from '@alloy-works/domain';
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
  machine: z
    .object({
      version: z.object({ id: z.uuid(), number: z.string() }),
      missedTerms: z
        .array(z.object({ term: z.uuid(), label: z.string() }))
        .describe("Each of the space's terms the draft did not translate by one of its labels"),
    })
    .nullable()
    .optional()
    .describe(
      "Its newest machine draft not yet accepted, which a publish refuses until a person with approve accepts it; null where there is none. Listed by a component's translations",
    ),
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
          .describe(
            'What came back of it: made a version of its translation, held for a person because the source or the translation moved since it was sent, or refused because it did not read back, the uploader may not edit it or a person rejected it; null while it is out',
          ),
      }),
    )
    .describe(
      'Each component the job lists that the caller may read, in the order the document places them',
    ),
  returns: z
    .array(
      z.object({
        id: z.uuid(),
        by: z.uuid(),
        at: z.iso.datetime({ offset: true }),
        state: z
          .enum(['reading', 'read', 'failed'])
          .describe('Waiting for the worker to read it, read and applied, or refused whole'),
        failure: z
          .string()
          .nullable()
          .describe(
            'Why it was refused whole: file_unreadable, file_unsafe, file_too_large, file_not_xliff, language_mismatch, unknown_file, translation_job_closed or reading_failed',
          ),
        returned: z.number().int().nullable(),
        held: z.number().int().nullable(),
        refused: z.number().int().nullable(),
      }),
    )
    .describe('Each file returned to it, newest first'),
});
export type TranslationJobView = z.infer<typeof TranslationJobView>;

export const TranslationJobItemParams = z.object({
  id: z.uuid(),
  job: z.uuid(),
  component: z.uuid(),
});
export type TranslationJobItemParams = z.infer<typeof TranslationJobItemParams>;

export const HeldTranslationView = z.object({
  component: z.object({ id: z.uuid(), title: z.string() }),
  sent: z
    .object({ id: z.uuid(), number: z.string() })
    .describe('The source version the job sent, which the words returned translate'),
  current: z
    .object({ id: z.uuid(), number: z.string() })
    .describe('The source version a translation is made against now'),
  changes: z
    .array(
      z.object({
        block: z.string(),
        change: z.enum(['added', 'changed', 'removed']),
        words: z.string(),
      }),
    )
    .describe('Each source block changed between the two, to review the returned words against'),
  returned: z
    .array(z.object({ block: z.string(), words: z.string() }))
    .describe("The returned words, block by block, in the source's order"),
  offered: z
    .enum(TRANSLATION_CONFLICTS)
    .describe("The decision the environment's policy offers first (LOC-036); a person decides"),
});
export type HeldTranslationView = z.infer<typeof HeldTranslationView>;

export const HeldDecisionBody = z.strictObject({
  decision: z
    .enum(['accept', 'reject'])
    .describe(
      '`accept` cuts the returned words as a translation of the source version sent, out of date at once where the source moved since; `reject` drops them',
    ),
});
export type HeldDecisionBody = z.infer<typeof HeldDecisionBody>;

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
/** The most bytes a returned file may hold (XL-F), an import's. */
const RETURN_MAX_BYTES = 25 * 1024 * 1024;
const itemMissing = {
  description: 'No such document, job, or held item of it, the caller may read',
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
  returnDocumentTranslationJob: {
    operationId: 'returnDocumentTranslationJob',
    method: 'PUT',
    path: '/v1/documents/{id}/translation-jobs/{job}/return',
    summary: "Return a translation job's translated XLIFF file, which the worker then reads back",
    tenantScoped: true,
    access: edit,
    params: TranslationJobParams,
    rawBody: { contentType: 'application/octet-stream', maxBytes: RETURN_MAX_BYTES },
    responses: {
      200: { description: 'The job, its return being read', schema: TranslationJobView },
      401: unauthenticated,
      403: documentEdit,
      404: jobMissing,
      409: { description: 'translation_job_closed: it is closed', schema: ErrorBody },
      413: { description: 'translation_return_too_large: more than 25 MB', schema: ErrorBody },
      415: {
        description: 'translation_return_bytes_expected: the body is not application/octet-stream',
        schema: ErrorBody,
      },
    },
  },
  getDocumentTranslationJobHeld: {
    operationId: 'getDocumentTranslationJobHeld',
    method: 'GET',
    path: '/v1/documents/{id}/translation-jobs/{job}/items/{component}/held',
    summary: 'Show a held translation beside the source changes since it was sent',
    tenantScoped: true,
    access: edit,
    params: TranslationJobItemParams,
    responses: {
      200: { description: 'The held item, to review', schema: HeldTranslationView },
      401: unauthenticated,
      403: documentEdit,
      404: itemMissing,
    },
  },
  decideDocumentTranslationJobItem: {
    operationId: 'decideDocumentTranslationJobItem',
    method: 'POST',
    path: '/v1/documents/{id}/translation-jobs/{job}/items/{component}/decision',
    summary: 'Accept or reject a held translation',
    tenantScoped: true,
    access: edit,
    params: TranslationJobItemParams,
    body: HeldDecisionBody,
    responses: {
      200: { description: 'Decided, and the job now', schema: TranslationJobView },
      401: unauthenticated,
      403: {
        description: 'The caller may not edit the document, or the component held',
        schema: ErrorBody,
      },
      404: itemMissing,
      409: {
        description:
          'translation_job_closed: the job is closed; lock_held: somebody is editing the translation',
        schema: ErrorBody,
      },
    },
  },
  draftComponentTranslation: {
    operationId: 'draftComponentTranslation',
    method: 'POST',
    path: '/v1/components/{id}/translations/{line}/machine-draft',
    summary: "Draft a component's translation by machine, through the tenant's translate endpoint",
    tenantScoped: true,
    access: {
      check: 'permission',
      permission: 'edit',
      target: { artifact: 'id' },
      credential: 'session',
    },
    params: LineParams,
    idempotencyKey: false,
    responses: {
      200: {
        description:
          'Server-sent events, as the AsyncAPI document’s `assistantRun` channel declares them: a `run` for each piece the component is sent in, `drafted` with the version cut, and `ended` or `failed`',
        stream: true,
      },
      401: unauthenticated,
      403: {
        description: 'A personal token, or the caller may read the component but may not edit it',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description:
          '`translation_machine_off`: the environment sends nothing to machine translation; `translation_machine_outside`: it sends only inside the data boundary, and the endpoint is outside; `model_unconfigured`: no endpoint is set up to translate; `endpoint_unusable`: it is retired or has no key; `translation_nothing_to_translate`: the source has no text; `context_too_large`: a piece is more than the endpoint takes; `guardrail_refused`: a guardrail refused what would be sent; `lock_held`: somebody is editing the translation; `model_rate_limited`: past the hourly limit. Each before any call',
        schema: ErrorBody,
      },
    },
  },
  acceptComponentMachineDraft: {
    operationId: 'acceptComponentMachineDraft',
    method: 'POST',
    path: '/v1/components/{id}/translations/{line}/machine-draft/accept',
    summary: "Accept a translation's machine drafts, so it may be published",
    tenantScoped: true,
    access: { check: 'permission', permission: 'approve', target: { artifact: 'id' } },
    params: LineParams,
    responses: {
      200: { description: 'Accepted, and its status now', schema: TranslationView },
      401: unauthenticated,
      403: {
        description: 'The caller may read the component but may not approve it',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description: '`translation_nothing_drafted`: no machine draft of it waits to be accepted',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
