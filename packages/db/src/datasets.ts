import { createHash } from 'node:crypto';
import {
  identityKey,
  parametersDigestInput,
  parseProvenance,
  parseProvenanceForWrite,
  type ParameterValues,
  type Provenance,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { mayReadArtifact } from './queryDefinitions.js';
import type { TenantTransaction } from './tables.js';
import { createArtifact, latestVersion, recordVersion, type StoredVersion } from './versions.js';

/**
 * Datasets and resolutions (data.md, "The dataset" and "The resolution, owned by the document"; the D3
 * plan, task 2). A stored result is a version of a dataset, whose identity is the question it answers;
 * what a binding holds in a document is the latest resolution row for it. Who may act is the route's
 * to decide, and the run is the connector's: these record what an act decided, in its transaction.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** The question a dataset answers: one definition, the same parameters, the same identity (DAT-084). */
export interface DatasetIdentity {
  readonly definition: string;
  /** SHA-256 over the parameters' canonical JSON (`parametersDigestInput`). */
  readonly parametersDigest: string;
  /** The identity as the source sees it: `service` for every run in D3. */
  readonly identityKey: string;
}

/** The identity of the dataset a run of a definition, with these values, as this identity, belongs to. */
export function datasetIdentity(input: {
  readonly definition: string;
  readonly parameters: ParameterValues;
  readonly identity: { readonly kind: 'service' };
}): DatasetIdentity {
  return {
    definition: input.definition,
    parametersDigest: sha256(parametersDigestInput(input.parameters)),
    identityKey: identityKey(input.identity),
  };
}

/** A dataset: its artifact, the space it is in - its definition's - and the question it answers. */
export interface StoredDataset extends DatasetIdentity {
  readonly id: string;
  readonly spaceId: string;
}

/** The dataset answering a question, or undefined where nothing has asked it yet. Never makes one. */
export async function datasetFor(
  trx: TenantTransaction,
  identity: DatasetIdentity,
): Promise<StoredDataset | undefined> {
  if (!UUID.test(identity.definition)) return undefined;
  const row = await trx
    .selectFrom('dataset as d')
    .innerJoin('artifact as a', 'a.id', 'd.artifact_id')
    .select(['d.artifact_id', 'a.space_id', 'd.parameters_digest', 'd.identity_key'])
    .where('d.query_definition', '=', identity.definition)
    .where('d.parameters_digest', '=', identity.parametersDigest)
    .where('d.identity_key', '=', identity.identityKey)
    .executeTakeFirst();
  return row
    ? {
        id: row.artifact_id,
        spaceId: row.space_id!,
        definition: identity.definition,
        parametersDigest: row.parameters_digest,
        identityKey: row.identity_key,
      }
    : undefined;
}

/** A dataset version recorded, or the latest one reused (D3-F). */
export interface RecordedDatasetVersion {
  readonly dataset: StoredDataset;
  readonly version: StoredVersion;
  readonly reused: boolean;
}

/**
 * Records a run's result as a version of the dataset its provenance identifies - the definition it
 * names, its parameters and its identity - making the dataset, with this as its first version, in its
 * definition's space where nothing has asked the question before. **The latest version is reused only
 * where the checksum, the definition version and the SQL that ran all equal this run's** (D3-F): a
 * version's content is its provenance (DAT-085), and a reused one naming a definition version or SQL
 * that did not run would be untrue of the run. Otherwise a new version is recorded, whatever its
 * checksum: a check compares it with what each document holds (D3-J).
 *
 * Two acts asking one question take turns on a lock on the question, held to the end of the caller's
 * transaction, so the second sees the first's dataset and version; an act recording several takes
 * them all first, with `lockDatasetQuestions`. The object holding the rows is the
 * caller's to have stored under the checksum first (D3-G). Throws on a provenance that is not a
 * record, or names a definition or connection version that is not one of theirs.
 */
export async function recordDatasetVersion(
  trx: TenantTransaction,
  input: { readonly provenance: Provenance; readonly author: string },
): Promise<RecordedDatasetVersion> {
  const provenance = parseProvenanceForWrite(input.provenance);
  const identity = datasetIdentity({
    definition: provenance.queryDefinition.artifact,
    parameters: provenance.parameters,
    identity: provenance.identity,
  });
  // Re-entrant: an act recording several takes them all first, in turn, with `lockDatasetQuestions`.
  await lockDatasetQuestions(trx, [provenance]);

  const found = await datasetFor(trx, identity);
  if (!found) {
    const definition = await trx
      .selectFrom('artifact')
      .select('space_id')
      .where('id', '=', identity.definition)
      .where('kind', '=', 'queryDefinition')
      .executeTakeFirst();
    if (!definition?.space_id) {
      throw new Error(
        `A dataset version's provenance names query definition ${identity.definition}, which this environment does not hold`,
      );
    }
    const version = await createArtifact(trx, {
      author: input.author,
      spaceId: definition.space_id,
      substance: { kind: 'dataset', content: provenance },
    });
    await trx
      .insertInto('dataset')
      .values({
        artifact_id: version.artifactId,
        query_definition: identity.definition,
        parameters_digest: identity.parametersDigest,
        identity_key: identity.identityKey,
      })
      .execute();
    return {
      dataset: { ...identity, id: version.artifactId, spaceId: definition.space_id },
      version,
      reused: false,
    };
  }

  const latest = await latestVersion(trx, found.id);
  if (!latest) throw new Error(`Dataset ${found.id} holds no version`);
  const held = parseProvenance(latest.content);
  if (
    held.checksum === provenance.checksum &&
    held.queryDefinition.version === provenance.queryDefinition.version &&
    held.ran.sql === provenance.ran.sql
  ) {
    return { dataset: found, version: latest, reused: true };
  }
  const answer = await recordVersion(trx, {
    artifactId: found.id,
    openedFrom: latest.id,
    author: input.author,
    substance: { kind: 'dataset', content: provenance },
  });
  switch (answer.answer) {
    case 'recorded':
      return { dataset: found, version: answer.version, reused: false };
    case 'version.unchanged':
      return { dataset: found, version: answer.current, reused: true };
    default:
      // Under the question's lock no other writer cuts this dataset, so neither can happen.
      throw new Error(`Dataset ${found.id} could not take a version: ${answer.answer}`);
  }
}

/** One resolution row: what a binding holds in a document from this act on. */
export interface StoredResolution {
  readonly id: string;
  readonly document: string;
  readonly node: string;
  readonly binding: string;
  /** SHA-256 over the binding's canonical form when it was resolved (D3-R). */
  readonly digest: string;
  readonly dataset: string;
  readonly version: string;
  readonly replaces: string | null;
  readonly act: 'resolve' | 'accept';
  readonly by: string;
  readonly at: Date;
}

/**
 * Adds a resolution row: from now, the binding of a node holds this dataset version in this document
 * (DAT-093), naming what it replaces - a version of the same dataset, or nothing - and who and when
 * (DAT-037). The rows are insert-only, so they are the audit trail. Whether the node and its binding
 * exist, and whether `replaces` is what the binding held, are the act's to have decided in this
 * transaction; the table holds the version to a dataset's, and what it replaces to the same dataset.
 */
export async function recordResolution(
  trx: TenantTransaction,
  input: {
    readonly document: string;
    readonly node: string;
    readonly binding: string;
    readonly digest: string;
    readonly version: string;
    readonly replaces: string | null;
    readonly act: 'resolve' | 'accept';
    readonly by: string;
  },
): Promise<StoredResolution> {
  const version = UUID.test(input.version)
    ? await trx
        .selectFrom('artifact_version')
        .select('artifact_id')
        .where('id', '=', input.version)
        .where('kind', '=', 'dataset')
        .executeTakeFirst()
    : undefined;
  if (!version)
    throw new Error(`A resolution holds a dataset version, and ${input.version} is none`);
  const row = await trx
    .insertInto('binding_resolution')
    .values({
      document_id: input.document,
      node_id: input.node,
      binding_id: input.binding,
      binding_digest: input.digest,
      dataset_version: input.version,
      dataset_id: version.artifact_id,
      replaces: input.replaces,
      act: input.act,
      resolved_by: input.by,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return {
    id: String(row.id),
    document: row.document_id,
    node: row.node_id,
    binding: row.binding_id,
    digest: row.binding_digest,
    dataset: row.dataset_id,
    version: row.dataset_version,
    replaces: row.replaces,
    act: row.act,
    by: row.resolved_by,
    at: row.resolved_at,
  };
}

/**
 * Takes transaction-scoped advisory locks on these keys, in one order whatever order they are asked
 * in: by the hashed key itself, which is what is locked, so two acts locking overlapping sets never
 * each hold what the other waits for. An advisory lock is the whole cluster's, and every tenant is a
 * schema of one database, so each key carries the tenant's schema: two tenants never wait on each
 * other. Postgres' advisory locks are re-entrant, so a key already held is taken again at no cost.
 */
async function lockInTurn(trx: TenantTransaction, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  const { rows } = await sql<{ key: string }>`
    select hashed::text as key
      from (select distinct hashtextextended(current_schema() || ':' || each, 0) as hashed
              from unnest(${[...keys]}::text[]) as each) keys
     order by hashed`.execute(trx);
  for (const { key } of rows) {
    await sql`select pg_advisory_xact_lock(${key}::bigint)`.execute(trx);
  }
}

/**
 * Takes the lock on what bindings hold in a document, held to the end of the caller's transaction:
 * every act that reads what a binding holds and then writes, or answers, from it - a resolve, a check
 * and an accept - takes this first, so two of them on one binding take turns and the second reads what
 * the first recorded. Several are taken in one order, whatever order they are asked in, and before any
 * lock on a question (`lockDatasetQuestions`), so two acts locking overlapping bindings never wait on
 * each other.
 */
export async function lockBindings(
  trx: TenantTransaction,
  document: string,
  bindings: readonly { readonly node: string; readonly binding: string }[],
): Promise<void> {
  await lockInTurn(
    trx,
    bindings.map(({ node, binding }) => `alloy-works:binding:${document}:${node}:${binding}`),
  );
}

/**
 * Takes the lock on each question these results answer - a definition, its parameters and its
 * identity - held to the end of the caller's transaction, in one order whatever order they are asked
 * in: an act recording several results takes them all before it records the first, so two acts
 * recording results of the same two questions never each hold what the other waits for.
 */
export async function lockDatasetQuestions(
  trx: TenantTransaction,
  provenances: readonly Provenance[],
): Promise<void> {
  await lockInTurn(
    trx,
    provenances.map((provenance) => {
      const identity = datasetIdentity({
        definition: provenance.queryDefinition.artifact,
        parameters: provenance.parameters,
        identity: provenance.identity,
      });
      return `alloy-works:dataset:${identity.definition}:${identity.parametersDigest}:${identity.identityKey}`;
    }),
  );
}

/** A dataset version as a resolution holds it: which, its number, and its provenance. */
export interface HeldVersion {
  readonly dataset: string;
  readonly version: string;
  readonly number: { readonly revision: number; readonly version: number };
  readonly provenance: Provenance;
}

/** What one binding holds in a document, and the newer result waiting for it, if any (D3-J). */
export interface HeldResolution extends Omit<StoredResolution, 'dataset' | 'version'> {
  readonly held: HeldVersion;
  /**
   * The newest version of the dataset held, where it was recorded after the version held and its
   * checksum differs: a revision a check found, which nothing resolves to until it is accepted.
   */
  readonly waiting: { readonly version: string; readonly provenance: Provenance } | null;
}

/**
 * What each binding holds in a document: the latest resolution for each node and binding, with its
 * version's provenance and any revision waiting (D3-J), by node and then binding. Whether a binding's
 * digest still matches the component version its node resolves to now - whether it is stale - is the
 * caller's to compare (D3-R).
 */
export async function resolutionsOf(
  trx: TenantTransaction,
  documentId: string,
): Promise<HeldResolution[]> {
  if (!UUID.test(documentId)) return [];
  const { rows } = await sql<{
    id: string;
    document_id: string;
    node_id: string;
    binding_id: string;
    binding_digest: string;
    dataset_id: string;
    dataset_version: string;
    replaces: string | null;
    act: 'resolve' | 'accept';
    resolved_by: string;
    resolved_at: Date;
    held_revision: number;
    held_version: number;
    held_content: unknown;
    newest_id: string;
    newest_revision: number;
    newest_version: number;
    newest_content: unknown;
  }>`
    select r.id, r.document_id, r.node_id, r.binding_id, r.binding_digest, r.dataset_id,
           r.dataset_version, r.replaces, r.act, r.resolved_by, r.resolved_at,
           held.revision_no as held_revision, held.version_no as held_version,
           held.content as held_content,
           newest.id as newest_id, newest.revision_no as newest_revision,
           newest.version_no as newest_version, newest.content as newest_content
      from (
        select distinct on (node_id, binding_id) *
          from binding_resolution
         where document_id = ${documentId}
         order by node_id, binding_id, id desc
      ) r
      join artifact_version held on held.id = r.dataset_version
      join lateral (
        select v.id, v.revision_no, v.version_no, v.content
          from artifact_version v
         where v.artifact_id = r.dataset_id
         order by v.revision_no desc, v.version_no desc
         limit 1
      ) newest on true
     order by r.node_id collate "C", r.binding_id collate "C"`.execute(trx);
  return rows.map((row) => {
    const provenance = parseProvenance(row.held_content);
    const newest = parseProvenance(row.newest_content);
    const later =
      row.newest_revision > row.held_revision ||
      (row.newest_revision === row.held_revision && row.newest_version > row.held_version);
    return {
      id: String(row.id),
      document: row.document_id,
      node: row.node_id,
      binding: row.binding_id,
      digest: row.binding_digest,
      replaces: row.replaces,
      act: row.act,
      by: row.resolved_by,
      at: new Date(row.resolved_at),
      held: {
        dataset: row.dataset_id,
        version: row.dataset_version,
        number: { revision: row.held_revision, version: row.held_version },
        provenance,
      },
      waiting:
        later && newest.checksum !== provenance.checksum
          ? { version: row.newest_id, provenance: newest }
          : null,
    };
  });
}

/** A dataset's name: the latest naming, who named it and when. */
export interface DatasetName {
  readonly name: string;
  readonly namedBy: string;
  readonly namedAt: Date;
}

/** Any control character: C0, DEL and C1. */
const CONTROL = /\p{Cc}/u;

/** Whether a name is one `dataset_name` takes: 1 to 200 characters, trimmed, no control, in NFC. */
function isDatasetName(name: string): boolean {
  const length = [...name].length;
  return (
    length >= 1 &&
    length <= 200 &&
    name === name.trim() &&
    !CONTROL.test(name) &&
    name === name.normalize('NFC')
  );
}

/**
 * Names a dataset (DAT-092; D3-N): a row, the latest the name, since an artifact row takes no update.
 * Who may is the route's to decide - `edit` on the dataset, in its definition's space.
 */
export async function nameDataset(
  trx: TenantTransaction,
  input: { readonly dataset: string; readonly name: string; readonly by: string },
): Promise<
  | ({ readonly answer: 'named' } & DatasetName)
  | { readonly answer: 'name.invalid' }
  | { readonly answer: 'dataset.missing' }
> {
  if (!isDatasetName(input.name)) return { answer: 'name.invalid' };
  if (!UUID.test(input.dataset)) return { answer: 'dataset.missing' };
  const dataset = await trx
    .selectFrom('dataset')
    .select('artifact_id')
    .where('artifact_id', '=', input.dataset)
    .executeTakeFirst();
  if (!dataset) return { answer: 'dataset.missing' };
  const row = await trx
    .insertInto('dataset_name')
    .values({ dataset_id: input.dataset, name: input.name, named_by: input.by })
    .returning(['name', 'named_by', 'named_at'])
    .executeTakeFirstOrThrow();
  return { answer: 'named', name: row.name, namedBy: row.named_by, namedAt: row.named_at };
}

/** A dataset's name, or null where nobody has named it. */
export async function datasetName(
  trx: TenantTransaction,
  datasetId: string,
): Promise<DatasetName | null> {
  if (!UUID.test(datasetId)) return null;
  const row = await trx
    .selectFrom('dataset_name')
    .select(['name', 'named_by', 'named_at'])
    .where('dataset_id', '=', datasetId)
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ? { name: row.name, namedBy: row.named_by, namedAt: row.named_at } : null;
}

/** What uses something: those the caller may read, by title, and how many more there are. */
export interface Uses {
  readonly readable: readonly { readonly id: string; readonly title: string }[];
  readonly others: number;
}

/** Splits artifacts into those a principal may read and a count of the rest, never naming those. */
async function splitByReading(
  trx: TenantTransaction,
  principalId: string,
  rows: readonly { readonly id: string; readonly space_id: string; readonly title: string }[],
): Promise<Uses> {
  const readable = await loadReadableSet(trx, principalId);
  const shown = rows.filter(
    (row) =>
      readable !== undefined && mayReadArtifact(readable, { id: row.id, spaceId: row.space_id }),
  );
  return {
    readable: shown.map(({ id, title }) => ({ id, title })),
    others: rows.length - shown.length,
  };
}

/**
 * The components whose latest versions hold a binding naming a definition (DAT-016; D3-M): computed
 * when asked, never stored beside what it counts (the plan's Q1). The definition's identifier reaches
 * the path as a variable, never as its text, and only a binding's own `query` is compared - a key
 * value or a literal spelling the identifier names nothing.
 */
export async function componentsBinding(
  trx: TenantTransaction,
  principalId: string,
  definitionId: string,
): Promise<Uses> {
  if (!UUID.test(definitionId)) return { readable: [], others: 0 };
  const { rows } = await sql<{ id: string; space_id: string; title: string }>`
    select latest.artifact_id as id, a.space_id, latest.content ->> 'title' as title
      from (
        select distinct on (v.artifact_id) v.artifact_id, v.content
          from artifact_version v
         where v.kind = 'component'
         order by v.artifact_id, v.revision_no desc, v.version_no desc
      ) latest
      join artifact a on a.id = latest.artifact_id
     where jsonb_path_exists(
             latest.content,
             '$.** ? (@.type == "binding" && @.query == $id)',
             jsonb_build_object('id', ${definitionId}::text)
           )
     order by latest.content ->> 'title' collate "C", latest.artifact_id`.execute(trx);
  return splitByReading(trx, principalId, rows);
}

/**
 * The documents where a binding holds a result of a definition, or of a connection (DAT-016, DAT-064;
 * D3-M): each document whose latest resolution for some node and binding holds a version of one of
 * the definition's datasets, or a version whose provenance ran on the connection. Computed when asked.
 */
export async function documentsResolving(
  trx: TenantTransaction,
  principalId: string,
  target: { readonly definition: string } | { readonly connection: string },
): Promise<Uses> {
  const id = 'definition' in target ? target.definition : target.connection;
  if (!UUID.test(id)) return { readable: [], others: 0 };
  const matches =
    'definition' in target
      ? sql`d.query_definition = ${id}`
      : sql`held.content -> 'connection' ->> 'artifact' = ${id}`;
  const { rows } = await sql<{ id: string; space_id: string; title: string }>`
    select a.id, a.space_id, outline.content ->> 'title' as title
      from artifact a
      join lateral (
        select v.content
          from artifact_version v
         where v.artifact_id = a.id
         order by v.revision_no desc, v.version_no desc
         limit 1
      ) outline on true
     where a.kind = 'document'
       and exists (
         select 1
           from (
             select distinct on (r.node_id, r.binding_id) r.dataset_id, r.dataset_version
               from binding_resolution r
              where r.document_id = a.id
              order by r.node_id, r.binding_id, r.id desc
           ) latest
           join dataset d on d.artifact_id = latest.dataset_id
           join artifact_version held on held.id = latest.dataset_version
          where ${matches}
       )
     order by outline.content ->> 'title' collate "C", a.id`.execute(trx);
  return splitByReading(trx, principalId, rows);
}
