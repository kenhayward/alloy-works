import type { ReadableSet } from '@alloy-works/domain';
import { sql } from 'kysely';
import { notDeletedAs } from './deletion.js';
import type { TenantTransaction } from './tables.js';

/** How many levels of narrower terms a term's reach follows (the TM plan, TM-I). */
export const NARROWER_LEVELS = 3;

/**
 * The query's words, each without the punctuation around it, one space between, an excluded word left
 * out: what a term's label or abbreviation is looked for in, whole words alone.
 */
const wordsOf = (query: string) =>
  query
    .normalize('NFC')
    .split(/\s+/u)
    .filter((each) => !each.startsWith('-'))
    .map((each) => each.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((each) => each !== '')
    .join(' ');

/**
 * The artifacts a query reaches through terms (LIB-026, SCH-015; terms.md, "Search"): where its words
 * hold a label or an abbreviation of a term the reader may read, the components whose latest version
 * uses that term or one narrower, three levels at most, by the reference index. At query time, so a
 * renamed or newly related term is found at once; whether the reader may read each component is the
 * search's own predicate.
 */
export async function termReach(
  trx: TenantTransaction,
  readable: ReadableSet,
  query: string,
): Promise<string[]> {
  const words = wordsOf(query);
  if (words === '') return [];
  const latest = (id: string) => sql`(
    select v.content from artifact_version v where v.artifact_id = ${sql.ref(id)}
     order by v.revision_no desc, v.version_no desc limit 1)`;
  const { rows } = await sql<{ id: string }>`
    with recursive matched as (
      select a.id from artifact a
      where a.kind = 'term' and ${notDeletedAs('a')}
        and (((a.space_id = any(${[...readable.spaces]}::uuid[]))
              and not a.id = any(${[...readable.excluded]}::uuid[]))
             or a.id = any(${[...readable.included]}::uuid[]))
        and exists (
          select 1 from jsonb_array_elements(${latest('a.id')} -> 'labels') l
          cross join lateral (
            select l ->> 'preferred'
            union all select jsonb_array_elements_text(l -> 'alternatives')
            union all select l ->> 'abbreviation') f(label)
          where f.label is not null
            and position(' ' || lower(regexp_replace(f.label, '[[:space:]]+', ' ', 'g')) || ' '
                         in ' ' || lower(${words}) || ' ') > 0)
    ),
    reach (id, depth, path) as (
      select id, 0, array[id] from matched
      union all
      select n.id, r.depth + 1, r.path || n.id
        from reach r
        cross join lateral (
          select x::uuid as id from jsonb_array_elements_text(${latest('r.id')} -> 'narrower') x) n
       where r.depth < ${NARROWER_LEVELS} and not n.id = any(r.path)
    )
    select distinct f.from_id::text as id from reference f
     where f.to_kind = 'term' and f.to_id in (select id from reach)`.execute(trx);
  return rows.map((row) => row.id);
}
