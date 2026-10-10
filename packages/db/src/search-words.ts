import { nameKey, parseQuery, type SearchKind } from '@alloy-works/domain';
import { sql, type RawBuilder, type SqlBool } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import type { TenantTransaction } from './tables.js';

/**
 * A search by words (search.md, "One query"; SCH-016, SCH-017, SCH-039, SCH-046, SCH-059): one
 * statement over the projection, holding the reader's readable set, the query, the filters, the best
 * place in each entry and a passage from it, the count, and every facet - each counted with the other
 * filters in force and its own left out, and each capped over what the reader may see (SCH-034).
 */

/** Past this many, a count says only that there are more (SCH-034). */
export const SEARCH_COUNT_CAP = 1000;

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
  /** A section's outline node; null for everything else. */
  readonly node: string | null;
  readonly title: string;
  readonly spaceId: string | null;
  readonly spaceName: string | null;
  readonly changedAt: Date;
  /** Where in the entry it matched best (search.md, "The tables"), or null for an entry of no words. */
  readonly place: string | null;
  readonly passage: readonly PassagePiece[];
}

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
  /** Whether more hold it than the count says, so the count is a lower bound (SCH-034). */
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
      /** Whether more match than the count says, so the count is a lower bound (SCH-034). */
      readonly capped: boolean;
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

/** A dimension's filter over `b`, compared as text so an identifier of no shape matches nothing. */
function among(column: string, values: readonly string[] | undefined): RawBuilder<SqlBool> {
  return values === undefined || values.length === 0
    ? sql<SqlBool>`true`
    : sql<SqlBool>`${sql.ref(column)}::text = any(${[...values]}::text[])`;
}

function changedFilter(changed: SearchFilters['changed']): RawBuilder<SqlBool> {
  if (changed === undefined) return sql<SqlBool>`true`;
  if ('within' in changed) {
    return changed.within === 'earlier'
      ? sql<SqlBool>`b.changed_at < ${rangeStart.year}`
      : sql<SqlBool>`b.changed_at >= ${rangeStart[changed.within]}`;
  }
  const from = calendarDate(changed.from);
  const to = calendarDate(changed.to);
  return sql<SqlBool>`${from === undefined ? sql`true` : sql`b.changed_at >= ${from}::date`}
    and ${to === undefined ? sql`true` : sql`b.changed_at < ${to}::date + 1`}`;
}

interface FacetRow {
  readonly value: string;
  readonly label: string;
  readonly n: number;
}

const capped = (rows: readonly FacetRow[] | null): FacetValue[] =>
  (rows ?? []).map((row) => ({
    value: row.value,
    label: row.label,
    count: Math.min(row.n, SEARCH_COUNT_CAP),
    capped: row.n > SEARCH_COUNT_CAP,
  }));

/**
 * Searches as `principal`: undefined where the tenant holds no such principal. A scoped term's name is
 * `title`, or a field's by its folded name - only for a reader who may read that field, as access.md
 * reads a definition (SE-H), so a field is no scope for anybody else and says nothing of what it holds.
 * A field facets for the same readers alone.
 */
