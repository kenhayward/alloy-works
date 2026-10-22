import {
  type BlockNode,
  type ImportLevels,
  type ImportPartFlag,
  type ImportPartReason,
  type OutlineNode,
  type ProposedPart,
  type ReportEntry,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { objectInUse } from './assets.js';
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
import { labelled, labels, recordEvent } from './audit.js';
import { createComponent } from './creation.js';
import { createDocument, newNodeIdentifier, type CreateDocumentAnswer } from './documents.js';
import { enqueueJob } from './queue.js';
import { notifyTenant } from './realtime.js';
import type { TenantTransaction } from './tables.js';
import type { StoredVersion } from './versions.js';

/**
 * **Imports** (docs/design/import.md; the IM plan, IM-A to IM-F; ADR-0069): a file uploaded into a
 * space, read by the `import` job into a proposal held apart, and accepted into a document of sections
 * and components, or abandoned. Seen by its importer and the space's administrators, which the
 * service decides; nothing here runs unattended (IMP-003): a person starts and accepts each one.
 */

export type ImportFileType = 'docx' | 'markdown' | 'html';
export type ImportState = 'awaiting' | 'reading' | 'proposed' | 'accepted' | 'abandoned' | 'failed';

/** Why an import failed, by code (IMP-042): what the file was, or that the reading gave up. */
export type ImportFailure =
  'file_unreadable' | 'file_unsafe' | 'file_too_large' | 'file_missing' | 'reading_failed';

/** An entry of an import's report: the admission report's, with the part it was about, if one. */
export type ImportReportEntry = ReportEntry & { readonly part: number | null };

/** How long a proposal is kept untouched, and when before that its importer is told (IM-F). */
export const IMPORT_KEPT_DAYS = 30;
export const IMPORT_WARNED_DAYS = 7;

export interface StoredImport {
  readonly id: string;
  readonly spaceId: string;
  readonly importer: string;
  readonly fileName: string;
  readonly fileType: ImportFileType;
  readonly objectKey: string | null;
  readonly sha256: string | null;
  readonly bytes: number | null;
  readonly kind: 'first' | 'again';
  readonly state: ImportState;
  readonly levels: ImportLevels;
  readonly title: string | null;
  readonly language: string | null;
  readonly report: readonly ImportReportEntry[];
  readonly failure: ImportFailure | null;
  readonly documentId: string | null;
  readonly createdAt: Date;
  readonly touchedAt: Date;
  readonly finishedAt: Date | null;
}

export interface StoredImportPart {
  readonly id: string;
  readonly ord: number;
  readonly kind: 'section' | 'component';
  readonly title: string;
  readonly blocks: readonly BlockNode[];
  readonly source: string;
  readonly reason: ImportPartReason;
  readonly flags: readonly ImportPartFlag[];
  /** The section it stands under, by its id; null at the top. */
  readonly parent: string | null;
}

interface Row {
  id: string;
  space_id: string;
  importer: string;
  file_name: string;
  file_type: ImportFileType;
  object_key: string | null;
  sha256: string | null;
  bytes: string | null;
  kind: 'first' | 'again';
  state: ImportState;
  levels: ImportLevels;
  title: string | null;
  language: string | null;
  report: ImportReportEntry[] | null;
  failure: ImportFailure | null;
  document_id: string | null;
  created_at: Date;
  touched_at: Date;
  finished_at: Date | null;
}

const importOf = (row: Row): StoredImport => ({
  id: row.id,
  spaceId: row.space_id,
  importer: row.importer,
  fileName: row.file_name,
  fileType: row.file_type,
  objectKey: row.object_key,
  sha256: row.sha256,
  bytes: row.bytes === null ? null : Number(row.bytes),
  kind: row.kind,
  state: row.state,
  levels: row.levels,
  title: row.title,
  language: row.language,
  report: row.report ?? [],
  failure: row.failure,
  documentId: row.document_id,
  createdAt: row.created_at,
  touchedAt: row.touched_at,
  finishedAt: row.finished_at,
});

const COLUMNS = sql`id, space_id, importer, file_name, file_type, object_key, sha256,
  bytes::text as bytes, kind, state, levels, title, language, report, failure, document_id,
  created_at, touched_at, finished_at`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An import made in a space, awaiting its file (IM-B). `create` in the space is the caller's to decide. */
export async function createImport(
  trx: TenantTransaction,
  input: {
    readonly spaceId: string;
    readonly importer: string;
    readonly fileName: string;
    readonly fileType: ImportFileType;
  },
): Promise<StoredImport> {
  const { rows } = await sql<Row>`
    insert into import (space_id, importer, file_name, file_type)
      values (${input.spaceId}, ${input.importer}, ${input.fileName}, ${input.fileType})
    returning ${COLUMNS}`.execute(trx);
  return importOf(rows[0]!);
}

/** An import by its id, or undefined where the tenant holds none. */
export async function readImport(
  trx: TenantTransaction,
  id: string,
): Promise<StoredImport | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`select ${COLUMNS} from import where id = ${id}`.execute(trx);
  return rows[0] && importOf(rows[0]);
}

