import { z } from 'zod';
import type { RouteContract } from './contract.js';
import { ErrorBody } from './schemas.js';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ids = z
  .string()
  .regex(new RegExp(`^${UUID}(?:,${UUID}){0,49}$`), 'Expected ids, separated by commas');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a day, YYYY-MM-DD');
const fieldValue = z
  .string()
  .regex(new RegExp(`^${UUID}:.{1,500}$`, 's'), 'Expected a field id, a colon and a value');

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
  kind: z
    .string()
    .regex(
      /^(?:component|document|section|publication|template|asset|field|metadataSchema|componentType|queryDefinition)(?:,(?:component|document|section|publication|template|asset|field|metadataSchema|componentType|queryDefinition)){0,9}$/,
      'Expected kinds, separated by commas',
    )
    .optional()
    .describe('Only these kinds, separated by commas'),
  space: ids.optional().describe('Only in these spaces, by id, separated by commas'),
  type: ids.optional().describe('Only components of these types, by id, separated by commas'),
  owner: ids.optional().describe('Only what these people made, by id, separated by commas'),
  changed: z
    .enum(['today', 'week', 'month', 'year', 'earlier'])
    .optional()
    .describe('Only what last changed within this range; `earlier` is before this year'),
  changedFrom: date.optional().describe('Only what last changed on or after this day'),
  changedTo: date.optional().describe('Only what last changed on or before this day'),
  value: z
    .union([fieldValue, z.array(fieldValue).max(20)])
    .optional()
    .describe(
      "Only what holds this value of a field, as `<field id>:<value>`, the value as the field's facet gives it; repeated for more, several of one field either of them",
    ),
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
  'queryDefinition',
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
      'Where it matched best: `title`, `block:<id>`, `field:<id>`, `section:<key>`, `description`, `fields`, `schemas`, `columns` or `connection`',
    ),
  passage: z
    .array(z.object({ text: z.string(), matched: z.boolean() }))
    .describe('Words from that place, about thirty, each matched word a piece of its own'),
});
export type SearchResultView = z.infer<typeof SearchResultView>;

export const FacetValueView = z.object({
  value: z.string().describe('What to filter by to leave these'),
  label: z.string(),
  count: z.number().int().describe('How many it would leave, up to 1,000'),
  capped: z.boolean().describe('Whether more than the count, which is then a lower bound'),
});

export const SearchFacetsView = z
  .object({
    kinds: z.array(FacetValueView),
    spaces: z.array(FacetValueView),
    componentTypes: z.array(FacetValueView),
    owners: z.array(FacetValueView),
    changed: z
      .array(FacetValueView)
      .describe('Each declared range, in order: today, week, month, year, earlier'),
    fields: z.array(
      z.object({
        field: z.string(),
        name: z.string(),
        dataType: z.string(),
        values: z.array(FacetValueView).describe('Its ten commonest values'),
      }),
    ),
  })
  .describe(
    'Every declared dimension, each counted with the other filters in force and its own left out',
  );

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
    facets: SearchFacetsView,
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
      400: {
        description: 'An offset or a limit out of range, or a filter that is not one',
        schema: ErrorBody,
      },
      401: { description: 'No session, or not one this environment issued', schema: ErrorBody },
    },
  },
} as const satisfies Record<string, RouteContract>;
