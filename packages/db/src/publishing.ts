import {
  readContent,
  readOutline,
  walkOutline,
  type ContentDocument,
  type NumberingTable,
  type OutlineDocument,
  type PublishFailure,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { readableComponents } from './documents.js';
import { enqueueJob } from './queue.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion } from './versions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What resolving one occurrence came to, as its publisher: the version it takes, or why none. */
export type OccurrenceOutcome =
  | {
      readonly node: string;
      readonly outcome: 'resolved';
      readonly component: string;
      readonly version: string;
    }
  | { readonly node: string; readonly outcome: 'unreadable' }
  | { readonly node: string; readonly outcome: 'unresolved' };

/**
 * Every reference in the outline resolved as one principal (decision C; PUB-094, issue #143): `latest`
 * to the component's head, `pinned` to its pin. **A component the principal may not read is never
 * read** - both version queries are restricted to the readable set in the query itself, as
 * `numberingInputs`' are - and its occurrence is `unreadable`, as is one naming no component at all,
 * so the answer cannot tell the two apart. `approved` resolves to nothing until revisions exist, and a
 * pin that is not the component's is refused again here; both are `unresolved`. The two queries are
 * `numberingInputs`' shape without the content; that function could be built on this one, and is left
 * alone so a publishing plan does not move structure's tested function.
 */
export async function resolveOccurrences(
  trx: TenantTransaction,
  outline: OutlineDocument,
  principalId: string,
): Promise<OccurrenceOutcome[]> {
  const references: {
    node: string;
    component: string;
    pinned: string | null;
    approved: boolean;
  }[] = [];
  walkOutline(outline.nodes, (node) => {
    if (node.type !== 'reference') return;
    references.push({
      node: node.id,
      component: node.component,
      pinned: node.mode.kind === 'pinned' ? node.mode.version : null,
      approved: node.mode.kind === 'approved',
    });
  });
  const readable = await readableComponents(
    trx,
    principalId,
    references.map((each) => each.component),
  );
  const latest = [
    ...new Set(
      references
        .filter((each) => readable.has(each.component) && each.pinned === null && !each.approved)
        .map((each) => each.component),
    ),
  ];
  const pinned = [
    ...new Set(
      references.flatMap((each) =>
        readable.has(each.component) && each.pinned !== null ? [each.pinned] : [],
      ),
    ),
  ];
  const heads =
    latest.length === 0
      ? []
      : await trx
          .selectFrom('artifact as a')
          .where('a.id', 'in', latest)
          .innerJoinLateral(
            (eb) =>
              eb
                .selectFrom('artifact_version as v')
                .select(['v.id', 'v.artifact_id'])
                .whereRef('v.artifact_id', '=', 'a.id')
                .orderBy('v.revision_no', 'desc')
                .orderBy('v.version_no', 'desc')
                .limit(1)
                .as('head'),
            (join) => join.onTrue(),
          )
          .select(['head.id', 'head.artifact_id'])
          .execute();
  // Restricted to the readable set in the query itself, as numberingInputs' pins are (F7): a pin to a
  // version of a component the principal may not read is never selected, whichever reference names it.
  const pins =
    pinned.length === 0
      ? []
      : await trx
          .selectFrom('artifact_version')
          .select(['id', 'artifact_id'])
          .where('id', 'in', pinned)
          .where('artifact_id', 'in', [...readable])
          .execute();
  const headOf = new Map(heads.map((row) => [row.artifact_id, row.id]));
  const pinOf = new Map(pins.map((row) => [row.id, row.artifact_id]));

  return references.map((reference): OccurrenceOutcome => {
    const { node, component } = reference;
    if (!readable.has(component)) return { node, outcome: 'unreadable' };
    if (reference.approved) return { node, outcome: 'unresolved' };
    if (reference.pinned !== null) {
      return pinOf.get(reference.pinned) === component
        ? { node, outcome: 'resolved', component, version: reference.pinned }
        : { node, outcome: 'unresolved' };
    }
    const head = headOf.get(component);
    return head === undefined
      ? { node, outcome: 'unresolved' }
      : { node, outcome: 'resolved', component, version: head };
  });
}

export type PublicationRequestAnswer =
  | {
      readonly answer: 'requested';
      readonly request: { readonly id: string; readonly state: 'queued' };
    }
  /**
   * The document is not at the version the caller named: they would publish what they have not seen.
   * The current version by its id alone - its outline names components and pinned versions the
   * caller may not read, so it is never handed back from here (IAM-073).
   */
  | { readonly answer: 'version.precondition'; readonly current: string }
  /** A format the fixed template cannot make (PUB-014): only `pdf` until the layout slice. */
  | { readonly answer: 'format.unsupported' }
  | { readonly answer: 'document.missing' };

/**
 * One publish asked for, decided and recorded in the caller's transaction (docs/design/publishing.md,
 * "Who may publish"): `publish` has been decided on the document before this runs, under the access
 * epoch's shared lock. It refuses a stale version or an unsupported format before recording anything;
 * otherwise it resolves every occurrence **as the publisher**, records the request with the failures
 * resolving found - each naming its node and nothing else (issue #143) - one row per resolved
 * occurrence, and the job, all in one transaction. A request with failures is still queued: `assemble`
 * adds its own for what the publisher can read, and the author is told once (PUB-052).
 */
export async function requestPublication(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly version: string;
    readonly formats: readonly string[];
    readonly requester: string;
  },
): Promise<PublicationRequestAnswer> {
  const latest = await latestVersion(trx, input.documentId);
  if (!latest || latest.kind !== 'document') return { answer: 'document.missing' };
  if (latest.id !== input.version) return { answer: 'version.precondition', current: latest.id };
  if (input.formats.length !== 1 || input.formats[0] !== 'pdf') {
    return { answer: 'format.unsupported' };
  }
  const read = readOutline(latest.content, { artifact: input.documentId, version: latest.id });
  if (!read.ok) throw new Error(`The document ${input.documentId} at ${latest.id} does not read`);

  const outcomes = await resolveOccurrences(trx, read.outline, input.requester);
  const failures: PublishFailure[] = outcomes.flatMap((each) =>
    each.outcome === 'resolved'
      ? []
      : [
          {
            stage: 'resolve' as const,
            code:
              each.outcome === 'unreadable'
                ? ('occurrence_unreadable' as const)
                : ('occurrence_unresolved' as const),
            node: each.node,
            block: null,
            detail: null,
          },
        ],
  );
  const request = await trx
    .insertInto('publication_request')
    .values({
      document_id: input.documentId,
      document_version_id: latest.id,
      formats: ['pdf'],
      requested_by: input.requester,
      failures: JSON.stringify(failures),
    })
    .returning(['id'])
    .executeTakeFirstOrThrow();
  const resolved = outcomes.flatMap((each) => (each.outcome === 'resolved' ? [each] : []));
  if (resolved.length > 0) {
    await trx
      .insertInto('publication_request_occurrence')
      .values(
        resolved.map((each) => ({
          request_id: request.id,
          node: each.node,
          component_id: each.component,
          version_id: each.version,
        })),
      )
      .execute();
  }
  await enqueueJob(trx, 'publish', request.id);
  return { answer: 'requested', request: { id: request.id, state: 'queued' } };
}

