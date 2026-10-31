import { cslItemSchema, referenceSourceKeySchema } from '@alloy-works/domain';
import { z } from 'zod';
import {
  CreateEntryAnswer,
  EntryFlagView,
  EntryMatch,
  EntryParams,
  EntryStatusView,
} from './bibliography.js';
import { SpaceParams } from './components.js';
import { DocumentParams } from './documents.js';
import type { RouteContract } from './contract.js';
import { ErrorBody, SPACE_ARCHIVED } from './schemas.js';

export const SourceParams = z.object({
  source: referenceSourceKeySchema.describe(
    'The source, by its id in the declared list, or a reference extension’s, `ext:` and its id',
  ),
});
export type SourceParams = z.infer<typeof SourceParams>;

export const ReferenceSourceView = z.object({
  id: referenceSourceKeySchema,
  name: z.string().describe('Its name; a reference extension’s, its manifest’s own words'),
  host: z.string().describe('The one host it is reached at'),
  identifier: z
    .enum(['DOI', 'PMID', 'Identifier'])
    .describe('What a record is fetched by: a reference extension’s own identifier'),
  enabled: z.boolean().describe('Whether this environment searches it'),
});

export const ReferenceSourceList = z.object({ items: z.array(ReferenceSourceView) });
export type ReferenceSourceList = z.infer<typeof ReferenceSourceList>;

export const ReferenceSourceBody = z.strictObject({
  source: referenceSourceKeySchema,
  enabled: z.boolean(),
});
export type ReferenceSourceBody = z.infer<typeof ReferenceSourceBody>;

export const ReferenceSearchBody = z.strictObject({
  space: z
    .string()
    .regex(/^space:[0-9a-f-]{36}$/)
    .describe('`space:<id>`: the space whose entries a result is matched against'),
  terms: z.string().min(1).max(300).describe('What to search for, sent to the source as typed'),
});
export type ReferenceSearchBody = z.infer<typeof ReferenceSearchBody>;

export const ReferenceResultView = z.object({
  identifier: z.string().describe("The record's DOI or PMID"),
  csl: cslItemSchema,
  dropped: z.array(z.string()).describe('The fields the source gave that an entry cannot hold'),
  matches: z.array(EntryMatch).describe('The entries in the space found to be the same source'),
});

export const ReferenceSearchAnswer = z.object({
  results: z.array(ReferenceResultView),
  mayCreate: z.boolean().describe('Whether the caller may make an entry in the space: edit there'),
});
export type ReferenceSearchAnswer = z.infer<typeof ReferenceSearchAnswer>;

export const FromSourceBody = z.strictObject({
  source: referenceSourceKeySchema,
  identifier: z
    .string()
    .min(1)
    .max(300)
    .describe("The record's DOI, PMID, or a reference extension's identifier"),
  despiteMatches: z
    .boolean()
    .optional()
    .describe('Make it though the same source is already in the space (LIB-044)'),
});
export type FromSourceBody = z.infer<typeof FromSourceBody>;

export const FromSourceAnswer = CreateEntryAnswer.extend({
  dropped: z.array(z.string()).describe('The fields the source gave that an entry cannot hold'),
});
export type FromSourceAnswer = z.infer<typeof FromSourceAnswer>;

/** A document's flagged sources (XR-G): each entry retracted, superseded or corrected that what it places cites. */
export const FlaggedSourcesView = z.object({
  items: z.array(
    z.object({
      flag: EntryFlagView,
      entry: z
        .object({ id: z.string(), key: z.string(), title: z.string().nullable() })
        .nullable()
        .describe('The entry, to a reader of it; null to anybody else, who sees the flag alone'),
      components: z
        .array(z.object({ id: z.string(), title: z.string() }))
        .describe('The components citing it the caller may read'),
      unreadable: z.boolean().describe('Whether components citing it the caller may not read do'),
    }),
  ),
});
export type FlaggedSourcesView = z.infer<typeof FlaggedSourcesView>;

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
const sourceFailed = {
  description:
    "`reference_unavailable`: the source could not be reached or answered out of shape, which is the source's",
  schema: ErrorBody,
} as const;
const connectorDown = {
  description:
    '`connector_unavailable` or `connector_busy`: the connector cannot ask the source now',
  schema: ErrorBody,
} as const;
const sourceOff = {
  description: '`reference_source_off`: this environment has switched the source off',
  schema: ErrorBody,
} as const;
const entryNotFound = {
  description: 'No such entry in this environment, or none the caller may read',
  schema: ErrorBody,
} as const;

/**
 * Reference sources (reference-sources.md; the XR plan, XR-C, XR-D): the declared list, each switched
 * on or off by an administrator of the environment; searched as a reader of a space, and a result made
 * an entry of it with the space's edit, every call through the connector.
 */
