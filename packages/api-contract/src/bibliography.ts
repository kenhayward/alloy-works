import {
  cslItemSchema,
  ENTRY_CHECK_OUTCOMES,
  entrySchema,
  REFERENCE_SOURCE_IDS,
  referenceNoticeSchema,
} from '@alloy-works/domain';
import { z } from 'zod';
import { ComponentParams, SpaceParams, VersionSummary } from './components.js';
import type { RouteContract } from './contract.js';
import { idsFilter, listingQuery, listingTotal, nextCursor } from './listing.js';
import { ErrorBody, LowercaseUuid, SPACE_ARCHIVED } from './schemas.js';

export const EntryParams = z.object({ id: LowercaseUuid });
export type EntryParams = z.infer<typeof EntryParams>;

/**
 * What a caller gives for an entry (citations.md, "The entry"): its CSL, without an `id`, and where it
 * was obtained and when last checked. Never its key, which the entry is given at its creation.
 */
export const EntryInputBody = entrySchema.pick({ csl: true, obtained: true, checkedAt: true });

export const CreateEntryBody = z.strictObject({
  entry: EntryInputBody,
  despiteMatches: z
    .boolean()
    .optional()
    .describe('Make it though the same source is already in the space (LIB-044)'),
});
export type CreateEntryBody = z.infer<typeof CreateEntryBody>;

/** An entry's next version: the whole entry, from the version it was opened at. */
export const EntryVersionBody = z.strictObject({
  openedFrom: LowercaseUuid,
  entry: EntryInputBody,
});
export type EntryVersionBody = z.infer<typeof EntryVersionBody>;

/** An entry's status from its last check against its source (the XR plan, XR-F). */
export const EntryStatusView = z.object({
  source: z.enum(REFERENCE_SOURCE_IDS),
  checkedAt: z.string().describe('When it was last checked'),
  outcome: z
    .enum(ENTRY_CHECK_OUTCOMES)
    .describe(
      '`current`: as held; `changed`: the source now holds `differs` otherwise; `gone`: the source holds no such record; `retracted` or `corrected`: the source reports so',
    ),
  differs: z.array(z.string()).describe('The CSL variables the source now holds otherwise'),
  notice: referenceNoticeSchema
    .nullable()
    .describe(
      "The retraction or correction: its kind, and the notice's identifier and date where given",
    ),
});
export type EntryStatusView = z.infer<typeof EntryStatusView>;

/** A citation's flag (XR-G): its entry retracted or corrected, shown to anybody who sees the citation. */
export const EntryFlagView = z.enum(['retracted', 'corrected']);

export const EntryView = z.object({
  id: z.string(),
  space: z.object({ id: z.string(), name: z.string() }),
  version: VersionSummary,
  entry: entrySchema,
  archived: z.boolean().describe('Whether it is archived: left out of the listing, still citable'),
  mayEdit: z.boolean().describe('Whether the caller may cut its next version: edit on it'),
  mayRetire: z.boolean().describe('Whether the caller may archive it: retire on it'),
  status: EntryStatusView.nullable()
    .optional()
    .describe('Its status from its last check, on a read of it; null where never checked'),
});
export type EntryView = z.infer<typeof EntryView>;

export const EntrySummary = z.object({
  id: z.string(),
  key: z.string().describe('Its key, made from its fields at its creation and never changed'),
  csl: cslItemSchema,
  version: z.object({ id: z.string(), number: z.string() }),
  changedAt: z.string().describe('When its latest version was made'),
  flag: EntryFlagView.nullable()
    .optional()
    .describe('Retracted or corrected, as its source last said (XR-G); null otherwise'),
});

const MATCH_BY = ['doi', 'pmid', 'isbn', 'issn', 'work'] as const;

export const EntryMatch = z.object({
  by: z
    .enum(MATCH_BY)
    .describe('What found it: a canonical identifier, or `work`, its title, year and first author'),
  entry: EntrySummary,
});

export const CreateEntryAnswer = z.object({
  entry: EntryView.nullable().describe(
    'The entry made; null where the same source was found and the caller did not make it despite it',
  ),
  matches: z.array(EntryMatch).describe('The entries in the space found to be the same source'),
});
export type CreateEntryAnswer = z.infer<typeof CreateEntryAnswer>;

export const EntryList = z.object({
  items: z.array(EntrySummary),
  next: nextCursor,
  total: listingTotal,
});

export const EntryListQuery = z.object({
  ...listingQuery(['key', 'changed'], 'key'),
  archived: z.enum(['true']).optional().describe('List only the archived'),
});
export type EntryListQuery = z.infer<typeof EntryListQuery>;

export const EntryUsesView = z.object({
  components: z.object({
    named: z.array(z.object({ id: z.string(), title: z.string() })),
    unreadable: z.boolean().describe('Whether a component the caller may not read cites it too'),
  }),
  baselines: z.object({
    named: z.array(z.object({ id: z.string(), name: z.string(), document: z.string() })),
    unreadable: z.boolean().describe('Whether a baseline the caller may not read pins one too'),
  }),
});
export type EntryUsesView = z.infer<typeof EntryUsesView>;