/** What the worker assembles from: everything recorded at the request, read as the tenant. */
export interface PublicationInputs {
  readonly request: {
    readonly id: string;
    readonly documentId: string;
    readonly documentVersionId: string;
    readonly requestedBy: string;
    readonly requestedAt: Date;
    readonly spaceId: string;
  };
  readonly outline: OutlineDocument;
  readonly occurrences: ReadonlyMap<
    string,
    { readonly version: string; readonly content: ContentDocument }
  >;
  readonly refused: readonly PublishFailure[];
}

/**
 * A queued request's inputs, or undefined when there is nothing to do - finished by another attempt.
 * The worker has no principal and decides nothing: it reads exactly the versions the request recorded
 * as its publisher resolved them, and no other.
 */
export async function publicationInputs(
  trx: TenantTransaction,
  requestId: string,
): Promise<PublicationInputs | undefined> {
  const request = await trx
    .selectFrom('publication_request as r')
    .innerJoin('artifact as a', 'a.id', 'r.document_id')
    .innerJoin('artifact_version as v', 'v.id', 'r.document_version_id')
    .select([
      'r.id',
      'r.document_id',
      'r.document_version_id',
      'r.requested_by',
      'r.requested_at',
      'r.state',
      'r.failures',
      'a.space_id',
      'v.content',
    ])
    .where('r.id', '=', requestId)
    .executeTakeFirst();
  if (!request || request.state !== 'queued') return undefined;
  const read = readOutline(request.content, {
    artifact: request.document_id,
    version: request.document_version_id,
  });
  if (!read.ok) {
    throw new Error(
      `The document ${request.document_id} at ${request.document_version_id} does not read`,
    );
  }
  const rows = await trx
    .selectFrom('publication_request_occurrence as o')
    .innerJoin('artifact_version as v', 'v.id', 'o.version_id')
    .select(['o.node', 'o.version_id', 'o.component_id', 'v.content'])
    .where('o.request_id', '=', requestId)
    .execute();
  const occurrences = new Map<string, { version: string; content: ContentDocument }>();
  for (const row of rows) {
    const content = readContent(row.content, {
      artifact: row.component_id,
      version: row.version_id,
    });
    // A stored version that does not read is a broken store, not the author's to fix: thrown, and so
    // retried and then recorded as the engine's stage.
    if (!content.ok) {
      throw new Error(`The component ${row.component_id} at ${row.version_id} does not read`);
    }
    occurrences.set(row.node, { version: row.version_id, content: content.document });
  }
  return {
    request: {
      id: request.id,
      documentId: request.document_id,
      documentVersionId: request.document_version_id,
      requestedBy: request.requested_by,
      requestedAt: request.requested_at,
      spaceId: request.space_id!,
    },
    outline: read.outline,
    occurrences,
    // Written only by requestPublication, whose failures are `PublishFailure`s it built itself - each
    // of the resolve stage, naming a node and nothing else - so they are read back without a parse.
    refused: request.failures as PublishFailure[],
  };
}

