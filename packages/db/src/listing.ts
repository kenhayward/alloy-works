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
  connections: {
    name: { types: ['text'], order: 'asc' },
    changed: { types: ['timestamptz'], order: 'desc' },
  },
  queryDefinitions: {
    title: { types: ['text'], order: 'asc' },
    changed: { types: ['timestamptz'], order: 'desc' },
  },
  // The small listings, each in one order: a space by its name, which nothing changes; a definition by
  // its latest name, read as of the snapshot; a person by when they first appeared, since a name is
  // changed in place at every sign-in.
  spaces: { name: { types: ['text'], order: 'asc' } },
  componentTypes: { name: { types: ['text'], order: 'asc' } },
  definitions: { name: { types: ['text'], order: 'asc' } },
  people: { joined: { types: ['timestamptz'], order: 'asc' } },
  // An author's own iterations of one component, the newest first (component-editor.md, "Recovery,
  // as W11 builds it"): what the Recovery panel lists.
  iterations: { saved: { types: ['timestamptz'], order: 'desc' } },
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
const TIME_PARTS =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?$/;

/**
 * Whether a page request is one a listing could have given out: a snapshot in Postgres's form, and a
 * keyset whose id is an id and whose key is of the sort's type. A caller answers one that is not as a
 * cursor the listing did not give out, rather than let Postgres fail on it.
 */
export function isListingRequest(
  request: ListingRequest<string>,
  types: readonly KeyType[],
): boolean {
  if (request.snapshot !== undefined && !isSnapshot(request.snapshot)) return false;
  if (request.after === undefined) return true;
  const { keys, id } = request.after;
  if (!UUID.test(id) || !Array.isArray(keys) || keys.length !== types.length) return false;
  return types.every((type, index) => {
    const key = keys[index];
    if (typeof key !== 'string') return false;
    return type === 'text' ? key.length <= 2000 : isTime(key);
  });
}

const XID8_MAX = 18446744073709551615n;

/**
 * A snapshot as `pg_current_snapshot()` writes one: `xmin:xmax:xip,...`, each a transaction id within
 * `xid8`'s range, xmin no more than xmax, and the transactions in progress between them, ascending.
 */
function isSnapshot(text: string): boolean {
  if (!SNAPSHOT.test(text)) return false;
  const [low, high, running] = text.split(':') as [string, string, string];
  const xmin = BigInt(low);
  const xmax = BigInt(high);
  if (xmin < 1n || xmax > XID8_MAX || xmin > xmax) return false;
  let previous = xmin - 1n;
  for (const each of running === '' ? [] : running.split(',')) {
    const xip = BigInt(each);
    if (xip <= previous || xip < xmin || xip >= xmax) return false;
    previous = xip;
  }
  return true;
}

/** A time as Postgres writes a `timestamptz`, and one that exists: no thirteenth month, no 25:00. */
function isTime(text: string): boolean {
  const parts = TIME_PARTS.exec(text);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second] = parts.map(Number) as number[];
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day &&
    hour! < 24 &&
    minute! < 60 &&
    second! < 60
  );
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

/** One value of a listing's facet: what to filter by to leave these, its label, and how many. */
export interface FacetCount {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

/** How many rows a listing's query holds: its total, with the filters in force. */
export async function countOf(trx: TenantTransaction, query: Compilable): Promise<number> {
  const { rows } = await sql<{ n: string }>`select count(*) as n from (${query}) as x`.execute(trx);
  return Number(rows[0]?.n ?? 0);
}

/**
 * A facet: the rows of `query` - run with every filter but this facet's own - counted by `value`, each
 * labelled by `label`, most first and then by label (SCH-046's rule, which search's facets follow).
 * `value` and `label` are column names the listing's own code names, never a caller's.
 */
export async function facetOf(
  trx: TenantTransaction,
  query: Compilable,
  value: string,
  label: string,
): Promise<readonly FacetCount[]> {
  const { rows } = await sql<{ value: string; label: string; n: string }>`
    select ${sql.ref(`x.${value}`)}::text as value, max(${sql.ref(`x.${label}`)}) as label,
           count(*) as n
    from (${query}) as x
    where ${sql.ref(`x.${value}`)} is not null
    group by ${sql.ref(`x.${value}`)}
    order by n desc, label, value`.execute(trx);
  return rows.map((row) => ({ value: row.value, label: row.label, count: Number(row.n) }));
}
