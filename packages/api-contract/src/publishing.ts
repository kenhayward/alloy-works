import { outputReportSchema, publishFailureCodes } from '@alloy-works/domain';
import { z } from 'zod';
import { FacetCountView, idsFilter, listingQuery, listingTotal, nextCursor } from './listing.js';
import type { RouteContract } from './contract.js';
import { VersionSummary } from './components.js';
import { DocumentParams } from './documents.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** What publishing takes: the version the caller is looking at, and the formats to make. */
export const RequestPublicationBody = z.strictObject({
  version: LowercaseUuid.describe(
    'The document version the caller is publishing, which must be the latest',
  ),
  formats: z
    .array(z.string().min(1))
    .min(1)
    // A format named twice is a malformed request, refused here rather than by the store, which would
    // answer it as a format the template cannot make.
    .refine((formats) => new Set(formats).size === formats.length, {
      message: 'Name each format once',
    })
    .describe(
      "The formats to publish, each once: `pdf`, `docx`, or both, where the document's layout makes them. A format it does not make is refused by name, and one without `pdf` where the document cites a page",
    ),
});
export type RequestPublicationBody = z.infer<typeof RequestPublicationBody>;

/**
 * What a preview takes: the version the caller is looking at, and nothing else. A preview is the PDF
 * alone (publishing.md, "Preview"; PV-C), so there is no format to name.
 */
export const RequestPreviewBody = z.strictObject({
  version: LowercaseUuid.describe(
    'The document version the caller is previewing, which must be the latest',
  ),
});
export type RequestPreviewBody = z.infer<typeof RequestPreviewBody>;

/**
 * A request refused because the document has moved on (API-037): the version it is at now, by its
 * heading alone. Not its outline, as the outline route's refusal carries - the outline names
 * components the caller may not read (IAM-073).
 */
export const PublicationRefusal = ErrorBody.extend({
  current: VersionSummary.optional().describe(
    'version_precondition: the version the document is at',
  ),
  sections: z
    .array(z.object({ key: z.string(), title: z.string() }))
    .optional()
    .describe(
      "section_required: each section the document's template requires that none of its sections came from",
    ),
  failures: z
    .array(
      z.object({
        node: z.string().nullable(),
        code: z.string(),
        field: z.string(),
        rule: z.string(),
        schemas: z.array(z.string()),
        detail: z.string(),
      }),
    )
    .optional()
    .describe(
      "metadata_invalid: each value that does not satisfy the document's template, in MET-022's shape, with the node it belongs to, null for the document's own",
    ),
  unresolved: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("values_unresolved: what the document's template names that does not resolve now"),
});
export type PublicationRefusal = z.infer<typeof PublicationRefusal>;

export const PublicationRequestParams = z.object({ id: LowercaseUuid });
export type PublicationRequestParams = z.infer<typeof PublicationRequestParams>;

export const PublicationParams = z.object({ id: LowercaseUuid });
export type PublicationParams = z.infer<typeof PublicationParams>;

/** One failure, naming its stage and its place (PUB-086). An unreadable place carries its node alone. */
export const PublishFailureView = z.object({
  stage: z.enum(['resolve', 'compose', 'engine', 'store']),
  code: z.enum(publishFailureCodes),
  node: z.string().nullable().describe('The outline node it concerns'),
  block: z.string().nullable().describe("The block within that node's component"),
  detail: z
    .string()
    .nullable()
    .describe(
      'The kind of block or mark, the style, the language tag, or the character as U+XXXX; null where the place is one the publisher may not read',
    ),
});
export type PublishFailureView = z.infer<typeof PublishFailureView>;

/** A done preview while it lasts: two links to its PDF, and when it goes (PV-F). */
export const PreviewView = z.object({
  view: z
    .string()
    .describe('A link to the PDF, valid for five minutes, that a browser shows rather than saves'),
  download: z
    .string()
    .describe(
      "A link to the same bytes, valid for five minutes, that saves them, named by the request's id",
    ),
  expiresAt: z
    .string()
    .describe('When the preview goes, an hour after it was made; after it, there are no links'),
});
export type PreviewView = z.infer<typeof PreviewView>;

export const PublicationRequestView = z.object({
  id: z.string(),
  document: z.string(),
  kind: z
    .enum(['publish', 'preview'])
    .describe('A publish, which makes a publication, or a preview, which makes a PDF for an hour'),
  state: z.enum(['queued', 'done', 'failed']),
  failures: z.array(PublishFailureView),
  publication: z.string().nullable().describe('The publication it made, once done'),
  preview: PreviewView.nullable().describe(
    "A done preview's links and expiry, until it expires; none for a publish, or a preview not done or expired",
  ),
});
export type PublicationRequestView = z.infer<typeof PublicationRequestView>;

