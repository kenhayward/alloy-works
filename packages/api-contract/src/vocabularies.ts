import { vocabularyDefinitionSchema } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { DataRefusal, SqlRefusal, unauthenticatedOrEnded } from './connections.js';
import { DefinitionRefusal } from './definitions.js';
import { ErrorBody, LowercaseUuid } from './schemas.js';
import { SKOS_FORMATS, TERM_IMPORT_BODY_MOST, TERM_IMPORT_MOST } from './terms.js';

export const VocabularyParams = z.object({ id: LowercaseUuid });
export type VocabularyParams = z.infer<typeof VocabularyParams>;

const VersionNumber = z.object({ id: z.string(), number: z.string() });

export const VocabularySummary = z.object({
  id: z.string(),
  key: z.string().describe('Its key, fixed, which an import names it by'),
  name: z.string(),
  version: VersionNumber,
  values: z.int().describe('How many values it holds, retired ones included'),
});

export const VocabularyList = z.object({ items: z.array(VocabularySummary) });
export type VocabularyList = z.infer<typeof VocabularyList>;

/** A vocabulary at its latest version (the VO plan, VO-B), the domain's own shape. */
export const VocabularyView = z.object({
  id: z.string(),
  version: VersionNumber,
  vocabulary: vocabularyDefinitionSchema,
});
export type VocabularyView = z.infer<typeof VocabularyView>;

/** Where a vocabulary is used (LIB-005; the VO plan, VO-G), as the caller may see it. */
export const VocabularyUsesView = z.object({
  fields: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .describe('Each field drawing on it, at its latest definition, by name'),
  axes: z
    .array(z.object({ id: z.string(), key: z.string(), name: z.string() }))
    .describe('Each condition axis drawing on it, at its latest definition, by name'),
  values: z
    .array(
      z.object({
        value: z.string().describe("The value's id"),
        count: z
          .int()
          .positive()
          .describe('How many components, not deleted, hold it at their latest version'),
        components: z
          .array(z.object({ id: z.string(), title: z.string() }))
          .describe('Those of them the caller may read, by title; the rest are counted only'),
      }),
    )
    .describe("Each value held, in the vocabulary's own order; a value nothing holds is left out"),
});
export type VocabularyUsesView = z.infer<typeof VocabularyUsesView>;

export const VocabularyExportAnswer = z.object({
  format: z.literal('json-ld'),
  text: z
    .string()
    .describe('The vocabulary as a SKOS concept scheme in JSON-LD, in the compact form documented'),
});
export type VocabularyExportAnswer = z.infer<typeof VocabularyExportAnswer>;

export const ImportVocabularyBody = z.strictObject({
  format: z.enum(SKOS_FORMATS),
  text: z.string().min(1).max(TERM_IMPORT_MOST),
});
export type ImportVocabularyBody = z.infer<typeof ImportVocabularyBody>;

export const VocabularyImportAnswer = z.object({
  answer: z
    .enum(['created', 'recorded', 'unchanged'])
    .describe('Made, a version recorded of the one with its key, or that one as it was'),
  vocabulary: VocabularyView,
  kept: z
    .array(z.string())
    .describe('The ids of the values it held that the import did not: kept, as a value always is'),
  notRepresented: z
    .array(z.string())
    .describe('What no value could hold, each said with its subject, at most 1,000 named'),
  notRepresentedTotal: z.int().describe('How many things no value could hold, named or not'),
});
export type VocabularyImportAnswer = z.infer<typeof VocabularyImportAnswer>;

/** An import refused: as `/v1/definitions` refuses a definition, or its shape, each problem named. */
export const VocabularyImportRefusal = DefinitionRefusal.extend({
  problems: z
    .array(
      z.object({ rule: z.literal('vocabulary_invalid'), path: z.string(), message: z.string() }),
    )
    .optional()
    .describe('vocabulary_invalid: each problem with the vocabulary the import would make'),
});

const unauthenticated = {
  description: 'No session, or not one this environment issued',
  schema: ErrorBody,
} as const;
/** What a refresh from a vocabulary's source did (LIB-058; the VO plan, VO-J), by value id. */
export const VocabularyRefreshAnswer = z.object({
  answer: z
    .enum(['recorded', 'unchanged'])
    .describe('`recorded`: a new version; `unchanged`: the source gave nothing new'),
  vocabulary: VocabularyView,
  report: z.object({
    added: z.array(z.string()).describe('Values new to the source, added active'),
    relabelled: z
      .array(z.string())
      .describe('Values whose labels or descriptions the source changed'),
    retired: z.array(z.string()).describe('Values gone from the source, retired, never removed'),
    returned: z
      .array(z.string())
      .describe('Values retired here and in the source again, kept retired to be restored by hand'),
    unchanged: z.int().describe('How many values the source gave as they were'),
    refused: z
      .array(z.object({ source: z.string(), reason: z.string() }))
      .describe(
        'The first 1,000 rows or concepts no value could hold, by their identifier in the source',
      ),
    refusedTotal: z.int(),
  }),
});
export type VocabularyRefreshAnswer = z.infer<typeof VocabularyRefreshAnswer>;

/** A source that gave nothing to refresh from: why the address failed, or the query's failure. */
const VocabularySourceRefusal = DataRefusal.extend({
  failure: z
    .enum([
      'host_refused',
      'connection_failed',
      'timeout',
      'source_refused',
      'source_too_large',
      'connector_error',
    ])
    .optional(),
});

