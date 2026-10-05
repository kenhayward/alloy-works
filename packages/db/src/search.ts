import { randomUUID } from 'node:crypto';
import {
  entriesOf,
  isUserValue,
  parseAssetVersion,
  parseQueryDefinition,
  readContent,
  readDefinition,
  readOutline,
  templateDefinitionSchema,
  type DataType,
  type DefinitionKind,
  type MetadataValues,
  type OutlineNode,
  type SearchContext,
  type SearchEntryDraft,
  type SearchSource,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';
import { readVersion, type StoredVersion } from './versions.js';

/**
 * Search's projection, written (docs/design/search.md, "Written with the version"; SCH-066): an
 * artifact's entries are rewritten in the transaction that writes its version, and a publication's in
 * the one that records it, so what a version says is findable the moment the version is. Derived and
 * never a record: `reindexSearch` makes it all again from the chain.
 */

/**
 * The kinds found by their versions. A layout, a theme and a catalogue are not searched (SCH-054), nor
 * a connection, nor a dataset: a stored result is browsed and queried in its own right only from T4
 * (DAT-094), and read until then through a document holding it (the D3 plan, D3-O).
 */
const versioned = new Set<string>([
  'component',
  'document',
  'template',
  'asset',
  'field',
  'metadataSchema',
  'componentType',
  'queryDefinition',
]);

/**
 * Whether this tenant has the projection yet. It has from the run that applies 0031, which makes it
 * whole; a version written before then - which only a test migrated to an earlier point writes - is
 * found once that run's reindex reads it.
 */
async function projected(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('search_entry') is not null as present`.execute(trx);
  return rows[0]?.present === true;
}

/**
 * Whether this tenant's uploads say where they came from yet (0051): an asset written before then -
 * which only a test migrated to an earlier point writes - is a person's upload.
 */
async function hasUploadOrigin(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{ present: boolean }>`
    select exists (
      select 1 from pg_attribute
       where attrelid = to_regclass('asset_upload') and attname = 'origin' and not attisdropped
    ) as present`.execute(trx);
  return rows[0]?.present === true;
}

/** Each artifact's latest content, by id, in one query: the names a version's words are said with. */
async function latestContents(
  trx: TenantTransaction,
  ids: readonly string[],
): Promise<ReadonlyMap<string, { readonly version: string; readonly content: unknown }>> {
  if (ids.length === 0) return new Map();
  const rows = await trx
    .selectFrom('artifact_version')
    .select(['artifact_id', 'id', 'content'])
    .distinctOn('artifact_id')
    .where('artifact_id', 'in', [...new Set(ids)])
    .orderBy('artifact_id')
    .orderBy('revision_no', 'desc')
    .orderBy('version_no', 'desc')
    .execute();
  return new Map(rows.map((row) => [row.artifact_id, { version: row.id, content: row.content }]));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The names of the fields, schemas and people a source's words are said with. */
async function contextFor(trx: TenantTransaction, source: SearchSource): Promise<SearchContext> {
  const valueSets: MetadataValues[] = [];
  const fieldIds: string[] = [];
  const schemaIds: string[] = [];
  if (source.kind === 'component') valueSets.push(source.values);
  if (source.kind === 'document') {
    valueSets.push(source.values);
    const walk = (nodes: readonly OutlineNode[]): void =>
      nodes.forEach((node) => {
        valueSets.push(node.values);
        walk(node.children);
      });
    walk(source.content.nodes);
  }
  if (source.kind === 'metadataSchema')
    fieldIds.push(...source.content.entries.map((e) => e.field));
  if (source.kind === 'componentType') {
    schemaIds.push(...source.content.assignments.map((each) => each.schema));
  }
  const people: string[] = [];
  for (const values of valueSets) {
    for (const [field, value] of Object.entries(values)) {
      fieldIds.push(field);
      for (const each of [value].flat()) if (isUserValue(each)) people.push(each.user);
    }
  }

  const contents = await latestContents(
    trx,
    [...fieldIds, ...schemaIds].filter((id) => UUID.test(id)),
  );
  const named = <K extends DefinitionKind>(kind: K, id: string) => {
    const latest = contents.get(id);
    if (!latest) return undefined;
    const read = readDefinition(kind, latest.content, { artifact: id, version: latest.version });
    return read.ok ? read.definition : undefined;
  };
  const fields = new Map<string, { name: string; dataType: DataType }>();
  for (const id of fieldIds) {
    const field = named('field', id);
    if (field) fields.set(id, { name: field.name, dataType: field.dataType });
  }
  const schemas = new Map<string, string>();
  for (const id of schemaIds) {
    const schema = named('metadataSchema', id);
    if (schema) schemas.set(id, schema.name);
  }
  const known = people.filter((id) => UUID.test(id));
  const names =
    known.length === 0
      ? []
      : await trx
          .selectFrom('principal')
          .select(['id', 'display_name'])
          .where('id', 'in', [...new Set(known)])
          .execute();
  return {
    fields,
    schemas,
    people: new Map(
      names.flatMap((row) => (row.display_name === null ? [] : [[row.id, row.display_name]])),
    ),
  };
}

/** What a stored version is read as, or undefined where it cannot be read (CNT-013). */
function sourceOf(version: StoredVersion): SearchSource | undefined {
  const at = { artifact: version.artifactId, version: version.id };
  switch (version.kind) {
    case 'component': {
      const read = readContent(version.content, at);
      return read.ok
        ? { kind: 'component', content: read.document, values: version.values }
        : undefined;
    }
    case 'document': {
      const read = readOutline(version.content, at);
      return read.ok
        ? { kind: 'document', content: read.outline, values: version.values }
        : undefined;
    }
    case 'template': {
      const read = templateDefinitionSchema.safeParse(version.content);
      return read.success ? { kind: 'template', content: read.data } : undefined;
    }
    case 'asset':
      try {
        return { kind: 'asset', content: parseAssetVersion(version.content) };
      } catch {
        return undefined;
      }
    case 'queryDefinition':
      try {
        return { kind: 'queryDefinition', content: parseQueryDefinition(version.content) };
      } catch {
        return undefined;
      }
    case 'field':
    case 'metadataSchema':
    case 'componentType': {
      const read = readDefinition(version.kind, version.content, at);
      return read.ok
        ? ({ kind: version.kind, content: read.definition } as SearchSource)
        : undefined;
    }
    default:
      return undefined;
  }
}

interface Placing {
  readonly artifactId: string;
  readonly versionId: string;
  readonly spaceId: string | null;
  readonly owner: string | null;
  readonly changedAt: Date;
  readonly componentType: string | null;
}

async function write(
  trx: TenantTransaction,
  placing: Placing,
  drafts: readonly SearchEntryDraft[],
): Promise<void> {
  await trx.deleteFrom('search_entry').where('artifact_id', '=', placing.artifactId).execute();
  if (drafts.length === 0) return;
  const entries = drafts.map((draft) => ({ id: randomUUID(), draft }));
  await trx
    .insertInto('search_entry')
    .values(
      entries.map(({ id, draft }) => ({
        id,
        artifact_id: placing.artifactId,
        kind: draft.kind,
        node: draft.node,
        version_id: placing.versionId,
        space_id: placing.spaceId,
        title: draft.title,
        owner: placing.owner,
        changed_at: placing.changedAt,
        component_type: draft.kind === 'component' ? placing.componentType : null,
        field_values: JSON.stringify(draft.values),
        configuration: draft.configuration,
        body: draft.texts.map((each) => each.text).join(' '),
      })),
    )
    .execute();
  const texts = entries.flatMap(({ id, draft }) =>
    draft.texts.map((each) => ({
      entry_id: id,
      place: each.place,
      body: each.text,
      configuration: draft.configuration,
    })),
  );
  if (texts.length > 0) await trx.insertInto('search_text').values(texts).execute();
}

/**
 * Rewrites an artifact's entries - and a document's sections' - from its version, which is its latest:
 * called by `insertVersion` for every version the chain writes, in that version's transaction.
 */
export async function indexVersion(trx: TenantTransaction, version: StoredVersion): Promise<void> {
  if (!versioned.has(version.kind) || !(await projected(trx))) return;
  // An asset a dataset's image made is never found (D8-I): read only through a document holding it.
  const hidden =
    version.kind === 'asset' &&
    (await hasUploadOrigin(trx)) &&
    (await trx
      .selectFrom('asset_upload')
      .select('id')
      .where('asset_id', '=', version.artifactId)
      .where('origin', '=', 'dataset')
      .executeTakeFirst()) !== undefined;
  const source = hidden ? undefined : sourceOf(version);
  const artifact = await trx
    .selectFrom('artifact')
    .select('space_id')
    .where('id', '=', version.artifactId)
    .executeTakeFirstOrThrow();
  // Who made it: the author of its first version, which is this one when it is the first.
  const first = await trx
    .selectFrom('artifact_version')
    .select('author_id')
    .where('artifact_id', '=', version.artifactId)
    .orderBy('revision_no')
    .orderBy('version_no')
    .limit(1)
    .executeTakeFirstOrThrow();
  await write(
    trx,
    {
      artifactId: version.artifactId,
      versionId: version.id,
      spaceId: artifact.space_id,
      owner: first.author_id,
      changedAt: version.createdAt,
      componentType: version.definitions.find((each) => each.kind === 'componentType')?.id ?? null,
    },
    source ? entriesOf(source, await contextFor(trx, source)) : [],
  );
}

/**
 * Writes a publication's entry: its document's title and language at the version it published, and
 * that version's number. A publication has no versions, so `recordPublication` calls this, in its own
 * transaction, as the chain calls `indexVersion`.
 */
export async function indexPublication(trx: TenantTransaction, id: string): Promise<void> {
  if (!(await projected(trx))) return;
  const row = await trx
    .selectFrom('publication as p')
    .innerJoin('artifact as a', 'a.id', 'p.id')
    .innerJoin('artifact_version as v', 'v.id', 'p.document_version_id')
    .select([
      'p.document_id',
      'p.document_version_id',
      'p.publisher',
      'p.published_at',
      'a.space_id',
      'v.content',
      'v.revision_no',
      'v.version_no',
    ])
    .where('p.id', '=', id)
    .executeTakeFirstOrThrow();
  const read = readOutline(row.content, {
    artifact: row.document_id,
    version: row.document_version_id,
  });
  await write(
    trx,
    {
      artifactId: id,
      versionId: row.document_version_id,
      spaceId: row.space_id,
      owner: row.publisher,
      changedAt: row.published_at,
      componentType: null,
    },
    read.ok
      ? entriesOf(
          {
            kind: 'publication',
            title: read.outline.title,
            language: read.outline.language,
            version: `${row.revision_no}.${row.version_no}`,
          },
          { fields: new Map(), schemas: new Map(), people: new Map() },
        )
      : [],
  );
}

/**
 * The whole projection again, from every searchable artifact's latest version and every publication:
 * what the migration runner runs in the run that applies 0031, and what a changed projection runs.
 */
export async function reindexSearch(trx: TenantTransaction): Promise<void> {
  await trx.deleteFrom('search_entry').execute();
  const latest = await trx
    .selectFrom('artifact_version')
    .select(['artifact_id', 'id'])
    .distinctOn('artifact_id')
    .where('kind', 'in', [...versioned] as never)
    .orderBy('artifact_id')
    .orderBy('revision_no', 'desc')
    .orderBy('version_no', 'desc')
    .execute();
  for (const each of latest) {
    const version = await readVersion(trx, each.id);
    if (version) await indexVersion(trx, version);
  }
  const publications = await trx.selectFrom('publication').select('id').execute();
  for (const each of publications) await indexPublication(trx, each.id);
}
