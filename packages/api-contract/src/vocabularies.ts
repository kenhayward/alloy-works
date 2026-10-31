import { vocabularyDefinitionSchema } from '@alloy-works/domain';
import { z } from 'zod';
import type { RouteContract } from './contract.js';
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
