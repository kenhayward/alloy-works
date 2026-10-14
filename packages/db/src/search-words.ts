import {
  nameKey,
  parseQuery,
  readOutline,
  SEARCH_CONFIGURATIONS,
  searchKinds,
  walkOutline,
  type SearchKind,
} from '@alloy-works/domain';
import { sql, type RawBuilder, type SqlBool } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { isDeleted } from './deletion.js';
import { HISTORY_KINDS, historyFielded, historyStored, historyTitled } from './search-history.js';
import { vectorStored } from './search-threads.js';
import type { TenantTransaction } from './tables.js';

/**
 * A search by words (search.md, "One query"; SCH-016, SCH-017, SCH-039, SCH-046, SCH-059): one
 * statement over the projection, holding the reader's readable set, the query, the filters, the best
 * place in each entry and a passage from it, the count, and every facet - each counted with the other
 * filters in force and its own left out, and each capped over what the reader may see (SCH-073). The
 * latest, and every version from one row a place, are first bounded to their most recently changed
 * matches, found by the road chosen (SV3).
 */

/** Past this many, a count says only that there are more (SCH-073). */
export const SEARCH_COUNT_CAP = 1000;

/** How many of the most recently changed matches a bounded search ranks and facets (SV3-C). */
export const SEARCH_RANK_BOUND = 1000;

/** How a bounded search finds its newest matches: walking them in changed order, or by the word indexes. */
export type SearchRoad = 'walk' | 'indexes';

/**
 * For tests and the load suite alone: a road forced, the plans explained, and each scan's roads in
 * order, a walk that falls back seen before the indexes road that answers.
 */
export interface SearchProbe {
  readonly road?: SearchRoad;
  /** How many of the newest rows a walk reads before it falls back; every row for a forced walk. */
  readonly reads?: number;
  readonly explain?: boolean;
  readonly seen?: (event: {
    readonly statement: 'results' | 'facets' | 'page';
    readonly road?: SearchRoad;
    /** The table a road scanned: every version scans two. */
    readonly scan?: string;
    /** The matches the planner reckoned when it chose the road; none for a road forced. */
    readonly estimate?: number;
    /** The rows the road was chosen, and a walk's reads sized, by; none for a road forced. */
    readonly rows?: number;
    readonly plan?: unknown;
  }) => void;
}

/** How many results a page holds unless asked for fewer, and the most it holds. */
export const SEARCH_PAGE = 20;
export const SEARCH_PAGE_MAX = 50;

/** How many of a field's values its facet offers: the commonest (SE-E). */
export const FIELD_FACET_VALUES = 10;

/** The declared ranges a change falls in, each within the next: today is this week too (SCH-046). */
export const changedRanges = ['today', 'week', 'month', 'year', 'earlier'] as const;
export type ChangedRange = (typeof changedRanges)[number];

/** A piece of a passage, and whether it is a word the query matched. */
export interface PassagePiece {
  readonly text: string;
  readonly matched: boolean;
}

export interface SearchResult {
  readonly kind: SearchKind;
  readonly artifactId: string;
  /** A section's outline node, or the node a thread on a document stands at; else null. */
  readonly node: string | null;
  readonly title: string;
  readonly spaceId: string | null;
  readonly spaceName: string | null;
  readonly changedAt: Date;
  /** Where in the entry it matched best (search.md, "The tables"), or null for an entry of no words. */
  readonly place: string | null;
  readonly passage: readonly PassagePiece[];
  /** The version it matched in, for a kind whose earlier versions are kept (SV-G); else null. */
  readonly version: {
    readonly id: string;
    /** `revision.version`, as the Versions panel says it. */
    readonly number: string;
    readonly latest: boolean;
  } | null;
  /**
   * The baseline searched, and where in its document the result is: a section's node, a component's
   * first pinned node in outline order, or null for the document or an asset (SV-C).
   */
  readonly baseline: {
    readonly id: string;
    readonly name: string;
    readonly document: string;
    readonly node: string | null;
  } | null;
  /**
   * The thread a `thread` result is, what it is on, and whether it is resolved, read when searched
   * (the SV plan, SV-M); null for every other kind.
   */
  readonly thread: {
    readonly id: string;
    readonly on: 'component' | 'document';
    readonly resolved: boolean;
  } | null;
}

/**
 * Which versions a search reads (the SV plan, SV-C): the latest alone, every version, or what one
 * baseline pins.
 */
export type SearchScope = 'latest' | 'all' | { readonly baseline: string };

