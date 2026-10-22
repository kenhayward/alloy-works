import { z } from 'zod';
import { SpaceParams } from './components.js';
import type { RouteContract } from './contract.js';
import { nextCursor, pageQuery } from './listing.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';

/** The most a file for an import may hold (the IM plan, IM-B). */
export const IMPORT_MAX_BYTES = 25 * 1024 * 1024;

/** What making an import takes: the file's name and the kind it says it is, checked from its bytes. */
export const CreateImportBody = z.strictObject({
  fileName: z
    .string()
    .min(1)
    .max(255)
    .describe('The file’s name as its importer chose it, ending .docx, .md or .html'),
  fileType: z
    .enum(['docx', 'markdown', 'html'])
    .describe('What the file says it is: a Word document, Markdown or HTML'),
});
export type CreateImportBody = z.infer<typeof CreateImportBody>;

export const ImportParams = z.object({ id: LowercaseUuid });
export type ImportParams = z.infer<typeof ImportParams>;

export const ImportLevelsBody = z.strictObject({
  section: z.number().int().min(1).max(8).describe('The heading level that starts a section'),
  component: z
    .number()
    .int()
    .min(2)
    .max(9)
    .describe('The heading level that starts a component, below the section’s'),
});
export type ImportLevelsBody = z.infer<typeof ImportLevelsBody>;

export const AcceptImportBody = z.strictObject({
  title: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe('The document’s title; the one the file names, or its name, where absent'),
  template: LowercaseUuid.optional().describe(
    'The template to make the document from; a blank document where absent',
  ),
  language: z
    .string()
    .max(35)
    .optional()
    .describe('The language of the document and its components; the file’s, or en, where absent'),
});
export type AcceptImportBody = z.infer<typeof AcceptImportBody>;

const ImportState = z
  .enum(['awaiting', 'reading', 'proposed', 'accepted', 'abandoned', 'failed'])
  .describe(
    '`awaiting` its file; `reading` it; `proposed`, its outline to review; `accepted` into a document; `abandoned`, or `failed` with why, leaving nothing',
  );

/** An import as its list shows it. */
export const ImportSummary = z.object({
  id: z.string(),
  space: z.string(),
  importer: z.string(),
  fileName: z.string(),
  fileType: z.enum(['docx', 'markdown', 'html']),
  state: ImportState,
  failure: z
    .enum(['file_unreadable', 'file_unsafe', 'file_too_large', 'file_missing', 'reading_failed'])
    .nullable()
    .describe('Why it failed, once failed'),
  document: z.string().nullable().describe('The document it made, once accepted'),
  createdAt: z.string(),
  sweepsAt: z
    .string()
    .nullable()
    .describe('When a proposal left alone is abandoned: 30 days after it last changed'),
});
export type ImportSummary = z.infer<typeof ImportSummary>;

const ImportReason = z
  .object({
    rule: z.enum(['heading', 'beforeFirstComponent', 'beforeFirstHeading']),
    style: z.string().optional(),
    text: z.string().optional(),
    level: z.number().int().optional(),
  })
  .describe(
    'Why the part starts where it does: the heading, by its style and text; or what came before the first heading under it',
  );

export const ImportPartView = z.object({
  id: z.string(),
  kind: z.enum(['section', 'component']),
  title: z.string(),
  parent: z.string().nullable().describe('The section it stands under; null at the top'),
  reason: ImportReason,
  flags: z
    .array(z.enum(['empty', 'refused']))
    .describe('`empty`: nothing under its heading; `refused`: what it held could not be admitted'),
  blocks: z.number().int().describe('How many blocks it holds'),
  source: z.string().describe('Its text as the file had it, its heading first'),
});
export type ImportPartView = z.infer<typeof ImportPartView>;

export const ImportReportEntry = z.object({
  stage: z.string(),
  action: z.enum(['discarded', 'rewritten', 'kept', 'refused']),
  subject: z.string(),
  message: z.string().describe('A fixed sentence saying what happened, never quoting the file'),
  detail: z.string().optional().describe('What it was about, as data: shown as text'),
  count: z.number().int().optional(),
  part: z
    .number()
    .int()
    .nullable()
    .describe('The part it was about, by its place; null for the file'),
});

export const ImportView = ImportSummary.extend({
  levels: ImportLevelsBody,
  title: z.string().nullable().describe('The title the file names, where it names one'),
  parts: z.array(ImportPartView).describe('The proposed outline, in order'),
  report: z
    .array(ImportReportEntry)
    .describe('What was left out, kept differently, or not read yet (IMP-007)'),
});
export type ImportView = z.infer<typeof ImportView>;

export const ImportListQuery = z.object(pageQuery);
export type ImportListQuery = z.infer<typeof ImportListQuery>;

export const ImportList = z.object({ items: z.array(ImportSummary), next: nextCursor });
export type ImportList = z.infer<typeof ImportList>;

export const ImportAccepted = z.object({
  import: ImportView,
  document: z.string().describe('The document it made'),
});
export type ImportAccepted = z.infer<typeof ImportAccepted>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;

