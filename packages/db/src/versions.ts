import {
  componentTypeDefinitionSchema,
  componentTypeOf,
  fieldDefinitionSchema,
  metadataSchemaDefinitionSchema,
  parseContentDocument,
  type DefinitionRef,
  type MetadataValues,
  type NotCarried,
  type VersionSubstance,
} from '@alloy-works/domain';
import type { ArtifactKind } from './artifact-kind.js';
import type { TenantTransaction } from './tables.js';
import { versionDigests } from './version-digest.js';

/** A version as the chain holds it. `content` is exactly what was written, never migrated. */
export interface StoredVersion {
  readonly id: string;
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  /** `revision.version`, as VER-009 presents it. Zero until a revision is designated. */
  readonly revision: number;
  readonly version: number;
  /** The principal who cut it: a reference, never a copy of their details. */
  readonly author: string;
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
        readonly substance: Extract<VersionSubstance, { kind: 'component' }>;
        readonly spaceId: string;
      }
    | { readonly substance: Exclude<VersionSubstance, { kind: 'component' }> }
  );

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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
    componentTypeOf(substance.definitions);
    return { ...substance, content: parseContentDocument(substance.content) };
  }
  const content = definitionSchemas[substance.kind].parse(substance.content);
  if (!UUID.test(content.id)) {
    throw new Error(
      `A stored ${substance.kind} is identified by its artifact's id, not ${content.id}`,
    );
  }
  return { kind: substance.kind, content } as VersionSubstance;
}

async function insertVersion(
  trx: TenantTransaction,
  artifactId: string,
  numbering: { readonly revision: number; readonly version: number },
  authorship: Authorship,
  substance: VersionSubstance,
): Promise<StoredVersion> {
  const digests = versionDigests(substance);
  const component = substance.kind === 'component' ? substance : undefined;
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
      metadata_values: JSON.stringify(component?.values ?? {}),
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
  return stored;
}

/**
 * Creates an artifact and its first version, `0.1`, in the caller's transaction: every artifact has a
 * version from the moment it exists, so a baseline can pin it (component-editor.md, Creating a
 * component). A component is created in a space; a definition in none, and identified by the id its
 * payload carries.
 */
export async function createArtifact(
  trx: TenantTransaction,
  input: NewArtifact,
): Promise<StoredVersion> {
  const substance = prepare(input.substance);
  const artifact = await trx
    .insertInto('artifact')
    .values(
      substance.kind === 'component'
        ? { kind: 'component', space_id: 'spaceId' in input ? input.spaceId : null }
        : { id: substance.content.id, kind: substance.kind, space_id: null },
    )
    .returning('id')
    .executeTakeFirstOrThrow();
  return insertVersion(trx, artifact.id, { revision: 0, version: 1 }, input, substance);
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
  return { kind: stored.kind, content: stored.content } as VersionSubstance;
}
