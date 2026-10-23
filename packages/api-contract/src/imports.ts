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
    rule: z.enum(['heading', 'beforeFirstComponent', 'beforeFirstHeading', 'split']),
    style: z.string().optional(),
    text: z.string().optional(),
    level: z.number().int().optional(),
  })
  .describe(
    'Why the part starts where it does: the heading, by its style and text; what came before the first heading under it; or that its importer split it there',
  );

const ImportReviewFlag = z.enum([
  'empty',
  'refused',
  'changeClamped',
  'commentClamped',
  'notYetRead',
  'leftOut',
  'keptDifferently',
]);

export const ImportPartView = z.object({
  id: z.string(),
  kind: z.enum(['section', 'component']),
  title: z.string(),
  parent: z.string().nullable().describe('The section it stands under; null at the top'),
  reason: ImportReason,
  flags: z
    .array(ImportReviewFlag)
    .describe(
      '`empty`: nothing under its heading; `refused`: what it held could not be admitted; `changeClamped`: a tracked change kept here ran on past it; `commentClamped`: a comment anchored here ran past where it starts; `notYetRead`, `leftOut` and `keptDifferently`: what the report said of what it came from',
    ),
  blocks: z.number().int().describe('How many blocks it holds'),
  source: z.string().describe('Its text as the file had it, its heading first'),
});
export type ImportPartView = z.infer<typeof ImportPartView>;

export const ImportPartParams = z.object({ id: LowercaseUuid, part: LowercaseUuid });
export type ImportPartParams = z.infer<typeof ImportPartParams>;

/** One part, beside what it came from (IMP-028): its blocks as text, and its neighbours. */
export const ImportPartDetail = ImportPartView.omit({ blocks: true }).extend({
  place: z.number().int().describe('Its place in the outline, from 0'),
  of: z.number().int().describe('How many parts the outline holds'),
  previous: z.string().nullable().describe('The part before it; null for the first'),
  next: z.string().nullable().describe('The part after it; null for the last'),
  blocks: z
    .array(
      z.object({
        id: z.string().describe('Its identifier, which a reference may be pointed at'),
        type: z.string().describe('What kind of block it is: paragraph, list, table and so on'),
        text: z.string().describe('Its text, shown as text'),
      }),
    )
    .describe('What it holds, a block at a time'),
  suggestions: z
    .array(
      z.object({
        author: z.string().describe('The Word author, as the file names them: shown as text'),
        blocks: z.number().int().describe('How many of its blocks their changes change'),
        text: z.string().describe('Those blocks as their changes leave them, shown as text'),
      }),
    )
    .describe('The suggestion each Word author’s tracked changes become at acceptance (IMP-005)'),
  threads: z
    .array(
      z.object({
        author: z.string().describe('The Word author, as the file names them: shown as text'),
        text: z.string().describe('The comment, shown as text'),
        quote: z.string().nullable().describe('The words it is on; null where it is on the part'),
        clamped: z.boolean().describe('Whether its range ran past where it is anchored'),
        replies: z.array(z.object({ author: z.string(), text: z.string() })),
      }),
    )
    .describe('The thread each comment becomes at acceptance (IMP-005)'),
  references: z
    .array(z.string())
    .describe('The cross-references outside the import it holds, by their key'),
});
export type ImportPartDetail = z.infer<typeof ImportPartDetail>;

export const ImportPartSearchQuery = z.object({
  q: z.string().max(200).optional().describe('Words its title or text holds, ignoring case'),
  flag: ImportReviewFlag.optional().describe('A flag it carries'),
});
export type ImportPartSearchQuery = z.infer<typeof ImportPartSearchQuery>;

export const ImportPartMatches = z.object({
  parts: z.array(z.string()).describe('The parts that match, by id, in outline order'),
});
export type ImportPartMatches = z.infer<typeof ImportPartMatches>;

const revision = z.number().int().min(0).describe('The revision the edit was made against');
const part = LowercaseUuid.describe('The part it is made to');
const editTitle = z.string().min(1).max(500);

/** An edit to the proposal (IMb; IMP-002, IMP-041), made against the revision its importer read. */
const ImportEdit = z.discriminatedUnion('edit', [
  z.strictObject({
    edit: z.literal('move'),
    part,
    to: z
      .enum(['previous', 'next'])
      .describe(
        'Its first blocks to the end of the part before, or its last to the start of the next',
      ),
    blocks: z.number().int().min(1).describe('How many blocks move'),
  }),
  z.strictObject({
    edit: z.literal('split'),
    part,
    at: z.number().int().min(1).describe('The block, from 0, the new part starts at'),
    title: editTitle.describe('The new part’s title'),
  }),
  z.strictObject({
    edit: z.literal('merge'),
    part: part.describe('The part merged with the one after it'),
  }),
  z.strictObject({ edit: z.literal('rename'), part, title: editTitle }),
  z.strictObject({
    edit: z.literal('kind'),
    part,
    kind: z.enum(['section', 'component']),
  }),
  z.strictObject({
    edit: z.literal('reference'),
    reference: z
      .string()
      .regex(/^wx-[0-9]{1,6}$/)
      .describe('The cross-reference outside the import, by its key'),
    to: z
      .discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('block'), block: z.string().min(1).max(64) }),
        z.strictObject({
          kind: z.literal('component'),
          component: LowercaseUuid,
          block: z.string().min(1).max(64),
        }),
        z.strictObject({ kind: z.literal('text') }),
      ])
      .describe(
        'A block of the import; a block of a component in the space; or the text it showed, said in the report',
      ),
  }),
  z.strictObject({
    edit: z.literal('identity'),
    identity: z.string().min(1).max(300).describe('A name the file carries'),
    member: LowercaseUuid.nullable().describe(
      'The member its name matches, confirmed for attribution; null withdraws the confirmation',
    ),
  }),
]);

