import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

export const SearchQuery = z.object({
  q: z
    .string()
    .max(1000)
    .optional()
    .describe(
      'What to look for: words, a phrase in quotes, `-` excluding, `or`, and `name:word` looked for only in the title or a field of that name',
    ),
  offset: z
    .string()
    .regex(/^(?:0|[1-9][0-9]{0,2}|1000)$/, 'Expected a whole number from 0 to 1000')
    .optional()
    .describe('How many results to pass over, 0 when absent'),
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-4][0-9]|50)$/, 'Expected a whole number from 1 to 50')
    .optional()
    .describe('At most this many, 20 when absent'),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchKind = z.enum([
  'component',
  'document',
  'section',
  'publication',
  'template',
  'asset',
  'field',
  'metadataSchema',
  'componentType',
]);

export const SearchResultView = z.object({
  kind: SearchKind,
  artifactId: z.string(),
  node: z.string().nullable().describe("A section's outline node; null for anything else"),
  title: z.string(),
  space: z.object({ id: z.string(), name: z.string() }).nullable(),
  changedAt: z.string(),
  place: z
    .string()
    .nullable()
    .describe(
      'Where it matched best: `title`, `block:<id>`, `field:<id>`, `section:<key>`, `description`, `fields` or `schemas`',
    ),
  passage: z
    .array(z.object({ text: z.string(), matched: z.boolean() }))
    .describe('Words from that place, about thirty, each matched word a piece of its own'),
});
export type SearchResultView = z.infer<typeof SearchResultView>;

const said = { message: z.string().describe('The outcome in a sentence, for the reader') };

/** Every outcome a search answers with, each by name and in a sentence (SCH-039). */
export const SearchAnswerView = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('empty'), ...said }),
  z.object({
    outcome: z.literal('nothing_to_match'),
    excluded: z.array(z.string()).describe('What the query left out, with nothing to look for'),
    ...said,
  }),
  z.object({ outcome: z.literal('unknown_field'), name: z.string(), ...said }),
  z.object({
    outcome: z.literal('results'),
    count: z.number().int().describe('How many match, up to 1,000'),
    capped: z.boolean().describe('Whether more match than the count, which is then a lower bound'),
    items: z.array(SearchResultView),
    ...said,
  }),
]);
export type SearchAnswerView = z.infer<typeof SearchAnswerView>;

/** Searching by words (search.md, "Searching words, in T1"): anybody signed in, over what they may read. */
export const searchRoutes = {
  search: {
    operationId: 'search',
    method: 'GET',
    path: '/v1/search',
    summary: 'Everything the caller may read that holds these words, a page at a time',
    tenantScoped: true,
    access: { check: 'session' },
    query: SearchQuery,
    responses: {
      200: {
        description: 'The results, or by name why there are none to give',
        schema: SearchAnswerView,
      },
      400: { description: 'An offset or a limit out of range', schema: ErrorBody },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
