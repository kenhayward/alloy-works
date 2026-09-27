import { nameKey, parseQuery, type SearchKind } from '@alloy-works/domain';
import { sql, type RawBuilder, type SqlBool } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import type { TenantTransaction } from './tables.js';

/**
 * A search by words (search.md, "One query"; SCH-016, SCH-017, SCH-039): one statement over the
 * projection, holding the reader's readable set, the query, the best place in each entry, a passage from
 * that place, and the count - capped over what the reader may see.
 */

/** Past this many, a count says only that there are more (SCH-034). */
export const SEARCH_COUNT_CAP = 1000;

/** How many results a page holds unless asked for fewer, and the most it holds. */
export const SEARCH_PAGE = 20;
export const SEARCH_PAGE_MAX = 50;

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

/**
 * Searches as `principal`: undefined where the tenant holds no such principal. A scoped term's name is
 * `title`, or a field's by its folded name - only for a reader who may read that field, as access.md
 * reads a definition (SE-H), so a field is no scope for anybody else and says nothing of what it holds.
 */
export async function searchWords(
  trx: TenantTransaction,
  principal: string,
  query: string,
  page: { readonly offset?: number; readonly limit?: number } = {},
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

  const words =
    parsed.words === ''
      ? sql<SqlBool>`true`
      : sql<SqlBool>`e.vector @@ websearch_to_tsquery(e.configuration, ${parsed.words})`;
  const limit = Math.min(Math.max(page.limit ?? SEARCH_PAGE, 1), SEARCH_PAGE_MAX);
  const offset = Math.min(Math.max(page.offset ?? 0, 0), SEARCH_COUNT_CAP);

  // The readable set as access.md's predicate, word for word: an artifact in no space - a definition -
  // is read at the tenant, and refused like any other by a grant on itself. A section is its
  // document's, by the document's artifact.
  const { rows } = await sql<{
    total: string;
    kind: SearchKind | null;
    artifact_id: string | null;
    node: string | null;
    title: string | null;
    space_id: string | null;
    space_name: string | null;
    changed_at: Date | null;
    place: string | null;
    passage: string | null;
  }>`
    with matched as (
      select e.id, e.kind, e.artifact_id, e.node, e.title, e.space_id, e.changed_at,
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
    counted as (select count(*) as total from (select 1 from matched limit ${SEARCH_COUNT_CAP + 1}) c),
    shown as (
      select * from matched order by rank desc, changed_at desc, id limit ${limit} offset ${offset}
    )
    select c.total, r.*
    from counted c
    left join lateral (
      select p.kind, p.artifact_id, p.node, p.title, p.space_id, sp.name as space_name, p.changed_at,
             p.rank, p.id, best.place, best.passage
      from shown p
      left join space sp on sp.id = p.space_id
      left join lateral (
        select t.place,
               ts_headline(t.configuration, t.body,
                           websearch_to_tsquery(t.configuration, ${parsed.anyOf}), ${HEADLINE}) as passage
        from search_text t
        where t.entry_id = p.id
        order by ts_rank(t.vector, websearch_to_tsquery(t.configuration, ${parsed.anyOf})) desc,
                 t.place = 'title' desc, t.place
        limit 1
      ) best on true
    ) r on true
    order by r.rank desc, r.changed_at desc, r.id`.execute(trx);

  const total = Number(rows[0]?.total ?? 0);
  return {
    outcome: 'results',
    count: Math.min(total, SEARCH_COUNT_CAP),
    capped: total > SEARCH_COUNT_CAP,
    items: rows.flatMap((row) =>
      row.artifact_id === null
        ? []
        : [
            {
              kind: row.kind!,
              artifactId: row.artifact_id,
              node: row.node,
              title: row.title!,
              spaceId: row.space_id,
              spaceName: row.space_name,
              changedAt: row.changed_at!,
              place: row.place,
              passage: piecesOf(row.passage),
            },
          ],
    ),
  };
}
