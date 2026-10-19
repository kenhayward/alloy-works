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
import { archivalStored, isArchived } from './archival.js';
import { deletionStored, isDeleted } from './deletion.js';
import { earlierStored } from './search-earlier.js';
import { relationsHeld, storedValues } from './search-relations.js';
import { foldHistory, rebuildHistory } from './search-history.js';
import { indexEveryThread, vectorStored } from './search-threads.js';
import { embedIndexed } from './embeddings.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion, lockArtifact, readVersion, type StoredVersion } from './versions.js';
import { stateKey, workflowStored } from './workflow.js';

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
 * The kinds whose earlier versions stay searchable (the SV plan, SV-A): what a baseline pins. A
 * document's sections go with it, as its rows.
 */
const kept = new Set<string>(['component', 'document', 'asset']);

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
  // Held FOR SHARE, in order, so an erasure (#594) waits for this version's entries to commit, or this
  // waits and reads the fixed word: an erasure rewrites only what is committed.
  const names =
    known.length === 0
      ? []
      : await trx
          .selectFrom('principal')
          .select(['id', 'display_name'])
          .where('id', 'in', [...new Set(known)])
          .orderBy('id')
          .forShare()
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
  /** Its artifact archived; undefined before 0083 stores archival. */
  readonly archived?: boolean;
  /** Its artifact deleted; undefined before 0085 stores deletion. */
  readonly deleted?: boolean;
  /** Its artifact's workflow state; undefined before 0095 stores workflow, null for other kinds. */
  readonly workflowState?: string | null;
}

/**
 * Rewrites an artifact's current entries from these drafts, leaving its threads' alone (SV-K). From 0089
 * the vector is a plain column, set here (SV-L).
 */