/** A publication as a listing shows it: what was published, from which version, by whom and when. */
export const PublicationSummary = z.object({
  id: z.string(),
  document: z.string(),
  version: z.object({ id: z.string(), number: z.string() }),
  title: z.string().describe("The document's title at the version published"),
  publisher: z.object({ id: z.string(), displayName: z.string().nullable() }),
  publishedAt: z.string(),
  approval: z.literal('none').describe('`none`: a draft. Nothing in T1 can approve a publication'),
  formats: z.array(z.string()),
});
export type PublicationSummary = z.infer<typeof PublicationSummary>;

export const PublicationList = z.object({
  items: z.array(PublicationSummary),
  next: nextCursor,
  total: listingTotal,
  facets: z
    .object({ spaces: z.array(FacetCountView), documents: z.array(FacetCountView) })
    .describe(
      'Each filter the listing takes, counted with the others in force and its own left out',
    ),
});

export const PublicationListQuery = z.object({
  ...listingQuery(['published', 'title'], 'published'),
  spaces: idsFilter.optional().describe('Only publications in these spaces, by id'),
  documents: idsFilter.optional().describe('Only publications of these documents, by id'),
});
export type PublicationListQuery = z.infer<typeof PublicationListQuery>;
export type PublicationList = z.infer<typeof PublicationList>;

const download = z
  .string()
  .describe('A link to the bytes, valid for five minutes, named by the publication id and format');

/** What veraPDF found of a publication's PDF, checked after the publication was recorded (W14.1). */
const PdfCheckView = z.object({
  checker: z.literal('verapdf'),
  checkerVersion: z.string().describe("veraPDF's own version, as its report names it"),
  profile: z.literal('ua1').describe('The profile it checked against: PDF/UA-1'),
  compliant: z.boolean(),
  failedRules: z
    .array(
      z.object({
        clause: z.string().describe('The clause of ISO 14289-1 the rule belongs to'),
        test: z.number().int().describe("The rule's test within its clause"),
        description: z.string().optional().describe("What the rule asks for, in veraPDF's words"),
      }),
    )
    .describe('Each rule the PDF failed; none where it passed'),
  report: z
    .object({
      bytes: z.number().int(),
      sha256: z.string(),
      download: z
        .string()
        .describe(
          "A link to veraPDF's whole report, its JSON, valid for five minutes, saved as `{id}-verapdf.json`",
        ),
    })
    .describe("veraPDF's whole report, as it wrote it, kept with the publication"),
  checkedAt: z.string(),
});

/** A PDF: PDF/UA-1, made by Typst under the publication's template, with nothing to report. */
const PdfOutputView = z.object({
  format: z.literal('pdf'),
  bytes: z.number().int(),
  sha256: z.string(),
  standard: z.literal('ua-1'),
  producer: z.literal('typst'),
  producerVersion: z.string().describe('The template version it was set by'),
  report: z.tuple([]),
  download,
  view: z
    .string()
    .describe(
      'A link to the same bytes, valid for five minutes, that a browser shows rather than saves',
    ),
  check: PdfCheckView.nullable().describe(
    'What veraPDF found of the PDF against PDF/UA-1; none until it has been checked, which follows the recording',
  ),
});

/** A Word document: no PDF standard, made by the Word writer, and what it could not carry. */
const DocxOutputView = z.object({
  format: z.literal('docx'),
  bytes: z.number().int(),
  sha256: z.string(),
  standard: z.null(),
  producer: z.literal('word'),
  producerVersion: z.string().describe("The Word writer's version, as `word/1`"),
  report: outputReportSchema.describe(
    'What Word could not carry: a face it set in another, that page numbers cite the PDF, that it carries no page-cited output',
  ),
  download,
  view: z.null().describe('None: a browser saves a Word document rather than showing it'),
});

export const PublicationView = PublicationSummary.extend({
  engine: z
    .object({ name: z.literal('typst'), version: z.string() })
    .nullable()
    .describe("The PDF's engine; none where the publication has no PDF"),
  template: z
    .object({ name: z.literal('publication'), version: z.number().int() })
    .nullable()
    .describe("The PDF's template; none where the publication has no PDF"),
  pipeline: z.string(),
  outputs: z
    .array(z.discriminatedUnion('format', [PdfOutputView, DocxOutputView]))
    .describe('One per format, the PDF first'),
});
export type PublicationView = z.infer<typeof PublicationView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

