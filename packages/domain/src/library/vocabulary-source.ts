import { z } from 'zod';

import { httpsUrl } from '../extensions/manifest.js';

/**
 * A vocabulary's SKOS address fetched through the connector (vocabularies.md; the VO plan, VO-J;
 * LIB-058): a built-in source, as an extension's manifest is, one `GET` behind the guard, no redirect.
 * Its text answered whole, with its media type, for the service to read.
 */

/** The most a vocabulary's source may be, as fetched. */
export const VOCABULARY_SOURCE_MOST_BYTES = 5 * 1024 * 1024;

const tenant = z.string().regex(/^[0-9a-z]{1,40}$/);

/** The connector asked to fetch a vocabulary's SKOS address: 5 MB, 20 s, no redirect. */
export const vocabularySourceRequestSchema = z.strictObject({
  requestId: z.uuid(),
  tenant,
  url: httpsUrl,
});
export type VocabularySourceRequest = z.infer<typeof vocabularySourceRequestSchema>;

export const vocabularySourceAnswerSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('fetched'),
    body: z.string().max(VOCABULARY_SOURCE_MOST_BYTES),
    /** The media type it answered, without its parameters. */
    contentType: z.string().max(200).optional(),
  }),
  z.strictObject({
    type: z.literal('failed'),
    code: z.enum([
      'host_refused',
      'connection_failed',
      'timeout',
      'source_refused',
      'source_too_large',
      'connector_error',
    ]),
  }),
]);
export type VocabularySourceAnswer = z.infer<typeof vocabularySourceAnswerSchema>;

/** The line the supervisor writes to a vocabulary source's child: no secret, the guard's ranges. */
export const childVocabularySourceRequestSchema = z.strictObject({
  kind: z.literal('vocabularySource'),
  request: vocabularySourceRequestSchema,
  deny: z.array(z.string()),
  connectTimeoutMs: z.number().int().min(1).max(60_000),
  ca: z
    .string()
    .max(256 * 1024)
    .optional(),
});
export type ChildVocabularySourceRequest = z.infer<typeof childVocabularySourceRequestSchema>;