/** A request that ended without a publication: its failures, all at once, and nothing else. */
export async function failPublicationRequest(
  trx: TenantTransaction,
  requestId: string,
  failures: readonly PublishFailure[],
): Promise<void> {
  await trx
    .updateTable('publication_request')
    .set({ state: 'failed', failures: JSON.stringify(failures), finished_at: sql<Date>`now()` })
    .where('id', '=', requestId)
    .where('state', '=', 'queued')
    .execute();
}

export interface NewPublication {
  readonly requestId: string;
  readonly engineVersion: string;
  readonly templateVersion: number;
  readonly pipelineVersion: string;
  readonly fonts: readonly { readonly file: string; readonly sha256: string }[];
  readonly dataSha256: string;
  readonly numbering: NumberingTable;
  readonly output: { readonly key: string; readonly sha256: string; readonly bytes: number };
}

/**
 * The publication, inserted whole in one transaction once its output is stored (PUB-053): its
 * artifact in the document's space, its record, every version it read, and its output - and the
 * request marked done. **The request's row is locked first**, so a second worker racing an expired
 * lease waits, then finds it done and inserts nothing. Answers the publication's id, or undefined where
 * the request had already finished.
 *
 * A request still carrying failures - an occurrence its publisher could not read or resolve - has no
 * publication to record: `assemble` refuses it, so reaching here with one is a bug in the caller. It
 * throws before inserting anything rather than leaving the refusal to 0017's
 * `publication_request_done_without_failures`, which would only catch it at the last statement.
 */
export async function recordPublication(
  trx: TenantTransaction,
  input: NewPublication,
): Promise<string | undefined> {
  const request = await trx
    .selectFrom('publication_request as r')
    .innerJoin('artifact as a', 'a.id', 'r.document_id')
    .select([
      'r.id',
      'r.state',
      'r.document_id',
      'r.document_version_id',
      'r.requested_by',
      'r.requested_at',
      'r.failures',
      'a.space_id',
    ])
    .where('r.id', '=', input.requestId)
    .forUpdate('r')
    .executeTakeFirst();
  if (!request || request.state !== 'queued') return undefined;
  if (request.failures.length > 0) {
    throw new Error(
      `The request ${request.id} carries failures, so it has no publication to record: fail it instead`,
    );
  }
  // All or nothing within the caller's transaction too: a failure part way - a refused row, or a lost
  // connection after a statement ran - rolls back to here before it is re-thrown, so a caller that
  // catches it and carries on (to fail the request) keeps no part of the publication. 0017's
  // `publication_recorded_whole` refuses at commit whatever a caller that skipped this left.
  await sql`savepoint record_publication`.execute(trx);
  try {
    const id = await insertPublication(trx, request, input);
    await sql`release savepoint record_publication`.execute(trx);
    return id;
  } catch (error) {
    // The failure that brought it here is the one reported. Where rolling back fails as well - the
    // connection is gone - the transaction cannot commit, and the check at commit stands regardless.
    await sql`rollback to savepoint record_publication`.execute(trx).catch(() => undefined);
    throw error;
  }
}

