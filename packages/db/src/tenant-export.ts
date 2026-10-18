import { sql, type RawBuilder } from 'kysely';
import type { KeptExport } from './audit-export.js';
import {
  checkedLimit,
  isListingRequest,
  keysetPage,
  listingSorts,
  snapshotFor,
  type Listed,
  type ListingRequest,
  type SortOf,
} from './listing.js';
import { enqueueJob } from './queue.js';
import type { TenantTransaction } from './tables.js';

/**
 * **The tenant's export** (API-044; the R21 plan, R21-B): one archive of the tenant's content as JSON
 * Lines, a part each, with the bytes its assets and publications hold by their hash and a manifest of
 * what it leaves out. Asked for by an administrator, written by a job, kept seven days.
 */

/** How long a written export is kept before its archive is swept (R21-B). */
export const EXPORT_KEPT_DAYS = 7;

/** An export of the tenant as its row holds it (0118). */
export interface TenantExport {
  readonly id: string;
  readonly requestedBy: string | null;
  readonly requestedAt: Date;
  readonly snapshot: string;
  readonly state: 'queued' | 'done' | 'failed' | 'expired';
  readonly key: string | null;
  readonly sha256: string | null;
  readonly bytes: number | null;
  readonly counts: Readonly<Record<string, number>> | null;
  readonly finishedAt: Date | null;
  /** When its archive is swept: seven days after it was written; null until then. */
  readonly expiresAt: Date | null;
}

interface Row {
  id: string;
  requested_by: string | null;
  requested_at: Date;
  snapshot: string;
  state: TenantExport['state'];
  object_key: string | null;
  sha256: string | null;
  bytes: string | null;
  counts: Record<string, number> | null;
  finished_at: Date | null;
}

const exportOf = (row: Row): TenantExport => ({
  id: row.id,
  requestedBy: row.requested_by,
  requestedAt: row.requested_at,
  snapshot: row.snapshot,
  state: row.state,
  key: row.object_key,
  sha256: row.sha256,
  bytes: row.bytes === null ? null : Number(row.bytes),
  counts: row.counts,
  finishedAt: row.finished_at,
  expiresAt:
    row.finished_at === null || row.state === 'failed'
      ? null
      : new Date(row.finished_at.getTime() + EXPORT_KEPT_DAYS * 86_400_000),
});

const COLUMNS = sql`id, requested_by, requested_at, snapshot::text as snapshot, state, object_key,
  sha256, bytes::text as bytes, counts, finished_at`;

/** An export asked for, in this transaction's snapshot, and its job queued in the same one. */
export async function requestTenantExport(
  trx: TenantTransaction,
  principalId: string,
): Promise<TenantExport> {
  const { rows } = await sql<Row>`
    insert into tenant_export (requested_by, requested_at, snapshot)
      values (${principalId}, clock_timestamp(), pg_current_snapshot())
    returning ${COLUMNS}`.execute(trx);
  const made = rows[0]!;
  await enqueueJob(trx, 'tenant_export', made.id);
  return exportOf(made);
}

/** An export by its id, or undefined where the tenant holds none. */
export async function readTenantExport(
  trx: TenantTransaction,
  id: string,
): Promise<TenantExport | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`select ${COLUMNS} from tenant_export where id = ${id}`.execute(
    trx,
  );
  return rows[0] && exportOf(rows[0]);
}

