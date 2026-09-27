import { sql, type Compilable, type RawBuilder, type SqlBool } from 'kysely';
import type { TenantTransaction } from './tables.js';

/**
 * Listings (service-foundations.md, "Listings and idempotency, in T1"; API-007, SCH-022): each sorted by
 * a key and then the artifact's id, a total order, paged by keyset over the two, and read as of the
 * snapshot its first page took, so a walk through one is over a set no later write moves.
 */

export type SortOrder = 'asc' | 'desc';

/** A sort key's type, as Postgres compares it: text by the database's collation, or a time. */
export type KeyType = 'text' | 'timestamptz';

/**
 * Each listing's sorts, the default first, each with its keys' types and its own default order (LI-C).
 * A sort is one key or more, and then the id: a publication's time is to the second, so two published
 * in one second are told apart by when each was recorded before their ids are reached.
 */
export const listingSorts = {
  components: {
    title: { types: ['text'], order: 'asc' },
    changed: { types: ['timestamptz'], order: 'desc' },
  },
  documents: {
    title: { types: ['text'], order: 'asc' },
    changed: { types: ['timestamptz'], order: 'desc' },
  },
  publications: {
    published: { types: ['timestamptz', 'timestamptz'], order: 'desc' },
    title: { types: ['text'], order: 'asc' },
  },
  templates: {
    name: { types: ['text'], order: 'asc' },
    changed: { types: ['timestamptz'], order: 'desc' },
  },
} as const satisfies Record<
  string,
  Record<string, { types: readonly KeyType[]; order: SortOrder }>
>;

export type ListingName = keyof typeof listingSorts;
export type SortOf<L extends ListingName> = keyof (typeof listingSorts)[L] & string;

/** Where the previous page ended: the last row's sort keys, as Postgres spells them, and its id. */
export interface Keyset {
  readonly keys: readonly string[];
  readonly id: string;
}

/** A page asked for: its sort and order, its length, and where and as of what it continues. */
export interface ListingRequest<S extends string> {
  readonly sort?: S;
  readonly order?: SortOrder;
  readonly limit: number;
  readonly after?: Keyset;
  /** The first page's snapshot, `pg_current_snapshot()` as text; absent for the first page. */
  readonly snapshot?: string;
}

/** A page: its rows, where the next begins or null at the end, and the snapshot the walk is read as of. */
export interface Listed<T> {
  readonly items: readonly T[];
  readonly next: Keyset | null;
  readonly snapshot: string;
}

const SNAPSHOT = /^\d{1,20}:\d{1,20}:(?:\d{1,20}(?:,\d{1,20})*)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A timestamptz as Postgres writes one in the ISO style the session uses: to the microsecond.
const TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?$/;

/**
 * Whether a page request is one a listing could have given out: a snapshot in Postgres's form, and a
 * keyset whose id is an id and whose key is of the sort's type. A caller answers one that is not as a
 * cursor the listing did not give out, rather than let Postgres fail on it.
 */
export function isListingRequest(
  request: ListingRequest<string>,
  types: readonly KeyType[],
): boolean {
  if (request.snapshot !== undefined && !SNAPSHOT.test(request.snapshot)) return false;
  if (request.after === undefined) return true;
  const { keys, id } = request.after;
  if (!UUID.test(id) || !Array.isArray(keys) || keys.length !== types.length) return false;
  return types.every((type, index) => {
    const key = keys[index];
    if (typeof key !== 'string') return false;
    return type === 'text' ? key.length <= 2000 : TIME.test(key);
  });
}

/** Throws unless the limit is an integer 1 to 100 (API-007) - the rule every listing shares. */
export function checkedLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error(`A page's limit is 1 to 100, not ${limit}`);
  }
  return limit;
}

/** The snapshot a walk is read as of: the one its first page took, or now's for a first page. */
export async function snapshotFor(trx: TenantTransaction, given?: string): Promise<string> {
  if (given !== undefined) return given;
  const { rows } = await sql<{
    snapshot: string;
  }>`select pg_current_snapshot()::text as snapshot`.execute(trx);
  return rows[0]!.snapshot;
}

/**
 * Whether a row written by the transaction in `column` is one the snapshot could see (LI-H). A row
 * from before migration 0032 names no transaction, and was committed before any snapshot a listing
 * takes.
 */
export function visibleIn(column: string, snapshot: string): RawBuilder<SqlBool> {
  const written = sql.ref(column);
  return sql<SqlBool>`(${written} is null or pg_visible_in_snapshot(${written}, ${snapshot}::pg_snapshot))`;
}

/**
 * A listing's sort keys, each also spelled as text for a cursor: the columns `keysetPage` reads,
 * `sort_key_<n>` and `sort_text_<n>`.
 */
export function sortColumns(keys: readonly RawBuilder<unknown>[]) {
  return keys.flatMap((key, index) => [
    key.as(`sort_key_${index}`),
    sql<string>`(${key})::text`.as(`sort_text_${index}`),
  ]);
}

/**
 * One page of `inner` - a query selecting at least `id` and each key's `sort_key_<n>` and `sort_text_<n>`
 * - by keyset over the keys and then the id, in the order asked: the rows after `after`, never an offset
 * (API-007, SCH-022). Answers the page's rows and where the next begins.
 */
export async function keysetPage<Row extends { readonly id: string }>(
  trx: TenantTransaction,
  inner: Compilable,
  types: readonly KeyType[],
  order: SortOrder,
  limit: number,
  after: Keyset | undefined,
): Promise<{ readonly rows: readonly Row[]; readonly next: Keyset | null }> {
  const direction = sql.raw(order === 'asc' ? 'asc' : 'desc');
  const past = sql.raw(order === 'asc' ? '>' : '<');
  const columns = types.map((_, index) => sql.ref(`x.sort_key_${index}`));
  const { rows } = await sql<Row & Record<string, unknown>>`
    select x.* from (${inner}) as x
    where ${
      after === undefined
        ? sql`true`
        : sql`(${sql.join(columns)}, x.id) ${past} (${sql.join(
            types.map((type, index) => sql`${after.keys[index]}::${sql.raw(type)}`),
          )}, ${after.id}::uuid)`
    }
    order by ${sql.join(columns.map((column) => sql`${column} ${direction}`))}, x.id ${direction}
    limit ${limit + 1}`.execute(trx);
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return {
    rows: shown,
    next:
      rows.length > limit && last !== undefined
        ? { keys: types.map((_, index) => String(last[`sort_text_${index}`])), id: last.id }
        : null,
  };
}