async function insertPublication(
  trx: TenantTransaction,
  request: {
    readonly id: string;
    readonly document_id: string;
    readonly document_version_id: string;
    readonly requested_by: string;
    readonly requested_at: Date;
    readonly space_id: string | null;
  },
  input: NewPublication,
): Promise<string> {
  const artifact = await trx
    .insertInto('artifact')
    .values({ kind: 'publication', space_id: request.space_id })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('publication')
    .values({
      id: artifact.id,
      request_id: request.id,
      document_id: request.document_id,
      document_version_id: request.document_version_id,
      publisher: request.requested_by,
      published_at: request.requested_at,
      approval: 'none',
      formats: ['pdf'],
      engine: 'typst',
      engine_version: input.engineVersion,
      template: 'publication',
      template_version: input.templateVersion,
      pipeline_version: input.pipelineVersion,
      fonts: JSON.stringify(input.fonts),
      data_sha256: input.dataSha256,
      numbering: JSON.stringify(input.numbering),
    })
    .execute();
  const occurrences = await trx
    .selectFrom('publication_request_occurrence')
    .select(['node', 'version_id'])
    .where('request_id', '=', request.id)
    .execute();
  await trx
    .insertInto('publication_input')
    .values([
      { publication_id: artifact.id, version_id: request.document_version_id, node: null },
      ...occurrences.map((each) => ({
        publication_id: artifact.id,
        version_id: each.version_id,
        node: each.node,
      })),
    ])
    .execute();
  await trx
    .insertInto('publication_output')
    .values({
      publication_id: artifact.id,
      format: 'pdf',
      object_key: input.output.key,
      sha256: input.output.sha256,
      bytes: input.output.bytes,
      standard: 'ua-1',
    })
    .execute();
  await trx
    .updateTable('publication_request')
    .set({ state: 'done', finished_at: sql<Date>`now()` })
    .where('id', '=', request.id)
    .execute();
  return artifact.id;
}

/** A request as its requester is shown it. */
export interface StoredPublicationRequest {
  readonly id: string;
  readonly documentId: string;
  readonly requestedBy: string;
  readonly state: 'queued' | 'done' | 'failed';
  readonly failures: readonly PublishFailure[];
  readonly publication: string | null;
}

/**
 * One request, with the publication it made, if any; undefined when this environment holds none of
 * that id. It decides nothing: who may be shown it is the caller's to decide, by `requestedBy`. Its
 * failures are written only by `requestPublication` and `failPublicationRequest`, each a
 * `PublishFailure` built in code - an unreadable place carrying its node alone - so they are read back
 * without a parse.
 */
export async function readPublicationRequest(
  trx: TenantTransaction,
  id: string,
): Promise<StoredPublicationRequest | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx
    .selectFrom('publication_request as r')
    .leftJoin('publication as p', 'p.request_id', 'r.id')
    .select([
      'r.id',
      'r.document_id',
      'r.requested_by',
      'r.state',
      'r.failures',
      'p.id as publication',
    ])
    .where('r.id', '=', id)
    .executeTakeFirst();
  return (
    row && {
      id: row.id,
      documentId: row.document_id,
      requestedBy: row.requested_by,
      state: row.state,
      failures: row.failures as PublishFailure[],
      publication: row.publication,
    }
  );
}

/** A publication as a reader is shown it: its record, and its outputs by key. */
export interface StoredPublication {
  readonly id: string;
  readonly documentId: string;
  readonly documentVersion: { readonly id: string; readonly number: string };
  readonly title: string;
  readonly publisher: { readonly id: string; readonly displayName: string | null };
  readonly publishedAt: Date;
  readonly approval: 'none';
  readonly formats: readonly string[];
  readonly engine: { readonly name: 'typst'; readonly version: string };
  readonly template: { readonly name: 'publication'; readonly version: number };
  readonly pipelineVersion: string;
  readonly outputs: readonly {
    readonly format: 'pdf';
    readonly key: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly standard: 'ua-1';
  }[];
}

