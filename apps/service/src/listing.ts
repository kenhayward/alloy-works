import {
  isListingRequest,
  listingSorts,
  type Keyset,
  type ListingName,
  type ListingRequest,
  type SortOf,
  type SortOrder,
} from '@alloy-works/db';
import { AppError } from './errors.js';

/**
 * A content listing's cursor (service-foundations.md, "Listings and idempotency, in T1"; LI-B): the
 * listing, the sort and its order, the walk's snapshot, and the last row's key and id, spelled as the
 * base64url of one JSON object. Opaque to a caller - the contract says only that it is to be sent back
 * - and read back only by the listing, sort and order that wrote it. Not signed: a forged one reaches
 * nothing the readable set does not already allow.
 */
interface Written {
  readonly v: 1;
  readonly l: ListingName;
  readonly s: string;
  readonly o: SortOrder;
  readonly n: string;
  readonly k: readonly string[];
  readonly i: string;
}

const PAGE = 50;

function refusedCursor(): AppError {
  return new AppError(400, 'invalid_request', 'The cursor is not one this listing gave out.');
}

/** The cursor a page answers with for the page after it, or null at the end. */
export function cursorFor<L extends ListingName>(
  listing: L,
  sort: SortOf<L>,
  order: SortOrder,
  snapshot: string,
  next: Keyset | null,
): string | null {
  if (next === null) return null;
  const written: Written = {
    v: 1,
    l: listing,
    s: sort,
    o: order,
    n: snapshot,
    k: next.keys,
    i: next.id,
  };
  return Buffer.from(JSON.stringify(written), 'utf8').toString('base64url');
}

/**
 * The page a listing's query asks for: its sort and order, each the listing's default when absent, its
 * length, and - from its cursor - where and as of what it continues. A cursor another listing, sort or
 * order gave out, or none at all, is refused `400 invalid_request`.
 */
export function pageAsked<L extends ListingName>(
  listing: L,
  query: {
    readonly cursor?: string | undefined;
    readonly limit?: string | undefined;
    readonly sort?: string | undefined;
    readonly order?: SortOrder | undefined;
  },
): ListingRequest<SortOf<L>> & { readonly sort: SortOf<L>; readonly order: SortOrder } {
  const sorts = listingSorts[listing] as Record<
    string,
    { types: readonly ('text' | 'timestamptz')[]; order: SortOrder }
  >;
  const sort = (query.sort ?? Object.keys(sorts)[0]!) as SortOf<L>;
  const { types, order: byDefault } = sorts[sort]!;
  const order = query.order ?? byDefault;
  const limit = query.limit === undefined ? PAGE : Number(query.limit);
  if (query.cursor === undefined) return { sort, order, limit };
  let written: Written;
  try {
    written = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as Written;
  } catch {
    throw refusedCursor();
  }
  if (
    typeof written !== 'object' ||
    written === null ||
    written.v !== 1 ||
    written.l !== listing ||
    written.s !== sort ||
    written.o !== order ||
    typeof written.n !== 'string' ||
    !Array.isArray(written.k) ||
    typeof written.i !== 'string'
  ) {
    throw refusedCursor();
  }
  const request = {
    sort,
    order,
    limit,
    after: { keys: written.k, id: written.i },
    snapshot: written.n,
  };
  if (!isListingRequest(request, types)) throw refusedCursor();
  return request;
}