/**
 * A space's imports, the newest first, a page at a time (API-007): the importer's own, or all of them
 * for its administrator.
 */
export async function listImports(
  trx: TenantTransaction,
  input: { readonly spaceId: string; readonly principal: string; readonly all: boolean },
  request: ListingRequest<SortOf<'imports'>> = { limit: 50 },
): Promise<Listed<StoredImport>> {
  const limit = checkedLimit(request.limit);
  const { types, order } = listingSorts.imports.created;
  if (!isListingRequest(request, types)) {
    throw new Error('A page request names a cursor no listing gave out');
  }
  const inner = sql`select ${COLUMNS}, created_at as sort_key_0, created_at::text as sort_text_0
    from import
    where space_id = ${input.spaceId} and (${input.all} or importer = ${input.principal})`;
  const { rows, next } = await keysetPage<Row>(
    trx,
    inner,
    types,
    request.order ?? order,
    limit,
    request.after,
  );
  return { items: rows.map(importOf), next, snapshot: await snapshotFor(trx, request.snapshot) };
}

/**
 * The file an awaiting import was filled with, already stored by its hash: moved to `reading`, and its
 * job queued, in one transaction. Undefined where it no longer awaits its file.
 */
export async function receiveImportFile(
  trx: TenantTransaction,
  id: string,
  file: { readonly key: string; readonly sha256: string; readonly bytes: number },
): Promise<StoredImport | undefined> {
  const { rows } = await sql<Row>`
    update import set object_key = ${file.key}, sha256 = ${file.sha256}, bytes = ${file.bytes},
           state = 'reading', touched_at = now()
     where id = ${id} and state = 'awaiting'
    returning ${COLUMNS}`.execute(trx);
  if (!rows[0]) return undefined;
  await enqueueJob(trx, 'import', id);
  return importOf(rows[0]);
}

/** An import's parts, in order, as read or as edited. */
export async function importParts(
  trx: TenantTransaction,
  id: string,
  proposal: 'read' | 'edited' = 'edited',
): Promise<StoredImportPart[]> {
  const { rows } = await sql<{
    id: string;
    ord: number;
    kind: 'section' | 'component';
    title: string;
    blocks: BlockNode[];
    source: string;
    reason: ImportPartReason;
    flags: ImportPartFlag[];
    parent: string | null;
  }>`select id, ord, kind, title, blocks, source, reason, flags, parent from import_part
      where import_id = ${id} and proposal = ${proposal} order by ord`.execute(trx);
  return rows;
}

/**
 * The job's proposal (IM-C, IM-D): written twice, as read and as the importer will edit it, with the
 * report and what the reader found the title and language to be; the import `proposed`. Undefined
 * where it is no longer being read: abandoned meanwhile, or written by an attempt before.
 */
export async function recordProposal(
  trx: TenantTransaction,
  id: string,
  proposal: {
    readonly parts: readonly ProposedPart[];
    readonly report: readonly ReportEntry[];
    readonly title: string | null;
    readonly language: string | null;
  },
): Promise<StoredImport | undefined> {
  const report: ImportReportEntry[] = [
    ...proposal.report.map((entry) => ({ ...entry, part: null })),
    ...proposal.parts.flatMap((part, index) =>
      part.report.map((entry) => ({ ...entry, part: index })),
    ),
  ];
  const { rows } = await sql<Row>`
    update import set state = 'proposed', title = ${proposal.title}, language = ${proposal.language},
           report = ${JSON.stringify(report)}::jsonb, touched_at = now()
     where id = ${id} and state = 'reading'
    returning ${COLUMNS}`.execute(trx);
  if (!rows[0]) return undefined;
  for (const set of ['read', 'edited'] as const) {
    const ids: string[] = [];
    for (const [index, part] of proposal.parts.entries()) {
      const parent = part.parent === null ? null : ids[part.parent]!;
      const { rows: made } = await sql<{ id: string }>`
        insert into import_part
          (import_id, proposal, ord, kind, title, blocks, source, reason, flags, parent)
        values (${id}, ${set}, ${index}, ${part.kind}, ${part.title},
                ${JSON.stringify(part.blocks)}::jsonb, ${part.source},
                ${JSON.stringify(part.reason)}::jsonb, ${[...part.flags]}::text[], ${parent})
        returning id`.execute(trx);
      ids.push(made[0]!.id);
    }
  }
  return importOf(rows[0]);
}