export async function searchWords(
  trx: TenantTransaction,
  principal: string,
  query: string,
  options: {
    readonly offset?: number;
    readonly limit?: number;
    readonly filters?: SearchFilters;
  } = {},
): Promise<SearchAnswer | undefined> {
  const readable = await loadReadableSet(trx, principal);
  if (!readable) return undefined;
  const parsed = parseQuery(query);
  if (parsed.outcome !== 'query') return parsed;

  const places: RawBuilder<SqlBool>[] = [];
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
      select 1 from search_text s
      where s.entry_id = e.id and s.place = ${place}
        and s.vector @@ websearch_to_tsquery(s.configuration, ${term.words}))`;
    places.push(term.excluded ? sql<SqlBool>`not ${holds}` : holds);
  }

  // Nothing any configuration can search for - punctuation, and nothing else - is no query at all.
  const { rows: lexemes } = await sql<{
    any: boolean;
  }>`select numnode(websearch_to_tsquery('simple', ${parsed.anyOf})) > 0 as any`.execute(trx);
  if (!lexemes[0]?.any) return { outcome: 'nothing_to_match', excluded: [] };

  // The words, as the entry's language reads them; or every term as a part of the entry's text, in
  // any case, none excluded (UI6), which the trigram index answers. A typed `%` or `_` is a
  // character, never a pattern.
  const whole = sql<SqlBool>`e.vector @@ websearch_to_tsquery(e.configuration, ${parsed.words})`;
  const like = (term: string) => `%${term.replace(/[\\%_]/gu, (each) => `\\${each}`)}%`;
  const contains =
    parsed.contains === null
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
      ? sql<SqlBool>`true`
      : contains === null
        ? whole
        : sql<SqlBool>`(${whole} or (${contains}))`;
  const limit = Math.min(Math.max(options.limit ?? SEARCH_PAGE, 1), SEARCH_PAGE_MAX);
  const offset = Math.min(Math.max(options.offset ?? 0, 0), SEARCH_COUNT_CAP);

  // Every filter a column of its own, so a facet can leave its own out: `f_field_<n>` for each field
  // filtered on, several values of one field either of them.
  const filters = options.filters ?? {};
  const byField = new Map<string, string[]>();
  for (const each of filters.values ?? []) {
    byField.set(each.field, [...(byField.get(each.field) ?? []), each.value]);
  }
  const fieldFilters = [...byField].map(([field, values], index) => ({
    field,
    values,
    flag: `f_field_${index}`,
  }));
  const flags = [
    ['f_kind', among('b.kind', filters.kinds)],
    ['f_space', among('b.space_id', filters.spaces)],
    ['f_type', among('b.component_type', filters.componentTypes)],
    ['f_owner', among('b.owner', filters.owners)],
    ['f_changed', changedFilter(filters.changed)],
    ...fieldFilters.map(
      ({ field, values, flag }) =>
        [
          flag,
          sql<SqlBool>`exists (select 1 from entry_values ev
            where ev.entry_id = b.id and ev.field::text = ${field} and ev.key = any(${values}::text[]))`,
        ] as const,
    ),
  ] as const;
  const flagged = sql.join(
    flags.map(([flag, predicate]) => sql`${predicate} as ${sql.raw(flag)}`),
    sql`, `,
  );
  /** Every filter in force but `left`, over the flagged row `b`. */
  const allBut = (left: string) =>
    sql.raw(
      flags
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

  // The readable set as access.md's predicate, word for word: an artifact in no space - a definition -
  // is read at the tenant, and refused like any other by a grant on itself. A section is its
  // document's, by the document's artifact. A field is read the same way, so the fields a reader may
  // read are the only ones that facet or filter for them.
  const { rows } = await sql<{
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
    base as (
      select e.id, e.kind, e.artifact_id, e.node, e.title, e.space_id, e.changed_at, e.owner,
             e.component_type, e.field_values,
             ts_rank(e.vector, websearch_to_tsquery(e.configuration, ${parsed.anyOf})) as rank
      from search_entry e
      where (
          ((e.space_id = any(${[...readable.spaces]}::uuid[])
              or (e.space_id is null and ${readable.tenant}::boolean))
            and not e.artifact_id = any(${[...readable.excluded]}::uuid[]))
          or e.artifact_id = any(${[...readable.included]}::uuid[])
        )
        and ${words}
        and ${places.length === 0 ? sql<SqlBool>`true` : sql.join(places, sql` and `)}
    ),
    -- Each value an entry holds for a field that facets, as its facet names it: a boolean as true or
    -- false, a person by id, a date by its month, and a text of one value as written (SE-E).
    entry_values as (
      select b.id as entry_id, f.field, f.data_type, k.key
      from base b
      cross join lateral jsonb_each(b.field_values) as fv(field, value)
      join readable_fields f on f.field::text = fv.field
      cross join lateral (
        select case
                 when f.data_type = 'boolean' and jsonb_typeof(x) = 'boolean' then x::text
                 when f.data_type = 'user' and jsonb_typeof(x) = 'object' then x ->> 'user'
                 when f.data_type = 'date' and jsonb_typeof(x) = 'string' then left(x #>> '{}', 7)
                 when f.data_type = 'text' and f.multiplicity = 'one'
                      and jsonb_typeof(x) = 'string' then x #>> '{}'
               end as key
        from jsonb_array_elements(
               case when jsonb_typeof(fv.value) = 'array' then fv.value
                    else jsonb_build_array(fv.value) end) as el(x)
      ) k
      where k.key is not null and k.key <> ''
    ),
    flagged as (select b.*, ${flagged} from base b),
    matched as (select * from flagged b where ${allBut('')})
    select
      (select count(*) from (select 1 from matched limit ${SEARCH_COUNT_CAP + 1}) c) as total,
      (select coalesce(json_agg(r order by r.rank desc, r.changed_at desc, r.id), '[]'::json)
       from (
         select p.id, p.rank, p.kind, p.artifact_id, p.node, p.title, p.space_id,
                sp.name as space_name, p.changed_at, best.place, best.passage
         from (select * from matched order by rank desc, changed_at desc, id
               limit ${limit} offset ${offset}) p
         left join space sp on sp.id = p.space_id
         left join lateral (
           select t.place,
                  ts_headline(t.configuration, t.body,
                              websearch_to_tsquery(t.configuration, ${parsed.anyOf}),
                              ${HEADLINE}) as passage
           from search_text t
           where t.entry_id = p.id
           order by ts_rank(t.vector, websearch_to_tsquery(t.configuration, ${parsed.anyOf})) desc,
                    t.place = 'title' desc, t.place
           limit 1
         ) best on true
       ) r) as items,
      ${facetJson(sql`select b.kind as value, b.kind as label, count(*)::int as n
                      from flagged b where ${allBut('f_kind')} group by b.kind`)} as kinds,
      ${facetJson(sql`select b.space_id::text as value, sp.name as label, count(*)::int as n
                      from flagged b join space sp on sp.id = b.space_id
                      where ${allBut('f_space')} group by b.space_id, sp.name`)} as spaces,
      ${facetJson(sql`select b.component_type::text as value, t.name as label, count(*)::int as n
                      from flagged b
                      join (select distinct on (artifact_id) artifact_id, content ->> 'name' as name
                            from artifact_version where kind = 'componentType'
                            order by artifact_id, revision_no desc, version_no desc) t
                        on t.artifact_id = b.component_type
                      where ${allBut('f_type')} group by b.component_type, t.name`)} as component_types,
      ${facetJson(sql`select b.owner::text as value,
                             coalesce(pr.display_name, pr.email, 'Unnamed') as label, count(*)::int as n
                      from flagged b join principal pr on pr.id = b.owner
                      where ${allBut('f_owner')}
                      group by b.owner, pr.display_name, pr.email`)} as owners,
      (select json_build_array(
         json_build_object('value', 'today', 'label', 'today',
                           'n', count(*) filter (where b.changed_at >= ${rangeStart.today})),
         json_build_object('value', 'week', 'label', 'week',
                           'n', count(*) filter (where b.changed_at >= ${rangeStart.week})),
         json_build_object('value', 'month', 'label', 'month',
                           'n', count(*) filter (where b.changed_at >= ${rangeStart.month})),
         json_build_object('value', 'year', 'label', 'year',
                           'n', count(*) filter (where b.changed_at >= ${rangeStart.year})),
         json_build_object('value', 'earlier', 'label', 'earlier',
                           'n', count(*) filter (where b.changed_at < ${rangeStart.year})))
       from flagged b where ${allBut('f_changed')}) as changed,
      (select json_agg(json_build_object('field', y.field, 'name', y.name, 'data_type', y.data_type,
                                         'value', y.value, 'label', y.label, 'n', y.n)
                       order by y.name, y.field, y.n desc, y.label)
       from (
         select x.*, row_number() over (partition by x.field order by x.n desc, x.label) as place
         from (
           select ev.field::text as field, f.name, f.data_type, ev.key as value,
                  coalesce(pr.display_name, ev.key) as label, count(distinct ev.entry_id)::int as n
           from entry_values ev
           join flagged b on b.id = ev.entry_id
           join readable_fields f on f.field = ev.field
           left join principal pr on ev.data_type = 'user' and pr.id::text = ev.key
           where ${fieldFacetScope}
           group by ev.field, f.name, f.data_type, ev.key, pr.display_name
         ) x
       ) y
       where y.place <= ${FIELD_FACET_VALUES}) as fields`.execute(trx);

  const row = rows[0]!;
  const total = Number(row.total);
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
