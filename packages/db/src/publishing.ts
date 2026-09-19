import {
  readOutline,
  walkOutline,
  type OutlineDocument,
  type PublishFailure,
} from '@alloy-works/domain';
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