/** Removes an object from the tenant's store: the caller's, which holds the store. */
export type RemoveObject = (key: string) => Promise<void>;

/**
 * The import's file let go: its key cleared, and the object removed unless another import, an asset
 * or an upload still holds the same bytes. Held by its hash meanwhile, as an asset's are, so nothing
 * comes to need it between the question and the removal.
 */
async function releaseFile(trx: TenantTransaction, row: Row, remove: RemoveObject): Promise<void> {
  if (row.object_key === null || row.sha256 === null) return;
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:object:${row.sha256}`}, 0))`.execute(
    trx,
  );
  await sql`update import set object_key = null where id = ${row.id}`.execute(trx);
  const { rows: others } = await sql`select 1 from import
    where object_key = ${row.object_key} and id <> ${row.id} limit 1`.execute(trx);
  if (others.length > 0) return;
  if (await objectInUse(trx, row.object_key, '00000000-0000-0000-0000-000000000000')) return;
  await remove(row.object_key);
}

/** The import's event on the log, in its space, with the space's name kept beside it. */
async function recordImportEvent(
  trx: TenantTransaction,
  row: Row,
  event:
    | { kind: 'import.abandoned'; swept: boolean }
    | { kind: 'import.accepted'; document: StoredVersion; components: number },
): Promise<void> {
  const space = await trx
    .selectFrom('space')
    .select('name')
    .where('id', '=', row.space_id)
    .executeTakeFirst();
  await recordEvent(
    trx,
    event.kind === 'import.accepted'
      ? {
          kind: 'import.accepted',
          space: row.space_id,
          subject: { kind: 'document', id: event.document.artifactId, version: event.document.id },
          detail: { import: row.id, components: event.components },
        }
      : {
          kind: 'import.abandoned',
          space: row.space_id,
          subject: { kind: 'import', id: row.id },
          detail: { swept: event.swept },
        },
    labels(labelled('space', space?.name, row.space_id)),
  );
}

/**
 * Failed (IMP-042): its parts deleted, its file let go, and why recorded by code; nothing it read is
 * left. Undefined where it is past reading.
 */
export async function failImport(
  trx: TenantTransaction,
  id: string,
  failure: ImportFailure,
  remove: RemoveObject,
): Promise<StoredImport | undefined> {
  const { rows } = await sql<Row>`
    update import set state = 'failed', failure = ${failure}, report = null, finished_at = now()
     where id = ${id} and state in ('awaiting', 'reading')
    returning ${COLUMNS}`.execute(trx);
  if (!rows[0]) return undefined;
  await sql`delete from import_part where import_id = ${id}`.execute(trx);
  await releaseFile(trx, rows[0], remove);
  return importOf({ ...rows[0], object_key: null });
}

/**
 * Abandoned (IMP-008), by its importer or by the sweep, at any point before acceptance: its parts and
 * its file gone, its row kept to say so. Undefined where it is already accepted, abandoned or failed.
 */
export async function abandonImport(
  trx: TenantTransaction,
  id: string,
  remove: RemoveObject,
  swept = false,
): Promise<StoredImport | undefined> {
  const { rows } = await sql<Row>`
    update import set state = 'abandoned', report = null, finished_at = now()
     where id = ${id} and state in ('awaiting', 'reading', 'proposed')
    returning ${COLUMNS}`.execute(trx);
  if (!rows[0]) return undefined;
  await sql`delete from import_part where import_id = ${id}`.execute(trx);
  await releaseFile(trx, rows[0], remove);
  await recordImportEvent(trx, rows[0], { kind: 'import.abandoned', swept });
  return importOf({ ...rows[0], object_key: null });
}

/**
 * The levels changed (IM-D): the proposal read again at them, its parts deleted and its job queued.
 * Undefined where it is not proposed.
 */