/** A publication as a listing shows it: its record without its outputs. */
export type PublicationSummary = Omit<StoredPublication, 'outputs'>;

const publicationColumns = [
  'p.id',
  'p.document_id',
  'p.document_version_id',
  'p.published_at',
  'p.approval',
  'p.formats',
  'p.engine_version',
  'p.template_version',
  'p.pipeline_version',
  'pr.id as publisher_id',
  'pr.display_name as publisher_name',
  'v.revision_no',
  'v.version_no',
] as const;

/**
 * One publication, or undefined where this environment holds no publication of that id - a
 * document's or a component's id among them. It decides nothing: `read` on the publication artifact
 * is the caller's to decide, before it asks (decision D).
 */
export async function readPublication(
  trx: TenantTransaction,
  id: string,
): Promise<StoredPublication | undefined> {
  if (!UUID.test(id)) return undefined;
  const row = await trx
    .selectFrom('publication as p')
    .innerJoin('principal as pr', 'pr.id', 'p.publisher')
    .innerJoin('artifact_version as v', 'v.id', 'p.document_version_id')
    .select([...publicationColumns, sql<string>`v.content ->> 'title'`.as('title')])
    .where('p.id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  const outputs = await trx
    .selectFrom('publication_output')
    .select(['format', 'object_key', 'sha256', 'bytes', 'standard'])
    .where('publication_id', '=', id)
    .orderBy('format')
    .execute();
  return {
    ...summaryOf(row),
    outputs: outputs.map((each) => ({
      format: each.format,
      key: each.object_key,
      sha256: each.sha256,
      bytes: each.bytes,
      standard: each.standard,
    })),
  };
}

/**
 * A document's publications the principal may read, newest first (PUB-048). Filtered in the query by
 * the one readable-set predicate every listing uses, over the **publication** artifacts, so a grant
 * on the document alone reaches none of them (decision D), and one the principal may not read leaves
 * no count, place or gap behind. A publication's time is to the second, so ties are broken by when
 * each was recorded. It does not ask whether the id is a document's: a component's lists nothing,
 * which the caller must answer as no such document. Undefined when the tenant holds no such principal.
 */
export async function listPublications(
  trx: TenantTransaction,
  documentId: string,
  principalId: string,
): Promise<readonly PublicationSummary[] | undefined> {
  const readable = await loadReadableSet(trx, principalId);
  if (!readable) return undefined;
  const rows = await trx
    .selectFrom('publication as p')
    .innerJoin('artifact as a', 'a.id', 'p.id')
    .innerJoin('principal as pr', 'pr.id', 'p.publisher')
    .innerJoin('artifact_version as v', 'v.id', 'p.document_version_id')
    .select([...publicationColumns, sql<string>`v.content ->> 'title'`.as('title')])
    .where('p.document_id', '=', documentId)
    .where((eb) => readableArtifacts(eb, readable))
    .orderBy('p.published_at', 'desc')
    .orderBy('a.created_at', 'desc')
    .orderBy('p.id')
    .execute();
  return rows.map(summaryOf);
}

function summaryOf(row: {
  id: string;
  document_id: string;
  document_version_id: string;
  title: string;
  published_at: Date;
  approval: 'none';
  formats: string[];
  engine_version: string;
  template_version: number;
  pipeline_version: string;
  publisher_id: string;
  publisher_name: string | null;
  revision_no: number;
  version_no: number;
}): PublicationSummary {
  return {
    id: row.id,
    documentId: row.document_id,
    documentVersion: {
      id: row.document_version_id,
      number: `${row.revision_no}.${row.version_no}`,
    },
    title: row.title,
    publisher: { id: row.publisher_id, displayName: row.publisher_name },
    publishedAt: row.published_at,
    approval: row.approval,
    formats: row.formats,
    engine: { name: 'typst', version: row.engine_version },
    template: { name: 'publication', version: row.template_version },
    pipelineVersion: row.pipeline_version,
  };
}
