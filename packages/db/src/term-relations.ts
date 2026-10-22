import { TermRefused, type Term, type TermProblem } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { notDeletedAs } from './deletion.js';
import { mayReadArtifact } from './queryDefinitions.js';
import { lockTerms } from './term-lock.js';
import type { TenantTransaction } from './tables.js';

/** The longest chain of replacements from a term (the TM plan, TM-A). */
export const MOST_REPLACEMENTS = 5;

/**
 * Every term a version names is a term of its space its author may read, not deleted and not itself,
 * one withheld refused as one that is not there; a replacement's chain
 * is at most five long and never returns to it (TM-A). Called on every path a term version is written
 * by, under its space's terms lock so two saves never close a cycle between them. Throws `TermRefused`.
 */
export async function checkTermRelations(
  trx: TenantTransaction,
  spaceId: string | undefined,
  self: string | undefined,
  term: Term,
  /** Its author; none for a version the system writes, which reads every term. */
  author: string | null,
): Promise<void> {
  const space =
    spaceId ??
    (
      await trx
        .selectFrom('artifact')
        .select('space_id')
        .where('id', '=', self!)
        .executeTakeFirstOrThrow()
    ).space_id!;
  await lockTerms(trx, space);
  const named = [
    ...(['broader', 'narrower', 'related'] as const).flatMap((list) =>
      term[list].map((id, at) => ({ id, path: `${list}.${at}` })),
    ),
    ...(term.replacedBy === undefined ? [] : [{ id: term.replacedBy, path: 'replacedBy' }]),
  ];
  if (named.length === 0) return;
  const { rows } = await sql<{ id: string; replaced_by: string | null }>`
    select a.id, latest.content ->> 'replacedBy' as replaced_by
      from artifact a
      cross join lateral (
        select v.content from artifact_version v where v.artifact_id = a.id
         order by v.revision_no desc, v.version_no desc limit 1) latest
     where a.kind = 'term' and a.space_id = ${space}
       and a.id = any(${[...new Set(named.map((each) => each.id))]}::uuid[])
       and ${notDeletedAs('a')}`.execute(trx);
  const readable = author === null ? undefined : await loadReadableSet(trx, author);
  const held = new Set(
    rows
      .filter(
        (row) =>
          author === null ||
          (readable !== undefined && mayReadArtifact(readable, { id: row.id, spaceId: space })),
      )
      .map((row) => row.id),
  );
  const problems: TermProblem[] = named.flatMap(({ id, path }): TermProblem[] =>
    id === self
      ? [{ rule: 'term_invalid', path, message: 'A term does not name itself' }]
      : held.has(id)
        ? []
        : [{ rule: 'term_invalid', path, message: 'This names no term of the space' }],
  );
  if (problems.length === 0 && term.replacedBy !== undefined) {
    const problem = await replacementProblem(trx, space, self, term.replacedBy);
    if (problem) problems.push({ rule: 'term_invalid', path: 'replacedBy', message: problem });
  }
  if (problems.length > 0) throw new TermRefused(problems);
}

/**
 * Why a replacement's chain is refused, or nothing: it returns to the term, or the longest chain
 * through it, those replaced by it counted, runs past five.
 */
async function replacementProblem(
  trx: TenantTransaction,
  space: string,
  self: string | undefined,
  first: string,
): Promise<string | undefined> {
  const { rows } = await sql<{ id: string; depth: number }>`
    with recursive chain (id, depth, path) as (
      select ${first}::uuid, 1, array[${first}::uuid]
      union all
      select next.id, chain.depth + 1, chain.path || next.id
        from chain
        cross join lateral (
          select (v.content ->> 'replacedBy')::uuid as id from artifact_version v
           where v.artifact_id = chain.id
           order by v.revision_no desc, v.version_no desc limit 1) next
       where next.id is not null and not next.id = any(chain.path)
         and chain.depth <= ${MOST_REPLACEMENTS}
    )
    select id::text, depth from chain order by depth`.execute(trx);
  if (self !== undefined && rows.some((row) => row.id === self)) {
    return 'The replacement is replaced, in turn, by this term';
  }
  if (
    rows.length + (self === undefined ? 0 : await inbound(trx, space, self)) >
    MOST_REPLACEMENTS
  ) {
    return `A chain of replacements is at most ${MOST_REPLACEMENTS} long`;
  }
  return undefined;
}

/** The longest chain of the space's terms replaced, in turn, by this one: its replacements in. */
async function inbound(trx: TenantTransaction, space: string, self: string): Promise<number> {
  const { rows } = await sql<{ depth: number }>`
    with recursive latest as (
      select a.id, (select (v.content ->> 'replacedBy')::uuid from artifact_version v
                     where v.artifact_id = a.id
                     order by v.revision_no desc, v.version_no desc limit 1) as replaced_by
        from artifact a where a.kind = 'term' and a.space_id = ${space}
    ),
    chain (id, depth, path) as (
      select ${self}::uuid, 0, array[${self}::uuid]
      union all
      select l.id, chain.depth + 1, chain.path || l.id
        from chain join latest l on l.replaced_by = chain.id
       where not l.id = any(chain.path) and chain.depth <= ${MOST_REPLACEMENTS}
    )
    select max(depth)::int as depth from chain`.execute(trx);
  return rows[0]?.depth ?? 0;
}
