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

/** The cursor a page answers with, for the next one. */
export const nextCursor = z
  .string()
  .nullable()
  .describe(
    'The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again',
  );
