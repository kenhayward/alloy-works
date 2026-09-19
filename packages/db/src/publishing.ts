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
import { readableComponents } from './documents.js';
import { enqueueJob } from './queue.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion } from './versions.js';

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
    // Written only by requestPublication, from the closed vocabulary (the stored-shape check, row 4).
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
    .set({ state: 'failed', failures: JSON.stringify(failures), finished_at: new Date() })
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
