import type { StoredProfile } from '@alloy-works/domain';
import { sql } from 'kysely';
import { requestPublication, type PublicationRequestAnswer } from './publishing.js';
import { enqueueJob } from './queue.js';
import type { TenantTransaction } from './tables.js';

/**
 * **The warm range preview** (CNT-186, PUB-080; publishing.md, "The warm range preview"; the R22 plan,
 * R22-B): a request of kind `range` records the document's inputs once, as a preview's are, and a
 * range preview on it names the occurrence being edited and its author's editing session. Each save
 * the session records asks for a refresh; the worker shows the session's latest iteration of the
 * component in place of its version, compiles warm, and replaces the pages around the edit, as PNG
 * images, untagged by design (PUB-061).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A range preview as its author reads it, its pages by number. */
export interface RangePreview {
  readonly id: string;
  readonly requestId: string;
  readonly documentId: string;
  readonly requestedBy: string;
  readonly node: string;
  readonly componentId: string;
  readonly sessionId: string;
  readonly wanted: number;
  readonly made: number;
  /** The iteration the pages show, or null where they show the component's version. */
  readonly sequence: number | null;
  readonly pages: number | null;
  readonly range: { readonly from: number; readonly to: number } | null;
  readonly failure: string | null;
  readonly changedAt: Date;
}

interface Row {
  id: string;
  request_id: string;
  document_id: string;
  requested_by: string;
  node: string;
  component_id: string;
  session_id: string;
  wanted: number;
  made: number;
  sequence: number | null;
  pages: number | null;
  range_from: number | null;
  range_to: number | null;
  failure: string | null;
  changed_at: Date;
}

const rangeOf = (row: Row): RangePreview => ({
  id: row.id,
  requestId: row.request_id,
  documentId: row.document_id,
  requestedBy: row.requested_by,
  node: row.node,
  componentId: row.component_id,
  sessionId: row.session_id,
  wanted: row.wanted,
  made: row.made,
  sequence: row.sequence,
  pages: row.pages,
  range:
    row.range_from === null || row.range_to === null
      ? null
      : { from: row.range_from, to: row.range_to },
  failure: row.failure,
  changedAt: row.changed_at,
});

export type RangePreviewAnswer =
  | Exclude<PublicationRequestAnswer, { readonly answer: 'requested' }>
  | { readonly answer: 'node.missing' }
  | { readonly answer: 'requested'; readonly range: RangePreview };

/**
 * A range preview asked for, in the caller's transaction, `read` on the document decided before it
 * runs: the document's inputs recorded by `requestPublication` as a `range`, its job queued, and the
 * range preview on it, of `node` - an occurrence of the version, placing a component - for the
 * author's `session`.
 */
export async function requestRangePreview(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly version: string;
    readonly node: string;
    readonly session: string;
    readonly requester: string;
    readonly profile?: StoredProfile;
  },
): Promise<RangePreviewAnswer> {
  const asked = await requestPublication(trx, {
    documentId: input.documentId,
    version: input.version,
    formats: ['pdf'],
    requester: input.requester,
    kind: 'range',
    ...(input.profile === undefined ? {} : { profile: input.profile }),
  });
  if (asked.answer !== 'requested') return asked;
  const occurrence = await trx
    .selectFrom('publication_request_occurrence')
    .select('component_id')
    .where('request_id', '=', asked.request.id)
    .where('node', '=', input.node)
    .executeTakeFirst();
  if (!occurrence) return { answer: 'node.missing' };
  const { rows } = await sql<Row>`
    insert into range_preview (request_id, document_id, requested_by, node, component_id, session_id)
    values (${asked.request.id}, ${input.documentId}, ${input.requester}, ${input.node},
      ${occurrence.component_id}, ${input.session})
    returning *`.execute(trx);
  return { answer: 'requested', range: rangeOf(rows[0]!) };
}

/** A range preview by its id, its author's alone: undefined to anybody else, as to nobody. */
export async function readRangePreview(
  trx: TenantTransaction,
  id: string,
  by?: string,
): Promise<RangePreview | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`select * from range_preview where id = ${id}
    ${by === undefined ? sql`` : sql`and requested_by = ${by}`}`.execute(trx);
  return rows[0] && rangeOf(rows[0]);
}