/** The tenant's exports, the newest first, a page at a time (API-007). */
export async function listTenantExports(
  trx: TenantTransaction,
  request: ListingRequest<SortOf<'tenantExports'>> = { limit: 50 },
): Promise<Listed<TenantExport>> {
  const limit = checkedLimit(request.limit);
  const { types, order } = listingSorts.tenantExports.requested;
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  // Rows are inserted and moved through their states in place: a walk is over the rows as they stand.
  const inner = sql`select ${COLUMNS}, requested_at as sort_key_0, requested_at::text as sort_text_0
    from tenant_export`;
  const { rows, next } = await keysetPage<Row>(
    trx,
    inner,
    types,
    request.order ?? order,
    limit,
    request.after,
  );
  return { items: rows.map(exportOf), next, snapshot: await snapshotFor(trx, request.snapshot) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The parts an export holds, a JSON Lines file each, in the order it writes them. */
export const EXPORT_PARTS = [
  'artifacts',
  'versions',
  'relationships',
  'baselines',
  'publications',
] as const;
export type ExportPart = (typeof EXPORT_PARTS)[number];

const visible = (column: string, snapshot: string): RawBuilder<boolean> =>
  sql<boolean>`pg_visible_in_snapshot(${sql.ref(column)}, ${snapshot}::pg_snapshot)`;

/**
 * Each part's rows after `after`, by id, as its JSON Lines hold them. The version chain, the artifacts
 * it is of and the publications are read as of the export's snapshot, so no version is exported
 * without its artifact (the R21 final review); a baseline and a relationship as made by its request -
 * a relationship as it then stands, since one is changed in place.
 */
function partQuery(
  part: ExportPart,
  asked: TenantExport,
  after: string | undefined,
  limit: number,
): RawBuilder<{ id: string; line: Record<string, unknown> }> {
  const past = after === undefined ? sql`true` : sql`x.id > ${after}::uuid`;
  const asOf = asked.requestedAt;
  switch (part) {
    case 'artifacts':
      return sql`select x.id, jsonb_build_object('id', x.id, 'kind', x.kind, 'space', x.space_id,
          'createdAt', x.created_at) as line
        from artifact x
        where exists (select 1 from artifact_version v where v.artifact_id = x.id
            and (v.written_by is null or ${visible('v.written_by', asked.snapshot)}))
          and ${past}
        order by x.id limit ${limit}`;
    case 'versions':
      return sql`select x.id, jsonb_build_object('id', x.id, 'artifact', x.artifact_id,
          'kind', x.kind, 'revision', x.revision_no, 'version', x.version_no, 'author', x.author_id,
          'content', x.content, 'contentHash', x.content_hash, 'restoredFrom', x.restored_from,
          'line', x.line_id, 'createdAt', x.created_at) as line
        from artifact_version x
        where (x.written_by is null or ${visible('x.written_by', asked.snapshot)}) and ${past}
        order by x.id limit ${limit}`;
    case 'relationships':
      return sql`select x.id, jsonb_build_object('id', x.id, 'type', x.type_id,
          'from', jsonb_build_object('id', x.from_id, 'kind', x.from_kind, 'version', x.from_version),
          'to', jsonb_build_object('id', x.to_id, 'kind', x.to_kind, 'version', x.to_version),
          'fields', x.field_values, 'createdBy', x.created_by, 'createdAt', x.created_at,
          'changedAt', x.changed_at) as line
        from relationship x where x.created_at <= ${asOf} and ${past} order by x.id limit ${limit}`;
    case 'baselines':
      return sql`select x.id, jsonb_build_object('id', x.id, 'document', x.document_id,
          'name', x.name, 'documentVersion', x.document_version_id,
          'layoutVersion', x.layout_version_id, 'themeVersion', x.theme_version_id,
          'templateVersion', x.template_version_id, 'madeBy', x.made_by, 'madeAt', x.made_at,
          'digest', x.digest,
          'pins', coalesce((select jsonb_agg(jsonb_build_object('node', p.node,
              'version', p.version_id, 'artifact', p.artifact_id, 'kind', p.kind)
              order by p.artifact_id, p.version_id)
            from baseline_pin p where p.baseline_id = x.id), '[]'::jsonb)) as line
        from baseline x where x.made_at <= ${asOf} and ${past} order by x.id limit ${limit}`;
    case 'publications':
      return sql`select x.id, jsonb_build_object('id', x.id, 'request', x.request_id,
          'document', x.document_id, 'documentVersion', x.document_version_id,
          'publisher', x.publisher, 'publishedAt', x.published_at, 'engine', x.engine_version,
          'template', x.template_version, 'pipeline', x.pipeline_version,
          'dataSha256', x.data_sha256,
          'outputs', coalesce((select jsonb_agg(jsonb_build_object('format', o.format,
              'sha256', o.sha256, 'bytes', o.bytes, 'standard', o.standard) order by o.format)
            from publication_output o where o.publication_id = x.id), '[]'::jsonb),
          'assets', coalesce((select jsonb_agg(jsonb_build_object('asset', a.asset_id,
              'version', a.version_id) order by a.asset_id, a.version_id)
            from publication_asset a where a.publication_id = x.id), '[]'::jsonb)) as line
        from publication x
        where (x.written_by is null or ${visible('x.written_by', asked.snapshot)}) and ${past}
        order by x.id limit ${limit}`;
  }
}

/**
 * One page of a part: its lines, the store keys of the bytes they name - an asset version's object, a
 * publication's outputs - and where the next page begins, or null at the end.
 */
export async function exportPage(
  trx: TenantTransaction,
  asked: TenantExport,
  part: ExportPart,
  after: string | undefined,
  limit = 500,
): Promise<{
  readonly lines: readonly Record<string, unknown>[];
  readonly objects: readonly string[];
  readonly next: string | null;
}> {
  const { rows } = await partQuery(part, asked, after, limit + 1).execute(trx);
  const shown = rows.slice(0, limit);
  const objects: string[] = [];
  if (part === 'versions') {
    for (const { line } of shown) {
      const content = line['content'] as Record<string, unknown> | null;
      if (line['kind'] === 'asset' && typeof content?.['object'] === 'string') {
        objects.push(content['object']);
      }
    }
  }
  if (part === 'publications' && shown.length > 0) {
    const keys = await trx
      .selectFrom('publication_output')
      .select('object_key')
      .where(
        'publication_id',
        'in',
        shown.map((row) => row.id),
      )
      .execute();
    objects.push(...keys.map((each) => each.object_key));
  }
  return {
    lines: shown.map((row) => row.line),
    objects,
    next: rows.length > limit ? shown.at(-1)!.id : null,
  };
}

/** An export written, once: an attempt that finds it no longer waiting changes nothing. */
export async function finishTenantExport(
  trx: TenantTransaction,
  id: string,
  stored: KeptExport,
  counts: Readonly<Record<string, number>>,
): Promise<void> {
  await sql`update tenant_export set state = 'done', object_key = ${stored.key},
      sha256 = ${stored.sha256}, bytes = ${stored.size}, counts = ${JSON.stringify(counts)}::jsonb,
      finished_at = now()
    where id = ${id} and state = 'queued'`.execute(trx);
}

/** An export its job gave up on, where it was still waiting. */
export async function failTenantExport(trx: TenantTransaction, id: string): Promise<void> {
  await sql`update tenant_export set state = 'failed', finished_at = now()
    where id = ${id} and state = 'queued'`.execute(trx);
}

/**
 * Exports written more than seven days ago, still `done`: each archive the sweep is to remove before
 * it marks the export expired, so an archive a removal missed is still named, and swept again
 * (the R21 plan, R21-B; its final review).
 */
export async function tenantExportsDue(
  trx: TenantTransaction,
  now: Date = new Date(),
): Promise<{ readonly id: string; readonly key: string }[]> {
  const { rows } = await sql<{ id: string; key: string }>`
    select id, object_key as key from tenant_export
     where state = 'done'
       and finished_at < ${now}::timestamptz - make_interval(days => ${EXPORT_KEPT_DAYS})
     order by finished_at`.execute(trx);
  return rows;
}

/** An export whose archive is removed, marked `expired`; its row stays, so the list says it was made. */
export async function expireTenantExport(trx: TenantTransaction, id: string): Promise<void> {
  await sql`update tenant_export set state = 'expired', object_key = null
    where id = ${id} and state = 'done'`.execute(trx);
}