const notFound = {
  description: 'No such vocabulary in this environment',
  schema: ErrorBody,
} as const;
const signedIn = { check: 'session' } as const;

/**
 * Vocabularies (the VO plan, VO-A, VO-I): read by anyone signed in, since authors choose their values;
 * written through `/v1/definitions`, and imported here, by `manage_definitions` at the tenant.
 */
export const vocabularyRoutes = {
  listVocabularies: {
    operationId: 'listVocabularies',
    method: 'GET',
    path: '/v1/vocabularies',
    summary: "The environment's vocabularies, each at its latest version",
    tenantScoped: true,
    access: signedIn,
    responses: {
      200: { description: 'Every vocabulary, by name', schema: VocabularyList },
      401: unauthenticated,
    },
  },
  importVocabulary: {
    operationId: 'importVocabulary',
    method: 'POST',
    path: '/v1/vocabularies/import',
    summary: 'Import a SKOS concept scheme, as JSON-LD or Turtle, as a vocabulary',
    tenantScoped: true,
    access: { check: 'permission', permission: 'manage_definitions', target: { tenant: true } },
    body: ImportVocabularyBody,
    bodyMaxBytes: TERM_IMPORT_BODY_MOST,
    responses: {
      200: {
        description: 'The vocabulary made or changed, and what the import could not represent',
        schema: VocabularyImportAnswer,
      },
      400: {
        description:
          '`import_unreadable`: the text does not read as the format, or holds no one concept scheme keyed by its notation. `import_too_many`: it holds more than 5,000 concepts or 200,000 statements. `vocabulary_invalid`: the vocabulary it would make is not valid, each problem named. `definition_name_taken` or `definition_invalid`, as `/v1/definitions` refuses them',
        schema: VocabularyImportRefusal,
      },
      401: unauthenticated,
      403: { description: 'The caller may not manage definitions', schema: ErrorBody },
      413: { description: 'The body is larger than 5 MiB', schema: ErrorBody },
    },
  },
  refreshVocabulary: {
    operationId: 'refreshVocabulary',
    method: 'POST',
    path: '/v1/vocabularies/{id}/refresh',
    summary: "Refresh a vocabulary's values from its source, recording a version",
    tenantScoped: true,
    // Decided at the vocabulary, so one that is not here is not found, as a definition's version is.
    access: { check: 'permission', permission: 'manage_definitions', target: { artifact: 'id' } },
    params: VocabularyParams,
    // Answered after the deciding transaction commits, as a sample is; a repeat refreshes again.
    idempotencyKey: false,
    responses: {
      200: {
        description:
          'The vocabulary at its new version, or as it was where nothing changed, and what the refresh did',
        schema: VocabularyRefreshAnswer,
      },
      401: unauthenticatedOrEnded,
      403: {
        description:
          "The caller may not manage definitions, use the query definition's connection, or read the stored result it queries",
        schema: ErrorBody,
      },
      404: notFound,
      409: {
        description:
          '`vocabulary_unsourced`: it has no source. `vocabulary_source_missing`: its query definition is not one the caller may read here. ' +
          '`vocabulary_source_parameters`: the query asks a required parameter. `definition_retired`, `connection_retired`, ' +
          '`credential_missing`, `credential_target_changed`, `sql_not_permitted`, `capability_undeclared` or `identity_unavailable`, as a sample refuses them. ' +
          '`version_precondition`: the vocabulary changed while the source answered',
        schema: SqlRefusal,
      },
      422: {
        description:
          "`vocabulary_source_unreadable`: the address's text does not read as SKOS, holds more than 5,000 concepts, or the query has no `id` or `label` column",
        schema: ErrorBody,
      },
      502: {
        description:
          "`vocabulary_source_failed`: the address could not be fetched, `failure` saying why (`host_refused`, `connection_failed`, `timeout`, `source_refused`, `source_too_large`, `connector_error`); or the query's run failed, by its failure's code and attribution",
        schema: VocabularySourceRefusal,
      },
      503: {
        description:
          '`connector_unavailable`, `connector_busy` or `query_throttled`, as a sample answers them',
        schema: DataRefusal,
      },
    },
  },
  getVocabulary: {
    operationId: 'getVocabulary',
    method: 'GET',
    path: '/v1/vocabularies/{id}',
    summary: 'A vocabulary at its latest version',
    tenantScoped: true,
    access: signedIn,
    params: VocabularyParams,
    responses: {
      200: { description: 'The vocabulary', schema: VocabularyView },
      401: unauthenticated,
      404: notFound,
    },
  },
  getVocabularyUses: {
    operationId: 'getVocabularyUses',
    method: 'GET',
    path: '/v1/vocabularies/{id}/uses',
    summary:
      'Where a vocabulary is used: the fields and axes naming it, and the components holding each value',
    tenantScoped: true,
    access: signedIn,
    params: VocabularyParams,
    responses: {
      200: {
        description: 'Its fields and axes, and per value the components holding it',
        schema: VocabularyUsesView,
      },
      401: unauthenticated,
      404: notFound,
    },
  },
  exportVocabulary: {
    operationId: 'exportVocabulary',
    method: 'GET',
    path: '/v1/vocabularies/{id}/export',
    summary: 'A vocabulary as a SKOS concept scheme in JSON-LD',
    tenantScoped: true,
    access: signedIn,
    params: VocabularyParams,
    responses: {
      200: { description: 'The vocabulary as JSON-LD', schema: VocabularyExportAnswer },
      401: unauthenticated,
      404: notFound,
    },
  },
} as const satisfies Record<string, RouteContract>;
