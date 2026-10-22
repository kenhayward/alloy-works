import {
  parseTerm,
  termPlaces,
  termSpans,
  termWarnings,
  walkOutline,
  type ContentDocument,
  type OutlineDocument,
  type PublishingTerm,
  type TermWarning,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { deletionStored, notDeletedAs } from './deletion.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import { latestRevisionsOf, workflowStates } from './workflow.js';

/**
 * **The terms a publish reads** (terms.md, "Printing"; the TM plan, TMb, TM-C, TM-F, TM-G): each use's
 * term at its latest approved revision, decided as the publisher, in the space of the component using
 * it - a section's title, the document's. Recorded and pinned as an entry is (0147, 0154); what the
 * uses report is recorded on the request.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Each node's terms, by term: what `assemble` prints from. */
export type NodeTerms = ReadonlyMap<string, ReadonlyMap<string, PublishingTerm>>;

/** One use, by the node it stands at and the artifact whose space it is read in. */
interface Use {
  readonly node: string;
  readonly owner: string;
  readonly term: string;
}

/** Every use in the occurrences and in the outline's section titles, a title's in the document. */
export function usesIn(
  occurrences: readonly {
    readonly node: string;
    readonly component: string;
    readonly content: ContentDocument;
  }[],
  outline: OutlineDocument,
  document: string,
): Use[] {
  const uses: Use[] = occurrences.flatMap(({ node, component, content }) =>
    termPlaces(content).map((span) => ({ node, owner: component, term: span.term })),
  );
  walkOutline(outline.nodes, (node) => {
    if (node.type !== 'section') return;
    for (const span of termSpans(node.title)) {
      uses.push({ node: node.id, owner: document, term: span.term });
    }
  });
  return uses;
}

/** Each artifact's space. */
async function spacesOf(
  trx: TenantTransaction,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom('artifact')
    .select(['id', 'space_id'])
    .where('id', 'in', [...new Set(ids)])
    .execute();
  return new Map(rows.map((row) => [row.id, row.space_id]));
}

/** The terms of these a principal may read, not deleted, each with its space. */
export async function readableTerms(
  trx: TenantTransaction,
  principal: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const wanted = [...new Set(ids)].filter((id) => UUID.test(id));
  if (wanted.length === 0) return new Map();
  const readable = await loadReadableSet(trx, principal);
  if (!readable) return new Map();
  const deletion = (await deletionStored(trx)) ? sql`and ${notDeletedAs('a')}` : sql``;
  const { rows } = await sql<{ id: string }>`
    select a.id from artifact a
     where a.kind = 'term' and a.id = any(${wanted}::uuid[]) ${deletion}`.execute(trx);
  if (rows.length === 0) return new Map();
  const read = await trx
    .selectFrom('artifact as a')
    .select(['a.id', 'a.space_id'])
    .where(
      'a.id',
      'in',
      rows.map((row) => row.id),
    )
    .where((eb) => readableArtifacts(eb, readable))
    .execute();
  return new Map(read.map((row) => [row.id, row.space_id!]));
}

/**
 * Each use offered its term where the term stands in the space of the artifact the use is read in,
 * from these versions by term, with each term's standing now.
 */
async function offered(
  trx: TenantTransaction,
  uses: readonly Use[],
  versions: ReadonlyMap<string, { readonly space: string; readonly content: unknown }>,
): Promise<{ readonly byNode: NodeTerms; readonly read: ReadonlySet<string> }> {
  const spaces = await spacesOf(
    trx,
    uses.map((use) => use.owner),
  );
  const states = await workflowStates(trx, [...versions.keys()]);
  const parsed = new Map<string, PublishingTerm>();
  const byNode = new Map<string, Map<string, PublishingTerm>>();
  const read = new Set<string>();
  for (const { node, owner, term } of uses) {
    const version = versions.get(term);
    if (version === undefined || version.space !== spaces.get(owner)) continue;
    if (!parsed.has(term)) {
      parsed.set(term, {
        term: parseTerm(version.content),
        deprecated: states.get(term)?.key === 'deprecated',
      });
    }
    if (!byNode.has(node)) byNode.set(node, new Map());
    byNode.get(node)!.set(term, parsed.get(term)!);
    read.add(term);
  }
  return { byNode, read };
}

/** Each version's content by its id. */
async function contents(
  trx: TenantTransaction,
  versions: readonly string[],
): Promise<ReadonlyMap<string, unknown>> {
  if (versions.length === 0) return new Map();
  const rows = await trx
    .selectFrom('artifact_version')
    .select(['id', 'content'])
    .where('id', 'in', [...new Set(versions)])
    .execute();
  return new Map(rows.map((row) => [row.id, row.content]));
}

/**
 * The terms a publish of the latest reads, decided as the publisher: each one's latest approved
 * revision, recorded; one draft, unreadable, missing or of another space is recorded as nothing and
 * prints its words. And what the uses report (LIB-018, LIB-050).
 */
export async function resolveTerms(
  trx: TenantTransaction,
  uses: readonly Use[],
  principal: string,
  language: string,
): Promise<{
  readonly terms: readonly { readonly version: string; readonly term: string }[];
  readonly warnings: readonly TermWarning[];
}> {
  const readable = await readableTerms(
    trx,
    principal,
    uses.map((use) => use.term),
  );
  // The caller passes only those its reader may read, as `latestRevisionsOf` asks.
  const revisions = await latestRevisionsOf(trx, [...readable.keys()]);
  const read = await contents(
    trx,
    [...revisions.values()].map((each) => each.versionId),
  );
  const versions = new Map(
    [...revisions].map(([term, revision]) => [
      term,
      {
        version: revision.versionId,
        space: readable.get(term)!,
        content: read.get(revision.versionId),
      },
    ]),
  );
  const { byNode, read: kept } = await offered(trx, uses, versions);
  return {
    terms: [...kept].map((term) => ({ term, version: versions.get(term)!.version })),
    warnings: termWarnings(uses, byNode, language),
  };
}

/** A use's key in a hidden set: by node and term, as a term may resolve at one node and not another. */
export const useKey = (use: { readonly node: string; readonly term: string }): string =>
  `${use.node} ${use.term}`;

/**
 * The uses a request's `term_unresolved` warnings hid, by `useKey`: a term's uses in its own space
 * where it was unresolved at more uses than stand in other spaces, which are never offered it. A term
 * resolved at one node is not hidden there for another's being of another space.
 */
export async function hiddenUses(
  trx: TenantTransaction,
  uses: readonly Use[],
  warnings: readonly TermWarning[],
): Promise<ReadonlySet<string>> {
  const unresolved = new Map(
    warnings.flatMap((each) =>
      each.code === 'term_unresolved' ? [[each.term, each.count] as const] : [],
    ),
  );
  if (unresolved.size === 0) return new Set();
  const spaces = await spacesOf(trx, [...unresolved.keys(), ...uses.map((use) => use.owner)]);
  const hidden = new Set<string>();
  for (const [term, count] of unresolved) {
    const own = uses.filter(
      (use) => use.term === term && spaces.get(use.owner) === spaces.get(term),
    );
    const elsewhere = uses.filter((use) => use.term === term).length - own.length;
    if (count > elsewhere) for (const use of own) hidden.add(useKey(use));
  }
  return hidden;
}

/**
 * The terms recorded on a request or pinned by a baseline, by node: each version offered to the uses
 * in its space, but for the uses `hidden` keys (`useKey`), whose term the reader may not read; a term
 * hidden at every use is never read.
 */
export async function recordedTerms(
  trx: TenantTransaction,
  uses: readonly Use[],
  recorded: readonly { readonly term: string; readonly version: string }[],
  hidden: ReadonlySet<string> = new Set(),
): Promise<NodeTerms> {
  const offeredUses = uses.filter((use) => !hidden.has(useKey(use)));
  const shown = recorded.filter((each) => offeredUses.some((use) => use.term === each.term));
  const spaces = await spacesOf(
    trx,
    shown.map((each) => each.term),
  );
  const read = await contents(
    trx,
    shown.map((each) => each.version),
  );
  const versions = new Map(
    shown.map((each) => [
      each.term,
      { space: spaces.get(each.term) ?? '', content: read.get(each.version) },
    ]),
  );
  return (await offered(trx, offeredUses, versions)).byNode;
}
