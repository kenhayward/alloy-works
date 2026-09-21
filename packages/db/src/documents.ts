import { randomBytes } from 'node:crypto';
import {
  applyOutlineOperation,
  blockIdentifierFrom,
  decide,
  OUTLINE_SCHEMA_VERSION,
  outlineDocumentSchema,
  readOutline,
  walkOutline,
  type OutlineDocument,
  type OutlineNode,
  type OutlineOperation,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadFacts, loadReadableSet } from './access-facts.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  recordVersion,
  type RecordAnswer,
  type StoredVersion,
} from './versions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 128 bits from `node:crypto`, spelled the way a block identifier is: `packages/domain` takes no
 * randomness from anywhere, so the store supplies it (STR-003's "never reused" is decision 3's
 * argument about 128 bits, not a counter's).
 */
const newNodeIdentifier = () => blockIdentifierFrom(randomBytes(16));

export interface NewDocument {
  readonly spaceId: string;
  readonly title: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly author: string;
}

export type CreateDocumentAnswer =
  | { readonly answer: 'created'; readonly version: StoredVersion }
  /** This environment holds no such space. */
  | { readonly answer: 'space.missing' }
  /** The title, language or direction is not one the outline accepts. */
  | { readonly answer: 'content.invalid' };

/**
 * What one structural act answers: the version chain's own answers, or a refusal from the outline -
 * an operation it cannot take, with the operation's fixed reason.
 */
export type OutlineAnswer =
  RecordAnswer | { readonly answer: 'outline.invalid'; readonly reason: string };

/** One document as its page reads it: the latest version, and the one space it lives in. */
export interface StoredDocument {
  readonly id: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly version: StoredVersion;
}

/** One document as a listing shows it: its title and number at the latest version, and its space. */
export interface DocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly space: { readonly id: string; readonly name: string };
  readonly revision: number;
  readonly version: number;
  /** When the latest version was made. */
  readonly changedAt: Date;
  /** The sections and the component references in the latest outline, at every depth. */
  readonly sections: number;
  readonly components: number;
  /** The reader's own view: whether the latest publication they may read is of the latest version. */
  readonly publishing: PublishingState;
}

/**
 * Where a document stands against what has been published of it, as one reader may see it: a
 * publication's readership is its own, so this is said of the publications the reader may read.
 */
export type PublishingState = 'published' | 'changedSince' | 'neverPublished';

/**
 * Creates a document and its version 0.1, an outline holding no nodes (STR-054): a document has a
 * version from the moment it exists, as a component does, and nothing in it is filler - an empty
 * outline is a valid document, not an error.
 *
 * Who may create here is `create` on the space, decided by the caller before this is called and in the
 * same transaction; this refuses a space this environment does not hold before anything else, which is
 * where a caller's identifier for another environment's ends up. The title is trimmed and refused if
 * trimming leaves nothing, and the language and direction are checked against the outline's own
 * schema, the way `createComponent` checks a component's header - so `createArtifact` throwing past
 * this point is a bug, not a caller's mistake.
 */
export async function createDocument(
  trx: TenantTransaction,
  input: NewDocument,
): Promise<CreateDocumentAnswer> {
  // Checked here, rather than left to Postgres, so a malformed id is refused as `space.missing` rather
  // than a raised 22P02.
  if (!UUID.test(input.spaceId)) return { answer: 'space.missing' };
  const space = await trx
    .selectFrom('space')
    .select('id')
    .where('id', '=', input.spaceId)
    .executeTakeFirst();
  if (!space) return { answer: 'space.missing' };

  const title = input.title.trim();
  if (
    !outlineDocumentSchema.shape.title.safeParse(title).success ||
    !outlineDocumentSchema.shape.language.safeParse(input.language).success ||
    !outlineDocumentSchema.shape.direction.safeParse(input.direction).success
  ) {
    return { answer: 'content.invalid' };
  }

  const content: OutlineDocument = {
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title,
    language: input.language,
    direction: input.direction,
    nodes: [],
  };
  const version = await createArtifact(trx, {
    author: input.author,
    spaceId: input.spaceId,
    substance: { kind: 'document', content },
  });
  return { answer: 'created', version };
}

/**
 * A document at its latest version, with its space. Undefined when this environment holds no such
 * artifact, or holds one that is not a document: `authorise` never looks at an artifact's kind, so
 * this is where a component's id on a document's route is turned away.
 */
