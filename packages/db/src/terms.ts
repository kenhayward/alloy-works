import {
  decide,
  parseTerm,
  TERM_SCHEMA_VERSION,
  TermRefused,
  type Term,
  type TermLabel,
  type TermProblem,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFactsFor, loadReadableSet } from './access-facts.js';
import { actOn, archivedAs, isArchived, notArchivedAs, type ArchivalAnswer } from './archival.js';
import { notDeletedAs } from './deletion.js';
import {
  checkedLimit,
  countOf,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  sortColumns,
  visibleIn,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { readableTerms } from './publication-terms.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import { lockTerms } from './term-lock.js';
import { readableAmong } from './uses.js';
import { createArtifact, latestVersion, recordVersion, type StoredVersion } from './versions.js';
import { workflowStanding, workflowStates } from './workflow.js';

/**
 * Terms (terms.md, "The term"; the TM plan, TM-A): an authored artifact in one space, every change a
 * version on the chain, its standing its workflow's. Who may make or change one is the route's to
 * decide; its shape and relations are checked on every path a version is written by.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What a caller gives for a term: everything but its schema version. */
export type TermInput = Omit<Term, 'schemaVersion'>;

/** A term's standing now: its workflow state (LIB-049). */
export interface TermStanding {
  readonly key: string;
  readonly name: string;
  readonly approved: boolean;
}

/** A term at its latest version. */
export interface StoredTerm {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: StoredVersion;
  readonly term: Term;
  readonly archived: boolean;
  readonly standing: TermStanding | null;
  /** Its state is keyed `deprecated` (TM-A), as every term workflow keeps one. */
  readonly deprecated: boolean;
}

/** One term as a listing shows it. */
export interface TermSummary {
  readonly id: string;
  /** Its preferred label in its base language. */
  readonly label: string;
  readonly abbreviation: string | null;
  readonly term: Term;
  readonly version: { readonly id: string; readonly revision: number; readonly version: number };
  readonly changedAt: Date;
  readonly standing: TermStanding | null;
}

const baseLabel = (term: Term): TermLabel =>
  term.labels.find((each) => each.language === term.base)!;

async function stored(trx: TenantTransaction, version: StoredVersion): Promise<StoredTerm> {
  const space = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['s.id', 's.name'])
    .where('a.id', '=', version.artifactId)
    .executeTakeFirstOrThrow();
  const standing = await workflowStanding(trx, version.artifactId);
  const state = standing === undefined ? null : standing.state;
  return {
    id: version.artifactId,
    space,
    version,
    term: parseTerm(version.content),
    archived: await isArchived(trx, version.artifactId),
    standing: state,
    deprecated: state?.key === 'deprecated',
  };
}

/** A term at its latest version, or undefined where this tenant holds none by that id. */
export async function readTerm(
  trx: TenantTransaction,
  id: string,
): Promise<StoredTerm | undefined> {
  if (!UUID.test(id)) return undefined;
  const version = await latestVersion(trx, id);
  if (!version || version.kind !== 'term') return undefined;
  return stored(trx, version);
}

export type TermAnswer =
  | { readonly answer: 'created' | 'recorded' | 'version.unchanged'; readonly term: StoredTerm }
  | { readonly answer: 'version.precondition'; readonly current: StoredTerm }
  | { readonly answer: 'term.refused'; readonly problems: readonly TermProblem[] }
  | { readonly answer: 'space.missing' }
  | { readonly answer: 'term.missing' };

function refusal(error: unknown): TermAnswer {
  if (error instanceof TermRefused) return { answer: 'term.refused', problems: error.problems };
  throw error;
}

/** A stored term as a caller gives one. */
function inputOf(term: Term): TermInput {
  const input: Partial<Term> = { ...term };
  delete input.schemaVersion;
  return input as TermInput;
}

const contentOf = (input: TermInput): unknown => ({ ...input, schemaVersion: TERM_SCHEMA_VERSION });

/** Makes a term at 0.1 in a space, in its workflow's initial state. */
export async function createTerm(
  trx: TenantTransaction,
  input: { readonly author: string; readonly spaceId: string; readonly term: TermInput },
): Promise<TermAnswer> {
  if (!UUID.test(input.spaceId)) return { answer: 'space.missing' };
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };
  try {
    const version = await createArtifact(trx, {
      spaceId: input.spaceId,
      author: input.author,
      substance: { kind: 'term', content: parseTerm(contentOf(input.term)) },
    });
    return { answer: 'created', term: await stored(trx, version) };
  } catch (error) {
    return refusal(error);
  }
}