export const INTERCHANGE_FORMATS = ['csl-json', 'bibtex', 'ris'] as const;

/** The most an import's text may be, in characters. */
export const IMPORT_MOST = 2_000_000;
/** The most records one import takes, each matched and written in one transaction. */
export const IMPORT_RECORDS_MOST = 500;

export const ImportEntriesBody = z.strictObject({
  format: z.enum(INTERCHANGE_FORMATS),
  text: z.string().min(1).max(IMPORT_MOST),
});
export type ImportEntriesBody = z.infer<typeof ImportEntriesBody>;

export const ImportedRecordView = z.object({
  outcome: z.enum(['created', 'merged', 'refused']),
  entry: EntrySummary.nullable(),
  by: z.enum(MATCH_BY).nullable().describe('What matched it, where it was merged'),
  merged: z.array(z.string()).describe('The fields the match lacked and was given'),
  dropped: z.array(z.string()).describe('The fields an entry could not hold, left out'),
  message: z.string().nullable().describe('Why it was refused'),
});

export const ImportAnswer = z.object({ records: z.array(ImportedRecordView) });
export type ImportAnswer = z.infer<typeof ImportAnswer>;

export const ExportQuery = z.object({
  format: z.enum(INTERCHANGE_FORMATS),
  ids: idsFilter.optional().describe('Only these entries, by id'),
});
export type ExportQuery = z.infer<typeof ExportQuery>;

export const ExportAnswer = z.object({
  format: z.enum(INTERCHANGE_FORMATS),
  text: z.string().describe('The entries in the format, each named by its key'),
});

/** The citations a component's editor shows, in order (the CI plan, CId). */
export const CitationPreviewBody = z.strictObject({
  citations: z
    .array(
      z.strictObject({
        entry: z.string().min(1).max(200),
        locator: z.string().min(1).max(200).optional(),
      }),
    )
    .max(500)
    .describe('Each citation in the order the component holds them'),
  document: LowercaseUuid.optional().describe(
    "The document it is edited in, whose theme's style renders them; absent, the environment's theme's",
  ),
});
export type CitationPreviewBody = z.infer<typeof CitationPreviewBody>;

export const CitationPreview = z.object({
  forms: z
    .array(z.string().nullable())
    .describe(
      "Each citation's in-text form, in order; null where it names no entry of the component's space the caller may read, or the theme names no style",
    ),
  flags: z
    .array(EntryFlagView.nullable())
    .describe(
      "Each citation's flag, in order: its entry retracted or corrected, shown whether or not the caller may read the entry; null otherwise",
    ),
});
export type CitationPreview = z.infer<typeof CitationPreview>;

export const ArchivalAnswer = z.object({
  archived: z.boolean().describe('Whether it is archived now'),
});