/** The range preview a range request carries, for its job. */
export async function rangePreviewOf(
  trx: TenantTransaction,
  requestId: string,
): Promise<RangePreview | undefined> {
  const { rows } =
    await sql<Row>`select * from range_preview where request_id = ${requestId}`.execute(trx);
  return rows[0] && rangeOf(rows[0]);
}

/** A refresh asked for, after a save its session recorded: its job queued, and the count it is. */
export async function refreshRangePreview(
  trx: TenantTransaction,
  id: string,
  by: string,
): Promise<RangePreview | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`
    update range_preview set wanted = wanted + 1, changed_at = now()
     where id = ${id} and requested_by = ${by}
    returning *`.execute(trx);
  const range = rows[0] && rangeOf(rows[0]);
  if (range) await enqueueJob(trx, 'range', range.requestId);
  return range;
}

/** The session's latest iteration of the component, its author's, or undefined where it has none. */
export async function latestIteration(
  trx: TenantTransaction,
  range: RangePreview,
): Promise<{ readonly sequence: number; readonly content: unknown } | undefined> {
  return trx
    .selectFrom('iteration')
    .select(['sequence', 'content'])
    .where('artifact_id', '=', range.componentId)
    .where('session_id', '=', range.sessionId)
    .where('principal_id', '=', range.requestedBy)
    .orderBy('sequence', 'desc')
    .limit(1)
    .executeTakeFirst();
}

/**
 * The pages of a refresh recorded, replacing the range's: written only where it is newer than what is
 * there, so a slower refresh never puts back an older edit; and its request finished, once, at the
 * first. Answers whether it was written.
 */
export async function recordRangePages(
  trx: TenantTransaction,
  input: {
    readonly id: string;
    readonly made: number;
    readonly sequence: number | null;
    readonly pages: number;
    readonly range: { readonly from: number; readonly to: number };
    readonly images: readonly { readonly page: number; readonly png: Uint8Array }[];
  },
): Promise<boolean> {
  const { rows } = await sql<{ request_id: string }>`
    update range_preview set made = ${input.made}, sequence = ${input.sequence},
      pages = ${input.pages}, range_from = ${input.range.from}, range_to = ${input.range.to},
      failure = null
     where id = ${input.id} and made < ${input.made} and wanted >= ${input.made}
    returning request_id`.execute(trx);
  const written = rows[0];
  if (!written) return false;
  await sql`delete from range_page where range_id = ${input.id}`.execute(trx);
  for (const image of input.images) {
    await sql`insert into range_page (range_id, page, png)
      values (${input.id}, ${image.page}, ${Buffer.from(image.png)})`.execute(trx);
  }
  await sql`update publication_request set state = 'done', finished_at = now()
    where id = ${written.request_id} and state = 'queued'`.execute(trx);
  return true;
}

/** A refresh that could not be made, by its code alone: the pages before it stay. */
export async function failRangePreview(
  trx: TenantTransaction,
  requestId: string,
  code: string,
): Promise<void> {
  await sql`update range_preview set failure = ${code}, made = wanted where request_id = ${requestId}`.execute(
    trx,
  );
  // A first refresh that failed leaves nothing to refresh from: its request is finished, failed, so
  // the sweep takes it with the rest.
  await sql`update publication_request set state = 'failed', finished_at = now()
    where id = ${requestId} and kind = 'range' and state = 'queued'`.execute(trx);
}

/** A page of a range preview as PNG, its author's alone, or undefined where it holds no such page. */
export async function readRangePage(
  trx: TenantTransaction,
  id: string,
  by: string,
  page: number,
): Promise<Buffer | undefined> {
  if (!UUID.test(id) || !Number.isInteger(page)) return undefined;
  const { rows } = await sql<{ png: Buffer }>`
    select p.png from range_page p join range_preview r on r.id = p.range_id
     where p.range_id = ${id} and r.requested_by = ${by} and p.page = ${page}`.execute(trx);
  return rows[0]?.png;
}

/**
 * Range previews an hour past their last change, and their requests and pages with them (the R22
 * plan, R22-B): what the sweep removes, by count.
 */
export async function sweepRangePreviews(trx: TenantTransaction): Promise<number> {
  const { rows } = await sql<{ id: string }>`
    delete from publication_request r
     using range_preview p
     where p.request_id = r.id and r.kind = 'range'
       and p.changed_at <= now() - interval '1 hour'
       and r.finished_at is not null and r.finished_at <= now() - interval '1 hour'
    returning r.id`.execute(trx);
  return rows.length;
}