/** The kinds whose results name a version: those whose earlier versions are kept (SV-A). */
const VERSIONED = new Set<SearchKind>(['component', 'document', 'section', 'asset']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Every column both projections' entries share, in one order, so the two can be read as one. */
const ENTRY_COLUMNS = sql.raw(
  'id, kind, artifact_id, node, version_id, title, space_id, changed_at, owner, component_type, field_values, configuration, body, vector, archived, deleted',
);
const TEXT_COLUMNS = sql.raw('entry_id, place, body, configuration, vector');
/** The kinds history holds, and every other, as SQL lists. */
const IN_HISTORY = sql`(${sql.join(HISTORY_KINDS.map((kind) => sql.lit(kind)))})`;
const NOT_IN_HISTORY = sql`(${sql.join(
  searchKinds
    .filter((kind) => !(HISTORY_KINDS as readonly string[]).includes(kind))
    .map((kind) => sql.lit(kind)),
)})`;

/**
 * What narrows a search (SCH-059), each dimension one filter, several values within one either of them.
 * `componentTypes` is over components: it leaves nothing that is not a component of one of the types.
 * A field's value is the value its facet offers: a boolean's `true` or `false`, a person's id, a date's
 * month as `YYYY-MM`, and a text as written.
 */
export interface SearchFilters {
  readonly kinds?: readonly SearchKind[];
  readonly spaces?: readonly string[];
  readonly componentTypes?: readonly string[];
  readonly owners?: readonly string[];
  readonly changed?:
    { readonly within: ChangedRange } | { readonly from?: string; readonly to?: string };
  readonly values?: readonly { readonly field: string; readonly value: string }[];
}

/** A value a facet offers, and how many results it would leave. */
export interface FacetValue {
  readonly value: string;
  readonly label: string;
  /** Up to the cap. */
  readonly count: number;
  /** Whether more hold it than the count says, so the count is a lower bound (SCH-073). */
  readonly capped: boolean;
}

/** The declared dimensions (search.md, "Filters and facets"; SCH-046), and nothing else. */
export interface SearchFacets {
  readonly kinds: readonly FacetValue[];
  readonly spaces: readonly FacetValue[];
  readonly componentTypes: readonly FacetValue[];
  readonly owners: readonly FacetValue[];
  /** Each declared range, in order, whether or not anything changed within it. */
  readonly changed: readonly FacetValue[];
  /** Each field the reader may read whose data type facets, with its commonest values. */
  readonly fields: readonly {
    readonly field: string;
    readonly name: string;
    readonly dataType: string;
    readonly values: readonly FacetValue[];
  }[];
}

/** What a search answers: the results, or by name why there are none to give (SCH-039). */
export type SearchAnswer =
  | { readonly outcome: 'empty' }
  | { readonly outcome: 'nothing_to_match'; readonly excluded: readonly string[] }
  | { readonly outcome: 'unknown_field'; readonly name: string }
  | {
      readonly outcome: 'results';
      /** How many match, up to the cap. */
      readonly count: number;
      /** Whether more match than the count says, so the count is a lower bound (SCH-073). */
      readonly capped: boolean;
      /**
       * Whether the facets were counted over the most recently changed matches alone, so that every
       * facet count is a lower bound and a value only older matches hold is missing (SV3-F).
       */
      readonly facetsBounded: boolean;
      readonly items: readonly SearchResult[];
      readonly facets: SearchFacets;
    };

// Private-use characters, which a passage's marks are made of and split on. Built rather than typed.
const START = String.fromCharCode(0xe000);
const STOP = String.fromCharCode(0xe001);
const HEADLINE = `StartSel=${START}, StopSel=${STOP}, MaxWords=30, MinWords=12, ShortWord=2`;

/** A passage as `ts_headline` marks it, as pieces: the words it matched and the words between. */
function piecesOf(passage: string | null): PassagePiece[] {
  if (passage === null) return [];
  const pieces: PassagePiece[] = [];
  for (const [index, part] of passage.split(new RegExp(`[${START}${STOP}]`, 'u')).entries()) {
    if (part !== '') pieces.push({ text: part, matched: index % 2 === 1 });
  }
  return pieces;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** A calendar date as written, or undefined where it is not one. */
function calendarDate(value: string | undefined): string | undefined {
  if (value === undefined || !DATE.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
    ? value
    : undefined;
}

/** Where each named range starts, in the session's zone. `earlier` is before the year began. */
const rangeStart: Record<Exclude<ChangedRange, 'earlier'>, RawBuilder<Date>> = {
  today: sql`date_trunc('day', now())`,
  week: sql`date_trunc('week', now())`,
  month: sql`date_trunc('month', now())`,
  year: sql`date_trunc('year', now())`,
};

/**
 * A dimension's filter over a row, written so the column's index serves it (#605): an identifier of no
 * shape matches nothing, as it did compared as text.
 */
function among(
  alias: string,
  column: string,
  values: readonly string[] | undefined,
  ids: boolean,
): RawBuilder<SqlBool> {
  if (values === undefined || values.length === 0) return sql<SqlBool>`true`;
  const ref = sql.ref(`${alias}.${column}`);
  return ids
    ? sql<SqlBool>`${ref} = any(${values.filter((each) => UUID.test(each))}::uuid[])`
    : sql<SqlBool>`${ref} = any(${[...values]}::text[])`;
}

function changedFilter(alias: string, changed: SearchFilters['changed']): RawBuilder<SqlBool> {
  if (changed === undefined) return sql<SqlBool>`true`;
  const at = sql.ref(`${alias}.changed_at`);
  if ('within' in changed) {
    return changed.within === 'earlier'
      ? sql<SqlBool>`${at} < ${rangeStart.year}`
      : sql<SqlBool>`${at} >= ${rangeStart[changed.within]}`;
  }
  const from = calendarDate(changed.from);
  const to = calendarDate(changed.to);
  return sql<SqlBool>`${from === undefined ? sql`true` : sql`${at} >= ${from}::date`}
    and ${to === undefined ? sql`true` : sql`${at} < ${to}::date + 1`}`;
}

/**
 * A field's value `x` as its facet names it: a boolean as true or false, a person by id, a date by its
 * month, and a text of one value as written (SE-E); null for anything else.
 */
const valueKey = (
  x: RawBuilder<unknown>,
  dataType: RawBuilder<unknown>,
  multiplicity: RawBuilder<unknown>,
) =>
  sql<string | null>`case
    when ${dataType} = 'boolean' and jsonb_typeof(${x}) = 'boolean' then ${x}::text
    when ${dataType} = 'user' and jsonb_typeof(${x}) = 'object' then ${x} ->> 'user'
    when ${dataType} = 'date' and jsonb_typeof(${x}) = 'string' then left(${x} #>> '{}', 7)
    when ${dataType} = 'text' and ${multiplicity} = 'one'
         and jsonb_typeof(${x}) = 'string' then ${x} #>> '{}'
  end`;

interface FacetRow {
  readonly value: string;
  readonly label: string;
  readonly n: number;
}

/** A facet's values, each capped; every one a lower bound where the facets were bounded (SV3-F). */
const cappedOf = (rows: readonly FacetRow[] | null, bounded: boolean): FacetValue[] =>
  (rows ?? []).map((row) => ({
    value: row.value,
    label: row.label,
    count: Math.min(row.n, SEARCH_COUNT_CAP),
    capped: bounded || row.n > SEARCH_COUNT_CAP,
  }));

/**
 * Where each component version a baseline pins first stands in its document, in outline order, by
 * `<component>:<version>`: where a result found in it opens the baseline (SV-C).
 */
async function firstPinnedNodes(
  trx: TenantTransaction,
  baseline: { readonly id: string; readonly document: string; readonly documentVersion: string },
): Promise<Map<string, string>> {
  const [pins, document] = await Promise.all([
    trx
      .selectFrom('baseline_pin')
      .select(['node', 'artifact_id', 'version_id'])
      .where('baseline_id', '=', baseline.id)
      .where('kind', '=', 'component')
      .execute(),
    trx
      .selectFrom('artifact_version')
      .select('content')
      .where('id', '=', baseline.documentVersion)
      .executeTakeFirstOrThrow(),
  ]);
  const read = readOutline(document.content, {
    artifact: baseline.document,
    version: baseline.documentVersion,
  });
  const order = new Map<string, number>();
  if (read.ok) walkOutline(read.outline.nodes, (node) => order.set(node.id, order.size));
  const placed = new Map<string, string>();
  for (const pin of [...pins].sort(
    (a, b) =>
      (order.get(a.node ?? '') ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.node ?? '') ?? Number.MAX_SAFE_INTEGER),
  )) {
    const key = `${pin.artifact_id}:${pin.version_id}`;
    if (pin.node !== null && !placed.has(key)) placed.set(key, pin.node);
  }
  return placed;
}

export interface SearchOptions {
  readonly offset?: number;
  readonly limit?: number;
  readonly filters?: SearchFilters;
  readonly scope?: SearchScope;
  readonly probe?: SearchProbe;
}

/**
 * Searches as `principal`: undefined where the tenant holds no such principal. A scoped term's name is
 * `title`, or a field's by its folded name - only for a reader who may read that field, as access.md
 * reads a definition (SE-H), so a field is no scope for anybody else and says nothing of what it holds.
 * A field facets for the same readers alone. A baseline the reader may not read, or none, is
 * `baseline_not_found`.
 */
export function searchWords(
  trx: TenantTransaction,
  principal: string,
  query: string,
  options?: SearchOptions & { readonly scope?: 'latest' | 'all' },
): Promise<SearchAnswer | undefined>;
export function searchWords(
  trx: TenantTransaction,
  principal: string,
  query: string,
  options: SearchOptions,
): Promise<SearchAnswer | 'baseline_not_found' | undefined>;
export async function searchWords(
  trx: TenantTransaction,
  principal: string,
  query: string,
  options: SearchOptions = {},
): Promise<SearchAnswer | 'baseline_not_found' | undefined> {
  const readable = await loadReadableSet(trx, principal);
  if (!readable) return undefined;
  const scope = options.scope ?? 'latest';
  // Threads have rows from 0089; before it, which only a test migrated to an earlier point reads, none.
  const threaded = await vectorStored(trx);
  // Every version from one row a place from 0091 (SV3-L); before it, the union of every version's.
  const history = scope === 'all' && (await historyStored(trx));
  const threadOf = threaded ? sql`thread_id` : sql`null::uuid as thread_id`;
  // A baseline is read as its document is (BL-H): one the reader may not read, or none, is not found.
  let baseline: { id: string; name: string; document: string; documentVersion: string } | undefined;
  if (typeof scope === 'object') {
    if (!UUID.test(scope.baseline)) return 'baseline_not_found';
    const row = await trx
      .selectFrom('baseline as b')
      .innerJoin('artifact as a', 'a.id', 'b.document_id')
      .select(['b.id', 'b.name', 'b.document_id', 'b.document_version_id', 'a.space_id'])
      .where('b.id', '=', scope.baseline)
      .executeTakeFirst();
    const readableDocument =
      row !== undefined &&
      (((row.space_id === null ? readable.tenant : readable.spaces.includes(row.space_id)) &&
        !readable.excluded.includes(row.document_id)) ||
        readable.included.includes(row.document_id));
    if (!readableDocument || (await isDeleted(trx, row.document_id))) {
      return 'baseline_not_found';
    }
    baseline = {
      id: row.id,
      name: row.name,
      document: row.document_id,
      documentVersion: row.document_version_id,
    };
  }
  // The latest alone reads `search_entry` as it always has, with no union (SV-C). Every version reads
  // history, and the current rows of the kinds it does not hold (SV3-L): scanned apart (below), read
  // here by the ids found. Before 0091 it adds `search_earlier` but its assets, which no page shows
  // (SV-A). A baseline reads what it pins.
  const pinnedBy = (at: { id: string; document: string; documentVersion: string }) =>
    sql<SqlBool>`((x.artifact_id = ${at.document} and x.version_id = ${at.documentVersion})
      or exists (select 1 from baseline_pin bp
                  where bp.baseline_id = ${at.id}
                    and bp.artifact_id = x.artifact_id and bp.version_id = x.version_id))`;
  // A thread is current, so in every version's search, and pinned by no baseline (SV-C).
  const source =
    scope === 'latest'
      ? threaded
        ? sql`search_entry`
        : sql`(select *, null::uuid as thread_id from search_entry)`
      : history
        ? sql`(select ${ENTRY_COLUMNS}, null::uuid as thread_id, false as current from search_history
               union all
               select ${ENTRY_COLUMNS}, thread_id, true as current from search_entry)`
        : baseline === undefined
          ? sql`(select ${ENTRY_COLUMNS}, ${threadOf}, true as current from search_entry
               union all
               select ${ENTRY_COLUMNS}, null::uuid, false as current from search_earlier
                where kind <> 'asset')`
          : sql`(select ${ENTRY_COLUMNS}, ${threadOf}, true as current from search_entry x
                where ${pinnedBy(baseline)} ${threaded ? sql`and x.thread_id is null` : sql``}
               union all
               select ${ENTRY_COLUMNS}, null::uuid, false as current from search_earlier x
                where ${pinnedBy(baseline)})`;
  const texts =
    scope === 'latest'
      ? sql`search_text`
      : sql`(select ${TEXT_COLUMNS} from search_text
             union all
             select ${TEXT_COLUMNS} from search_earlier_text)`;
  // Archived content leaves ordinary search (LIF-020), and stays in a baseline that pins it (SV-E).
  const shown =
    baseline === undefined
      ? sql<SqlBool>`not e.archived and not e.deleted`
      : sql<SqlBool>`not e.deleted`;
  // One result per artifact and place however many of its versions match, counted once (SV-C): from
  // history, each place is one row already.
  const collapse = scope !== 'latest' && !history;
  const counted = !collapse
    ? sql`count(*)`
    : sql`count(distinct (b.artifact_id, coalesce(b.node, ''), coalesce(b.thread_id::text, '')))`;
  const parsed = parseQuery(query);
  if (parsed.outcome !== 'query') return parsed;

  // Each statement planned for its own parameters (search.md, "The permission predicate"; SV3-H).
  await sql`set local plan_cache_mode = force_custom_plan`.execute(trx);
  // Never compiled: every version's page is costed past JIT's threshold, and compiling it took a
  // second where running it takes milliseconds (SV3b's load suite).
  await sql`set local jit = off`.execute(trx);

  // The configurations in use, one index probe each (SV3-A), each named as a constant: probed by a
  // parameter, the planner reckons any configuration as common as the commonest and reads the whole
  // table for one in no row. Every version probes history, and before 0091 the earlier rows; the
  // version a history row names matches an earlier version's words by its own configuration.
  const probed =
    scope === 'latest'
      ? ['search_entry']
      : ['search_entry', history ? 'search_history' : 'search_earlier'];
  const { rows: inUse } = await sql<{ c: string }>`
    ${sql.join(
      SEARCH_CONFIGURATIONS.map(
        (c) =>
          sql`select ${sql.lit(c)}::text as c where ${sql.join(
            probed.map(
              (table) =>
                sql`exists (select 1 from ${sql.table(table)} where configuration = ${sql.lit(c)}::regconfig)`,
            ),
            sql` or `,
          )}`,
      ),
      sql` union all `,
    )}
    order by c`.execute(trx);
  const configurations = inUse.map((row) => row.c);
  /**
   * `alias`'s words, or `vector` over it, matching `words`: a constant tsquery per configuration, so an
   * index serves it.
   */
  const matches = (alias: string, words: string, vector?: RawBuilder<unknown>) =>
    configurations.length === 0
      ? sql<SqlBool>`false`
      : sql<SqlBool>`(${sql.join(
          configurations.map(
            (c) => sql`(${sql.ref(`${alias}.configuration`)} = ${c}::regconfig
              and ${vector ?? sql.ref(`${alias}.vector`)} @@ websearch_to_tsquery(${c}::regconfig, ${words}))`,
          ),
          sql` or `,
        )})`;

  const scopedTerms: { place: string; words: string; excluded: boolean }[] = [];
  for (const term of parsed.scoped) {
    let place: string;
    if (nameKey(term.name) === 'title') {
      place = 'title';
    } else {
      const field = await trx
        .selectFrom('definition_name')
        .select('artifact_id')
        .where('kind', '=', 'field')
        .where('name_key', '=', nameKey(term.name))
        .executeTakeFirst();
      // A field is read as any artifact in no space is: at the tenant, unless a grant on it refuses
      // it, or by a grant on it alone. One the reader may not read is no scope for them.
      const readableField =
        field !== undefined &&
        ((readable.tenant && !readable.excluded.includes(field.artifact_id)) ||
          readable.included.includes(field.artifact_id));
      if (!readableField) return { outcome: 'unknown_field', name: term.name };
      place = `field:${field.artifact_id}`;
    }
    scopedTerms.push({ place, words: term.words, excluded: term.excluded });
  }
  /** Whether `alias`'s row holds `words` at `place`, its places in `from` by the row's id. */
  const heldAt = (alias: string, from: RawBuilder<unknown>, place: string, words: string) =>
    sql<SqlBool>`exists (
      select 1 from ${from} s
      where s.entry_id = ${sql.ref(`${alias}.id`)} and s.place = ${place}
        and s.vector @@ websearch_to_tsquery(s.configuration, ${words}))`;
  // Under every version, a history row holds a scoped term any of its place's versions held (SV3-L).
  // A node compared so each version's row is found by its index, a section's node by equality and an
  // artifact's own row by `is null`, never by `is not distinct from`, which no index serves.
  // `offset 0` keeps each a probe per row: without it Postgres may hash every place in the tenant
  // holding the words, once, which costs far more than the candidates' probes.
  const heldByVersions = (place: string, words: string, node: RawBuilder<SqlBool>) =>
    sql<SqlBool>`(exists (
             select 1 from search_entry x join search_text s on s.entry_id = x.id
             where x.artifact_id = e.artifact_id and ${node}
               and x.kind in ${IN_HISTORY} and s.place = ${place}
               and s.vector @@ websearch_to_tsquery(s.configuration, ${words}) offset 0)
        or exists (
             select 1 from search_earlier x join search_earlier_text s on s.entry_id = x.id
             where x.artifact_id = e.artifact_id and ${node} and s.place = ${place}
               and s.vector @@ websearch_to_tsquery(s.configuration, ${words}) offset 0))`;
  const heldOverVersions = (place: string, words: string) =>
    sql<SqlBool>`(case when e.current then ${heldAt('e', sql`search_text`, place, words)}
      when e.node is null then ${heldByVersions(place, words, sql<SqlBool>`x.node is null`)}
      else ${heldByVersions(place, words, sql<SqlBool>`x.node = e.node`)} end)`;
  // A scoped term is found through its places' index (SV3-A), and beside words where it narrows them
  // (#610, below); under every version, through the row's own words, which hold every place's in every
  // version: a superset, the places' test below then exact. A title through its own index, whose statistics count titles alone
  // (0092; #605), under every version through every version's titles (0093; #608); a field through
  // every field's (0094; #610), likewise.
  const wanted = scopedTerms.find((term) => !term.excluded);
  const field = wanted?.place.startsWith('field:') === true;
  const own =
    wanted?.place === 'title'
      ? history && (await historyTitled(trx)) && sql`e.title_vector`
      : field && history && (await historyFielded(trx)) && sql`e.fields_vector`;
  const placeIndexed = (place: 'title' | 'field') =>
    place === 'title'
      ? sql`(case when s.place = 'title' then s.vector end)`
      : sql`(case when s.place like 'field:%' then s.vector end)`;
  const scopedDriver =
    wanted === undefined
      ? undefined
      : history
        ? matches('e', wanted.words, own === false ? undefined : own)
        : sql<SqlBool>`e.id in (
            select s.entry_id from ${texts} s
            where ${field ? sql`s.place = ${wanted.place} and ` : sql``}${matches(
              's',
              wanted.words,
              placeIndexed(field ? 'field' : 'title'),
            )})`;
  // Beside words, only where the planner reckons under a quarter of the rows hold the term: held by
  // more, the places' test passes on enough of the newest candidates, and the term's bitmap costs more
  // than it saves; held by fewer, it spares testing every candidate (#610).
  const narrows = async (term: RawBuilder<SqlBool>) => {
    const table = sql.table(history ? 'search_history' : 'search_entry');
    const { rows: plan } = await sql<{ 'QUERY PLAN': { Plan: { 'Plan Rows': number } }[] }>`
      explain (format json) select 1 from ${table} e where ${term}`.execute(trx);
    const { rows: sized } = await sql<{ rows: number }>`
      select reltuples::float8 as rows from pg_class where oid = ${history ? 'search_history' : 'search_entry'}::regclass`.execute(
      trx,
    );
    return (
      Number(plan[0]?.['QUERY PLAN'][0]?.Plan['Plan Rows'] ?? 0) < Number(sized[0]?.rows ?? 0) / 4
    );
  };
  const driver =
    scopedDriver === undefined || parsed.words === ''
      ? scopedDriver
      : (scope === 'latest' || history) && (await narrows(scopedDriver))
        ? scopedDriver
        : undefined;
  // The term the latest's driver finds is not tested again: the same rows, but the planner would
  // reckon the two independent and the matches far fewer than they are (#605).
  const places = scopedTerms
    .filter((term) => history || term !== wanted || driver === undefined)
    .map(({ place, words, excluded }) => {
      const holds = history ? heldOverVersions(place, words) : heldAt('e', texts, place, words);
      return excluded ? sql<SqlBool>`not ${holds}` : holds;
    });

  // Nothing any configuration can search for - punctuation, and nothing else - is no query at all.
  const { rows: lexemes } = await sql<{
    any: boolean;
  }>`select numnode(websearch_to_tsquery('simple', ${parsed.anyOf})) > 0 as any`.execute(trx);
  if (!lexemes[0]?.any) return { outcome: 'nothing_to_match', excluded: [] };

  // The words, as the entry's language reads them; or every term as a part of the entry's text, in
  // any case, none excluded (UI6), which the trigram index answers. A term under three characters,
  // which no trigram holds, only narrows a longer one's, written so the index is never planned for it;
  // with no longer term there is no part-of-a-word match (SV3-A). A typed `%` or `_` is a character,
  // never a pattern.
  const like = (term: string) => `%${term.replace(/[\\%_]/gu, (each) => `\\${each}`)}%`;
  const short = (term: string) => [...term].length < 3;
  /** `alias`'s row matching the words, or holding every term as a part of a word. */
  const wordsOver = (alias: string) => {
    const body = sql.ref(`${alias}.body`);
    const whole = matches(alias, parsed.words);
    const contains =
      parsed.contains === null || parsed.contains.all.every(short)
        ? null
        : sql.join(
            [
              ...parsed.contains.all.map((term) =>
                short(term)
                  ? sql<SqlBool>`(${body} || '') ilike ${like(term)}`
                  : sql<SqlBool>`${body} ilike ${like(term)}`,
              ),
              ...parsed.contains.none.map((term) => sql<SqlBool>`${body} not ilike ${like(term)}`),
            ],
            sql` and `,
          );
    return contains === null ? whole : sql<SqlBool>`(${whole} or (${contains}))`;
  };
  const words =
    parsed.words === ''
      ? (driver ?? sql<SqlBool>`true`)
      : driver === undefined
        ? wordsOver('e')
        : sql<SqlBool>`${wordsOver('e')} and ${driver}`;
  /** One version's row, `alias`, matching the whole query: the version a history row names (SV3-M). */
  const wholeOver = (alias: string, from: RawBuilder<unknown>) =>
    sql.join(
      [
        parsed.words === '' ? sql<SqlBool>`true` : wordsOver(alias),
        ...scopedTerms.map(({ place, words: held, excluded }) =>
          excluded
            ? sql<SqlBool>`not ${heldAt(alias, from, place, held)}`
            : heldAt(alias, from, place, held),
        ),
      ],
      sql` and `,
    );
  const limit = Math.min(Math.max(options.limit ?? SEARCH_PAGE, 1), SEARCH_PAGE_MAX);
  const offset = Math.min(Math.max(options.offset ?? 0, 0), SEARCH_COUNT_CAP);

  // The readable set as access.md's predicate, word for word: an artifact in no space - a definition -
  // is read at the tenant, and refused like any other by a grant on itself. A section is its
  // document's, by the document's artifact. A field is read the same way, so the fields a reader may
  // read are the only ones that facet or filter for them.
  const readableRow = sql<SqlBool>`(
      ((e.space_id = any(${[...readable.spaces]}::uuid[])
          or (e.space_id is null and ${readable.tenant}::boolean))
        and not e.artifact_id = any(${[...readable.excluded]}::uuid[]))
      or e.artifact_id = any(${[...readable.included]}::uuid[])
    )`;
  // Archived content is no result, facet or count (LIF-020; lifecycle.md).
  // The places' tests apart: per row, so a bounded search runs them on the newest candidates alone.
  const candidate = sql<SqlBool>`${readableRow} and ${shown} and ${words}`;
  const held = places.length === 0 ? undefined : sql<SqlBool>`${sql.join(places, sql` and `)}`;
  const matching = held === undefined ? candidate : sql<SqlBool>`${candidate} and ${held}`;

  // Every filter a column of its own, so a facet can leave its own out: `f_field_<n>` for each field
  // filtered on, several values of one field either of them. A field's value is read from the row's
  // own values, as its facet reads it, and only for a field the reader may read.
  const filters = options.filters ?? {};
  const byField = new Map<string, string[]>();
  for (const each of filters.values ?? []) {
    byField.set(each.field, [...(byField.get(each.field) ?? []), each.value]);
  }
  const filterFields = new Map(
    byField.size === 0
      ? []
      : (
          await sql<{ field: string; data_type: string; multiplicity: string }>`
            select distinct on (v.artifact_id) v.artifact_id::text as field,
                   v.content ->> 'dataType' as data_type, v.content ->> 'multiplicity' as multiplicity
            from artifact_version v
            where v.kind = 'field'
              and v.artifact_id = any(${[...byField.keys()].filter((id) => UUID.test(id))}::uuid[])
              and ((${readable.tenant}::boolean
                    and not v.artifact_id = any(${[...readable.excluded]}::uuid[]))
                   or v.artifact_id = any(${[...readable.included]}::uuid[]))
            order by v.artifact_id, v.revision_no desc, v.version_no desc`.execute(trx)
        ).rows.map((row) => [row.field, row] as const),
  );
  const fieldFilters = [...byField].map(([field, values], index) => ({
    field,
    values,
    flag: `f_field_${index}`,
  }));
  const valueFilter = (alias: string, field: string, values: readonly string[]) => {
    const known = filterFields.get(field);
    if (known === undefined) return sql<SqlBool>`false`;
    const held = sql`${sql.ref(`${alias}.field_values`)} -> ${field}`;
    return sql<SqlBool>`exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(${held}) = 'array' then ${held} else jsonb_build_array(${held}) end) el(x)
      where ${valueKey(sql`el.x`, sql`${known.data_type}::text`, sql`${known.multiplicity}::text`)}
            = any(${[...values]}::text[])
        and ${valueKey(sql`el.x`, sql`${known.data_type}::text`, sql`${known.multiplicity}::text`)} <> '')`;
  };
  const flagsOver = (alias: string) =>
    [
      ['f_kind', among(alias, 'kind', filters.kinds, false)],
      ['f_space', among(alias, 'space_id', filters.spaces, true)],
      ['f_type', among(alias, 'component_type', filters.componentTypes, true)],
      ['f_owner', among(alias, 'owner', filters.owners, true)],
      ['f_changed', changedFilter(alias, filters.changed)],
      ...fieldFilters.map(
        ({ field, values, flag }) => [flag, valueFilter(alias, field, values)] as const,
      ),
    ] as const;
  const flagged = sql.join(
    flagsOver('b').map(([flag, predicate]) => sql`${predicate} as ${sql.raw(flag)}`),
    sql`, `,
  );
  /** Every filter in force but `left`, over the flagged row `b`. */
  const allBut = (left: string) =>
    sql.raw(
      flagsOver('b')
        .filter(([flag]) => flag !== left)
        .map(([flag]) => `b.${flag}`)
        .join(' and ') || 'true',
    );
  // A field's own filter is left out of that field's facet, and only that field's.
  const fieldFacetScope = sql.join(
    [
      sql.raw(
        ['f_kind', 'f_space', 'f_type', 'f_owner', 'f_changed'].map((f) => `b.${f}`).join(' and '),
      ),
      ...fieldFilters.map(
        ({ field, flag }) => sql`(${sql.raw(`b.${flag}`)} or ev.field::text = ${field})`,
      ),
    ],
    sql` and `,
  );
  const facetJson = (rows: RawBuilder<unknown>) => sql`(
    select coalesce(json_agg(json_build_object('value', x.value, 'label', x.label, 'n', x.n)
                             order by x.n desc, x.label, x.value), '[]'::json)
    from (${rows}) x)`;

  // The latest, and every version from history, are bounded (SV3-C, SV3-D): results from the newest
  // N + 1 rows matching every filter, facets from those and the newest N + 1 failing at most one, each
  // found by the road chosen (SV3-E).
  let bounded: { results: string[]; facets: string[]; facetsBounded: boolean } | undefined;
  if (scope === 'latest' || history) {
    // Every version scans history, and the current rows of the kinds it does not hold, apart: each by
    // its own road, the newest of the two merged. One union would read the current rows history stands
    // for too, as a branch with a `where` of its own is never flattened.
    const scans =
      scope === 'latest'
        ? [{ from: sql`search_entry`, relation: 'search_entry' }]
        : [
            {
              from: sql`(select *, null::uuid as thread_id, false as current from search_history)`,
              relation: 'search_history',
            },
            {
              // Named, not excluded: the kind index then finds them, never the rows history holds.
              // Their own words stand for titles and fields, a superset the places' test makes exact.
              from: sql`(select *, true as current, vector as title_vector, vector as fields_vector
                         from search_entry where kind in ${NOT_IN_HISTORY})`,
              relation: 'search_entry',
              // Always by the indexes: a walk of the table's (changed_at, id) index would read the
              // current rows history stands for too, and a table's size says nothing of these kinds'.
              indexesOnly: true,
            },
          ];
    const seen = options.probe?.seen;
    const explained = async (
      statement: 'results' | 'facets' | 'page',
      query: RawBuilder<unknown>,
    ) => {
      if (options.probe?.explain !== true) return;
      const { rows: plan } = await sql<{
        'QUERY PLAN': unknown;
      }>`explain (format json) ${query}`.execute(trx);
      seen?.({ statement, plan: plan[0]?.['QUERY PLAN'] });
    };
    // The rows as the planner reckons them: its last count, scaled to the table's size now.
    const sizeOf = async (relation: string) => {
      const { rows: sized } = await sql<{ rows: number }>`
        select case when relpages > 0
                    then reltuples / relpages
                         * (pg_relation_size(oid) / current_setting('block_size')::int)
                    else reltuples end::float8 as rows
        from pg_class where oid = ${relation}::regclass`.execute(trx);
      return Number(sized[0]?.rows ?? -1);
    };
    const N = SEARCH_RANK_BOUND;
    /** The rows of `candidates` matching `where`, as the planner reckons them. */
    const planned = async (candidates: RawBuilder<unknown>, where: RawBuilder<SqlBool>) => {
      const { rows: plan } = await sql<{ 'QUERY PLAN': { Plan: { 'Plan Rows': number } }[] }>`
        explain (format json) select 1 from ${candidates} e where ${where}`.execute(trx);
      return Number(plan[0]?.['QUERY PLAN'][0]?.Plan['Plan Rows'] ?? 0);
    };
    /**
     * The newest N + 1 rows of one scan matching `where` and the places' tests, with when each
     * changed, in microseconds.
     */
    const newestOf = async (
      statement: 'results' | 'facets',
      candidateWhere: RawBuilder<SqlBool>,
      candidates: RawBuilder<unknown>,
      rows: number,
      relation: string,
      indexesOnly: boolean,
    ) => {
      const where =
        held === undefined ? candidateWhere : sql<SqlBool>`${candidateWhere} and ${held}`;
      let road: SearchRoad | undefined = indexesOnly ? 'indexes' : options.probe?.road;
      // The rows a walk reads at most: every row for a road forced, so it answers alone, unless a
      // test sets how many.
      let reads: number = options.probe?.reads ?? Number.MAX_SAFE_INTEGER;
      let estimate: { estimate: number; rows: number } | undefined;
      if (road === undefined) {
        const matches = await planned(candidates, where);
        estimate = { estimate: matches, rows };
        road = rows > 0 && matches > Math.sqrt(N * rows) ? 'walk' : 'indexes';
        if (road === 'walk') reads = Math.ceil((4 * (N + 1) * rows) / matches);
      }
      const at = sql`(extract(epoch from e.changed_at) * 1000000)::bigint::text as at`;
      // The limit inside, the reader's predicate outside: the limit bounds the cost alone.
      const walk = sql`
        select e.id, ${at} from (select * from ${candidates} c order by changed_at desc, id desc
                                 limit ${reads}) e
        where ${where} order by e.changed_at desc, e.id desc limit ${N + 1}`;
      // What the places' tests and the answer read, alone: a sort of every column could spill.
      const narrow = sql.raw(
        `e.id, e.artifact_id, e.node, e.changed_at${scope === 'latest' ? '' : ', e.current'}`,
      );
      // Ordered by an expression no index holds, so the planner finds the matches by their indexes;
      // the places' tests then run in that order until N + 1 pass, not on every candidate (#608).
      const indexes =
        held === undefined
          ? sql`
            select e.id, ${at} from ${candidates} e where ${where}
            order by e.changed_at + interval '0 s' desc, e.id desc limit ${N + 1}`
          : sql`
            select e.id, ${at}
            from (select ${narrow}, e.changed_at + interval '0 s' as sort_at from ${candidates} e
                  where ${candidateWhere} order by sort_at desc, e.id desc offset 0) e
            where ${held} order by e.sort_at desc, e.id desc limit ${N + 1}`;
      if (road === 'walk') {
        await explained(statement, walk);
        const { rows: walked } = await sql<{ id: string; at: string }>`${walk}`.execute(trx);
        if (walked.length > N || reads === Number.MAX_SAFE_INTEGER) {
          seen?.({ statement, road, scan: relation, ...estimate });
          return walked;
        }
        // Too few among the rows read: the indexes road answers instead.
        seen?.({ statement, road, scan: relation, ...estimate });
        road = 'indexes';
      }
      await explained(statement, indexes);
      const { rows: found } = await sql<{ id: string; at: string }>`${indexes}`.execute(trx);
      seen?.({ statement, road, scan: relation, ...estimate });
      return found;
    };
    const sizes = await Promise.all(scans.map((scan) => sizeOf(scan.relation)));
    // A change filter bounded below alone holds the newest rows, the first a walk reads: the results'
    // walk is sized to them, not to the table (#605).
    const { changed } = filters;
    const recent =
      changed !== undefined &&
      ('within' in changed
        ? changed.within !== 'earlier'
        : calendarDate(changed.from) !== undefined && calendarDate(changed.to) === undefined);
    /** The newest N + 1 over every scan, in the one order, `changed_at desc, id desc`. */
    const newest = async (statement: 'results' | 'facets', where: RawBuilder<SqlBool>) => {
      const found: { id: string; at: string }[] = [];
      for (const [index, scan] of scans.entries()) {
        const indexesOnly = 'indexesOnly' in scan;
        const rows =
          statement === 'results' && recent && !indexesOnly && options.probe?.road === undefined
            ? Math.min(sizes[index]!, await planned(scan.from, changedFilter('e', changed)))
            : sizes[index]!;
        found.push(
          ...(await newestOf(statement, where, scan.from, rows, scan.relation, indexesOnly)),
        );
      }
      return found
        .sort((a, b) => {
          const by = BigInt(b.at) - BigInt(a.at);
          return by !== 0n ? (by > 0n ? 1 : -1) : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
        })
        .slice(0, N + 1)
        .map((row) => row.id);
    };
    const flags = flagsOver('e').map(
      ([, predicate]) => sql<SqlBool>`coalesce(${predicate}, false)`,
    );
    // Bare, so an index on a filtered column serves the results and the planner counts them (#605).
    const results = await newest(
      'results',
      sql<SqlBool>`${candidate} and ${sql.join(
        flagsOver('e').map(([, predicate]) => predicate),
        sql` and `,
      )}`,
    );
    const inForce =
      byField.size +
      (filters.changed === undefined ? 0 : 1) +
      [filters.kinds, filters.spaces, filters.componentTypes, filters.owners].filter(
        (each) => each !== undefined && each.length > 0,
      ).length;
    // Under one filter, every match fails at most it: the facets are the matches', so estimated as
    // they are rather than as a sum the planner cannot read (#605).
    const facets =
      inForce === 0
        ? results
        : await newest(
            'facets',
            inForce === 1
              ? candidate
              : sql<SqlBool>`${candidate}
                  and (${sql.join(
                    flags.map((flag) => sql`(not ${flag})::int`),
                    sql` + `,
                  )}) <= 1`,
          );
    bounded = {
      results,
      facets: [...new Set([...results.slice(0, N), ...facets.slice(0, N)])],
      facetsBounded: facets.length > N,
    };
  }

  // The rows read: a bounded search's candidates by id, the predicate checked again, and ranked over
  // them alone (SV3-C); a baseline's, or every version's before 0091, every match, exact and unbounded.
  const rank = sql`ts_rank(e.vector, websearch_to_tsquery(e.configuration, ${parsed.anyOf})) as rank`;
  const base =
    bounded === undefined
      ? sql`
          select e.id, e.kind, e.artifact_id, e.node, e.title, e.space_id, e.changed_at, e.owner,
                 e.component_type, e.field_values, e.version_id, e.thread_id, e.current, ${rank}
          from ${source} e
          where ${matching}`
      : sql`
          select e.id, e.kind, e.artifact_id, e.node, e.title, e.space_id, e.changed_at, e.owner,
                 e.component_type, e.field_values, e.version_id, e.thread_id,
                 ${scope === 'latest' ? sql`true` : sql`e.current`} as current, ${rank}
          from ${source} e
          where e.id = any(${bounded.facets}::uuid[]) and ${readableRow} and ${shown}`;
  const matched =
    bounded === undefined
      ? sql`select * from flagged b where ${allBut('')}`
      : sql`select * from flagged b
            where b.id = any(${bounded.results.slice(0, SEARCH_RANK_BOUND)}::uuid[])`;
  // The version a history row names, for the page's rows alone (SV3-M): the newest of its place's
  // versions matching the whole query, else the newest holding any of its words.
  const versionOf = (table: string, texts: string, current: boolean) => sql`
    select x.id, x.version_id, ${current}::boolean as current, v.revision_no, v.version_no,
           ${wholeOver('x', sql.raw(texts))} as whole,
           x.vector @@ websearch_to_tsquery(x.configuration, ${parsed.anyOf}) as some
    from ${sql.raw(table)} x join artifact_version v on v.id = x.version_id
    where x.artifact_id = p.artifact_id
      and (x.node = p.node or (p.node is null and x.node is null))
      ${table === 'search_entry' ? sql`and x.kind in ${IN_HISTORY}` : sql``}`;
  const named = history
    ? sql`select n.id, n.version_id, n.current from (
            ${versionOf('search_entry', 'search_text', true)}
            union all
            ${versionOf('search_earlier', 'search_earlier_text', false)}) n
          order by n.whole desc, n.some desc, n.revision_no desc, n.version_no desc
          limit 1`
    : sql`select null::uuid as id, null::uuid as version_id, null::boolean as current`;

  const page = sql<{
    total: string;
    items: {
      kind: SearchKind;
      artifact_id: string;
      node: string | null;
      title: string;
      space_id: string | null;
      space_name: string | null;
      changed_at: string;
      place: string | null;
      passage: string | null;
      version_id: string;
      current: boolean;
      revision_no: number | null;
      version_no: number | null;
      thread_id: string | null;
      thread_on: 'component' | 'document' | null;
      resolved: boolean;
    }[];
    kinds: FacetRow[];
    spaces: FacetRow[];
    component_types: FacetRow[];
    owners: FacetRow[];
    changed: FacetRow[];
    fields: (FacetRow & { field: string; name: string; data_type: string })[] | null;
  }>`
    with readable_fields as (
      select distinct on (v.artifact_id)
             v.artifact_id as field, v.content ->> 'name' as name,
             v.content ->> 'dataType' as data_type, v.content ->> 'multiplicity' as multiplicity
      from artifact_version v
      where v.kind = 'field'
        and ((${readable.tenant}::boolean
              and not v.artifact_id = any(${[...readable.excluded]}::uuid[]))
             or v.artifact_id = any(${[...readable.included]}::uuid[]))
      order by v.artifact_id, v.revision_no desc, v.version_no desc
    ),
    base as (${base}),
    -- Each value an entry holds for a field that facets, as its facet names it: a boolean as true or
    -- false, a person by id, a date by its month, and a text of one value as written (SE-E).
    entry_values as (
      select b.id as entry_id, f.field, f.data_type, k.key
      from base b
      cross join lateral jsonb_each(b.field_values) as fv(field, value)
      join readable_fields f on f.field::text = fv.field
      cross join lateral (
        select ${valueKey(sql`x`, sql`f.data_type`, sql`f.multiplicity`)} as key
        from jsonb_array_elements(
               case when jsonb_typeof(fv.value) = 'array' then fv.value
                    else jsonb_build_array(fv.value) end) as el(x)
      ) k
      where k.key is not null and k.key <> ''
    ),
    flagged as (select b.*, ${flagged} from base b),
    matched as (${matched}),
    -- Each artifact and place once, at its newest version that matched every filter (SV-C).
    results as (${
      !collapse
        ? sql`select * from matched`
        : sql`select distinct on (m.artifact_id, m.node, m.thread_id) m.*
               from matched m join artifact_version v on v.id = m.version_id
               order by m.artifact_id, m.node, m.thread_id, v.revision_no desc, v.version_no desc`
    })
    select
      (select count(*) from (select 1 from results limit ${SEARCH_COUNT_CAP + 1}) c) as total,
      (select coalesce(json_agg(r order by r.rank desc, r.changed_at desc, r.id), '[]'::json)
       from (
         select p.id, p.rank, p.kind, p.artifact_id, p.node, p.title, p.space_id,
                sp.name as space_name, p.changed_at, best.place, best.passage,
                coalesce(named.version_id, p.version_id) as version_id,
                coalesce(named.current, p.current) as current, av.revision_no, av.version_no,
                p.thread_id, th.on_kind as thread_on, th.resolved
         from (select * from results order by rank desc, changed_at desc, id
               limit ${limit} offset ${offset}) p
         left join space sp on sp.id = p.space_id
         left join lateral (${named}) named on not p.current
         left join artifact_version av on av.id = coalesce(named.version_id, p.version_id)
         -- Resolved as it is now, read when searched (SV-M).
         left join lateral (${
           threaded
             ? sql`select t.on_kind,
                          exists (select 1 from thread_resolution r where r.thread_id = t.id)
                            as resolved
                     from thread t where t.id = p.thread_id`
             : sql`select null::text as on_kind, false as resolved`
         }) th on true
         left join lateral (
           select t.place,
                  ts_headline(t.configuration, t.body,
                              websearch_to_tsquery(t.configuration, ${parsed.anyOf}),
                              ${HEADLINE}) as passage
           from ${texts} t
           where t.entry_id = coalesce(named.id, p.id)
           order by ts_rank(t.vector, websearch_to_tsquery(t.configuration, ${parsed.anyOf})) desc,
                    t.place = 'title' desc, t.place
           limit 1
         ) best on true
       ) r) as items,
      ${facetJson(sql`select b.kind as value, b.kind as label, ${counted}::int as n
                      from flagged b where ${allBut('f_kind')} group by b.kind`)} as kinds,
      ${facetJson(sql`select b.space_id::text as value, sp.name as label, ${counted}::int as n
                      from flagged b join space sp on sp.id = b.space_id
                      where ${allBut('f_space')} group by b.space_id, sp.name`)} as spaces,
      ${facetJson(sql`select b.component_type::text as value, t.name as label, ${counted}::int as n
                      from flagged b
                      join (select distinct on (artifact_id) artifact_id, content ->> 'name' as name
                            from artifact_version where kind = 'componentType'
                            order by artifact_id, revision_no desc, version_no desc) t
                        on t.artifact_id = b.component_type
                      where ${allBut('f_type')} group by b.component_type, t.name`)} as component_types,
      ${facetJson(sql`select b.owner::text as value,
                             coalesce(pr.display_name, pr.email, 'Unnamed') as label, ${counted}::int as n
                      from flagged b join principal pr on pr.id = b.owner
                      where ${allBut('f_owner')}
                      group by b.owner, pr.display_name, pr.email`)} as owners,
      (select json_build_array(
         json_build_object('value', 'today', 'label', 'today',
                           'n', ${counted} filter (where b.changed_at >= ${rangeStart.today})),
         json_build_object('value', 'week', 'label', 'week',
                           'n', ${counted} filter (where b.changed_at >= ${rangeStart.week})),
         json_build_object('value', 'month', 'label', 'month',
                           'n', ${counted} filter (where b.changed_at >= ${rangeStart.month})),
         json_build_object('value', 'year', 'label', 'year',
                           'n', ${counted} filter (where b.changed_at >= ${rangeStart.year})),
         json_build_object('value', 'earlier', 'label', 'earlier',
                           'n', ${counted} filter (where b.changed_at < ${rangeStart.year})))
       from flagged b where ${allBut('f_changed')}) as changed,
      (select json_agg(json_build_object('field', y.field, 'name', y.name, 'data_type', y.data_type,
                                         'value', y.value, 'label', y.label, 'n', y.n)
                       order by y.name, y.field, y.n desc, y.label)
       from (
         select x.*, row_number() over (partition by x.field order by x.n desc, x.label) as place
         from (
           select ev.field::text as field, f.name, f.data_type, ev.key as value,
                  coalesce(pr.display_name, ev.key) as label,
                  ${collapse ? counted : sql`count(distinct ev.entry_id)`}::int as n
           from entry_values ev
           join flagged b on b.id = ev.entry_id
           join readable_fields f on f.field = ev.field
           left join principal pr on ev.data_type = 'user' and pr.id::text = ev.key
           where ${fieldFacetScope}
           group by ev.field, f.name, f.data_type, ev.key, pr.display_name
         ) x
       ) y
       where y.place <= ${FIELD_FACET_VALUES}) as fields`;
  if (options.probe?.explain === true) {
    const { rows: plan } = await sql<{
      'QUERY PLAN': unknown;
    }>`explain (format json) ${page}`.execute(trx);
    options.probe.seen?.({ statement: 'page', plan: plan[0]?.['QUERY PLAN'] });
  }
  const { rows } = await page.execute(trx);

  const row = rows[0]!;
  const total = bounded === undefined ? Number(row.total) : bounded.results.length;
  const facetsBounded = bounded?.facetsBounded ?? false;
  const capped = (each: readonly FacetRow[] | null) => cappedOf(each, facetsBounded);
  const placed =
    baseline !== undefined && row.items.some((item) => item.kind === 'component')
      ? await firstPinnedNodes(trx, baseline)
      : new Map<string, string>();
  const fields = new Map<
    string,
    { field: string; name: string; dataType: string; values: FacetRow[] }
  >();
  for (const each of row.fields ?? []) {
    const held = fields.get(each.field) ?? {
      field: each.field,
      name: each.name,
      dataType: each.data_type,
      values: [],
    };
    held.values.push({ value: each.value, label: each.label, n: each.n });
    fields.set(each.field, held);
  }
  return {
    outcome: 'results',
    count: Math.min(total, SEARCH_COUNT_CAP),
    capped: total > SEARCH_COUNT_CAP,
    facetsBounded,
    items: row.items.map((item) => ({
      kind: item.kind,
      artifactId: item.artifact_id,
      node: item.node,
      title: item.title,
      spaceId: item.space_id,
      spaceName: item.space_name,
      changedAt: new Date(item.changed_at),
      place: item.place,
      passage: piecesOf(item.passage),
      version:
        VERSIONED.has(item.kind) && item.revision_no !== null
          ? {
              id: item.version_id,
              number: `${item.revision_no}.${item.version_no}`,
              latest: item.current,
            }
          : null,
      baseline:
        baseline === undefined
          ? null
          : {
              id: baseline.id,
              name: baseline.name,
              document: baseline.document,
              node:
                item.kind === 'section'
                  ? item.node
                  : item.kind === 'component'
                    ? (placed.get(`${item.artifact_id}:${item.version_id}`) ?? null)
                    : null,
            },
      thread:
        item.thread_id === null || item.thread_on === null
          ? null
          : { id: item.thread_id, on: item.thread_on, resolved: item.resolved === true },
    })),
    facets: {
      kinds: capped(row.kinds),
      spaces: capped(row.spaces),
      componentTypes: capped(row.component_types),
      owners: capped(row.owners),
      changed: capped(row.changed),
      fields: [...fields.values()].map((each) => ({
        field: each.field,
        name: each.name,
        dataType: each.dataType,
        values: capped(
          [...each.values].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)),
        ),
      })),
    },
  };
}