/** An entry refused: by its shape, each problem named, or as it now stands. */
export const EntryRefusal = ErrorBody.extend({
  problems: z
    .array(z.object({ rule: z.literal('entry_invalid'), path: z.string(), message: z.string() }))
    .optional(),
  current: EntryView.optional(),
});

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const notFound = {
  description: 'No such entry in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const spaceNotFound = {
  description: 'No such space in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;
const entryRefused = {
  description:
    "`entry_invalid`: a source type or field CSL 1.0.2 does not hold, or a field in another shape than CSL's, each problem named",
  schema: EntryRefusal,
} as const;
const retire = { check: 'permission', permission: 'retire', target: { artifact: 'id' } } as const;

/**
 * Bibliography entries (citations.md; the CI plan, CI-B, CI-C): `edit` in the space makes, changes and
 * imports them; `read` shows and exports them; `retire` archives one nothing cites.
 */
export const bibliographyRoutes = {
  listBibliographyEntries: {
    operationId: 'listBibliographyEntries',
    method: 'GET',
    path: '/v1/spaces/{space}/bibliography-entries',
    summary: "The space's bibliography entries the caller may read",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { space: 'space' } },
    params: SpaceParams,
    query: EntryListQuery,
    responses: {
      200: { description: 'A page of entries', schema: EntryList },
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
  createBibliographyEntry: {
    operationId: 'createBibliographyEntry',
    method: 'POST',
    path: '/v1/spaces/{space}/bibliography-entries',
    summary: 'Make a bibliography entry in this space, or be offered the one already there',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { space: 'space' } },
    params: SpaceParams,
    body: CreateEntryBody,
    responses: {
      200: {
        description: 'Made at version 0.1, or not made and the same source offered',
        schema: CreateEntryAnswer,
      },
      400: entryRefused,
      401: unauthenticated,
      403: { description: 'The caller may not edit in the space', schema: ErrorBody },
      404: spaceNotFound,
      409: { description: SPACE_ARCHIVED, schema: ErrorBody },
    },
  },
  importBibliographyEntries: {
    operationId: 'importBibliographyEntries',
    method: 'POST',
    path: '/v1/spaces/{space}/bibliography-entries/import',
    summary: 'Import CSL-JSON, BibTeX or RIS as entries of this space, merging each match',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { space: 'space' } },
    params: SpaceParams,
    body: ImportEntriesBody,
    responses: {
      200: { description: 'What became of each record, in order', schema: ImportAnswer },
      400: {
        description:
          '`import_unreadable`: the text does not read as the format. `import_too_many`: it holds more than 500 records',
        schema: ErrorBody,
      },
      401: unauthenticated,
      403: { description: 'The caller may not edit in the space', schema: ErrorBody },
      404: spaceNotFound,
      409: { description: SPACE_ARCHIVED, schema: ErrorBody },
    },
  },
  exportBibliographyEntries: {
    operationId: 'exportBibliographyEntries',
    method: 'GET',
    path: '/v1/spaces/{space}/bibliography-entries/export',
    summary: "The space's entries the caller may read, as CSL-JSON, BibTeX or RIS",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { space: 'space' } },
    params: SpaceParams,
    query: ExportQuery,
    responses: {
      200: { description: 'The entries in the format', schema: ExportAnswer },
      401: unauthenticated,
      403: {
        description: 'Never answered: a space the caller may not read is not found',
        schema: ErrorBody,
      },
      404: spaceNotFound,
    },
  },
  getBibliographyEntry: {
    operationId: 'getBibliographyEntry',
    method: 'GET',
    path: '/v1/bibliography-entries/{id}',
    summary: 'A bibliography entry at its latest version',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: EntryParams,
    responses: {
      200: { description: 'The entry', schema: EntryView },
      401: unauthenticated,
      403: {
        description: 'Never answered: an entry the caller may not read is not found',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  recordBibliographyEntryVersion: {
    operationId: 'recordBibliographyEntryVersion',
    method: 'POST',
    path: '/v1/bibliography-entries/{id}/versions',
    summary: "Cut an entry's next version from the one the caller opened, its key kept",
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: EntryParams,
    body: EntryVersionBody,
    responses: {
      200: {
        description:
          'The entry at its latest version: the one cut, or the one before where nothing changed',
        schema: EntryView,
      },
      400: entryRefused,
      401: unauthenticated,
      403: { description: 'The caller may read the entry but may not edit it', schema: ErrorBody },
      404: notFound,
      409: {
        description:
          '`version_precondition`: the entry has a newer version than the one named, answered with it; ' +
          SPACE_ARCHIVED,
        schema: EntryRefusal,
      },
    },
  },
  getBibliographyEntryUses: {
    operationId: 'getBibliographyEntryUses',
    method: 'GET',
    path: '/v1/bibliography-entries/{id}/uses',
    summary: 'Where an entry is cited: components, and baselines pinning a version that cites it',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: EntryParams,
    responses: {
      200: {
        description:
          'The components and baselines citing it the caller may read, and whether there are more',
        schema: EntryUsesView,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: an entry the caller may not read is not found',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
  archiveBibliographyEntry: {
    operationId: 'archiveBibliographyEntry',
    method: 'POST',
    path: '/v1/bibliography-entries/{id}/archive',
    summary: 'Archive an entry nothing cites',
    tenantScoped: true,
    access: retire,
    params: EntryParams,
    responses: {
      200: {
        description: 'Archived, or already so, which changes nothing',
        schema: ArchivalAnswer,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the entry but may not retire it',
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description: "`entry_cited`: a component's latest version, or a baseline's, cites it",
        schema: ErrorBody,
      },
    },
  },
  previewComponentCitations: {
    operationId: 'previewComponentCitations',
    method: 'POST',
    path: '/v1/components/{id}/citations/preview',
    summary: "A component's citations in their in-text form, as its editor shows them",
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: ComponentParams,
    body: CitationPreviewBody,
    responses: {
      200: { description: 'Each citation in its in-text form, in order', schema: CitationPreview },
      401: unauthenticated,
      403: {
        description: 'Never answered: a component the caller may not read is not found',
        schema: ErrorBody,
      },
      404: {
        description:
          'No such component in this environment, or none the caller may read; or a document the caller may not read',
        schema: ErrorBody,
      },
    },
  },
  unarchiveBibliographyEntry: {
    operationId: 'unarchiveBibliographyEntry',
    method: 'POST',
    path: '/v1/bibliography-entries/{id}/unarchive',
    summary: 'Unarchive an entry',
    tenantScoped: true,
    access: retire,
    params: EntryParams,
    responses: {
      200: {
        description: 'Unarchived, or already so, which changes nothing',
        schema: ArchivalAnswer,
      },
      401: unauthenticated,
      403: {
        description: 'The caller may read the entry but may not retire it',
        schema: ErrorBody,
      },
      404: notFound,
    },
  },
} as const satisfies Record<string, RouteContract>;
