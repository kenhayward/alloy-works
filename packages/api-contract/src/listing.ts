import { z } from 'zod';

/**
 * What every listing of content takes (service-foundations.md, "Listings and idempotency, in T1";
 * API-007): where the previous page ended, how many, and the sort and its order. A cursor is the
 * service's, opaque, and read back only by the listing, sort and order that gave it out.
 */
export function listingQuery<S extends string>(sorts: readonly [S, ...S[]], byDefault: string) {
  return {
    cursor: z
      .string()
      .max(4000)
      .optional()
      .describe('Where the previous page ended, as that page gave it; absent for the first'),
    limit: z
      .string()
      .regex(/^(?:[1-9]|[1-9][0-9]|100)$/, 'Expected a whole number from 1 to 100')
      .optional()
      .describe('At most this many, 50 when absent'),
    sort: z.enum(sorts).optional().describe(`What to sort by, ${byDefault} when absent`),
    order: z
      .enum(['asc', 'desc'])
      .optional()
      .describe("Ascending or descending, the sort's own when absent"),
  };
}

/**
 * What a listing in one order takes - the small ones, spaces, component types, definitions and people -
 * a cursor and a limit, and no sort to choose.
 */
export const pageQuery = {
  cursor: z
    .string()
    .max(4000)
    .optional()
    .describe('Where the previous page ended, as that page gave it; absent for the first'),
  limit: z
    .string()
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/, 'Expected a whole number from 1 to 100')
    .optional()
    .describe('At most this many, 50 when absent'),
};

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** A filter naming artifacts by id, several joined by commas, either of them. */
export const idsFilter = z
  .string()
  .regex(new RegExp(`^${UUID}(?:,${UUID}){0,49}$`), 'Expected ids, separated by commas');

/** One value of a listing's facet, and how many it would leave with the other filters in force. */
export const FacetCountView = z.object({
  value: z.string().describe('What to filter by to leave these'),
  label: z.string(),
  count: z.number().int(),
});

/** The total a listing answers with: every row with the filters in force, as of the walk's snapshot. */
export const listingTotal = z
  .number()
  .int()
  .describe('How many there are with the filters in force, as of the walk this page belongs to');

/** The cursor a page answers with, for the next one. */
export const nextCursor = z
  .string()
  .nullable()
  .describe(
    'The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again',
  );