export async function changeImportLevels(
  trx: TenantTransaction,
  id: string,
  levels: ImportLevels,
): Promise<StoredImport | undefined> {
  const { rows } = await sql<Row>`
    update import set levels = ${JSON.stringify(levels)}::jsonb, state = 'reading', report = null,
           touched_at = now()
     where id = ${id} and state = 'proposed'
    returning ${COLUMNS}`.execute(trx);
  if (!rows[0]) return undefined;
  await sql`delete from import_part where import_id = ${id}`.execute(trx);
  await enqueueJob(trx, 'import', id);
  return importOf(rows[0]);
}

/** What a document made with its components is made of: sections holding components, in order. */
export type NewOutlinePart =
  | {
      readonly kind: 'section';
      readonly title: string;
      readonly children: readonly NewOutlinePart[];
    }
  | { readonly kind: 'component'; readonly title: string; readonly blocks: readonly BlockNode[] };

/**
 * A document made with new components (IM-F), in the caller's transaction: each component at 0.1 by
 * the author with its blocks, then the document at 0.1, blank or from its template, placing them in
 * order under their sections, each at its latest. A refusal of any of them leaves the caller to roll
 * the whole back.
 */
export async function createDocumentWithComponents(
  trx: TenantTransaction,
  input: {
    readonly spaceId: string;
    readonly author: string;
    readonly title: string;
    readonly language: string;
    readonly direction: 'ltr' | 'rtl';
    readonly template?: string;
    readonly parts: readonly NewOutlinePart[];
  },
): Promise<
  | {
      readonly answer: 'created';
      readonly document: StoredVersion;
      readonly components: readonly StoredVersion[];
    }
  | Exclude<CreateDocumentAnswer, { answer: 'created' }>
  | { readonly answer: 'component_type.missing' }
> {
  const components: StoredVersion[] = [];
  const base = { numbered: true, matter: 'body' as const, pageBreak: 'none' as const, values: {} };
  const nodesOf = async (parts: readonly NewOutlinePart[]): Promise<OutlineNode[] | string> => {
    const nodes: OutlineNode[] = [];
    for (const part of parts) {
      if (part.kind === 'section') {
        const children = await nodesOf(part.children);
        if (typeof children === 'string') return children;
        nodes.push({
          ...base,
          id: newNodeIdentifier(),
          type: 'section',
          title: [{ type: 'text', value: part.title, marks: [] }],
          children,
        });
        continue;
      }
      const made = await createComponent(trx, {
        spaceId: input.spaceId,
        title: part.title,
        language: input.language,
        direction: input.direction,
        author: input.author,
        blocks: part.blocks,
      });
      if (made.answer !== 'created') return made.answer;
      components.push(made.version);
      nodes.push({
        ...base,
        id: newNodeIdentifier(),
        type: 'reference',
        component: made.version.artifactId,
        mode: { kind: 'latest' },
        children: [],
      });
    }
    return nodes;
  };
  const nodes = await nodesOf(input.parts);
  if (typeof nodes === 'string') {
    return { answer: nodes === 'component_type.missing' ? nodes : 'content.invalid' } as
      { answer: 'component_type.missing' } | { answer: 'content.invalid' };
  }
  const made = await createDocument(trx, {
    spaceId: input.spaceId,
    title: input.title,
    language: input.language,
    direction: input.direction,
    author: input.author,
    ...(input.template === undefined ? {} : { template: input.template }),
    nodes,
  });
  if (made.answer !== 'created') return made;
  return { answer: 'created', document: made.version, components };
}

/** The proposal as edited, as the parts a document is made of. */
function outlineOf(parts: readonly StoredImportPart[]): NewOutlinePart[] {
  const children = new Map<string | null, StoredImportPart[]>();
  for (const part of parts) children.set(part.parent, [...(children.get(part.parent) ?? []), part]);
  const build = (parent: string | null): NewOutlinePart[] =>
    (children.get(parent) ?? []).map((part) =>
      part.kind === 'section'
        ? { kind: 'section', title: part.title, children: build(part.id) }
        : { kind: 'component', title: part.title, blocks: part.blocks },
    );
  return build(null);
}

export type AcceptImportAnswer =
  | {
      readonly answer: 'accepted';
      readonly import: StoredImport;
      readonly document: StoredVersion;
      readonly components: readonly StoredVersion[];
    }
  | { readonly answer: 'import.not_proposed' }
  | Exclude<Awaited<ReturnType<typeof createDocumentWithComponents>>, { answer: 'created' }>;