async function write(
  trx: TenantTransaction,
  placing: Placing,
  drafts: readonly SearchEntryDraft[],
): Promise<void> {
  const threads = await vectorStored(trx);
  let gone = trx.deleteFrom('search_entry').where('artifact_id', '=', placing.artifactId);
  if (threads) gone = gone.where('thread_id', 'is', null);
  await gone.execute();
  if (drafts.length === 0) return;
  // An artifact's relationships are its own, not a section's (SCH-063; R14-E).
  const relations = await relationsHeld(trx, placing.artifactId);
  const entries = drafts.map((draft) => ({ id: randomUUID(), draft }));
  const bodyOf = (draft: SearchEntryDraft) => draft.texts.map((each) => each.text).join(' ');
  await trx
    .insertInto('search_entry')
    .values(
      entries.map(({ id, draft }) => ({
        // Before 0089 the column is generated, and only its default may be written.
        vector: threads
          ? sql<string>`to_tsvector(${draft.configuration}::regconfig, ${bodyOf(draft)})`
          : sql<string>`default`,
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
        field_values: storedValues(
          draft.values,
          draft.conditions,
          draft.kind === 'section' ? [] : relations,
        ),
        configuration: draft.configuration,
        body: bodyOf(draft),
        ...(placing.archived === undefined ? {} : { archived: placing.archived }),
        ...(placing.deleted === undefined ? {} : { deleted: placing.deleted }),
        ...(placing.workflowState === undefined ? {} : { workflow_state: placing.workflowState }),
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

/** Adds an earlier version's entries, as a move would have left them (0088). */
async function writeEarlier(
  trx: TenantTransaction,
  placing: Placing,
  drafts: readonly SearchEntryDraft[],
): Promise<void> {
  if (drafts.length === 0) return;
  const entries = drafts.map((draft) => ({ id: randomUUID(), draft }));
  const vector = (configuration: string, body: string) =>
    sql<string>`to_tsvector(${configuration}::regconfig, ${body})`;
  await trx
    .insertInto('search_earlier')
    .values(
      entries.map(({ id, draft }) => {
        const body = draft.texts.map((each) => each.text).join(' ');
        return {
          id,
          artifact_id: placing.artifactId,
          kind: draft.kind as 'component' | 'document' | 'section' | 'asset',
          node: draft.node,
          version_id: placing.versionId,
          space_id: placing.spaceId,
          title: draft.title,
          owner: placing.owner,
          changed_at: placing.changedAt,
          component_type: draft.kind === 'component' ? placing.componentType : null,
          // An earlier version keeps its conditions; its relationships are the artifact's now.
          field_values: storedValues(draft.values, draft.conditions, []),
          configuration: draft.configuration,
          body,
          vector: vector(draft.configuration, body),
          archived: placing.archived ?? false,
          deleted: placing.deleted ?? false,
        };
      }),
    )
    .execute();
  const texts = entries.flatMap(({ id, draft }) =>
    draft.texts.map((each) => ({
      entry_id: id,
      place: each.place,
      body: each.text,
      configuration: draft.configuration,
      vector: vector(draft.configuration, each.text),
    })),
  );
  if (texts.length > 0) await trx.insertInto('search_earlier_text').values(texts).execute();
}

/** Rows whose values name `person`, by the same path wherever a value is held (#594). */
const naming = (person: string) =>
  sql<boolean>`jsonb_path_exists(field_values, '$.** ? (@.user == $id)', jsonb_build_object('id', ${person}::text))`;

/**
 * Moves an artifact's rows from versions older than `version` into `search_earlier`, each keeping its
 * id and vector, one statement per table, before `write` deletes what is left; refuses where the
 * current rows are a newer version's, which only a stale read would index over. A version indexed
 * again - a dataset's image is, once its upload names it (assets.ts) - moves nothing. The people the
 * moved rows name are held FOR SHARE, in id order, so an erasure waits for them to commit (SV-J).
 */
async function moveEarlier(trx: TenantTransaction, version: StoredVersion): Promise<void> {
  // A thread's row is current whatever version it was made against, and never moves (SV-K).
  const notThread = (await vectorStored(trx)) ? sql`and e.thread_id is null` : sql``;
  const older = sql`(select v.id from artifact_version v
     where v.artifact_id = ${version.artifactId}
       and (v.revision_no, v.version_no) < (${version.revision}, ${version.version}))`;
  const { rows: newer } = await sql<{ id: string }>`
    select e.id from search_entry e join artifact_version v on v.id = e.version_id
     where e.artifact_id = ${version.artifactId} ${notThread}
       and (v.revision_no, v.version_no) > (${version.revision}, ${version.version})
     limit 1`.execute(trx);
  if (newer.length > 0) {
    throw new Error(
      `Version ${version.id} is indexed over a newer version of ${version.artifactId}`,
    );
  }
  await sql`select p.id from principal p
     where p.id::text in (
       select jsonb_path_query(e.field_values, '$.** ? (exists(@.user)).user') #>> '{}'
         from search_entry e
        where e.artifact_id = ${version.artifactId} and e.version_id in ${older} ${notThread})
     order by p.id
     for share`.execute(trx);
  const columns = sql.raw(
    'id, artifact_id, kind, node, version_id, space_id, title, owner, changed_at, component_type, field_values, configuration, body, vector, archived, deleted',
  );
  // An earlier version's relationships are the artifact's now, which `writeEarlier` holds none of.
  const moved = sql.raw(
    "id, artifact_id, kind, node, version_id, space_id, title, owner, changed_at, component_type, field_values - '~relations', configuration, body, vector, archived, deleted",
  );
  await sql`insert into search_earlier (${columns})
    select ${moved} from search_entry e
     where artifact_id = ${version.artifactId} and version_id in ${older} ${notThread}`.execute(
    trx,
  );
  await sql`insert into search_earlier_text (entry_id, place, body, configuration, vector)
    select t.entry_id, t.place, t.body, t.configuration, t.vector
      from search_text t join search_entry e on e.id = t.entry_id
     where e.artifact_id = ${version.artifactId} and e.version_id in ${older} ${notThread}`.execute(
    trx,
  );
}

/** What every version of an artifact is indexed with: where it is, who made it, and its acts. */
interface ArtifactFacts {
  readonly spaceId: string | null;
  readonly owner: string | null;
  /** An asset a dataset's image made, which is never found (D8-I). */
  readonly hidden: boolean;
  readonly archived?: boolean;
  readonly deleted?: boolean;
  readonly workflowState?: string | null;
}

async function artifactFacts(
  trx: TenantTransaction,
  artifactId: string,
  kind: string,
): Promise<ArtifactFacts> {
  // An asset a dataset's image made is never found (D8-I): read only through a document holding it.
  const hidden =
    kind === 'asset' &&
    (await hasUploadOrigin(trx)) &&
    (await trx
      .selectFrom('asset_upload')
      .select('id')
      .where('asset_id', '=', artifactId)
      .where('origin', '=', 'dataset')
      .executeTakeFirst()) !== undefined;
  const artifact = await trx
    .selectFrom('artifact')
    .select('space_id')
    .where('id', '=', artifactId)
    .executeTakeFirstOrThrow();
  // Who made it: the author of its first version.
  const first = await trx
    .selectFrom('artifact_version')
    .select('author_id')
    .where('artifact_id', '=', artifactId)
    // The main line's first: a line's versions are numbered below it (ADR-0063).
    .where('revision_no', '>=', 0)
    .orderBy('revision_no')
    .orderBy('version_no')
    .limit(1)
    .executeTakeFirstOrThrow();
  return {
    spaceId: artifact.space_id,
    owner: first.author_id,
    hidden,
    // As the acts left it, so an edit of an archived artifact does not bring it back (AH-D).
    ...((await archivalStored(trx)) ? { archived: await isArchived(trx, artifactId) } : {}),
    ...((await deletionStored(trx)) ? { deleted: await isDeleted(trx, artifactId) } : {}),
    // As its moves left it, a section's its document's (WF-H).
    ...((await workflowStored(trx))
      ? {
          workflowState:
            kind === 'component' || kind === 'document'
              ? ((await stateKey(trx, artifactId)) ?? null)
              : null,
        }
      : {}),
  };
}

function placingOf(version: StoredVersion, facts: ArtifactFacts): Placing {
  return {
    artifactId: version.artifactId,
    versionId: version.id,
    spaceId: facts.spaceId,
    owner: facts.owner,
    changedAt: version.createdAt,
    componentType: version.definitions.find((each) => each.kind === 'componentType')?.id ?? null,
    ...(facts.archived === undefined ? {} : { archived: facts.archived }),
    ...(facts.deleted === undefined ? {} : { deleted: facts.deleted }),
    ...(facts.workflowState === undefined ? {} : { workflowState: facts.workflowState }),
  };
}

async function draftsOf(
  trx: TenantTransaction,
  version: StoredVersion,
  facts: ArtifactFacts,
): Promise<readonly SearchEntryDraft[]> {
  const source = facts.hidden ? undefined : sourceOf(version);
  return source ? entriesOf(source, await contextFor(trx, source)) : [];
}

/**
 * Rewrites an artifact's entries - and a document's sections' - from its version, which is its latest:
 * called by `insertVersion` for every version the chain writes, in that version's transaction. A kept
 * kind's rows from earlier versions move to `search_earlier` first (SV-A).
 */
export async function indexVersion(
  trx: TenantTransaction,
  version: StoredVersion,
  options: {
    /** False for a caller that makes history again itself, after: the erasure and the reindex. */
    readonly fold?: boolean;
  } = {},
): Promise<void> {
  if (!versioned.has(version.kind) || !(await projected(trx))) return;
  const facts = await artifactFacts(trx, version.artifactId, version.kind);
  if (kept.has(version.kind) && (await earlierStored(trx))) await moveEarlier(trx, version);
  await write(trx, placingOf(version, facts), await draftsOf(trx, version, facts));
  // Its blocks' meaning: copied where their words' vectors exist, the rest queued (the G7 plan, G7-C).
  await embedIndexed(trx, version.artifactId, { queue: options.fold !== false });
  // Each place's words over every version, folded under the lock its writer holds (SV3-K).
  if (options.fold !== false && (version.kind === 'component' || version.kind === 'document')) {
    await foldHistory(trx, version.artifactId, version.id);
  }
}

/**
 * Takes the lock of every artifact whose rows, current or earlier, name `person`, in id order: what an
 * erasure takes before it holds the person's row, so a save holding one of them and waiting on that row
 * finishes first rather than deadlocking (the SV final review, H1).
 */
export async function lockNaming(trx: TenantTransaction, person: string): Promise<void> {
  if (!UUID.test(person) || !(await projected(trx))) return;
  const current = trx.selectFrom('search_entry').select('artifact_id').where(naming(person));
  const rows = (await earlierStored(trx))
    ? await current
        .union(trx.selectFrom('search_earlier').select('artifact_id').where(naming(person)))
        .orderBy('artifact_id')
        .execute()
    : await current.distinct().orderBy('artifact_id').execute();
  for (const row of rows) await lockArtifact(trx, row.artifact_id);
}

/**
 * Rewrites the entries of each artifact a relationship act touched (SCH-063; the R14 plan, R14-E): both
 * ends, and an end it moved from, each under its lock in id order and from its latest version, so its
 * relationships' fields are found as they stand.
 */
export async function reindexArtifacts(
  trx: TenantTransaction,
  artifacts: readonly string[],
): Promise<void> {
  if (!(await projected(trx))) return;
  for (const id of [...new Set(artifacts)].sort()) {
    await lockArtifact(trx, id);
    const version = await latestVersion(trx, id);
    if (version) await indexVersion(trx, version);
  }
}

/**
 * Rewrites every artifact whose entries name `person` in a value (#594): an entry's `field_values` are
 * the values its words were said from, so it is every entry whose text holds their name, and no more.
 * Each under its artifact's lock, in id order, its latest read under the lock, so a save cannot slip a
 * newer version beneath it (H1). Answers the artifacts rewritten, whose history the erasure rebuilds.
 */
export async function reindexNaming(trx: TenantTransaction, person: string): Promise<string[]> {
  if (!(await projected(trx))) return [];
  const named = await trx
    .selectFrom('search_entry')
    .select('artifact_id')
    .distinct()
    .where(naming(person))
    .orderBy('artifact_id')
    .execute();
  for (const each of named) {
    await lockArtifact(trx, each.artifact_id);
    const version = await latestVersion(trx, each.artifact_id);
    // Its history is made again by the erasure, after the earlier rows are rewritten.
    if (version) await indexVersion(trx, version, { fold: false });
  }
  return named.map((each) => each.artifact_id);
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
 * Every earlier version's rows, from the chain (0088): each version but the latest of a kept kind,
 * written straight to `search_earlier` rather than through a chain of moves.
 */
async function writeEveryEarlier(trx: TenantTransaction): Promise<void> {
  const { rows } = await sql<{ id: string; artifact_id: string; kind: string }>`
    select v.id, v.artifact_id, v.kind
      from (select id, artifact_id, kind, revision_no, version_no,
                   row_number() over (partition by artifact_id
                                      order by revision_no desc, version_no desc) as newest
              from artifact_version
             -- The main line's: a line's versions are numbered below it and never searched (ADR-0063).
             where kind = any(${[...kept]}::text[]) and revision_no >= 0) v
     where v.newest > 1
     order by v.artifact_id, v.revision_no, v.version_no`.execute(trx);
  let current: { readonly artifactId: string; readonly facts: ArtifactFacts } | undefined;
  for (const row of rows) {
    if (current?.artifactId !== row.artifact_id) {
      current = {
        artifactId: row.artifact_id,
        facts: await artifactFacts(trx, row.artifact_id, row.kind),
      };
    }
    if (current.facts.hidden) continue;
    const version = await readVersion(trx, row.id);
    if (!version) continue;
    await writeEarlier(
      trx,
      placingOf(version, current.facts),
      await draftsOf(trx, version, current.facts),
    );
  }
}

/** What a reindex rewrites (`reindexSearch`). */
export type ReindexScope = 'whole' | 'earlier' | 'threads' | 'history';

/**
 * Runs the scopes asked for once each, in order, and answers the order run: `whole` holds `threads`;
 * history is made from the rest, so `whole` and `earlier` imply it and it runs last (SV3-K).
 */
export async function reindexScopes(
  trx: TenantTransaction,
  asked: Iterable<ReindexScope>,
): Promise<ReindexScope[]> {
  const scopes = new Set(asked);
  if (scopes.has('whole')) scopes.delete('threads');
  if (scopes.has('whole') || scopes.has('earlier')) scopes.add('history');
  const order = (['whole', 'earlier', 'threads', 'history'] as const).filter((scope) =>
    scopes.has(scope),
  );
  for (const scope of order) await reindexOne(trx, scope);
  return order;
}

/**
 * The projection again, from the chain: what the migration runner runs in the run that applies 0031
 * (`whole`: every searchable artifact's latest version, every publication and every thread), 0088
 * (`earlier`: every earlier version, written apart, until #596 moves it to a resumable job), 0089
 * (`threads`: every thread's row alone) or 0091 (`history`: every place's words over every version,
 * from the projection), and what a changed projection runs. No scope touches another's rows but
 * `whole`, which holds `threads`; `whole` and `earlier` then make history again.
 */
export async function reindexSearch(
  trx: TenantTransaction,
  scope: ReindexScope = 'whole',
): Promise<void> {
  await reindexScopes(trx, [scope]);
}

async function reindexOne(trx: TenantTransaction, scope: ReindexScope): Promise<void> {
  if (scope === 'history') {
    await rebuildHistory(trx);
    return;
  }
  if (scope === 'threads') {
    await indexEveryThread(trx);
    return;
  }
  if (scope === 'earlier') {
    if (!(await earlierStored(trx))) return;
    await trx.deleteFrom('search_earlier').execute();
    await writeEveryEarlier(trx);
    return;
  }
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
    // History is made again after, from what this writes, once (`reindexScopes`).
    if (version) await indexVersion(trx, version, { fold: false });
  }
  const publications = await trx.selectFrom('publication').select('id').execute();
  for (const each of publications) await indexPublication(trx, each.id);
  await indexEveryThread(trx);
}

/**
 * Rewrites every earlier version's rows whose values name `person` from that version (#594, for
 * `search_earlier`): an erased person's name is then said by the fixed word in every version. Each
 * artifact under its lock, in id order, so its acts' flags are read as they stand (L1). Answers the
 * artifacts rewritten, whose history the erasure rebuilds.
 */
export async function rewriteEarlierNaming(
  trx: TenantTransaction,
  person: string,
): Promise<string[]> {
  if (!(await earlierStored(trx))) return [];
  const named = await trx
    .selectFrom('search_earlier')
    .select(['artifact_id', 'version_id'])
    .distinct()
    .where(naming(person))
    .orderBy('artifact_id')
    .orderBy('version_id')
    .execute();
  let locked: string | undefined;
  for (const each of named) {
    if (locked !== each.artifact_id) {
      await lockArtifact(trx, each.artifact_id);
      locked = each.artifact_id;
    }
    const version = await readVersion(trx, each.version_id);
    if (!version) continue;
    await trx
      .deleteFrom('search_earlier')
      .where('artifact_id', '=', each.artifact_id)
      .where('version_id', '=', each.version_id)
      .execute();
    const facts = await artifactFacts(trx, version.artifactId, version.kind);
    await writeEarlier(trx, placingOf(version, facts), await draftsOf(trx, version, facts));
  }
  return [...new Set(named.map((each) => each.artifact_id))];
}