const notYours = {
  description: 'No such import, or one the caller neither made nor administers the space of',
  schema: ErrorBody,
} as const;

/** Importing a Word, Markdown or HTML file as a proposal (docs/design/import.md; the IM plan). */
export const importRoutes = {
  createImport: {
    operationId: 'createImport',
    method: 'POST',
    path: '/v1/spaces/{space}/imports',
    summary: 'Make an import in this space, awaiting its file',
    tenantScoped: true,
    access: { check: 'permission', permission: 'create', target: { space: 'space' } },
    params: SpaceParams,
    body: CreateImportBody,
    responses: {
      200: { description: 'The import, awaiting its file', schema: ImportView },
      400: {
        description:
          '`import_file_not_permitted`: the name does not end as its kind does (.docx, .md, .markdown, .html or .htm)',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'The caller may read the space but not create in it', schema: ErrorBody },
      404: { description: 'No such space, or none the caller may read', schema: ErrorBody },
    },
  },
  putImportFile: {
    operationId: 'putImportFile',
    method: 'PUT',
    path: '/v1/imports/{id}/file',
    summary: 'Fill an import with its file, which the worker then reads into a proposal',
    tenantScoped: true,
    access: { check: 'session' },
    params: ImportParams,
    rawBody: { contentType: 'application/octet-stream', maxBytes: IMPORT_MAX_BYTES },
    responses: {
      200: { description: 'The import, reading', schema: ImportView },
      400: {
        description:
          '`import_file_not_permitted`: the bytes are not what the import says, read from them: a Word document is a zip holding word/document.xml, Markdown and HTML are UTF-8 text',
        schema: ErrorBody,
      },
      401: unauthenticated,
      404: notYours,
      409: { description: '`import_filled`: the import already has its file', schema: ErrorBody },
      413: { description: '`import_too_large`: more than 25 MB', schema: ErrorBody },
      415: {
        description: '`import_bytes_expected`: the body is not application/octet-stream',
        schema: ErrorBody,
      },
    },
  },
  listImports: {
    operationId: 'listImports',
    method: 'GET',
    path: '/v1/spaces/{space}/imports',
    summary: 'The caller’s imports in this space, or every one for its administrator',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { space: 'space' } },
    params: SpaceParams,
    query: ImportListQuery,
    responses: {
      200: { description: 'The imports, the newest first, a page at a time', schema: ImportList },
      401: unauthenticated,
      403: {
        description: 'Never answered: a space the caller may read is listed',
        schema: ErrorBody,
      },
      404: { description: 'No such space, or none the caller may read', schema: ErrorBody },
    },
  },
  getImport: {
    operationId: 'getImport',
    method: 'GET',
    path: '/v1/imports/{id}',
    summary: 'An import: its state, its proposed outline and what its report says',
    tenantScoped: true,
    access: { check: 'session' },
    params: ImportParams,
    responses: {
      200: { description: 'The import', schema: ImportView },
      401: unauthenticated,
      404: notYours,
    },
  },
  setImportLevels: {
    operationId: 'setImportLevels',
    method: 'PUT',
    path: '/v1/imports/{id}/levels',
    summary: 'Change the heading levels a proposal breaks out at, reading it again',
    tenantScoped: true,
    access: { check: 'session' },
    params: ImportParams,
    body: ImportLevelsBody,
    responses: {
      200: { description: 'The import, reading again', schema: ImportView },
      400: {
        description: '`import_levels_invalid`: a component’s level is not below a section’s',
        schema: ErrorBody,
      },
      401: unauthenticated,
      404: notYours,
      409: { description: '`import_not_proposed`: it is not proposed', schema: ErrorBody },
    },
  },
  acceptImport: {
    operationId: 'acceptImport',
    method: 'POST',
    path: '/v1/imports/{id}/accept',
    summary: 'Accept a proposal, making its document, sections and components in one act',
    tenantScoped: true,
    access: { check: 'session' },
    params: ImportParams,
    body: AcceptImportBody,
    responses: {
      200: {
        description: 'The import, accepted, and the document it made',
        schema: ImportAccepted,
      },
      400: {
        description:
          '`content_invalid`: the title or language is not one a document takes; `template_unresolved`: the template does not resolve',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'The caller may no longer create in the space', schema: ErrorBody },
      404: notYours,
      409: { description: '`import_not_proposed`: it is not proposed', schema: ErrorBody },
    },
  },
  abandonImport: {
    operationId: 'abandonImport',
    method: 'POST',
    path: '/v1/imports/{id}/abandon',
    summary: 'Abandon an import before it is accepted, leaving nothing of it',
    tenantScoped: true,
    access: { check: 'session' },
    params: ImportParams,
    responses: {
      200: { description: 'The import, abandoned', schema: ImportView },
      401: unauthenticated,
      404: notYours,
      409: {
        description: '`import_not_open`: it is already accepted, abandoned or failed',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