/**
 * Accepted (IM-F): the document and its components made from the proposal as edited, by the person
 * accepting, in the caller's transaction; what each version came from recorded (IMP-035); the import
 * `accepted`, naming the document. The parts are kept, for what was accepted unchanged (IMP-031), and
 * the file, for a re-import (IMd).
 */
export async function acceptImport(
  trx: TenantTransaction,
  id: string,
  input: {
    readonly by: string;
    readonly title: string;
    readonly language: string;
    readonly direction: 'ltr' | 'rtl';
    readonly template?: string;
  },
): Promise<AcceptImportAnswer> {
  const { rows: held } = await sql<Row>`select ${COLUMNS} from import where id = ${id}
    and state = 'proposed' for update`.execute(trx);
  const row = held[0];
  if (!row) return { answer: 'import.not_proposed' };
  const made = await createDocumentWithComponents(trx, {
    spaceId: row.space_id,
    author: input.by,
    title: input.title,
    language: input.language,
    direction: input.direction,
    ...(input.template === undefined ? {} : { template: input.template }),
    parts: outlineOf(await importParts(trx, id)),
  });
  if (made.answer !== 'created') return made;
  for (const version of [made.document, ...made.components]) {
    await sql`insert into import_made (version_id, artifact_id, import_id)
      values (${version.id}, ${version.artifactId}, ${id})`.execute(trx);
  }
  const { rows } = await sql<Row>`
    update import set state = 'accepted', document_id = ${made.document.artifactId},
           finished_at = now(), touched_at = now()
     where id = ${id}
    returning ${COLUMNS}`.execute(trx);
  await recordImportEvent(trx, row, {
    kind: 'import.accepted',
    document: made.document,
    components: made.components.length,
  });
  return {
    answer: 'accepted',
    import: importOf(rows[0]!),
    document: made.document,
    components: made.components,
  };
}

/** What a version came from (IMP-035): the file's name and hash, when and by whom; undefined if none. */
export async function provenanceOf(
  trx: TenantTransaction,
  versionId: string,
): Promise<
  | {
      readonly import: string;
      readonly fileName: string;
      readonly sha256: string | null;
      readonly at: Date;
      readonly by: string;
    }
  | undefined
> {
  if (!UUID.test(versionId)) return undefined;
  const { rows } = await sql<{
    id: string;
    file_name: string;
    sha256: string | null;
    finished_at: Date;
    importer: string;
  }>`select i.id, i.file_name, i.sha256, i.finished_at, i.importer
       from import_made m join import i on i.id = m.import_id
      where m.version_id = ${versionId}`.execute(trx);
  const found = rows[0];
  return (
    found && {
      import: found.id,
      fileName: found.file_name,
      sha256: found.sha256,
      at: found.finished_at,
      by: found.importer,
    }
  );
}

/**
 * The sweep (IM-F): a proposal untouched for 23 days told to its importer, once, that it is swept in
 * seven; one untouched for 30, or still awaiting or being read that long, abandoned as the system.
 */
export async function sweepImports(
  trx: TenantTransaction,
  remove: RemoveObject,
): Promise<{ readonly warned: number; readonly swept: number }> {
  const { rows: due } = await sql<{ id: string; importer: string; touched_at: Date }>`
    update import set warned_at = now()
     where state = 'proposed' and warned_at is null
       and touched_at < now() - make_interval(days => ${IMPORT_KEPT_DAYS - IMPORT_WARNED_DAYS})
    returning id, importer, touched_at`.execute(trx);
  for (const each of due) {
    const sweepsAt = new Date(each.touched_at.getTime() + IMPORT_KEPT_DAYS * 86_400_000);
    await sql`insert into notification (recipient, kind, counts)
      values (${each.importer}, 'import',
              ${JSON.stringify({ import: each.id, sweepsAt: sweepsAt.toISOString() })}::jsonb)`.execute(
      trx,
    );
    await notifyTenant(trx, { kind: 'inbox', recipient: each.importer });
  }
  const { rows: stale } = await sql<{ id: string }>`
    select id from import
     where state in ('awaiting', 'reading', 'proposed')
       and touched_at < now() - make_interval(days => ${IMPORT_KEPT_DAYS})
     order by id`.execute(trx);
  let swept = 0;
  for (const each of stale) {
    if (await abandonImport(trx, each.id, remove, true)) swept += 1;
  }
  return { warned: due.length, swept };
}