/** Publishing a document, following the request, and reading what was published (publishing.md). */
export const publishingRoutes = {
  requestPublication: {
    operationId: 'requestPublication',
    method: 'POST',
    path: '/v1/documents/{id}/publications',
    summary: 'Publish the latest version of this document',
    tenantScoped: true,
    access: { check: 'permission', permission: 'publish', target: { artifact: 'id' } },
    params: DocumentParams,
    body: RequestPublicationBody,
    responses: {
      // 200, not 202: a permission-checked handler cannot set a status (finding 12).
      200: {
        description: 'Asked for, and queued; follow the request for its outcome',
        schema: PublicationRequestView,
      },
      400: {
        description:
          "`format_unsupported`: a format the layout does not make; `layout_language`: the document is not in its layout's language; `page_reference_without_pdf`: the document cites a page and the PDF was not asked for; `section_required`: a section its template requires is missing; `metadata_invalid`: its values, or a section's, do not satisfy its template; `values_unresolved`: its template no longer resolves",
        schema: PublicationRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the document but may not publish it',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: {
        description:
          '`version_precondition`: the document has a newer version than the one named, which `current` names',
        schema: PublicationRefusal,
      },
    },
  },
  requestPreview: {
    operationId: 'requestPreview',
    method: 'POST',
    path: '/v1/documents/{id}/previews',
    summary: 'Preview the latest version of this document as a PDF, kept an hour for the caller',
    tenantScoped: true,
    // `read`, not `publish` (PV-B): a reader who may not publish still sees the pages.
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    body: RequestPreviewBody,
    responses: {
      // 200, not 202, as a publish's: a permission-checked handler cannot set a status (finding 12).
      200: {
        description: 'Asked for, and queued; follow the request for its outcome and its PDF',
        schema: PublicationRequestView,
      },
      400: {
        description:
          "`format_unsupported`: the layout makes no PDF; `layout_language`: the document is not in its layout's language; `section_required`: a section its template requires is missing; `metadata_invalid`: its values, or a section's, do not satisfy its template; `values_unresolved`: its template no longer resolves",
        schema: PublicationRefusal,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may read is one they may preview',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: {
        description:
          '`version_precondition`: the document has a newer version than the one named, which `current` names',
        schema: PublicationRefusal,
      },
    },
  },
  getPublicationRequest: {
    operationId: 'getPublicationRequest',
    method: 'GET',
    path: '/v1/publication-requests/{id}',
    summary:
      'A publish or a preview the caller asked for: its state, every failure, and its publication once made, or its PDF while it lasts',
    tenantScoped: true,
    access: { check: 'session' },
    params: PublicationRequestParams,
    responses: {
      200: { description: 'The request', schema: PublicationRequestView },
      401: unauthenticated,
      404: { description: 'No such request, or one somebody else asked for', schema: ErrorBody },
      503: {
        description: 'A done preview, and this environment has nowhere to keep documents yet',
        schema: ErrorBody,
      },
    },
  },
  listPublications: {
    operationId: 'listPublications',
    method: 'GET',
    path: '/v1/documents/{id}/publications',
    summary: "The document's publications the caller may read, a page at a time",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    query: PublicationListQuery,
    responses: {
      200: { description: 'A page of the publications', schema: PublicationList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: {
        description:
          'Never answered: a document the caller may read is one whose listing they may read',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
  listPublicationsEverywhere: {
    operationId: 'listPublicationsEverywhere',
    method: 'GET',
    path: '/v1/publications',
    summary: 'Every publication the caller may read, of every document, a page at a time',
    tenantScoped: true,
    access: { check: 'session' },
    query: PublicationListQuery,
    responses: {
      200: { description: 'A page of the publications', schema: PublicationList },
      400: {
        description: 'A cursor this listing did not give out, or a limit outside 1 to 100',
        schema: ErrorBody,
      },
      401: unauthenticated,
    },
  },
  getPublication: {
    operationId: 'getPublication',
    method: 'GET',
    path: '/v1/publications/{id}',
    summary: 'A publication: its record, and a link to each output',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: PublicationParams,
    responses: {
      200: { description: 'The publication', schema: PublicationView },
      401: unauthenticated,
      403: {
        description: 'Never answered: a publication the caller may read is one they may open',
        schema: ErrorBody,
      },
      404: {
        description: 'No such publication in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      503: {
        description: 'This environment has nowhere to keep documents yet',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