/** Cuts a term's next version from the one its author opened. */
export async function recordTermVersion(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly id: string;
    readonly openedFrom: string;
    readonly term: TermInput;
  },
): Promise<TermAnswer> {
  if (!(await readTerm(trx, input.id))) return { answer: 'term.missing' };
  let answer;
  try {
    answer = await recordVersion(trx, {
      artifactId: input.id,
      openedFrom: input.openedFrom,
      author: input.author,
      substance: { kind: 'term', content: parseTerm(contentOf(input.term)) },
    });
  } catch (error) {
    return refusal(error);
  }
  switch (answer.answer) {
    case 'recorded':
      return { answer: 'recorded', term: await stored(trx, answer.version) };
    case 'version.unchanged':
      return { answer: 'version.unchanged', term: await stored(trx, answer.current) };
    case 'version.precondition':
      return { answer: 'version.precondition', current: await stored(trx, answer.current) };
    case 'artifact.missing':
      return { answer: 'term.missing' };
  }
}

/** The base preferred label of the content in `alias`, in SQL: what a listing sorts by. */
const labelOf = (content: string) =>
  sql<string>`(select l ->> 'preferred' from jsonb_array_elements(${sql.ref(content)} -> 'labels') l
                where l ->> 'language' = ${sql.ref(content)} ->> 'base' limit 1)`;

/**
 * The terms of a space a principal may read, a page at a time by keyset over the sort asked for and
 * then the id, as of the snapshot the walk's first page took, each with its standing: archived ones
 * left out, or only they where asked. Undefined when the tenant holds no such principal.
 */
export async function listTerms(
  trx: TenantTransaction,
  principalId: string,
  spaceId: string,
  request: ListingRequest<SortOf<'terms'>> = { limit: 100 },
  filter: { readonly archived?: boolean } = {},
): Promise<(Listed<TermSummary> & { readonly total: number }) | undefined> {
  const limit = checkedLimit(request.limit);
  const sort = request.sort ?? 'label';
  const { types, order: byDefault } = listingSorts.terms[sort];
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const snapshot = await snapshotFor(trx, request.snapshot);
  const base = () =>
    trx
      .selectFrom('artifact as a')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('artifact_version as v')
            .select(['v.id as version_id', 'v.revision_no', 'v.version_no', 'v.created_at'])
            .select('v.content')
            .whereRef('v.artifact_id', '=', 'a.id')
            .where(visibleIn('v.written_by', snapshot))
            .orderBy('v.revision_no', 'desc')
            .orderBy('v.version_no', 'desc')
            .limit(1)
            .as('latest'),
        (join) => join.onTrue(),
      )
      .select(['a.id', 'latest.content'])
      .select(['latest.version_id', 'latest.revision_no', 'latest.version_no', 'latest.created_at'])
      .select(
        sortColumns([
          sort === 'label' ? sql`lower(${labelOf('latest.content')})` : sql`latest.created_at`,
        ]),
      )
      .where('a.kind', '=', 'term')
      .where('a.space_id', '=', spaceId)
      .where((eb) => readableArtifacts(eb, readable))
      .where(filter.archived === true ? archivedAs('a', snapshot) : notArchivedAs('a', snapshot));
  const { rows, next } = await keysetPage<{
    id: string;
    content: unknown;
    version_id: string;
    revision_no: number;
    version_no: number;
    created_at: Date;
  }>(trx, base(), types, request.order ?? byDefault, limit, request.after);
  const states = await workflowStates(
    trx,
    rows.map((row) => row.id),
  );
  return {
    items: rows.map((row) => {
      const term = parseTerm(row.content);
      return {
        id: row.id,
        label: baseLabel(term).preferred,
        abbreviation: baseLabel(term).abbreviation ?? null,
        term,
        version: { id: row.version_id, revision: row.revision_no, version: row.version_no },
        changedAt: new Date(row.created_at),
        standing: states.get(row.id) ?? null,
      };
    }),
    next,
    snapshot,
    total: await countOf(trx, base()),
  };
}

