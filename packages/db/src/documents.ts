import { randomBytes } from 'node:crypto';
import {
  applyOutlineOperation,
  blockIdentifierFrom,
  OUTLINE_SCHEMA_VERSION,
  outlineDocumentSchema,
  readOutline,
  type OutlineDocument,
  type OutlineOperation,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
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

/** Refused when the version opened from does not read. Fixed, so no parse failure reaches a caller. */
const UNREADABLE_OUTLINE = 'The version this was opened from does not read as an outline';

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
}

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
  const none = ['00000000-0000-0000-0000-000000000000'];
  const listed = <T extends string>(ids: readonly T[]) => (ids.length > 0 ? [...ids] : none);

  const rows = await trx
    .selectFrom('artifact as a')
    .innerJoin('space as s', 's.id', 'a.space_id')
    .innerJoinLateral(
      (eb) =>
        eb
          .selectFrom('artifact_version as v')
          .select(['v.revision_no', 'v.version_no', sql<string>`v.content ->> 'title'`.as('title')])
          .whereRef('v.artifact_id', '=', 'a.id')
          .orderBy('v.revision_no', 'desc')
          .orderBy('v.version_no', 'desc')
          .limit(1)
          .as('latest'),
      (join) => join.onTrue(),
    )
    .select(['a.id', 's.id as space_id', 's.name as space_name', 'latest.title'])
    .select(['latest.revision_no', 'latest.version_no'])
    .where('a.kind', '=', 'document')
    // access.md's third disjunct, "space_id is null and tenant", is left out as it is for components:
    // `artifact_space_by_kind` (0016) requires a document to carry a non-null `space_id` too.
    .where((eb) =>
      eb.or([
        eb.and([
          eb('a.space_id', 'in', listed(readable.spaces)),
          eb('a.id', 'not in', listed(readable.excluded)),
        ]),
        eb('a.id', 'in', listed(readable.included)),
      ]),
    )
    .orderBy('a.id')
    .execute();

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      space: { id: row.space_id, name: row.space_name },
      revision: row.revision_no,
      version: row.version_no,
    })),
  };
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
  // A stored outline that does not read is a broken store, and its parse failure names internal
  // shapes: refused with a fixed reason, as `applyOutlineOperation` refuses, never with the failure.
  if (!read.ok) return { answer: 'outline.invalid', reason: UNREADABLE_OUTLINE };
  const applied = applyOutlineOperation(read.outline, input.operation, newNodeIdentifier);
  if (!applied.applied) return { answer: 'outline.invalid', reason: applied.reason };
  return recordVersion(trx, {
    artifactId: input.artifactId,
    openedFrom: input.openedFrom,
    author: input.author,
    substance: { kind: 'document', content: applied.outline },
  });
}
