import {
  componentTypeDefinitionSchema,
  componentTypeOf,
  definitionKinds,
  fieldDefinitionSchema,
  metadataSchemaDefinitionSchema,
  parseContentDocument,
  parseAssetVersion,
  parseLayout,
  templateDefinitionSchema,
  parseOutlineDocument,
  type CatalogueSubstance,
  type DefinitionRef,
  type DefinitionSubstance,
  type MetadataValues,
  type NotCarried,
  type ThemeSubstance,
  type VersionSubstance,
  nameKey,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import type { ArtifactKind } from './artifact-kind.js';
import { checkedLimit } from './listing.js';
import { indexVersion } from './search.js';
import type { TenantTransaction } from './tables.js';
import { versionDigests } from './version-digest.js';

/** A version as the chain holds it. `content` is exactly what was written, never migrated. */
/**
 * A version by its heading alone - which it is, its number, who cut it, when, and its note - and none
 * of what it holds: what a refusal may name when the content names things its reader may not read.
 */
export type VersionHeading = Pick<
  StoredVersion,
  'id' | 'revision' | 'version' | 'author' | 'createdAt' | 'note'
>;

/** A version's heading, and nothing of what it holds. */
export function headingOf(version: StoredVersion): VersionHeading {
  const { id, revision, version: number, author, createdAt, note } = version;
  return { id, revision, version: number, author, createdAt, note };
}

export interface StoredVersion {
  readonly id: string;
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  /** `revision.version`, as VER-009 presents it. Zero until a revision is designated. */
  readonly revision: number;
  readonly version: number;
  /** The principal who cut it, or null for a definition the environment itself started with. */
  readonly author: string | null;
  readonly createdAt: Date;
  readonly note: string | null;
  readonly schemaVersion: number;
  readonly content: unknown;
  readonly contentHash: string;
  readonly values: MetadataValues;
  readonly notCarried: readonly NotCarried[];
  /** The component type's version, for a component; null for anything else. */
  readonly componentType: string | null;
  /** Sorted by kind, identifier and version, as the version digest serialises them. */
  readonly definitions: readonly DefinitionRef[];
  readonly versionDigest: string;
}

/** Who cut a version and why. Outside both digests (ADR-0024). */
export interface Authorship {
  readonly author: string;
  readonly note?: string;
}

export type NewArtifact = Authorship &
  (
    | {
        readonly substance: Extract<
          VersionSubstance,
          { kind: 'component' | 'document' | 'asset' | 'template' }
        >;
        readonly spaceId: string;
      }
    | {
        readonly substance: Exclude<
          VersionSubstance,
          { kind: 'component' | 'document' | 'asset' | 'template' }
        >;
      }
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The kinds recorded only by a writer of their own, which reads a version whole before it is written:
 * a theme's contrast is decided against the catalogues it names, and a catalogue's identifiers against
 * every earlier version of it (themes 1, ruling R4). Neither is a question `prepare` can answer from the
 * substance alone, so neither general writer takes them.
 */
const ownWriters = { theme: 'addThemeVersion', catalogue: 'addCatalogueVersion' } as const;

/** A field, metadata schema or component type: the substances whose payload repeats their identity. */
function isDefinition(substance: VersionSubstance): substance is DefinitionSubstance {
  return (definitionKinds as readonly string[]).includes(substance.kind);
}

const definitionSchemas = {
  field: fieldDefinitionSchema,
  metadataSchema: metadataSchemaDefinitionSchema,
  componentType: componentTypeDefinitionSchema,
} as const;

/**
 * Validates a substance before anything is digested or written, and returns what is stored: the
 * parsed content, since parsing fills defaults and a digest must be over what the row holds.
 *
 * Content is parsed at the current schema version, because a version is written now. A component's
 * metadata values are not validated here: which values are valid is `validate`'s, run by the service,
 * and a version holds values that fail it (MET-023 fails the publish, not the save).
 */
function prepare(substance: VersionSubstance): VersionSubstance {
  if (substance.kind === 'component') {
    // Postgres reads any spelling of a UUID and answers in this one, so a definition named any other
    // way would be stored in a spelling its digest was not computed over.
    for (const each of substance.definitions) {
      if (!UUID.test(each.id) || !UUID.test(each.version)) {
        throw new Error(
          `A component version names each definition by lower-case hyphenated UUIDs, not ${each.kind} ${each.id} at ${each.version}`,
        );
      }
    }
    componentTypeOf(substance.definitions);
    return { ...substance, content: parseContentDocument(substance.content) };
  }
  if (substance.kind === 'document') {
    // An outline carries no `id`: a document's identity is its artifact row's, as a component's is.
    // Its values are its template's fields', written already checked (templates.md, "Values"), and
    // left out where there are none, so a document with none digests as it did before templates.
    const values = substance.values ?? {};
    return {
      kind: 'document',
      content: parseOutlineDocument(substance.content),
      ...(Object.keys(values).length === 0 ? {} : { values }),
    };
  }
  if (substance.kind === 'layout') {
    // A layout carries no `id` either: it is a definition in no space, identified by its artifact row.
    return { kind: 'layout', content: parseLayout(substance.content) };
  }
  if (substance.kind === 'template') {
    // Nor does a template: it is in a space, and identified by its artifact row (templates.md).
    return { kind: 'template', content: templateDefinitionSchema.parse(substance.content) };
  }
  if (substance.kind === 'asset') {
    // Nor does an asset version: an asset is in a space, as content is (docs/design/assets.md).
    return { kind: 'asset', content: parseAssetVersion(substance.content) };
  }
  if (!isDefinition(substance)) {
    // A theme or a catalogue, already read whole by its own writer, which is the only way here.
    return substance;
  }
  const content = definitionSchemas[substance.kind].parse(substance.content);
  if (!UUID.test(content.id)) {
    throw new Error(
      `A stored ${substance.kind} is identified by its artifact's id, not ${content.id}`,
    );
  }
  return { kind: substance.kind, content } as VersionSubstance;
}

/** A caller with no note leaves it out: the column refuses an empty one, and says so opaquely. */
function checkAuthorship(authorship: Authorship): void {
  if (authorship.note === '') {
    throw new Error(`A version's note is left out when there is none, never an empty string`);
  }
}

async function insertVersion(
  trx: TenantTransaction,
  artifactId: string,
  numbering: { readonly revision: number; readonly version: number },
  authorship: Authorship,
  substance: VersionSubstance,
  digests = versionDigests(substance),
): Promise<StoredVersion> {
  const component = substance.kind === 'component' ? substance : undefined;
  const values =
    component?.values ?? (substance.kind === 'document' ? substance.values : undefined) ?? {};
  const row = await trx
    .insertInto('artifact_version')
    .values({
      artifact_id: artifactId,
      kind: substance.kind,
      revision_no: numbering.revision,
      version_no: numbering.version,
      author_id: authorship.author,
      note: authorship.note ?? null,
      schema_version: substance.content.schemaVersion,
      content: JSON.stringify(substance.content),
      content_hash: digests.contentHash,
      metadata_values: JSON.stringify(values),
      not_carried: JSON.stringify(component?.notCarried ?? []),
      component_type_version_id: component ? componentTypeOf(component.definitions) : null,
      version_digest: digests.versionDigest,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  const definitions = component?.definitions ?? [];
  if (definitions.length > 0) {
    await trx
      .insertInto('version_definition')
      .values(
        definitions.map((each) => ({
          version_id: row.id,
          definition_version_id: each.version,
          definition_artifact_id: each.id,
          definition_kind: each.kind,
        })),
      )
      .execute();
  }
  const stored = await readVersion(trx, row.id);
  if (!stored) throw new Error(`Version ${row.id} was written and cannot be read back`);
  // Found by its words from the moment it exists, in its own transaction (search.md; SCH-066).
  await indexVersion(trx, stored);
  return stored;
}

/**
 * Creates an artifact and its first version, `0.1`, in the caller's transaction: every artifact has a
 * version from the moment it exists, so a baseline can pin it (component-editor.md, Creating a
 * component). A component or a document is created in a space, and identified by a generated id; a
 * definition in none, and identified by the id its payload carries.
 */
export async function createArtifact(
  trx: TenantTransaction,
  input: NewArtifact,
): Promise<StoredVersion> {
  checkAuthorship(input);
  const substance = prepare(input.substance);
  // Every environment's layout is seeded by the migration that makes layouts an artifact kind (0018),
  // and its theme and catalogues by the one that makes themes one (0024).
  if (substance.kind === 'layout' || substance.kind === 'theme' || substance.kind === 'catalogue') {
    throw new Error(`A ${substance.kind} is created by its migration, not by createArtifact`);
  }
  const artifact = await trx
    .insertInto('artifact')
    .values(
      substance.kind === 'component' ||
        substance.kind === 'document' ||
        substance.kind === 'asset' ||
        substance.kind === 'template'
        ? { kind: substance.kind, space_id: 'spaceId' in input ? input.spaceId : null }
        : { id: substance.content.id, kind: substance.kind, space_id: null },
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await insertVersion(
    trx,
    artifact.id,
    { revision: 0, version: 1 },
    input,
    substance,
  );
  // A definition's name is held from its first version, whatever made it (definitions.md, MET-031):
  // the seed's as well as the routes', so no path onto the chain leaves a name unheld.
  if (isDefinition(substance)) {
    await trx
      .insertInto('definition_name')
      .values({
        artifact_id: artifact.id,
        kind: substance.kind,
        name_key: nameKey(substance.content.name),
      })
      .execute();
  }
  return version;
}

/** One version by its id, or undefined when this tenant holds no such version. */
export async function readVersion(
  trx: TenantTransaction,
  id: string,
): Promise<StoredVersion | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx
    .selectFrom('artifact_version')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  const definitions = await trx
    .selectFrom('version_definition')
    .select(['definition_kind', 'definition_artifact_id', 'definition_version_id'])
    .where('version_id', '=', id)
    .execute();
  return {
    id: row.id,
    artifactId: row.artifact_id,
    kind: row.kind,
    revision: row.revision_no,
    version: row.version_no,
    author: row.author_id,
    createdAt: row.created_at,
    note: row.note,
    schemaVersion: row.schema_version,
    content: row.content,
    contentHash: row.content_hash,
    values: row.metadata_values,
    notCarried: row.not_carried as NotCarried[],
    componentType: row.component_type_version_id,
    definitions: definitions
      .map((each) => ({
        kind: each.definition_kind,
        id: each.definition_artifact_id,
        version: each.definition_version_id,
      }))
      .sort(
        (a, b) => compare(a.kind, b.kind) || compare(a.id, b.id) || compare(a.version, b.version),
      ),
    versionDigest: row.version_digest,
  };
}

/** The latest version of an artifact, or undefined when this tenant holds no such artifact. */
/** A version's content and its number, `revision.version`, and nothing else of it. */
export interface VersionContent {
  readonly revision: number;
  readonly version: number;
  readonly content: unknown;
}

/**
 * The content and the number of each of these versions, by id, in one query: for a caller that has
 * already decided which versions may be read - the text of a document, resolved by `numberingInputs` -
 * and needs nothing of each but what it holds and which it is. An id that names no version is simply
 * absent.
 */
export async function versionContents(
  trx: TenantTransaction,
  ids: readonly string[],
): Promise<ReadonlyMap<string, VersionContent>> {
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom('artifact_version')
    .select(['id', 'content', 'revision_no', 'version_no'])
    .where('id', 'in', [...ids])
    .execute();
  return new Map(
    rows.map((row) => [
      row.id,
      { revision: row.revision_no, version: row.version_no, content: row.content },
    ]),
  );
}

/** One version as a listing of an artifact's versions shows it: its heading, with its author named. */
export interface ListedVersion {
  readonly id: string;
  readonly revision: number;
  readonly version: number;
  readonly createdAt: Date;
  readonly note: string | null;
  readonly author: { readonly id: string; readonly name: string | null } | null;
}

/** Where a page of an artifact's versions ended: the last version's number. */
export interface VersionPosition {
  readonly revision: number;
  readonly version: number;
}

/**
 * A page of an artifact's versions, newest first (document-view.md, "Versions"): the ones after
 * `after`, by keyset over `(revision_no, version_no)` descending, and where the next page begins, or
 * null at the end. The caller has decided the artifact may be read.
 *
 * **No snapshot**, unlike the content listings (listing.ts): a version is immutable and the chain is
 * append-only, so a later version only ever arrives before the first page, never inside a walk
 * already past it - the pages a walk has yet to read hold exactly what they held when it began.
 */
export async function listVersions(
  trx: TenantTransaction,
  artifactId: string,
  page: { readonly limit: number; readonly after?: VersionPosition },
): Promise<{ readonly items: readonly ListedVersion[]; readonly next: VersionPosition | null }> {
  const limit = checkedLimit(page.limit);
  if (!UUID.test(artifactId)) return { items: [], next: null };
  const { after } = page;
  const rows = await trx
    .selectFrom('artifact_version as v')
    .leftJoin('principal as p', 'p.id', 'v.author_id')
    .select([
      'v.id',
      'v.revision_no',
      'v.version_no',
      'v.created_at',
      'v.note',
      'v.author_id',
      'p.display_name',
      'p.email',
    ])
    .where('v.artifact_id', '=', artifactId)
    .$if(after !== undefined, (query) =>
      query.where(
        sql<boolean>`(v.revision_no, v.version_no) < (${after!.revision}, ${after!.version})`,
      ),
    )
    .orderBy('v.revision_no', 'desc')
    .orderBy('v.version_no', 'desc')
    .limit(limit + 1)
    .execute();
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return {
    items: shown.map((row) => ({
      id: row.id,
      revision: row.revision_no,
      version: row.version_no,
      createdAt: row.created_at,
      note: row.note,
      author:
        row.author_id === null
          ? null
          : { id: row.author_id, name: row.display_name ?? row.email ?? null },
    })),
    next:
      rows.length > limit && last !== undefined
        ? { revision: last.revision_no, version: last.version_no }
        : null,
  };
}

export async function latestVersion(
  trx: TenantTransaction,
  artifactId: string,
): Promise<StoredVersion | undefined> {
  if (!UUID.test(artifactId)) return undefined;
  const row = await trx
    .selectFrom('artifact_version')
    .select('id')
    .where('artifact_id', '=', artifactId)
    .orderBy('revision_no', 'desc')
    .orderBy('version_no', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row && readVersion(trx, row.id);
}

/**
 * The substance a stored version records, rebuilt from the row exactly as stored - so anybody holding
 * the row can recompute both digests (VER-042) and compare them with the ones it carries.
 */
export function substanceOf(stored: StoredVersion): VersionSubstance {
  if (stored.kind === 'component') {
    return {
      kind: 'component',
      // As stored, never migrated: the serialisation reads any JSON, and a digest is over what was
      // written. The type says ContentDocument because that is what was validated at the write.
      content: stored.content as Extract<VersionSubstance, { kind: 'component' }>['content'],
      values: stored.values,
      notCarried: stored.notCarried,
      definitions: stored.definitions,
    };
  }
  if (stored.kind === 'document') {
    return {
      kind: 'document',
      content: stored.content as Extract<VersionSubstance, { kind: 'document' }>['content'],
      values: stored.values,
    };
  }
  return { kind: stored.kind, content: stored.content } as VersionSubstance;
}

export interface NextVersion extends Authorship {
  readonly artifactId: string;
  /** The version the caller's session opened from, which must still be the latest. */
  readonly openedFrom: string;
  readonly substance: VersionSubstance;
}

export type RecordAnswer =
  | { readonly answer: 'recorded'; readonly version: StoredVersion }
  /** The digest equals the latest version's: nothing to cut, and not an error to the author. */
  | { readonly answer: 'version.unchanged'; readonly current: StoredVersion }
  /** The latest version is not the one the caller opened from. Names the current one. */
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  /** This tenant holds no such artifact. */
  | { readonly answer: 'artifact.missing' };

/**
 * Records the next version of an artifact, in the caller's transaction, answering what
 * component-editor.md's "Cutting a version" says the store answers: `version.precondition` when the
 * latest version is not the one stated, `version.unchanged` when the version digest equals the
 * latest version's, and otherwise the version recorded, numbered next within its revision.
 *
 * The lock, the definitions and carrying values forward are the caller's, done before this is called
 * and inside the same transaction. Two callers cutting one artifact at once take turns on a
 * transaction-scoped advisory lock, so the second sees the first's version and is answered
 * `version.precondition` rather than colliding on a number.
 */
export async function recordVersion(
  trx: TenantTransaction,
  input: NextVersion,
): Promise<RecordAnswer> {
  const { kind } = input.substance;
  if (kind === 'theme' || kind === 'catalogue') {
    throw new Error(
      `A ${kind} version is recorded by ${ownWriters[kind]}, which reads it whole first`,
    );
  }
  return record(trx, input);
}

/**
 * The transaction-scoped lock two writers of one artifact take turns on. Taken again by the same
 * transaction it is simply held twice, so a writer that reads under it before recording - a catalogue's
 * earlier versions, in themes.ts - takes it first and `recordVersion`'s own taking of it costs nothing.
 */
export async function lockArtifact(trx: TenantTransaction, artifactId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:artifact:${artifactId}`}, 0))`.execute(
    trx,
  );
}

/**
 * `recordVersion` for a theme or a catalogue version its own writer has read whole, in themes.ts, and
 * nowhere else: the package does not export it, so those writers stay the only way one is recorded.
 */
export function recordReadVersion(
  trx: TenantTransaction,
  input: NextVersion & {
    readonly substance: ThemeSubstance | CatalogueSubstance;
    /**
     * The latest version's digest as its writer read it, where that differs from the digest its row
     * carries: a `catalogue/1` row is read upgraded to `catalogue/2`, and a version is written as it
     * reads, so the same catalogue saved again would otherwise differ from its row by its shape alone
     * (themes 2). Consulted only when `versionId` is still the latest; the unchanged answer then
     * compares against this rather than the row's own digest.
     */
    readonly latestAsRead?: { readonly versionId: string; readonly versionDigest: string };
  },
): Promise<RecordAnswer> {
  return record(trx, input, input.latestAsRead);
}

async function record(
  trx: TenantTransaction,
  input: NextVersion,
  latestAsRead?: { readonly versionId: string; readonly versionDigest: string },
): Promise<RecordAnswer> {
  if (!UUID.test(input.artifactId)) return { answer: 'artifact.missing' };
  checkAuthorship(input);
  // Compared with the latest version's id as Postgres spells it, so any other spelling is a bug.
  if (!UUID.test(input.openedFrom)) {
    throw new Error(
      `A version cannot be opened from ${input.openedFrom}, which is not a lower-case hyphenated UUID`,
    );
  }
  await lockArtifact(trx, input.artifactId);
  const current = await latestVersion(trx, input.artifactId);
  if (!current) return { answer: 'artifact.missing' };
  if (current.id !== input.openedFrom) return { answer: 'version.precondition', current };
  if (input.substance.kind !== current.kind) {
    throw new Error(
      `Artifact ${input.artifactId} is a ${current.kind}, not a ${input.substance.kind}`,
    );
  }

  const substance = prepare(input.substance);
  // A definition's rule, not content's: a definition's payload repeats its identity, and a
  // component's content, a document's outline, a layout, an asset version, a theme and a catalogue
  // carry none.
  if (isDefinition(substance) && substance.content.id !== input.artifactId) {
    throw new Error(
      `A version of ${input.artifactId} cannot carry the identity ${substance.content.id}`,
    );
  }
  const digests = versionDigests(substance);
  const latest =
    latestAsRead?.versionId === current.id ? latestAsRead.versionDigest : current.versionDigest;
  if (digests.versionDigest === latest) {
    return { answer: 'version.unchanged', current };
  }
  const version = await insertVersion(
    trx,
    input.artifactId,
    { revision: current.revision, version: current.version + 1 },
    input,
    substance,
    digests,
  );
  // And a definition renamed holds its new name, the old one freed.
  if (isDefinition(substance)) {
    await trx
      .updateTable('definition_name')
      .set({ name_key: nameKey(substance.content.name) })
      .where('artifact_id', '=', input.artifactId)
      .execute();
  }
  return { answer: 'recorded', version };
}
