import {
  nameKey,
  parseQuery,
  readOutline,
  SEARCH_CONFIGURATIONS,
  walkOutline,
  type SearchKind,
} from '@alloy-works/domain';
import { sql, type RawBuilder, type SqlBool } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { isDeleted } from './deletion.js';
import { vectorStored } from './search-threads.js';
import type { TenantTransaction } from './tables.js';

/**
 * A search by words (search.md, "One query"; SCH-016, SCH-017, SCH-039, SCH-046, SCH-059): one
 * statement over the projection, holding the reader's readable set, the query, the filters, the best
 * place in each entry and a passage from it, the count, and every facet - each counted with the other
 * filters in force and its own left out, and each capped over what the reader may see (SCH-073). The
 * latest is first bounded to its most recently changed matches, found by the road chosen (SV3).
 */

/** Past this many, a count says only that there are more (SCH-073). */
export const SEARCH_COUNT_CAP = 1000;

/** How many of the most recently changed matches the latest ranks and facets (SV3-C). */
export const SEARCH_RANK_BOUND = 1000;

/** How the latest finds its newest matches: walking them in changed order, or by the word indexes. */
export type SearchRoad = 'walk' | 'indexes';

/** For tests and the load suite alone: a road forced, the plans explained, and each scan's road. */
export interface SearchProbe {
  readonly road?: SearchRoad;
  readonly explain?: boolean;
  readonly seen?: (event: {
    readonly statement: 'results' | 'facets' | 'page';
    readonly road?: SearchRoad;
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

/** A dimension's filter over a row, compared as text so an identifier of no shape matches nothing. */
function among(
  alias: string,
  column: string,
  values: readonly string[] | undefined,
): RawBuilder<SqlBool> {
  return values === undefined || values.length === 0
    ? sql<SqlBool>`true`
    : sql<SqlBool>`${sql.ref(`${alias}.${column}`)}::text = any(${[...values]}::text[])`;
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
  // The latest alone reads `search_entry` as it always has, with no union (SV-C). Every version adds
  // `search_earlier` but its assets, which no page shows (SV-A); a baseline reads what it pins.
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
  // One result per artifact and place however many of its versions match, counted once (SV-C).
  const counted =
    scope === 'latest'
      ? sql`count(*)`
      : sql`count(distinct (b.artifact_id, coalesce(b.node, ''), coalesce(b.thread_id::text, '')))`;
  const parsed = parseQuery(query);
  if (parsed.outcome !== 'query') return parsed;

  // Each statement planned for its own parameters (search.md, "The permission predicate"; SV3-H).
  await sql`set local plan_cache_mode = force_custom_plan`.execute(trx);

  // The configurations in use, one index probe each (SV3-A).
  const { rows: inUse } = await sql<{ c: string }>`
    select c from unnest(${[...SEARCH_CONFIGURATIONS]}::text[]) c
    where exists (select 1 from search_entry where configuration = c::regconfig)
      ${
        scope === 'latest'
          ? sql``
          : sql`or exists (select 1 from search_earlier where configuration = c::regconfig)`
      }
    order by c`.execute(trx);
  const configurations = inUse.map((row) => row.c);
  /** `alias`'s words matching `words`, a constant tsquery per configuration, so an index serves it. */
  const matches = (alias: string, words: string) =>
    configurations.length === 0
      ? sql<SqlBool>`false`
      : sql<SqlBool>`(${sql.join(
          configurations.map(
            (c) => sql`(${sql.ref(`${alias}.configuration`)} = ${c}::regconfig
              and ${sql.ref(`${alias}.vector`)} @@ websearch_to_tsquery(${c}::regconfig, ${words}))`,
          ),
          sql` or `,
        )})`;

  const places: RawBuilder<SqlBool>[] = [];
  // A query of scoped terms alone is found through its places' index (SV3-A).
  let driver: RawBuilder<SqlBool> | undefined;
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
    const holds = sql<SqlBool>`exists (
      select 1 from ${texts} s
      where s.entry_id = e.id and s.place = ${place}
        and s.vector @@ websearch_to_tsquery(s.configuration, ${term.words}))`;
    places.push(term.excluded ? sql<SqlBool>`not ${holds}` : holds);
    if (!term.excluded && driver === undefined) {
      driver = sql<SqlBool>`e.id in (
        select s.entry_id from ${texts} s where s.place = ${place} and ${matches('s', term.words)})`;
    }
  }

  // Nothing any configuration can search for - punctuation, and nothing else - is no query at all.
  const { rows: lexemes } = await sql<{
    any: boolean;
  }>`select numnode(websearch_to_tsquery('simple', ${parsed.anyOf})) > 0 as any`.execute(trx);
  if (!lexemes[0]?.any) return { outcome: 'nothing_to_match', excluded: [] };

  // The words, as the entry's language reads them; or every term as a part of the entry's text, in
  // any case, none excluded (UI6), which the trigram index answers - so never for a term under three
  // characters, which no trigram holds (SV3-A). A typed `%` or `_` is a character, never a pattern.
  const whole = matches('e', parsed.words);
  const like = (term: string) => `%${term.replace(/[\\%_]/gu, (each) => `\\${each}`)}%`;
  const contains =
    parsed.contains === null || parsed.contains.all.some((term) => [...term].length < 3)
      ? null
      : sql.join(
          [
            ...parsed.contains.all.map((term) => sql<SqlBool>`e.body ilike ${like(term)}`),
            ...parsed.contains.none.map((term) => sql<SqlBool>`e.body not ilike ${like(term)}`),
          ],
          sql` and `,
        );
  const words =
    parsed.words === ''
      ? (driver ?? sql<SqlBool>`true`)
      : contains === null
        ? whole
        : sql<SqlBool>`(${whole} or (${contains}))`;
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
  const matching = sql<SqlBool>`${readableRow} and ${shown} and ${words}
    and ${places.length === 0 ? sql<SqlBool>`true` : sql.join(places, sql` and `)}`;

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
            = any(${[...values]}::text[]))`;
  };
  const flagsOver = (alias: string) =>
    [
      ['f_kind', among(alias, 'kind', filters.kinds)],
      ['f_space', among(alias, 'space_id', filters.spaces)],
      ['f_type', among(alias, 'component_type', filters.componentTypes)],
      ['f_owner', among(alias, 'owner', filters.owners)],
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

  // The latest is bounded (SV3-C, SV3-D): results from the newest N + 1 rows matching every filter,
  // facets from those and the newest N + 1 failing at most one, each found by the road chosen (SV3-E).
  let bounded: { results: string[]; facets: string[]; facetsBounded: boolean } | undefined;
  if (scope === 'latest') {
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
    const { rows: sized } = await sql<{ rows: number }>`
      select reltuples::float8 as rows from pg_class where oid = 'search_entry'::regclass`.execute(
      trx,
    );
    const rows = Number(sized[0]?.rows ?? -1);
    const N = SEARCH_RANK_BOUND;
    const newest = async (statement: 'results' | 'facets', where: RawBuilder<SqlBool>) => {
      let road = options.probe?.road;
      // The rows a walk reads at most: every row for a road forced, so it answers alone.
      let reads: number = Number.MAX_SAFE_INTEGER;
      if (road === undefined) {
        const { rows: estimate } = await sql<{ 'QUERY PLAN': { Plan: { 'Plan Rows': number } }[] }>`
          explain (format json) select 1 from search_entry e where ${where}`.execute(trx);
        const matches = Number(estimate[0]?.['QUERY PLAN'][0]?.Plan['Plan Rows'] ?? 0);
        road = rows > 0 && matches > Math.sqrt(N * rows) ? 'walk' : 'indexes';
        if (road === 'walk') reads = Math.ceil((4 * (N + 1) * rows) / matches);
      }
      // The limit inside, the reader's predicate outside: the limit bounds the cost alone.
      const walk = sql`
        select e.id from (select * from search_entry order by changed_at desc, id desc
                          limit ${reads}) e
        where ${where} order by e.changed_at desc, e.id desc limit ${N + 1}`;
      // Ordered by an expression no index holds, so the planner finds the matches by their indexes.
      const indexes = sql`
        select e.id from search_entry e where ${where}
        order by e.changed_at + interval '0 s' desc, e.id desc limit ${N + 1}`;
      if (road === 'walk') {
        await explained(statement, walk);
        const { rows: walked } = await sql<{ id: string }>`${walk}`.execute(trx);
        if (walked.length > N || reads === Number.MAX_SAFE_INTEGER) {
          seen?.({ statement, road });
          return walked.map((row) => row.id);
        }
        road = 'indexes';
      }
      await explained(statement, indexes);
      const { rows: found } = await sql<{ id: string }>`${indexes}`.execute(trx);
      seen?.({ statement, road });
      return found.map((row) => row.id);
    };
    const flags = flagsOver('e').map(
      ([, predicate]) => sql<SqlBool>`coalesce(${predicate}, false)`,
    );
    const results = await newest(
      'results',
      sql<SqlBool>`${matching} and ${sql.join(flags, sql` and `)}`,
    );
    const anyFilter =
      byField.size > 0 ||
      filters.changed !== undefined ||
      [filters.kinds, filters.spaces, filters.componentTypes, filters.owners].some(
        (each) => each !== undefined && each.length > 0,
      );
    const facets = anyFilter
      ? await newest(
          'facets',
          sql<SqlBool>`${matching}
            and (${sql.join(
              flags.map((flag) => sql`(not ${flag})::int`),
              sql` + `,
            )}) <= 1`,
        )
      : results;
    bounded = {
      results,
      facets: [...new Set([...results.slice(0, N), ...facets.slice(0, N)])],
      facetsBounded: facets.length > N,
    };
  }

  // The rows read: the latest's candidates by id, the predicate checked again; every version's or a
  // baseline's, every match, exact and unbounded.
  const base =
    bounded === undefined
      ? sql`
          select e.id, e.kind, e.artifact_id, e.node, e.title, e.space_id, e.changed_at, e.owner,
                 e.component_type, e.field_values, e.version_id, e.thread_id, e.current,
                 ts_rank(e.vector, websearch_to_tsquery(e.configuration, ${parsed.anyOf})) as rank
          from ${source} e
          where ${matching}`
      : sql`
          select e.id, e.kind, e.artifact_id, e.node, e.title, e.space_id, e.changed_at, e.owner,
                 e.component_type, e.field_values, e.version_id, e.thread_id, true as current
          from ${source} e
          where e.id = any(${bounded.facets}::uuid[]) and ${readableRow} and ${shown}`;
  // Ranked over the candidates alone (SV3-C).
  const matched =
    bounded === undefined
      ? sql`select * from flagged b where ${allBut('')}`
      : sql`select b.*, ts_rank(e.vector, websearch_to_tsquery(e.configuration, ${parsed.anyOf})) as rank
            from flagged b join search_entry e on e.id = b.id
            where b.id = any(${bounded.results.slice(0, SEARCH_RANK_BOUND)}::uuid[])`;

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
      scope === 'latest'
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
                p.version_id, p.current, av.revision_no, av.version_no,
                p.thread_id, th.on_kind as thread_on, th.resolved
         from (select * from results order by rank desc, changed_at desc, id
               limit ${limit} offset ${offset}) p
         left join space sp on sp.id = p.space_id
         left join artifact_version av on av.id = p.version_id
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
           where t.entry_id = p.id
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
                  ${scope === 'latest' ? sql`count(distinct ev.entry_id)` : counted}::int as n
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