/** A term of a space as an editor shows it: its latest version and its standing. */
export interface TermInSpace {
  readonly term: Term;
  readonly standing: TermStanding | null;
}

/**
 * Those of these terms that are the space's and that a principal may read, not deleted, each at its
 * latest version with its standing (the TM plan, TMc, TM-K): what a save may use, and what its editor
 * flags.
 */
export async function termsInSpace(
  trx: TenantTransaction,
  principal: string,
  spaceId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, TermInSpace>> {
  const ours = [...(await readableTerms(trx, principal, ids))]
    .filter(([, space]) => space === spaceId)
    .map(([id]) => id);
  if (ours.length === 0) return new Map();
  const { rows } = await sql<{ artifact_id: string; content: unknown }>`
    select distinct on (artifact_id) artifact_id, content from artifact_version
     where artifact_id = any(${ours}::uuid[])
     order by artifact_id, revision_no desc, version_no desc`.execute(trx);
  const states = await workflowStates(trx, ours);
  return new Map(
    rows.map((row) => [
      row.artifact_id,
      { term: parseTerm(row.content), standing: states.get(row.artifact_id) ?? null },
    ]),
  );
}

/** The components whose latest version uses a term, named where the reader may read them. */
export interface TermUses {
  readonly named: readonly { readonly id: string; readonly title: string }[];
  readonly unreadable: boolean;
}

/** A use counts while its user is neither deleted nor archived: for the uses list and the guard. */
const inService = (alias: string) => sql`${notDeletedAs(alias)} and ${notArchivedAs(alias)}`;

/**
 * Where a term is used: the components, neither deleted nor archived, whose latest version marks
 * words as it, from the reference index. What `by` may not read is never named, and only whether there is any is said.
 */
export async function termUses(
  trx: TenantTransaction,
  by: string,
  termId: string,
): Promise<TermUses> {
  const readable = await loadReadableSet(trx, by);
  const { rows } = await sql<{ id: string; space_id: string; title: string | null }>`
    select distinct a.id, a.space_id, v.content ->> 'title' as title
      from reference r
      join artifact a on a.id = r.from_id and a.kind = 'component'
      join artifact_version v on v.id = r.from_version
     where r.to_id = ${termId} and r.to_kind = 'term' and ${inService('a')}
     order by title, a.id`.execute(trx);
  const shown = await readableAmong(trx, readable, rows);
  return {
    named: shown.map(({ id, title }) => ({ id, title: title ?? '' })),
    unreadable: shown.length < shown.total,
  };
}

/**
 * Archives a term, refused while the latest version of a component neither deleted nor archived uses
 * it, whoever may read that component (LIB-006), or unarchives one. Undefined for anything but a term. The caller has decided
 * `retire`.
 */
export async function archiveTerm(
  trx: TenantTransaction,
  termId: string,
  by: string,
  act: 'archived' | 'unarchived',
): Promise<ArchivalAnswer | 'used' | undefined> {
  const term = await readTerm(trx, termId);
  if (!term) return undefined;
  if (act === 'archived') {
    // After any version using it that commits first (`indexReferences`).
    await lockTerms(trx, term.space.id);
    const { rows } = await sql<{ used: boolean }>`
      select exists (
        select from reference r join artifact a on a.id = r.from_id
         where r.to_id = ${termId} and r.to_kind = 'term' and ${inService('a')}) as used`.execute(
      trx,
    );
    if (rows[0]?.used === true) return 'used';
  }
  return actOn(trx, termId, by, act, ['term']);
}

/**
 * The terms of a space a principal may read, archived or not but never deleted, for export (LIB-028),
 * in label order, each with its standing.
 */
export async function termsForExport(
  trx: TenantTransaction,
  principalId: string,
  spaceId: string,
): Promise<
  | readonly { readonly id: string; readonly term: Term; readonly standing: string | null }[]
  | undefined
> {
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('artifact_version as v')
          .select('v.content')
          .whereRef('v.artifact_id', '=', 'a.id')
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .select(['a.id', 'latest.content'])
    .where('a.kind', '=', 'term')
    .where('a.space_id', '=', spaceId)
    .where((eb) => readableArtifacts(eb, readable))
    .where(notDeletedAs('a'))
    .orderBy(sql`lower(${labelOf('latest.content')})`)
    .orderBy('a.id')
    .execute();
  const states = await workflowStates(
    trx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    term: parseTerm(row.content),
    standing: states.get(row.id)?.key ?? null,
  }));
}