export const referenceSourceRoutes = {
  listReferenceSources: {
    operationId: 'listReferenceSources',
    method: 'GET',
    path: '/v1/reference-sources',
    summary: 'The reference sources, and whether this environment searches each',
    tenantScoped: true,
    access: { check: 'session' },
    responses: {
      200: { description: 'Every declared source', schema: ReferenceSourceList },
      401: unauthenticated,
    },
  },
  setReferenceSource: {
    operationId: 'setReferenceSource',
    method: 'PUT',
    path: '/v1/reference-sources',
    summary: 'Switch a reference source on or off for this environment',
    tenantScoped: true,
    access: { check: 'permission', permission: 'administer', target: { tenant: true } },
    body: ReferenceSourceBody,
    responses: {
      200: { description: 'The source, as switched', schema: ReferenceSourceView },
      400: { description: 'No such source', schema: ErrorBody },
      401: unauthenticated,
      403: { description: 'The caller may not administer this environment', schema: ErrorBody },
      404: { description: 'No such reference extension installed here', schema: ErrorBody },
    },
  },
  searchReferenceSource: {
    operationId: 'searchReferenceSource',
    method: 'POST',
    path: '/v1/reference-sources/{source}/search',
    summary: 'Search a reference source, each result matched against the space’s entries',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { body: 'space' } },
    params: SourceParams,
    body: ReferenceSearchBody,
    responses: {
      200: { description: 'At most 20 results, as CSL', schema: ReferenceSearchAnswer },
      400: { description: 'No such source, or terms of no use', schema: ErrorBody },
      401: unauthenticated,
      403: {
        description: 'Never answered: a space the caller may not read is not found',
        schema: ErrorBody,
      },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: sourceOff,
      502: sourceFailed,
      503: connectorDown,
    },
  },
  createBibliographyEntryFromSource: {
    operationId: 'createBibliographyEntryFromSource',
    method: 'POST',
    path: '/v1/spaces/{space}/bibliography-entries/from-source',
    summary: 'Make an entry in this space from a reference source’s record, or be offered a match',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { space: 'space' } },
    params: SpaceParams,
    body: FromSourceBody,
    responses: {
      200: {
        description: 'Made at version 0.1, or not made and the same source offered',
        schema: FromSourceAnswer,
      },
      400: { description: 'No such source, or an identifier it does not use', schema: ErrorBody },
      401: unauthenticated,
      403: { description: 'The caller may not edit in the space', schema: ErrorBody },
      404: {
        description: 'No such space in this environment, or none the caller may read',
        schema: ErrorBody,
      },
      409: { description: `${sourceOff.description}. ${SPACE_ARCHIVED}`, schema: ErrorBody },
      422: {
        description: '`reference_missing`: the source holds no record by that identifier',
        schema: ErrorBody,
      },
      502: sourceFailed,
      503: connectorDown,
    },
  },
  checkBibliographyEntry: {
    operationId: 'checkBibliographyEntry',
    method: 'POST',
    path: '/v1/bibliography-entries/{id}/check',
    summary: 'Check an entry against the source it was obtained from, and record its status',
    tenantScoped: true,
    access: { check: 'permission', permission: 'edit', target: { artifact: 'id' } },
    params: EntryParams,
    responses: {
      200: {
        description:
          'Its status, recorded beside it and never as a version: the source is sent its identifier alone',
        schema: EntryStatusView,
      },
      401: unauthenticated,
      403: { description: 'The caller may read the entry but not edit it', schema: ErrorBody },
      404: entryNotFound,
      409: sourceOff,
      422: {
        description: '`entry_not_obtained`: its latest version was not obtained from a source',
        schema: ErrorBody,
      },
      429: {
        description: '`entry_checked_recently`: the entry was checked, or tried, within the minute',
        schema: ErrorBody,
      },
      502: sourceFailed,
      503: connectorDown,
    },
  },
  getDocumentFlaggedSources: {
    operationId: 'getDocumentFlaggedSources',
    method: 'GET',
    path: '/v1/documents/{id}/flagged-sources',
    summary: 'The retracted, superseded and corrected sources cited by what a document places',
    tenantScoped: true,
    access: { check: 'permission', permission: 'read', target: { artifact: 'id' } },
    params: DocumentParams,
    responses: {
      200: {
        description:
          'Each flagged entry cited by a component the latest version places, at the version it places',
        schema: FlaggedSourcesView,
      },
      401: unauthenticated,
      403: {
        description: 'Never answered: a document the caller may not read is not found',
        schema: ErrorBody,
      },
      404: {
        description: 'No such document in this environment, or none the caller may read',
        schema: ErrorBody,
      },
    },
  },
} as const satisfies Record<string, RouteContract>;
