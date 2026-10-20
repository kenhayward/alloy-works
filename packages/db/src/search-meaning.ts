import { sql, type RawBuilder, type SqlBool } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { embeddingsStored, type Dimensions, vectorLiteral } from './embeddings.js';
import { changedFilter, type SearchFilters } from './search-words.js';
import type { TenantTransaction } from './tables.js';

/**
 * Searching by meaning (search.md, "Meaning"; the G7 plan, G7-H): the passages nearest a query's
 * vector over what the reader may read and has not archived or deleted, the reader's kind, space,
 * type, owner, state and changed filters applied where the passage is found, never after; a field's,
 * a condition's and a relation's are applied by `searchWords` to what this finds. The best passage of
 * each entry, nearest first. Below a visible set of `EXACT_BELOW` passages every distance
 * is computed; above it the index is scanned iteratively, so a reader who may see little still gets
 * a full page (SCH-035). `searchWords` fuses these with the words and applies every filter again.
 */

/** The visible passages below which every distance is computed rather than an index scanned. */
export const EXACT_BELOW = 20_000;

/**
 * The farthest a passage may be and still be found by meaning, in cosine distance: provisional, set
 * from measurement once real models' vectors are searched (the G7 plan). Past it, nothing is shared.
 */
export const MEANING_DISTANCE_MOST = 0.75;

/** How many entries meaning offers to fusion (search.md, "One list"). */
export const MEANING_HITS = 50;

export interface MeaningHit {
  readonly entry: string;
  readonly block: string;
  readonly distance: number;
}

export interface MeaningFilters {
  readonly kinds?: readonly string[];
  readonly spaces?: readonly string[];
  readonly componentTypes?: readonly string[];
  readonly owners?: readonly string[];
  readonly states?: readonly string[];
  readonly changed?: SearchFilters['changed'];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const among = (column: string, values: readonly string[] | undefined, ids: boolean) =>
  values === undefined || values.length === 0
    ? sql<SqlBool>`true`
    : ids
      ? sql<SqlBool>`${sql.ref(`e.${column}`)} = any(${values.filter((each) => UUID.test(each))}::uuid[])`
      : sql<SqlBool>`${sql.ref(`e.${column}`)} = any(${[...values]}::text[])`;

/** Which strategy a search took, for its test (search.md's table). */
export type MeaningRoad = 'exact' | 'index';

export async function searchMeaning(
  trx: TenantTransaction,
  principal: string,
  input: {
    readonly vector: readonly number[];
    readonly model: string;
    readonly dims: Dimensions;
    readonly filters?: MeaningFilters;
    /** Forces a strategy, for a test. */
    readonly road?: MeaningRoad;
    readonly seen?: (road: MeaningRoad) => void;
  },
): Promise<MeaningHit[] | undefined> {
  if (!(await embeddingsStored(trx))) return [];
  const readable = await loadReadableSet(trx, principal);
  if (!readable) return undefined;
  const filters = input.filters ?? {};
  // The words' own predicate, word for word: readable, not archived, not deleted (search-words.ts).
  const predicate = sql<SqlBool>`(
      ((e.space_id = any(${[...readable.spaces]}::uuid[])
          or (e.space_id is null and ${readable.tenant}::boolean))
        and not e.artifact_id = any(${[...readable.excluded]}::uuid[]))
      or e.artifact_id = any(${[...readable.included]}::uuid[])
    ) and not e.archived and not e.deleted
    and ${among('kind', filters.kinds, false)} and ${among('space_id', filters.spaces, true)}
    and ${among('component_type', filters.componentTypes, true)}
    and ${among('owner', filters.owners, true)} and ${among('workflow_state', filters.states, false)}
    and ${changedFilter('e', filters.changed)}`;
  // The dimension a literal, so the partial index for it serves the scan (G7-D).
  const n = sql.raw(String(input.dims));
  const query = sql`${vectorLiteral(input.vector)}::extensions.halfvec(${n})`;
  const distance: RawBuilder<number> = sql`(p.vector::extensions.halfvec(${n})) operator(extensions.<=>) ${query}`;
  const passages = sql`search_passage p join search_entry e on e.id = p.entry_id
    where p.dims = ${n} and p.model = ${input.model} and ${predicate}`;
  await sql`set local plan_cache_mode = force_custom_plan`.execute(trx);
  let road = input.road;
  if (road === undefined) {
    const { rows: plan } = await sql<{ 'QUERY PLAN': { Plan: { 'Plan Rows': number } }[] }>`
      explain (format json) select 1 from ${passages}`.execute(trx);
    road =
      Number(plan[0]?.['QUERY PLAN'][0]?.Plan['Plan Rows'] ?? 0) < EXACT_BELOW ? 'exact' : 'index';
  }
  input.seen?.(road);
  let rows: { entry_id: string; block_id: string; distance: number }[];
  if (road === 'exact') {
    // Every visible passage's distance, then sorted: `offset 0` keeps the index from being planned.
    ({ rows } = await sql<{ entry_id: string; block_id: string; distance: number }>`
      select entry_id, block_id, distance from (
        select p.entry_id, p.block_id, ${distance} as distance from ${passages} offset 0) d
      where distance <= ${MEANING_DISTANCE_MOST}
      order by distance limit ${MEANING_HITS * 4}`.execute(trx));
  } else {
    // The index scanned until enough pass the predicate, approximately in order, then re-sorted.
    await sql`set local hnsw.iterative_scan = relaxed_order`.execute(trx);
    await sql`set local hnsw.ef_search = 200`.execute(trx);
    await sql`set local hnsw.max_scan_tuples = 50000`.execute(trx);
    ({ rows } = await sql<{ entry_id: string; block_id: string; distance: number }>`
      select entry_id, block_id, distance from (
        select p.entry_id, p.block_id, ${distance} as distance from ${passages}
        order by ${distance} limit ${MEANING_HITS * 4}) d
      where distance <= ${MEANING_DISTANCE_MOST}
      order by distance`.execute(trx));
  }
  // Each entry once, at its nearest passage.
  const best = new Map<string, MeaningHit>();
  for (const row of rows) {
    if (!best.has(row.entry_id)) {
      best.set(row.entry_id, {
        entry: row.entry_id,
        block: row.block_id,
        distance: Number(row.distance),
      });
    }
  }
  return [...best.values()].slice(0, MEANING_HITS);
}