export async function readDocument(
  trx: TenantTransaction,
  id: string,
): Promise<StoredDocument | undefined> {
  const version = await latestVersion(trx, id);
  if (!version || version.kind !== 'document') return undefined;
  const space = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .select(['s.id', 's.name'])
    .where('a.id', '=', id)
    .executeTakeFirstOrThrow();
  return { id, space, version };
}

/**
 * The documents a principal may read, filtered by the readable set inside the query (access.md, "The
 * readable set"), the predicate `listReadableComponents` uses. Not paged: the listing is small in
 * this slice, and paging it is left undone rather than half-built. Undefined when the tenant holds no
 * such principal.
 */
export async function listReadableDocuments(
  trx: TenantTransaction,
  principalId: string,
): Promise<{ readonly items: readonly DocumentSummary[] } | undefined> {
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;

  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('artifact_version as v')
          .select([
            'v.id as version_id',
            'v.revision_no',
            'v.version_no',
            'v.created_at',
            sql<string>`v.content ->> 'title'`.as('title'),
            // Every node's type, at any depth: the outline holds nothing else with one.
            sql<number>`jsonb_array_length(jsonb_path_query_array(v.content, 'strict $.**.type ? (@ == "section")'))`.as(
              'sections',
            ),
            sql<number>`jsonb_array_length(jsonb_path_query_array(v.content, 'strict $.**.type ? (@ == "reference")'))`.as(
              'components',
            ),
          ])
          .whereRef('v.artifact_id', '=', 'a.id')
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .select(['a.id', 's.id as space_id', 's.name as space_name', 'latest.title'])
    .select(['latest.revision_no', 'latest.version_no', 'latest.version_id', 'latest.created_at'])
    .select(['latest.sections', 'latest.components'])
    .where('a.kind', '=', 'document')
    .where((eb) => readableArtifacts(eb, readable))
    .orderBy('a.id')
    .execute();

  // The latest publication the reader may read of each, by the one readable-set predicate: which
  // version it was made from is all the state needs.
  const published =
    rows.length === 0
      ? []
      : await trx
          .selectFrom('publication as p')
          .innerJoin('artifact as a', 'a.id', 'p.id')
          .select(['p.document_id', 'p.document_version_id'])
          .where(
            'p.document_id',
            'in',
            rows.map((row) => row.id),
          )
          .where((eb) => readableArtifacts(eb, readable))
          .orderBy('p.published_at', 'desc')
          .orderBy('a.created_at', 'desc')
          .execute();
  const latestPublished = new Map<string, string>();
  for (const row of published) {
    if (!latestPublished.has(row.document_id)) {
      latestPublished.set(row.document_id, row.document_version_id);
    }
  }

  return {
    items: rows.map((row) => {
      const from = latestPublished.get(row.id);
      return {
        id: row.id,
        title: row.title,
        space: { id: row.space_id, name: row.space_name },
        revision: row.revision_no,
        version: row.version_no,
        changedAt: row.created_at,
        sections: Number(row.sections),
        components: Number(row.components),
        publishing:
          from === undefined
            ? 'neverPublished'
            : from === row.version_id
              ? 'published'
              : 'changedSince',
      };
    }),
  };
}

/**
 * Which of these components the principal may read, for the view a reader is shown of an outline
 * (structure.md, "Who is shown what"): a reference to any other has its component withheld. Filtered
 * by the one readable-set predicate every listing uses (`readableArtifacts`), inside the query, so it
 * cannot disagree with what `GET /v1/components` lists. An id that is not a component in this
 * environment - another environment's, a document's, none at all - is never in the answer. Empty when
 * the tenant holds no such principal.
 */
export async function readableComponents(
  trx: TenantTransaction,
  principalId: string,
  components: readonly string[],
): Promise<ReadonlySet<string>> {
  const asked = [...new Set(components)].filter((id) => UUID.test(id));
  if (asked.length === 0) return new Set();
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return new Set();
  const rows = await trx
    .selectFrom('artifact as a')
    .select('a.id')
    .where('a.id', 'in', asked)
    .where('a.kind', '=', 'component')
    .where((eb) => readableArtifacts(eb, readable))
    .execute();
  return new Set(rows.map((row) => row.id));
}