export const EditImportBody = z.strictObject({ revision, edit: ImportEdit });
export type EditImportBody = z.infer<typeof EditImportBody>;

export const ImportPlaceBody = z.strictObject({
  part: LowercaseUuid.describe('The part its importer is at'),
});
export type ImportPlaceBody = z.infer<typeof ImportPlaceBody>;

const AcceptedCounts = z
  .object({
    unchanged: z.number().int(),
    edited: z.number().int(),
    merged: z.number().int(),
    split: z.number().int(),
    renamed: z.number().int(),
  })
  .describe(
    'How the parts accepted compare with the proposal as read, each counted once: merged, split, edited, renamed, or unchanged',
  );

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

const ImportIdentityView = z.object({
  name: z.string().describe('As the file carries it: shown as text'),
  email: z.string().nullable(),
  carries: z
    .array(z.enum(['changes', 'comments', 'creator', 'lastModifiedBy']))
    .describe('What the file names it for'),
  match: z
    .enum(['email', 'name', 'none'])
    .describe(
      'The member it matches, for attribution only: by an exact email, by name for its importer to confirm, or none',
    ),
  member: z.string().nullable(),
  memberName: z.string().nullable(),
  confirmed: z.boolean().describe('Whether its importer confirmed a name match'),
});

const OutsideReferenceView = z.object({
  key: z.string(),
  field: z.enum(['REF', 'NOTEREF', 'PAGEREF']),
  text: z.string().describe('What it showed in the file: shown as text, never content'),
  resolved: z
    .enum(['retargeted', 'text'])
    .nullable()
    .describe('Pointed at a block, made the text it showed, or null: still outside the import'),
});

export const ImportView = ImportSummary.extend({
  levels: ImportLevelsBody,
  title: z.string().nullable().describe('The title the file names, where it names one'),
  parts: z.array(ImportPartView).describe('The proposed outline, in order'),
  revision: z
    .number()
    .int()
    .describe('How many edits it has had: what the next edit is made against'),
  place: z.string().nullable().describe('The part its importer was last at'),
  accepted: AcceptedCounts.nullable().describe('Once accepted, how much was accepted unchanged'),
  report: z
    .array(ImportReportEntry)
    .describe('What was left out, kept differently, or not read yet (IMP-007)'),
  references: z
    .array(OutsideReferenceView)
    .describe('Each cross-reference whose target is not in the file (IMP-033)'),
  identities: z
    .array(ImportIdentityView)
    .describe('Every name the file carries (IMP-009), as carried'),
  policy: z
    .enum(['map', 'keep', 'discard'])
    .describe('The identity policy applied at acceptance, or, until then, the one that will be'),
  policyApplied: z.boolean().describe('Whether `policy` was applied, at acceptance (IMP-011)'),
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
      409: {
        description:
          '`import_not_proposed`: it is not proposed; `import_references_unresolved`: a cross-reference outside the file is neither retargeted nor made text',
        schema: ErrorBody,
      },
    },
  },
  getImportPart: {
    operationId: 'getImportPart',
    method: 'GET',
    path: '/v1/imports/{id}/parts/{part}',
    summary: 'One part of a proposal, beside the text it came from',
    tenantScoped: true,
    access: { check: 'session' },
    params: ImportPartParams,
    responses: {
      200: { description: 'The part', schema: ImportPartDetail },
      401: unauthenticated,
      404: { description: 'No such part, or no such import the caller may see', schema: ErrorBody },
    },
  },
  searchImportParts: {
    operationId: 'searchImportParts',
    method: 'GET',
    path: '/v1/imports/{id}/parts',
    summary:
      'The parts of a proposal whose title or text holds the words asked, or carrying a flag',
    tenantScoped: true,
    access: { check: 'session' },
    params: ImportParams,
    query: ImportPartSearchQuery,
    responses: {
      200: { description: 'The parts that match, in outline order', schema: ImportPartMatches },
      401: unauthenticated,
      404: notYours,
    },
  },
  editImport: {
    operationId: 'editImport',
    method: 'POST',
    path: '/v1/imports/{id}/edits',
    summary: 'Edit a proposal: move a split, split, merge or rename a part, or change its kind',
    tenantScoped: true,
    access: { check: 'session' },
    params: ImportParams,
    body: EditImportBody,
    responses: {
      200: { description: 'The import as edited', schema: ImportView },
      400: {
        description:
          '`import_edit_refused`: what the edit would make is not a part an import can accept, the message saying why',
        schema: ErrorBody,
      },
      401: unauthenticated,
      404: notYours,
      409: {
        description:
          '`import_not_proposed`: it is not proposed; `import_changed`: it was edited since the revision given',
        schema: ErrorBody,
      },
    },
  },
  setImportPlace: {
    operationId: 'setImportPlace',
    method: 'PUT',
    path: '/v1/imports/{id}/place',
    summary: 'Keep the part its importer is at, to return to',
    tenantScoped: true,
    access: { check: 'session' },
    params: ImportParams,
    body: ImportPlaceBody,
    responses: {
      200: { description: 'The import', schema: ImportView },
      401: unauthenticated,
      404: { description: 'No such part, or no such import the caller made', schema: ErrorBody },
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