/**
 * One concept to import: its term without relations, and its relations by the identities the file
 * gives, which are resolved to terms once every concept is made or matched.
 */
export interface ImportConcept {
  readonly key: string;
  readonly term: Pick<TermInput, 'base' | 'labels' | 'definition'>;
  readonly broader: readonly string[];
  readonly narrower: readonly string[];
  readonly related: readonly string[];
  readonly replacedBy?: string;
}

/** What import did with one concept (LIB-028, LIB-029). */
export type ImportedTerm =
  | { readonly key: string; readonly outcome: 'created'; readonly term: StoredTerm }
  | {
      readonly key: string;
      readonly outcome: 'merged';
      readonly term: StoredTerm;
      /** What the match lacked and was given, by path; none where it lacked nothing. */
      readonly merged: readonly string[];
    }
  | {
      readonly key: string;
      readonly outcome: 'refused';
      readonly term?: undefined;
      readonly message: string;
    };

/** `a` with what `b` holds that it lacks: labels and definitions by language, and alternatives. */
function mergeTerm(a: TermInput, b: ImportConcept['term']): { term: TermInput; merged: string[] } {
  const merged: string[] = [];
  const labels = a.labels.map((label) => {
    const other = b.labels.find((each) => each.language === label.language);
    if (other === undefined) return label;
    const alternatives = [
      ...label.alternatives,
      // Case aside, as a match is found.
      ...[other.preferred, ...other.alternatives].filter(
        (each) =>
          ![label.preferred, ...label.alternatives].some(
            (held) => held.toLowerCase() === each.toLowerCase(),
          ),
      ),
    ];
    if (alternatives.length > label.alternatives.length) {
      merged.push(`labels.${label.language}.alternatives`);
    }
    const abbreviation = label.abbreviation ?? other.abbreviation;
    if (label.abbreviation === undefined && other.abbreviation !== undefined) {
      merged.push(`labels.${label.language}.abbreviation`);
    }
    return { ...label, alternatives, ...(abbreviation === undefined ? {} : { abbreviation }) };
  });
  for (const label of b.labels) {
    if (!labels.some((each) => each.language === label.language)) {
      labels.push(label);
      merged.push(`labels.${label.language}`);
    }
  }
  const definition = [...a.definition];
  for (const each of b.definition) {
    if (!definition.some((held) => held.language === each.language)) {
      definition.push(each);
      merged.push(`definition.${each.language}`);
    }
  }
  return { term: { ...a, labels, definition }, merged };
}

/** The most concepts one import takes (the TM plan, TM-J). */
export const IMPORT_CONCEPTS_MOST = 2000;

/**
 * Imports concepts as terms of a space (LIB-028): each matched to a term of the space by its preferred
 * label in its base language, case aside, and merged into it, else made; then each given its
 * relations, resolved by the file's identities, in a second version where it has any. A relation to
 * an identity no concept of the file has is the caller's to report (LIB-029) and is left out here.
 * Undefined where there is no such space.
 */