/**
 * The one answer every refused reference target gets, whatever was wrong with it: no such artifact,
 * another environment's, a definition, a document - this one included - a component the author may
 * not read, or a pinned version of some other artifact. One sentence, so the refusal cannot be used to
 * learn whether an identifier exists (access.md: a thing you may not read is indistinguishable from
 * one that does not exist).
 */
const REFERENCE_REFUSED = 'The component is not one this outline can reference';

/**
 * What an operation would have the outline point at: an inserted reference's component and pinned
 * version, or the component of the reference a `set` pins. Undefined when it points at nothing new -
 * and for a `set` whose node is missing or is a section, which the operation refuses on its own.
 */
function targetOf(
  outline: OutlineDocument,
  operation: OutlineOperation,
): { readonly component: string; readonly version: string | null } | undefined {
  if (operation.operation === 'insert' && operation.node.type === 'reference') {
    const { component, mode } = operation.node;
    return { component, version: mode.kind === 'pinned' ? mode.version : null };
  }
  if (operation.operation === 'set' && operation.mode?.kind === 'pinned') {
    let node: OutlineNode | undefined;
    walkOutline(outline.nodes, (each) => {
      if (each.id === operation.node) node = each;
    });
    if (node?.type !== 'reference') return undefined;
    return { component: node.component, version: operation.mode.version };
  }
  return undefined;
}

/**
 * Whether the author may point an outline at this target: a **component**, in this environment, that
 * the author may **read**, decided by the same facts and the same `decide` every route uses; and a
 * pinned version that **belongs to that component**. A document references components alone in T1,
 * so its own id - the only way a cycle could close (structure.md) - is refused with the rest.
 */
async function mayReference(
  trx: TenantTransaction,
  author: string,
  target: { readonly component: string; readonly version: string | null },
): Promise<boolean> {
  if (!UUID.test(target.component)) return false;
  const artifact = await trx
    .selectFrom('artifact')
    .select('kind')
    .where('id', '=', target.component)
    .executeTakeFirst();
  if (artifact?.kind !== 'component') return false;
  const facts = await loadFacts(trx, author, { kind: 'artifact', id: target.component });
  if (!facts || !decide('read', facts).allowed) return false;
  if (target.version === null) return true;
  const version = await readVersion(trx, target.version);
  return version?.artifactId === target.component;
}

/**
 * One structural act, and one version (structure.md, "Editing the outline"). There is no document
 * lock and there cannot be one: `component_lock`'s check constraint refuses a document at the
 * database (COL-N02).
 *
 * The operation is applied to the version the caller **opened from**, never to the latest, so the
 * store never rebases one person's act onto another's; `recordVersion` then takes the advisory lock,
 * finds the latest and answers `version.precondition` with it when somebody moved first. An act that
 * changes nothing - a node put back where it was - is answered `version.unchanged` by the same digest
 * comparison, and the chain keeps no row for it (decision K).
 */
export async function editOutline(
  trx: TenantTransaction,
  input: {
    readonly artifactId: string;
    readonly openedFrom: string;
    readonly author: string;
    readonly operation: OutlineOperation;
  },
): Promise<OutlineAnswer> {
  const opened = await readVersion(trx, input.openedFrom);
  if (!opened || opened.artifactId !== input.artifactId || opened.kind !== 'document') {
    return { answer: 'artifact.missing' };
  }
  const read = readOutline(opened.content, { artifact: input.artifactId, version: opened.id });
  // A stored outline that does not read is a broken store, not the caller's mistake: thrown, as
  // `currentDefinition` throws on a definition that does not read, so the service logs it and answers
  // a 500. The failure names internal shapes, and a thrown error never reaches the wire.
  if (!read.ok) {
    throw new Error(
      `The document ${input.artifactId} at ${opened.id} does not read: ${read.failure}`,
    );
  }
  // Checked before the operation is applied, in this transaction, so what is recorded points only
  // at what the author may read: nothing is stored that a later rule would have to refuse.
  const target = targetOf(read.outline, input.operation);
  if (target && !(await mayReference(trx, input.author, target))) {
    return { answer: 'outline.invalid', reason: REFERENCE_REFUSED };
  }
  const applied = applyOutlineOperation(read.outline, input.operation, newNodeIdentifier);
  if (!applied.applied) return { answer: 'outline.invalid', reason: applied.reason };
  return recordVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: input.openedFrom,
    author: input.author,
    substance: { kind: 'document', content: applied.outline },
  });
}
