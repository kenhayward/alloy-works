import { outputReportSchema, publishFailureCodes } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
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

export const PublicationRequestView = z.object({
  id: z.string(),
  document: z.string(),
  state: z.enum(['queued', 'done', 'failed']),
  failures: z.array(PublishFailureView),
  publication: z.string().nullable().describe('The publication it made, once done'),
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

export const PublicationList = z.object({ items: z.array(PublicationSummary) });
export type PublicationList = z.infer<typeof PublicationList>;

const download = z
  .string()
  .describe('A link to the bytes, valid for five minutes, named by the publication id and format');

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
          "`format_unsupported`: a format the layout does not make; `layout_language`: the document is not in its layout's language; `page_reference_without_pdf`: the document cites a page and the PDF was not asked for",
        schema: ErrorBody,
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
        description: '`version_precondition`: the document has a newer version than the one named',
        schema: ErrorBody,
      },
    },
  },
  getPublicationRequest: {
    operationId: 'getPublicationRequest',
    method: 'GET',
    path: '/v1/publication-requests/{id}',
    summary:
      'A publish the caller asked for: its state, every failure, and its publication once made',
    tenantScoped: true,
    access: { check: 'session' },
    params: PublicationRequestParams,
    responses: {
      200: { description: 'The request', schema: PublicationRequestView },
      401: unauthenticated,
      404: { description: 'No such request, or one somebody else asked for', schema: ErrorBody },
    },
  },
  listPublications: {
    operationId: 'listPublications',
    method: 'GET',
    path: '/v1/documents/{id}/publications',
    summary: "The document's publications the caller may read, newest first",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: { description: 'The publications', schema: PublicationList },
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
    summary: 'Every publication the caller may read, of every document, newest first',
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'The publications', schema: PublicationList },
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