export async function importTerms(
  trx: TenantTransaction,
  input: {
    readonly author: string;
    readonly spaceId: string;
    readonly concepts: readonly ImportConcept[];
  },
): Promise<ImportedTerm[] | undefined> {
  if (!UUID.test(input.spaceId)) return undefined;
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return undefined;
  // Before any term's own lock (`lockTerms`).
  await lockTerms(trx, input.spaceId);
  if (input.concepts.length > IMPORT_CONCEPTS_MOST) {
    throw new Error(`An import holds at most ${IMPORT_CONCEPTS_MOST} concepts`);
  }
  // Matched and merged only among the terms the importer may read, and merged only where they may
  // edit; a match they may not edit is refused without naming it.
  const readable = await loadReadableSet(trx, input.author);
  if (!readable) return undefined;
  const done: ImportedTerm[] = [];
  const idOf = new Map<string, string>();
  for (const concept of input.concepts) {
    const label = concept.term.labels.find((each) => each.language === concept.term.base);
    const { rows: found } = await sql<{ id: string }>`
      select a.id from artifact a
       cross join lateral (
         select v.content from artifact_version v where v.artifact_id = a.id
          order by v.revision_no desc, v.version_no desc limit 1) latest
       where a.kind = 'term' and a.space_id = ${input.spaceId} and ${notDeletedAs('a')}
         and (((a.space_id = any(${[...readable.spaces]}::uuid[]))
               and not a.id = any(${[...readable.excluded]}::uuid[]))
              or a.id = any(${[...readable.included]}::uuid[]))
         and latest.content ->> 'base' = ${concept.term.base}
         and lower(${labelOf('latest.content')}) = lower(${label?.preferred ?? ''})
       order by a.id limit 1`.execute(trx);
    const match = found[0] === undefined ? undefined : await readTerm(trx, found[0].id);
    const answer =
      match === undefined
        ? await createTerm(trx, {
            author: input.author,
            spaceId: input.spaceId,
            term: { ...concept.term, broader: [], narrower: [], related: [] },
          })
        : undefined;
    if (match !== undefined) {
      const facts = (await loadFactsFor(trx, input.author, [match.id])).get(match.id);
      if (facts === undefined || !decide('edit', facts).allowed) {
        done.push({
          key: concept.key,
          outcome: 'refused',
          message: 'A term of the space has this label, and you may not edit it',
        });
        continue;
      }
      const held = inputOf(match.term);
      const { term, merged } = mergeTerm(held, concept.term);
      const recorded =
        merged.length === 0
          ? undefined
          : await recordTermVersion(trx, {
              author: input.author,
              id: match.id,
              openedFrom: match.version.id,
              term,
            });
      if (recorded !== undefined && recorded.answer !== 'recorded') {
        done.push({ key: concept.key, outcome: 'refused', message: refusedBecause(recorded) });
        continue;
      }
      idOf.set(concept.key, match.id);
      done.push({
        key: concept.key,
        outcome: 'merged',
        term: recorded?.term ?? match,
        merged,
      });
    } else if (answer?.answer === 'created') {
      idOf.set(concept.key, answer.term.id);
      done.push({ key: concept.key, outcome: 'created', term: answer.term });
    } else {
      done.push({ key: concept.key, outcome: 'refused', message: refusedBecause(answer!) });
    }
  }
  // Relations once every concept is a term: those the file states, added to those held.
  for (const [index, concept] of input.concepts.entries()) {
    const at = done[index]!;
    if (at.outcome === 'refused') continue;
    const ids = (keys: readonly string[]) =>
      keys.flatMap((key) => (idOf.has(key) ? [idOf.get(key)!] : []));
    const current = (await readTerm(trx, at.term.id))!;
    const held = inputOf(current.term);
    const union = (list: 'broader' | 'narrower' | 'related') => [
      ...new Set([...held[list], ...ids(concept[list])]),
    ];
    // A held replacement is kept; one is named only where none is held and it resolved.
    const replacedBy =
      held.replacedBy ??
      (concept.replacedBy === undefined ? undefined : idOf.get(concept.replacedBy));
    const term: TermInput = {
      ...held,
      broader: union('broader'),
      narrower: union('narrower'),
      related: union('related'),
      ...(replacedBy === undefined ? {} : { replacedBy }),
    };
    const added = (['broader', 'narrower', 'related'] as const).filter(
      (list) => term[list].length > held[list].length,
    );
    if (added.length === 0 && term.replacedBy === held.replacedBy) continue;
    const recorded = await recordTermVersion(trx, {
      author: input.author,
      id: current.id,
      openedFrom: current.version.id,
      term,
    });
    if (recorded.answer !== 'recorded') {
      done[index] = { key: concept.key, outcome: 'refused', message: refusedBecause(recorded) };
      continue;
    }
    done[index] =
      at.outcome === 'merged'
        ? { ...at, term: recorded.term, merged: [...at.merged, ...added] }
        : { ...at, term: recorded.term };
  }
  return done;
}

const refusedBecause = (answer: TermAnswer): string =>
  answer.answer === 'term.refused'
    ? answer.problems.map((each) => `${each.path}: ${each.message}`).join('; ')
    : `The term could not be recorded (${answer.answer})`;
