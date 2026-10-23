import { randomUUID } from 'node:crypto';
import {
  acceptedCounts,
  againIdentifiers,
  againStatus,
  attributionOf,
  contentDocumentSchema,
  createReport,
  editProposal,
  inImportBlocks as inBlocks,
  matchAgain,
  matchIdentity,
  parseContentDocument,
  resolveReferences,
  suggestedBlocks,
  type AcceptedCounts,
  type AcceptedComponent,
  type AgainCandidate,
  type AgainMatchedBy,
  type BlockNode,
  type ContentDocument,
  type ImportEdit,
  type ImageHeader,
  type ImportEditRefusal,
  type ImportIdentity,
  type ImportLevels,
  type ImportMember,
  type ImportPolicy,
  type ImportReference,
  type ImportReviewReason,
  type ImportPartFlag,
  type OutlineDocument,
  type OutlineNode,
  type ProposedChange,
  type ProposedPart,
  type ProposedThread,
  type ReportEntry,
} from '@alloy-works/domain';
import { sql, type RawBuilder } from 'kysely';
import {
  createAssetUpload,
  holdObject,
  objectInUse,
  receiveAssetBytes,
  recordAsset,
} from './assets.js';
import { isArchived } from './archival.js';
import { isDeleted } from './deletion.js';
import { readableComponents } from './documents.js';
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
import {
  createDocument,
  editOutline,
  newNodeIdentifier,
  type CreateDocumentAnswer,
} from './documents.js';
import { enqueueJob } from './queue.js';
import { notifyTenant } from './realtime.js';
import { makeSuggestion } from './suggestions.js';
import { addComment, startThread } from './threads.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion, type StoredVersion } from './versions.js';

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

/** A reference outside the import (IMP-033), and how its importer resolved it (IMP-034). */
export type OutsideReference = ImportReference & {
  readonly resolved: null | 'retargeted' | 'text';
};

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
  /** How many edits its proposal has had (IMb): what an edit is made against. */
  readonly revision: number;
  /** The part of its edited set its importer was last at (IMP-029). */
  readonly place: string | null;
  /** How the parts accepted compare with the proposal as read, once accepted (IMP-031). */
  readonly acceptedCounts: AcceptedCounts | null;
  /** Where each block the reader identified was admitted (IMc). */
  readonly anchors: Readonly<Record<string, string>>;
  readonly outside: readonly OutsideReference[];
  /** The identities the file carries (IMP-009), and the member each name match was confirmed as. */
  readonly identities: readonly ImportIdentity[];
  readonly confirmed: Readonly<Record<string, string>>;
  /** The file's own properties, kept only where the policy keeps identities as text (IM-J). */
  readonly properties: Readonly<Record<string, string>> | null;
  /** The policy applied at acceptance (IMP-011). */
  readonly policy: ImportPolicy | null;
  /** The accepted import one gain updates (IMd). */
  readonly earlier: string | null;
  /** What accepting it again did, once accepted. */
  readonly outcome: ImportOutcome | null;
}

export interface StoredImportPart {
  readonly id: string;
  readonly ord: number;
  readonly kind: 'section' | 'component';
  readonly title: string;
  readonly blocks: readonly BlockNode[];
  readonly source: string;
  readonly reason: ImportReviewReason;
  readonly flags: readonly ImportPartFlag[];
  /** The section it stands under, by its id; null at the top. */
  readonly parent: string | null;
  /** The parts as read it came from, by their place. */
  readonly origins: readonly number[];
  readonly headings: readonly string[];
  readonly changes: readonly ProposedChange[];
  readonly threads: readonly ProposedThread[];
  /** The component it made or updated, once accepted: what a later import matches it by (IMd). */
  readonly made: string | null;
  /** In an import again, the component the earlier import made that it is matched to, and how. */
  readonly matched: string | null;
  readonly matchedBy: AgainMatchedBy | null;
}

/**
 * Why a changed component was not suggested on: its importer may not, has as many pending on it as
 * one may, the suggestion would change nothing or was made and resolved before, or the component was
 * deleted or archived since it was matched.
 */
export type SkippedReason = 'suggest' | 'limit' | 'empty' | 'resolved' | 'gone';

const SKIPPED: Readonly<
  Record<'missing' | `suggestion.${'empty' | 'limit' | 'resolved'}`, SkippedReason>
> = {
  missing: 'gone',
  'suggestion.empty': 'empty',
  'suggestion.limit': 'limit',
  'suggestion.resolved': 'resolved',
};

/**
 * What accepting an import again did (IM-K): each suggestion made, each new component and whether it
 * was placed, each component gone and whether it was flagged, and each skipped, with why.
 */
export interface ImportOutcome {
  readonly suggested: readonly { readonly component: string; readonly suggestion: string }[];
  readonly made: readonly { readonly component: string; readonly placed: boolean }[];
  readonly gone: readonly { readonly component: string; readonly flagged: boolean }[];
  readonly skipped: readonly { readonly component: string; readonly reason: SkippedReason }[];
  readonly unchanged: number;
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
  revision: number;
  place: string | null;
  accepted: AcceptedCounts | null;
  anchors: Record<string, string>;
  outside: OutsideReference[];
  identities: ImportIdentity[];
  confirmed: Record<string, string>;
  properties: Record<string, string> | null;
  policy: ImportPolicy | null;
  earlier: string | null;
  outcome: ImportOutcome | null;
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
  revision: row.revision,
  place: row.place,
  acceptedCounts: row.accepted,
  anchors: row.anchors,
  outside: row.outside,
  identities: row.identities,
  confirmed: row.confirmed,
  properties: row.properties,
  policy: row.policy,
  earlier: row.earlier,
  outcome: row.outcome,
});

const COLUMNS = sql`id, space_id, importer, file_name, file_type, object_key, sha256,
  bytes::text as bytes, kind, state, levels, title, language, report, failure, document_id,
  created_at, touched_at, finished_at, revision, place, accepted, anchors, outside, identities,
  confirmed, properties, policy, earlier, outcome`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Whether the import, held for update, is in one of these states, and at the revision its importer
 * read where they gave one: `state`, else `changed`, else held.
 */
async function heldAt(
  trx: TenantTransaction,
  id: string,
  states: readonly ImportState[],
  revision: number | undefined,
): Promise<'state' | 'changed' | 'held'> {
  const { rows } = await sql<{ state: ImportState; revision: number }>`
    select state, revision from import where id = ${id} for update`.execute(trx);
  const row = rows[0];
  if (!row || !states.includes(row.state)) return 'state';
  return revision !== undefined && row.revision !== revision ? 'changed' : 'held';
}

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

/** An accepted import a file was imported in before (IMP-036): who, when, and the document it made. */
export interface EarlierImport {
  readonly id: string;
  readonly fileName: string;
  readonly importer: string;
  readonly finishedAt: Date;
  readonly documentId: string;
  /** The same bytes, by their hash; else the same file name in the space. */
  readonly match: 'hash' | 'name';
}

/**
 * The accepted import in this import's space that holds the same file (IM-K): by its hash, else by
 * its name, the latest first, accepted before this one was, and the first of them `seen` passes,
 * so none is said that its importer may not know of. Said first, before anything is read.
 */
export async function earlierImport(
  trx: TenantTransaction,
  id: string,
  seen: (earlier: EarlierImport) => Promise<boolean> = async () => true,
): Promise<EarlierImport | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<{
    id: string;
    file_name: string;
    importer: string;
    finished_at: Date;
    document_id: string;
    hash: boolean;
  }>`select e.id, e.file_name, e.importer, e.finished_at, e.document_id,
            coalesce(e.sha256 = i.sha256, false) as hash
       from import i join import e on e.space_id = i.space_id and e.id <> i.id
      where i.id = ${id} and e.state = 'accepted' and e.document_id is not null
        and e.finished_at < coalesce(i.finished_at, now())
        and (e.sha256 = i.sha256 or e.file_name = i.file_name)
      order by coalesce(e.sha256 = i.sha256, false) desc, e.finished_at desc, e.id`.execute(trx);
  for (const found of rows) {
    const earlier: EarlierImport = {
      id: found.id,
      fileName: found.file_name,
      importer: found.importer,
      finishedAt: found.finished_at,
      documentId: found.document_id,
      match: found.hash ? 'hash' : 'name',
    };
    if (await seen(earlier)) return earlier;
  }
  return undefined;
}

/**
 * Imported as new, or as an update of what an accepted import in the space made (IM-K): its parts
 * matched to that import's components now if it is proposed, else once it is. Undefined where it is
 * past its proposal; `import.changed` where it is past the revision given; `import.earlier_invalid`
 * where the earlier one is not an accepted import of this space with its document.
 */
export async function chooseImportKind(
  trx: TenantTransaction,
  id: string,
  choice: { readonly kind: 'first' } | { readonly kind: 'again'; readonly earlier: string },
  revision?: number,
): Promise<StoredImport | 'import.earlier_invalid' | 'import.changed' | undefined> {
  const held = await heldAt(trx, id, ['awaiting', 'reading', 'proposed'], revision);
  if (held === 'state') return undefined;
  if (held === 'changed') return 'import.changed';
  const earlier = choice.kind === 'again' ? choice.earlier : null;
  if (earlier !== null) {
    if (!UUID.test(earlier) || earlier === id) return 'import.earlier_invalid';
    const { rows: found } =
      await sql`select 1 from import e join import i on i.space_id = e.space_id
       where i.id = ${id} and e.id = ${earlier} and e.state = 'accepted'
         and e.document_id is not null`.execute(trx);
    if (found.length === 0) return 'import.earlier_invalid';
  }
  const { rows } = await sql<Row>`
    update import set kind = ${choice.kind}, earlier = ${earlier}, revision = revision + 1,
           touched_at = now()
     where id = ${id} and state in ('awaiting', 'reading', 'proposed')
    returning ${COLUMNS}`.execute(trx);
  if (!rows[0]) return undefined;
  if (rows[0].state === 'proposed') await matchParts(trx, rows[0]);
  return importOf(rows[0]);
}

/**
 * What an earlier import made that a part may match (IM-K): each component an edited part of it made
 * or updated, in order, by the heading it was read from and its title now; none deleted or archived.
 */
export async function againCandidates(
  trx: TenantTransaction,
  earlier: string,
): Promise<AgainCandidate[]> {
  const { rows } = await sql<{ made: string; title: string; reason: ImportReviewReason }>`
    select made, title, reason from import_part
     where import_id = ${earlier} and proposal = 'edited' and kind = 'component' and made is not null
     order by ord`.execute(trx);
  const candidates: AgainCandidate[] = [];
  for (const row of rows) {
    if ((await isDeleted(trx, row.made)) || (await isArchived(trx, row.made))) continue;
    if (candidates.some((each) => each.component === row.made)) continue;
    const latest = await latestVersion(trx, row.made);
    const title = (latest?.content as { readonly title?: unknown } | undefined)?.title;
    candidates.push({
      component: row.made,
      heading: 'text' in row.reason && row.reason.text !== undefined ? row.reason.text : row.title,
      title: typeof title === 'string' ? title : row.title,
    });
  }
  return candidates;
}

/** An import's edited parts matched again (IM-K), or every match cleared where it is a first. */
async function matchParts(trx: TenantTransaction, row: Row): Promise<void> {
  if (row.kind !== 'again' || row.earlier === null) {
    await sql`update import_part set matched = null, matched_by = null
       where import_id = ${row.id} and proposal = 'edited'`.execute(trx);
    return;
  }
  const parts = await importParts(trx, row.id);
  const { matches } = matchAgain(parts, await againCandidates(trx, row.earlier));
  for (const [index, part] of parts.entries()) {
    const match = matches[index] ?? null;
    await sql`update import_part set matched = ${match?.component ?? null},
              matched_by = ${match?.by ?? null}
       where id = ${part.id}`.execute(trx);
  }
}

/** What the earlier import made that no part of this one matches: gone (IM-K). */
export async function goneComponents(trx: TenantTransaction, id: string): Promise<string[]> {
  const found = await readImport(trx, id);
  if (found?.kind !== 'again' || found.earlier === null) return [];
  const held = new Set((await importParts(trx, id)).map((part) => part.matched));
  return (await againCandidates(trx, found.earlier))
    .map((each) => each.component)
    .filter((component) => !held.has(component));
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
    reason: ImportReviewReason;
    flags: ImportPartFlag[];
    parent: string | null;
    origins: number[];
    headings: string[];
    changes: ProposedChange[];
    threads: ProposedThread[];
    made: string | null;
    matched: string | null;
    matchedBy: AgainMatchedBy | null;
  }>`select id, ord, kind, title, blocks, source, reason, flags, parent, origins, headings, changes,
            threads, made, matched, matched_by as "matchedBy"
       from import_part
      where import_id = ${id} and proposal = ${proposal} order by ord`.execute(trx);
  return rows;
}

/** Its parts and the edits made to them deleted: abandoned, failed, or proposed again. */
async function forgetProposal(trx: TenantTransaction, id: string): Promise<void> {
  await sql`delete from import_edit where import_id = ${id}`.execute(trx);
  await sql`delete from import_part where import_id = ${id}`.execute(trx);
}

/** An image the import's job checked and stored by its hash, held for the import until acceptance. */
export interface HeldImage {
  readonly placeholder: string;
  readonly key: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly header: ImageHeader;
}

/**
 * An image held for an import being read (IM-C): its bytes already stored by the caller under this
 * hash, which it holds (`holdObject`). No asset is made until the import is accepted (IMP-008).
 */
export async function holdImportImage(
  trx: TenantTransaction,
  id: string,
  image: HeldImage,
): Promise<boolean> {
  const { rows } = await sql`
    insert into import_asset (import_id, placeholder, object_key, sha256, format, bytes, header)
    select ${id}, ${image.placeholder}, ${image.key}, ${image.sha256}, ${image.header.format},
           ${image.bytes}, ${JSON.stringify(image.header)}::jsonb
      from import where id = ${id} and state = 'reading'
    on conflict (import_id, placeholder) do nothing
    returning 1`.execute(trx);
  return rows.length > 0;
}

/**
 * The images an import held let go (IMP-008): its rows deleted, and each object released.
 */
async function releaseImages(
  trx: TenantTransaction,
  id: string,
  remove: RemoveObject,
): Promise<void> {
  const { rows } = await sql<{ object_key: string; sha256: string }>`
    delete from import_asset where import_id = ${id} returning object_key, sha256`.execute(trx);
  for (const each of rows)
    await releaseObject(trx, { key: each.object_key, sha256: each.sha256 }, remove);
}

/**
 * An object an import stored let go: removed unless an import's file or image, an asset or an upload
 * still holds the same bytes, held by its hash meanwhile so nothing comes to need it between the
 * question and the removal. Answers whether it was removed.
 */
export async function releaseObject(
  trx: TenantTransaction,
  object: { readonly key: string; readonly sha256: string },
  remove: RemoveObject,
): Promise<boolean> {
  await holdObject(trx, object.sha256);
  const { rows: files } = await sql`select 1 from import
    where object_key = ${object.key} limit 1`.execute(trx);
  if (files.length > 0) return false;
  if (await objectInUse(trx, object.key, '00000000-0000-0000-0000-000000000000')) return false;
  await remove(object.key);
  return true;
}

/** An edit as recorded (IMb): by whom, when, and what was asked. */
export interface StoredImportEdit {
  readonly revision: number;
  readonly by: string;
  readonly at: Date;
  readonly edit: ImportEdit;
}

/** The edits made to an import's proposal, in order. */
export async function importEdits(trx: TenantTransaction, id: string): Promise<StoredImportEdit[]> {
  const { rows } = await sql<{ revision: number; by: string; at: Date; edit: ImportEdit }>`
    select revision, by_principal as by, at, edit from import_edit
     where import_id = ${id} order by revision`.execute(trx);
  return rows;
}

/**
 * What an importer asks of a proposal (IMb, IMc): an edit to its parts; a reference outside it pointed
 * elsewhere or made the text it showed, which is filled in here; or a name match confirmed.
 */
export type ImportEditInput =
  | Exclude<ImportEdit, { edit: 'reference' }>
  | {
      readonly edit: 'reference';
      readonly reference: string;
      readonly to:
        | { readonly kind: 'block'; readonly block: string }
        | { readonly kind: 'component'; readonly component: string; readonly block: string }
        | { readonly kind: 'text' };
    }
  /** The member a name match is confirmed as, or the confirmation withdrawn. */
  | { readonly edit: 'identity'; readonly identity: string; readonly member: string | null }
  /** In an import again, a part matched to another component the earlier import made, or new. */
  | { readonly edit: 'match'; readonly part: string; readonly component: string | null };

export type EditImportAnswer =
  | { readonly answer: 'edited'; readonly import: StoredImport }
  | { readonly answer: 'import.not_proposed' }
  /** Another edit came first: the caller's revision is not the import's. */
  | { readonly answer: 'import.changed' }
  | { readonly answer: 'refused'; readonly refusal: ImportEditRefusal };

/**
 * An edit to the edited set (IMb; IMP-002, IMP-041), by its importer, against the revision they
 * read: validated as made (`editProposal`), written in place, each component under the section
 * before it, and recorded. The proposal as read is never touched.
 */
export async function editImport(
  trx: TenantTransaction,
  id: string,
  input: { readonly revision: number; readonly edit: ImportEditInput; readonly by: string },
): Promise<EditImportAnswer> {
  const { rows: held } = await sql<Row>`select ${COLUMNS} from import where id = ${id}
    and state = 'proposed' for update`.execute(trx);
  const row = held[0];
  if (!row) return { answer: 'import.not_proposed' };
  if (row.revision !== input.revision) return { answer: 'import.changed' };
  const language =
    row.language !== null && contentDocumentSchema.shape.language.safeParse(row.language).success
      ? row.language
      : 'en';
  const { edit } = input;
  let changes: { readonly outside?: OutsideReference[]; readonly report?: ImportReportEntry[] } =
    {};
  if (edit.edit === 'identity') {
    const confirmed = { ...row.confirmed };
    if (edit.member === null) delete confirmed[edit.identity];
    else confirmed[edit.identity] = edit.member;
    // A confirmation holds only for the member the name matches, a user of this tenant (IM-I).
    const identity = row.identities.find((each) => each.name === edit.identity);
    if (
      !identity ||
      (edit.member !== null && matchIdentity(identity, await membersOf(trx)).member !== edit.member)
    ) {
      return { answer: 'refused', refusal: 'identity_invalid' };
    }
    return recordEdit(
      trx,
      id,
      input,
      sql`confirmed = ${JSON.stringify(confirmed)}::jsonb, touched_at = now()`,
    );
  }
  if (edit.edit === 'match') {
    // Only to a component the earlier import made that no other part holds (IMP-037).
    const parts = await importParts(trx, id);
    const part = parts.find((each) => each.id === edit.part && each.kind === 'component');
    if (!part) return { answer: 'refused', refusal: 'part_missing' };
    if (edit.component !== null) {
      const candidates = row.earlier === null ? [] : await againCandidates(trx, row.earlier);
      if (
        !candidates.some((each) => each.component === edit.component) ||
        parts.some((each) => each.id !== part.id && each.matched === edit.component)
      ) {
        return { answer: 'refused', refusal: 'match_invalid' };
      }
    }
    await sql`update import_part set matched = ${edit.component},
              matched_by = ${edit.component === null ? null : 'importer'}
       where id = ${part.id}`.execute(trx);
    return recordEdit(trx, id, input, sql`touched_at = now()`);
  }
  const before = await importParts(trx, id);
  let asked: ImportEdit;
  if (edit.edit === 'reference') {
    const reference = row.outside.find((each) => each.key === edit.reference);
    if (!reference) return { answer: 'refused', refusal: 'reference_missing' };
    const { to } = edit;
    if (to.kind === 'component' && !(await componentHolds(trx, row.space_id, input.by, to))) {
      return { answer: 'refused', refusal: 'target_missing' };
    }
    asked = {
      edit: 'reference',
      reference: edit.reference,
      to: to.kind === 'text' ? { kind: 'text', text: reference.text } : to,
    };
    const resolved = to.kind === 'text' ? 'text' : 'retargeted';
    const holding = before.findIndex((part) =>
      JSON.stringify(part.blocks).includes(JSON.stringify(edit.reference)),
    );
    const said = createReport();
    if (resolved === 'text') {
      said.add('read', 'rewritten', 'crossReferenceText', { detail: reference.text });
    }
    changes = {
      outside: row.outside.map((each) =>
        each.key === edit.reference ? { ...each, resolved } : each,
      ),
      report: [
        ...(row.report ?? []),
        ...said.entries.map((entry) => ({
          ...entry,
          part: holding === -1 ? null : (before[holding]!.origins[0] ?? null),
        })),
      ],
    };
  } else asked = edit;
  const edited = editProposal(before, asked, { language, direction: 'ltr' });
  if (!edited.ok) return { answer: 'refused', refusal: edited.refusal };

  // Out of the way of the order each is given, then each written where it now stands.
  await sql`update import_part set ord = ord + 1000000
     where import_id = ${id} and proposal = 'edited'`.execute(trx);
  let section: string | null = null;
  const kept: string[] = [];
  for (const [ord, part] of edited.parts.entries()) {
    const parent: string | null = part.kind === 'section' ? null : section;
    const values: RawBuilder<unknown> = sql`${part.kind}, ${part.title}, ${JSON.stringify(part.blocks)}::jsonb,
      ${part.source}, ${[...part.flags]}::text[], ${parent}, ${[...part.origins]}::integer[],
      ${[...part.headings]}::text[], ${JSON.stringify(part.changes)}::jsonb,
      ${JSON.stringify(part.threads)}::jsonb`;
    const written: readonly { id: string }[] = (
      part.id === null
        ? await sql<{ id: string }>`insert into import_part
              (import_id, proposal, ord, reason, kind, title, blocks, source, flags, parent, origins,
               headings, changes, threads)
            values (${id}, 'edited', ${ord}, ${JSON.stringify(part.reason)}::jsonb, ${values})
            returning id`.execute(trx)
        : await sql<{ id: string }>`update import_part
              set ord = ${ord}, (kind, title, blocks, source, flags, parent, origins, headings,
                                 changes, threads) = (${values})
            where id = ${part.id} and import_id = ${id} and proposal = 'edited'
            returning id`.execute(trx)
    ).rows;
    kept.push(written[0]!.id);
    if (part.kind === 'section') section = written[0]!.id;
  }
  // What was merged away goes once nothing stands under it.
  await sql`delete from import_part where import_id = ${id} and proposal = 'edited'
     and not (id = any(${kept}::uuid[]))`.execute(trx);
  return recordEdit(
    trx,
    id,
    input,
    changes.outside === undefined
      ? sql`touched_at = now()`
      : sql`outside = ${JSON.stringify(changes.outside)}::jsonb,
            report = ${JSON.stringify(changes.report)}::jsonb, touched_at = now()`,
  );
}

/** The edit counted against the import's revision and recorded, with what else it set. */
async function recordEdit(
  trx: TenantTransaction,
  id: string,
  input: { readonly edit: ImportEditInput; readonly by: string },
  set: RawBuilder<unknown>,
): Promise<EditImportAnswer> {
  const { rows } = await sql<Row>`
    update import set ${set}, revision = revision + 1
     where id = ${id}
    returning ${COLUMNS}`.execute(trx);
  await sql`insert into import_edit (import_id, revision, by_principal, edit)
    values (${id}, ${rows[0]!.revision}, ${input.by}, ${JSON.stringify(input.edit)}::jsonb)`.execute(
    trx,
  );
  return { answer: 'edited', import: importOf(rows[0]!) };
}

/**
 * Whether a component of this space that `by` may read, neither deleted nor archived, holds this block
 * at its latest version (IMP-034). One answer for each way it does not, so none says what exists.
 */
async function componentHolds(
  trx: TenantTransaction,
  spaceId: string,
  by: string,
  target: { readonly component: string; readonly block: string },
): Promise<boolean> {
  if (!UUID.test(target.component)) return false;
  const { rows } = await sql`select 1 from artifact
     where id = ${target.component} and kind = 'component' and space_id = ${spaceId}`.execute(trx);
  if (rows.length === 0) return false;
  if (!(await readableComponents(trx, by, [target.component])).has(target.component)) return false;
  if ((await isDeleted(trx, target.component)) || (await isArchived(trx, target.component))) {
    return false;
  }
  const version = await latestVersion(trx, target.component);
  return (
    version !== undefined && inBlocks((version.content as ContentDocument).content, target.block)
  );
}

/**
 * The part its importer is at (IMP-029), kept on the import so returning, from anywhere, lands there.
 * Undefined where it is not proposed; `part.missing` where the part is not of its edited set.
 */
export async function setImportPlace(
  trx: TenantTransaction,
  id: string,
  part: string,
): Promise<StoredImport | 'part.missing' | undefined> {
  if (!UUID.test(part)) return 'part.missing';
  const { rows: found } = await sql`select 1 from import_part
     where id = ${part} and import_id = ${id} and proposal = 'edited'`.execute(trx);
  if (found.length === 0) return 'part.missing';
  const { rows } = await sql<Row>`
    update import set place = ${part} where id = ${id} and state = 'proposed'
    returning ${COLUMNS}`.execute(trx);
  return rows[0] && importOf(rows[0]);
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
    readonly anchors?: Readonly<Record<string, string>>;
    readonly references?: readonly ImportReference[];
    readonly identities?: readonly ImportIdentity[];
    /** The file's own properties: kept only where the policy keeps identities as text (IM-J). */
    readonly properties?: Readonly<Record<string, string>>;
  },
): Promise<StoredImport | undefined> {
  const keep = (await importPolicy(trx)) === 'keep';
  const outside: OutsideReference[] = (proposal.references ?? []).map((each) => ({
    ...each,
    resolved: null,
  }));
  const report: ImportReportEntry[] = [
    ...proposal.report.map((entry) => ({ ...entry, part: null })),
    ...proposal.parts.flatMap((part, index) =>
      part.report.map((entry) => ({ ...entry, part: index })),
    ),
  ];
  const { rows } = await sql<Row>`
    update import set state = 'proposed', title = ${proposal.title}, language = ${proposal.language},
           report = ${JSON.stringify(report)}::jsonb, touched_at = now(),
           anchors = ${JSON.stringify(proposal.anchors ?? {})}::jsonb,
           outside = ${JSON.stringify(outside)}::jsonb,
           identities = ${JSON.stringify(proposal.identities ?? [])}::jsonb, confirmed = '{}',
           properties = ${keep && proposal.properties !== undefined ? JSON.stringify(proposal.properties) : null}::jsonb
     where id = ${id} and state = 'reading'
    returning ${COLUMNS}`.execute(trx);
  if (!rows[0]) return undefined;
  for (const set of ['read', 'edited'] as const) {
    const ids: string[] = [];
    for (const [index, part] of proposal.parts.entries()) {
      const parent = part.parent === null ? null : ids[part.parent]!;
      const { rows: made } = await sql<{ id: string }>`
        insert into import_part
          (import_id, proposal, ord, kind, title, blocks, source, reason, flags, parent, origins,
           headings, changes, threads)
        values (${id}, ${set}, ${index}, ${part.kind}, ${part.title},
                ${JSON.stringify(part.blocks)}::jsonb, ${part.source},
                ${JSON.stringify(part.reason)}::jsonb, ${[...part.flags]}::text[], ${parent},
                array[${index}::integer], ${[...part.headings]}::text[],
                ${JSON.stringify(part.changes)}::jsonb, ${JSON.stringify(part.threads)}::jsonb)
        returning id`.execute(trx);
      ids.push(made[0]!.id);
    }
  }
  // Read again, then matched to what the earlier import made (IM-K).
  if (rows[0].kind === 'again') await matchParts(trx, rows[0]);
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
  await holdObject(trx, row.sha256);
  await sql`update import set object_key = null where id = ${row.id}`.execute(trx);
  await releaseObject(trx, { key: row.object_key, sha256: row.sha256 }, remove);
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
    update import set state = 'failed', failure = ${failure}, report = null, finished_at = now(),
           anchors = '{}', outside = '[]', identities = '[]', confirmed = '{}',
           properties = null
     where id = ${id} and state in ('awaiting', 'reading')
    returning ${COLUMNS}`.execute(trx);
  if (!rows[0]) return undefined;
  await forgetProposal(trx, id);
  await releaseImages(trx, id, remove);
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
    update import set state = 'abandoned', report = null, finished_at = now(),
           anchors = '{}', outside = '[]', identities = '[]', confirmed = '{}',
           properties = null
     where id = ${id} and state in ('awaiting', 'reading', 'proposed')
    returning ${COLUMNS}`.execute(trx);
  if (!rows[0]) return undefined;
  await forgetProposal(trx, id);
  await releaseImages(trx, id, remove);
  await releaseFile(trx, rows[0], remove);
  await recordImportEvent(trx, rows[0], { kind: 'import.abandoned', swept });
  return importOf({ ...rows[0], object_key: null });
}

/**
 * The levels changed (IM-D): the proposal read again at them, its parts and images let go and its
 * job queued. Undefined where it is not proposed; `import.changed` where it is past the revision given.
 */
export async function changeImportLevels(
  trx: TenantTransaction,
  id: string,
  levels: ImportLevels,
  remove: RemoveObject,
  revision?: number,
): Promise<StoredImport | 'import.changed' | undefined> {
  const held = await heldAt(trx, id, ['proposed'], revision);
  if (held === 'state') return undefined;
  if (held === 'changed') return 'import.changed';
  const { rows } = await sql<Row>`
    update import set levels = ${JSON.stringify(levels)}::jsonb, state = 'reading', report = null,
           revision = revision + 1, touched_at = now(), anchors = '{}', outside = '[]', identities = '[]', confirmed = '{}',
           properties = null
     where id = ${id} and state = 'proposed'
    returning ${COLUMNS}`.execute(trx);
  if (!rows[0]) return undefined;
  await forgetProposal(trx, id);
  // Read again, its images are stored and held again: these are let go, as abandoning does.
  await releaseImages(trx, id, remove);
  await enqueueJob(trx, 'import', id);
  return importOf(rows[0]);
}

/** What a document made with its components is made of: sections holding components, in order. */
export type NewOutlinePart =
  | {
      readonly kind: 'section';
      readonly title: string;
      readonly children: readonly NewOutlinePart[];
      /** Its node's identifier, where one was chosen before it is written. */
      readonly node?: string;
    }
  | {
      readonly kind: 'component';
      readonly title: string;
      readonly blocks: readonly BlockNode[];
      /** Its identifier and its reference node's, where chosen before they are written (IMc). */
      readonly artifactId?: string;
      readonly node?: string;
    };

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
          id: part.node ?? newNodeIdentifier(),
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
        ...(part.artifactId === undefined ? {} : { artifactId: part.artifactId }),
      });
      if (made.answer !== 'created') return made.answer;
      components.push(made.version);
      nodes.push({
        ...base,
        id: part.node ?? newNodeIdentifier(),
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

/** The proposal as edited, as the parts a document is made of, each with what was chosen for it. */
function outlineOf(
  parts: readonly StoredImportPart[],
  chosen: ReadonlyMap<string, { readonly node: string; readonly component?: AcceptedComponent }>,
): NewOutlinePart[] {
  const children = new Map<string | null, StoredImportPart[]>();
  for (const part of parts) children.set(part.parent, [...(children.get(part.parent) ?? []), part]);
  const build = (parent: string | null): NewOutlinePart[] =>
    (children.get(parent) ?? []).map((part) => {
      const { node, component } = chosen.get(part.id)!;
      return part.kind === 'section'
        ? { kind: 'section', title: part.title, children: build(part.id), node }
        : {
            kind: 'component',
            title: part.title,
            blocks: component!.blocks,
            artifactId: component!.component,
            node,
          };
    });
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
  /** It was changed since the revision its importer read. */
  | { readonly answer: 'import.changed' }
  /** A reference outside the import is neither retargeted nor made text (IMP-034). */
  | { readonly answer: 'import.references_unresolved'; readonly references: readonly string[] }
  /** Imported again: its importer may suggest on none of the components it changes (IM-K). */
  | { readonly answer: 'import.not_permitted' }
  /** Imported again: the earlier import's document is gone. */
  | { readonly answer: 'import.earlier_missing' }
  | Exclude<Awaited<ReturnType<typeof createDocumentWithComponents>>, { answer: 'created' }>;

/** What accepting takes: who, the document's title, language and template, and what they may do. */
export interface AcceptImportInput {
  readonly by: string;
  /** The revision its importer read; any where absent. */
  readonly revision?: number;
  readonly title: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly template?: string;
  /**
   * Whether `by` holds a permission on an artifact, for an import again: `suggest` on a component it
   * changes, `comment` on one it flags, `edit` on the document it places in. The caller's to decide;
   * all held where absent.
   */
  readonly may?: (artifact: string, permission: 'suggest' | 'comment' | 'edit') => Promise<boolean>;
}

/**
 * Accepted (IM-F): the document and its components made from the proposal as edited, by the person
 * accepting, in the caller's transaction; what each version came from recorded (IMP-035); the import
 * `accepted`, naming the document and counting what was accepted unchanged (IMP-031). The parts are kept, and
 * the file, for a re-import (IMd).
 */
export async function acceptImport(
  trx: TenantTransaction,
  id: string,
  input: AcceptImportInput,
): Promise<AcceptImportAnswer> {
  const { rows: held } = await sql<Row>`select ${COLUMNS} from import where id = ${id}
    and state = 'proposed' for update`.execute(trx);
  const row = held[0];
  if (!row) return { answer: 'import.not_proposed' };
  if (input.revision !== undefined && row.revision !== input.revision) {
    return { answer: 'import.changed' };
  }
  const waiting = row.outside.filter((each) => each.resolved === null).map((each) => each.key);
  if (waiting.length > 0) return { answer: 'import.references_unresolved', references: waiting };
  if (row.kind === 'again') return acceptAgain(trx, row, input);
  const parts = placedImages(await importParts(trx, id), await assetsOf(trx, row, input.by));

  // Each component's identity and every node's chosen first, so a reference resolves to them (IMP-006).
  const chosen = new Map<string, { node: string; component?: AcceptedComponent }>();
  for (const part of parts) {
    const node = newNodeIdentifier();
    chosen.set(
      part.id,
      part.kind === 'section'
        ? { node }
        : {
            node,
            component: {
              component: randomUUID(),
              node,
              headings: part.headings,
              blocks: part.blocks,
            },
          },
    );
  }
  const components = [...chosen.values()].flatMap((each) => each.component ?? []);
  const within = {
    components,
    sections: parts.flatMap((part) =>
      part.kind === 'section' ? [{ node: chosen.get(part.id)!.node, headings: part.headings }] : [],
    ),
    anchors: row.anchors,
  };
  const unresolved = new Set<string>();
  const changes = new Map<string, ProposedChange[]>();
  for (const part of parts) {
    const own = chosen.get(part.id)!.component;
    if (!own) continue;
    const resolved = resolveReferences(own, within);
    resolved.unresolved.forEach((each) => unresolved.add(each));
    changes.set(
      part.id,
      part.changes.map((change) => ({
        ...change,
        proposed: resolveReferences(
          { ...own, blocks: [...own.blocks, ...change.proposed] },
          within,
        ).blocks.slice(own.blocks.length),
      })),
    );
    chosen.set(part.id, {
      ...chosen.get(part.id)!,
      component: { ...own, blocks: resolved.blocks },
    });
  }
  if (unresolved.size > 0) {
    return { answer: 'import.references_unresolved', references: [...unresolved] };
  }
  const made = await createDocumentWithComponents(trx, {
    spaceId: row.space_id,
    author: input.by,
    title: input.title,
    language: input.language,
    direction: input.direction,
    ...(input.template === undefined ? {} : { template: input.template }),
    parts: outlineOf(parts, chosen),
  });
  if (made.answer !== 'created') return made;
  const counts = acceptedCounts(await importParts(trx, id, 'read'), parts);
  for (const version of [made.document, ...made.components]) {
    await sql`insert into import_made (version_id, artifact_id, import_id)
      values (${version.id}, ${version.artifactId}, ${id})`.execute(trx);
  }
  // What each part made, for a later import of the same file to match against (IM-K).
  for (const part of parts) {
    const own = chosen.get(part.id)!.component;
    if (own) await recordMade(trx, part.id, own.component);
  }

  // The tenant's policy applied once, now (IMP-032): each author's changes a suggestion and each
  // comment a thread, in order, on the component's 0.1.
  const policy = await importPolicy(trx);
  const applied = {
    policy,
    identities: row.identities,
    members: await membersOf(trx),
    confirmed: row.confirmed,
  };
  const report = createReport();
  for (const part of parts) {
    const own = chosen.get(part.id)!.component;
    const version = own && made.components.find((each) => each.artifactId === own.component);
    if (!version) continue;
    const skipped = await suggestAndDiscuss(trx, {
      import: id,
      importer: input.by,
      version,
      changes: changes.get(part.id) ?? [],
      threads: part.threads,
      applied,
    });
    if (skipped > 0) report.add('read', 'discarded', 'trackedChange', { count: skipped });
  }
  if (policy === 'discard') await unnameParts(trx, id);
  const { rows } = await sql<Row>`
    update import set state = 'accepted', document_id = ${made.document.artifactId},
           accepted = ${JSON.stringify(counts)}::jsonb, finished_at = now(), touched_at = now(),
           policy = ${policy},
           report = ${JSON.stringify([
             ...(row.report ?? []),
             ...report.entries.map((entry) => ({ ...entry, part: null })),
           ])}::jsonb,
           identities = ${policy === 'discard' ? '[]' : JSON.stringify(row.identities)}::jsonb,
           confirmed = ${policy === 'discard' ? '{}' : JSON.stringify(row.confirmed)}::jsonb,
           properties = ${policy === 'keep' && row.properties !== null ? JSON.stringify(row.properties) : null}::jsonb
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

/**
 * Every Word author's name and initials blanked on its parts, as read and as edited, once accepted
 * under `discard` (IMP-010): the one change the read set allows (0157).
 */
async function unnameParts(trx: TenantTransaction, id: string): Promise<void> {
  await sql`update import_part set changes = import_part_unnamed(changes),
            threads = import_part_unnamed_threads(threads)
     where import_id = ${id}`.execute(trx);
}

/** The component an edited part made or updated, recorded at acceptance (IM-K). */
async function recordMade(trx: TenantTransaction, part: string, component: string): Promise<void> {
  await sql`update import_part set made = ${component} where id = ${part}`.execute(trx);
}

/** Where a component is referenced in an outline: its node, its parent's and its place there. */
function referenceIn(
  nodes: readonly OutlineNode[],
  component: string,
  parent: string | null = null,
):
  { readonly node: string; readonly parent: string | null; readonly position: number } | undefined {
  for (const [position, node] of nodes.entries()) {
    if (node.type === 'reference' && node.component === component) {
      return { node: node.id, parent, position };
    }
    const within = referenceIn(node.children, component, node.id);
    if (within) return within;
  }
  return undefined;
}

/** A gone component's flag on the document (IM-K): words only, its file named as data. */
const goneText = (fileName: string) =>
  `Imported again from ${fileName}, no part of the file matched this component. It was kept as it is; nothing was deleted.`;

/**
 * Accepted again (IM-K; IMP-037): no document is made. Each changed part is a whole-component
 * suggestion against its component's current version, by the importer, its Word authors' changes
 * and comments on top as IMc makes them, so an edit made in the space is never overwritten. Each new
 * part is a new component placed in the earlier import's document after the part before it; a
 * placement is never suggested, since no suggestion places. What no part matches is flagged on the
 * document and kept. A component its importer may not suggest on is skipped and said; none being
 * suggestable refuses the whole before anything is written.
 */
async function acceptAgain(
  trx: TenantTransaction,
  row: Row,
  input: AcceptImportInput,
): Promise<AcceptImportAnswer> {
  const may = input.may ?? (async () => true);
  const { rows: earlier } = await sql<{ document_id: string | null }>`
    select document_id from import where id = ${row.earlier}`.execute(trx);
  const documentId = earlier[0]?.document_id ?? null;
  if (documentId === null || (await isDeleted(trx, documentId))) {
    return { answer: 'import.earlier_missing' };
  }

  // What each part does, and who may, decided before anything is written.
  const stored = await importParts(trx, row.id);
  const plans: {
    act: 'none' | 'new' | 'gone' | 'unchanged' | 'changed';
    version?: StoredVersion;
  }[] = [];
  for (const part of stored) {
    const version =
      part.kind === 'component' && part.matched !== null
        ? await latestVersion(trx, part.matched)
        : undefined;
    if (part.kind !== 'component') plans.push({ act: 'none' });
    else if (!version) plans.push({ act: 'new' });
    // Deleted or archived since it was matched: skipped, and said.
    else if (
      (await isDeleted(trx, version.artifactId)) ||
      (await isArchived(trx, version.artifactId))
    ) {
      plans.push({ act: 'gone', version });
    } else {
      const status = againStatus(part.blocks, (version.content as ContentDocument).content);
      plans.push({ act: status === 'unchanged' ? 'unchanged' : 'changed', version });
    }
  }
  const suggestable = new Map<string, boolean>();
  for (const plan of plans) {
    if (plan.version && plan.act !== 'gone') {
      suggestable.set(plan.version.artifactId, await may(plan.version.artifactId, 'suggest'));
    }
  }
  const changed = plans.filter((plan) => plan.act === 'changed');
  if (changed.length > 0 && changed.every((plan) => !suggestable.get(plan.version!.artifactId))) {
    return { answer: 'import.not_permitted' };
  }

  // Each block a matched part shares with its component keeps the component's identifiers, so what
  // anchors to it stands (IMP-037); the rest are new.
  const carried = new Map<string, string>();
  const parts = placedImages(stored, await assetsOf(trx, row, input.by)).map((part, index) => {
    const version = plans[index]!.version;
    if (!version) return part;
    const given = againIdentifiers((version.content as ContentDocument).content, part.blocks);
    given.forEach((to, from) => carried.set(from, to));
    return renamed(part, given);
  });
  const ids = new Map(parts.map((part) => [part.id, part.matched ?? randomUUID()] as const));
  // References within the file resolve among its components: a matched one's blocks as they stand
  // now, a new one's as proposed. One to a heading, or to a block a component does not hold yet, is
  // left as it is and said.
  const within = {
    components: parts.flatMap((part, index) => {
      if (part.kind !== 'component') return [];
      const version = plans[index]!.version;
      const blocks = version ? (version.content as ContentDocument).content : part.blocks;
      return [{ component: ids.get(part.id)!, node: '', headings: [], blocks }];
    }),
    sections: [],
    anchors: Object.fromEntries(
      Object.entries(row.anchors).map(([read, admitted]) => [
        read,
        carried.get(admitted) ?? admitted,
      ]),
    ),
  };
  const unresolved = new Set<string>();
  const resolved = (part: StoredImportPart, blocks: readonly BlockNode[]) => {
    const answer = resolveReferences(
      { component: ids.get(part.id)!, node: '', headings: [], blocks },
      within,
    );
    answer.unresolved.forEach((each) => unresolved.add(each));
    return answer.blocks;
  };
  const applied = {
    policy: await importPolicy(trx),
    identities: row.identities,
    members: await membersOf(trx),
    confirmed: row.confirmed,
  };
  const report = createReport();
  const outcome: {
    suggested: { component: string; suggestion: string }[];
    made: { component: string; placed: boolean }[];
    gone: { component: string; flagged: boolean }[];
    skipped: { component: string; reason: SkippedReason }[];
    unchanged: number;
  } = { suggested: [], made: [], gone: [], skipped: [], unchanged: 0 };
  const components: StoredVersion[] = [];
  const mayEdit = await may(documentId, 'edit');

  for (const [index, part] of parts.entries()) {
    const plan = plans[index]!;
    if (plan.act === 'none') continue;
    const blocks = resolved(part, part.blocks);
    const changes = part.changes.map((change) => ({
      ...change,
      proposed: resolved(part, [...part.blocks, ...change.proposed]).slice(part.blocks.length),
    }));
    if (plan.act === 'new') {
      const made = await createComponent(trx, {
        spaceId: row.space_id,
        title: part.title,
        language: input.language,
        direction: input.direction,
        author: input.by,
        blocks,
        artifactId: ids.get(part.id)!,
      });
      if (made.answer !== 'created') {
        return {
          answer: made.answer === 'component_type.missing' ? made.answer : 'content.invalid',
        } as { answer: 'component_type.missing' } | { answer: 'content.invalid' };
      }
      components.push(made.version);
      await sql`insert into import_made (version_id, artifact_id, import_id)
        values (${made.version.id}, ${made.version.artifactId}, ${row.id})`.execute(trx);
      await recordMade(trx, part.id, made.version.artifactId);
      const placed = mayEdit && (await placeAfter(trx, documentId, input.by, parts, ids, index));
      outcome.made.push({ component: made.version.artifactId, placed });
      const skipped = await suggestAndDiscuss(trx, {
        import: row.id,
        importer: input.by,
        version: made.version,
        changes,
        threads: part.threads,
        applied,
      });
      if (skipped > 0) report.add('read', 'discarded', 'trackedChange', { count: skipped });
      continue;
    }
    const version = plan.version!;
    if (plan.act === 'gone') {
      outcome.skipped.push({ component: version.artifactId, reason: 'gone' });
      continue;
    }
    if (plan.act === 'unchanged') outcome.unchanged += 1;
    const allowed = suggestable.get(version.artifactId) === true;
    if (plan.act === 'changed') {
      if (!allowed) {
        outcome.skipped.push({ component: version.artifactId, reason: 'suggest' });
        continue;
      }
      const content = version.content as ContentDocument;
      const made = await makeSuggestion(trx, {
        component: version.artifactId,
        version: version.id,
        proposed: parseContentDocument({ ...content, content: blocks }),
        by: input.by,
      });
      if (made.answer !== 'made') {
        outcome.skipped.push({ component: version.artifactId, reason: SKIPPED[made.answer] });
        continue;
      }
      outcome.suggested.push({ component: version.artifactId, suggestion: made.suggestion });
      await sql`insert into import_made (suggestion_id, artifact_id, import_id)
        values (${made.suggestion}, ${version.artifactId}, ${row.id})`.execute(trx);
    }
    // Recorded only where it was suggested on, or left as it is.
    await recordMade(trx, part.id, version.artifactId);
    // Its Word authors' changes and its comments on top, against the same version (IMc's rules).
    const skipped = await suggestAndDiscuss(trx, {
      import: row.id,
      importer: input.by,
      version,
      changes: allowed ? changes : [],
      threads: (await may(version.artifactId, 'comment')) ? part.threads : [],
      applied,
      base: blocks,
    });
    if (skipped > 0) report.add('read', 'discarded', 'trackedChange', { count: skipped });
  }

  if (unresolved.size > 0) {
    report.add('read', 'kept', 'crossReferenceUnresolved', { count: unresolved.size });
  }

  // What no part matches is gone: kept, and flagged on the document where it stands there.
  const held = new Set(parts.map((part) => part.matched));
  const mayComment = await may(documentId, 'comment');
  for (const candidate of await againCandidates(trx, row.earlier!)) {
    if (held.has(candidate.component)) continue;
    const document = await latestVersion(trx, documentId);
    const at = referenceIn((document!.content as OutlineDocument).nodes, candidate.component);
    const started =
      mayComment && at
        ? await startThread(trx, {
            on: documentId,
            version: document!.id,
            anchor: { kind: 'node', node: at.node },
            parts: [{ text: words(goneText(row.file_name)) }],
            author: input.by,
          })
        : undefined;
    outcome.gone.push({ component: candidate.component, flagged: started?.answer === 'done' });
  }

  const document = (await latestVersion(trx, documentId))!;
  const counts = acceptedCounts(await importParts(trx, row.id, 'read'), parts);
  if (applied.policy === 'discard') await unnameParts(trx, row.id);
  const { rows } = await sql<Row>`
    update import set state = 'accepted', document_id = ${documentId},
           accepted = ${JSON.stringify(counts)}::jsonb, finished_at = now(), touched_at = now(),
           policy = ${applied.policy}, outcome = ${JSON.stringify(outcome)}::jsonb,
           report = ${JSON.stringify([
             ...(row.report ?? []),
             ...report.entries.map((entry) => ({ ...entry, part: null })),
           ])}::jsonb,
           identities = ${applied.policy === 'discard' ? '[]' : JSON.stringify(row.identities)}::jsonb,
           confirmed = ${applied.policy === 'discard' ? '{}' : JSON.stringify(row.confirmed)}::jsonb,
           properties = ${applied.policy === 'keep' && row.properties !== null ? JSON.stringify(row.properties) : null}::jsonb
     where id = ${row.id}
    returning ${COLUMNS}`.execute(trx);
  await recordImportEvent(trx, row, {
    kind: 'import.accepted',
    document,
    components: components.length,
  });
  return { answer: 'accepted', import: importOf(rows[0]!), document, components };
}

/**
 * A new component placed in the document (IM-K): after the nearest part before it whose component
 * the document references, else before the nearest after it, else last. Answers whether it was.
 */
async function placeAfter(
  trx: TenantTransaction,
  documentId: string,
  by: string,
  parts: readonly StoredImportPart[],
  ids: ReadonlyMap<string, string>,
  index: number,
): Promise<boolean> {
  const document = await latestVersion(trx, documentId);
  if (!document) return false;
  const { nodes } = document.content as OutlineDocument;
  const component = ids.get(parts[index]!.id)!;
  const near = (from: number, step: 1 | -1) => {
    for (let at = from + step; at >= 0 && at < parts.length; at += step) {
      const part = parts[at]!;
      if (part.kind !== 'component') continue;
      const found = referenceIn(nodes, ids.get(part.id)!);
      if (found) return found;
    }
    return undefined;
  };
  const before = near(index, -1);
  const after = before ? undefined : near(index, 1);
  const at = before
    ? { parent: before.parent, position: before.position + 1 }
    : after
      ? { parent: after.parent, position: after.position }
      : { parent: null, position: nodes.length };
  const recorded = await editOutline(trx, {
    artifactId: documentId,
    openedFrom: document.id,
    author: by,
    operation: {
      operation: 'insert',
      parent: at.parent,
      position: at.position,
      node: { type: 'reference', component, mode: { kind: 'latest' } },
    },
  });
  return recorded.answer === 'recorded';
}

/**
 * The images an import held made assets of its space at acceptance (IM-C), each through an upload
 * filled and recorded with the header its job read, by the person accepting: each placeholder's
 * asset version. The rows go; the objects are the assets' now.
 */
async function assetsOf(
  trx: TenantTransaction,
  row: Row,
  by: string,
): Promise<Map<string, string>> {
  const { rows } = await sql<{
    placeholder: string;
    object_key: string;
    sha256: string;
    bytes: string;
    header: ImageHeader;
  }>`delete from import_asset where import_id = ${row.id}
     returning placeholder, object_key, sha256, bytes::text as bytes, header`.execute(trx);
  const made = new Map<string, string>();
  for (const each of rows) {
    await holdObject(trx, each.sha256);
    const upload = await createAssetUpload(trx, {
      spaceId: row.space_id,
      uploader: by,
      alternative: null,
    });
    await receiveAssetBytes(
      trx,
      upload.id,
      { key: each.object_key, format: each.header.format, bytes: Number(each.bytes) },
      false,
    );
    made.set(each.placeholder, (await recordAsset(trx, upload.id, each.header)).id);
  }
  return made;
}

/** A part with each identifier `given` names, of a node or of a block it names, given instead. */
function renamed(part: StoredImportPart, given: ReadonlyMap<string, string>): StoredImportPart {
  if (given.size === 0) return part;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, each]) => [
        key,
        (key === 'id' || key === 'block') && typeof each === 'string'
          ? (given.get(each) ?? each)
          : walk(each),
      ]),
    );
  };
  return {
    ...part,
    blocks: walk(part.blocks) as BlockNode[],
    changes: walk(part.changes) as ProposedChange[],
    threads: walk(part.threads) as ProposedThread[],
  };
}

/** The parts with each figure's placeholder its asset version. */
function placedImages(
  parts: readonly StoredImportPart[],
  assets: ReadonlyMap<string, string>,
): StoredImportPart[] {
  if (assets.size === 0) return [...parts];
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (typeof value !== 'object' || value === null) return value;
    const node = Object.fromEntries(Object.entries(value).map(([key, each]) => [key, walk(each)]));
    const asset = node['asset'];
    if (typeof asset === 'string' && assets.has(asset)) node['asset'] = assets.get(asset);
    return node;
  };
  return parts.map((part) => ({
    ...part,
    blocks: walk(part.blocks) as BlockNode[],
    changes: walk(part.changes) as ProposedChange[],
  }));
}

/** The tenant's people an identity may match, for attribution: its users, none erased. */
export async function membersOf(trx: TenantTransaction): Promise<ImportMember[]> {
  const { rows } = await sql<ImportMember>`
    select id, email, display_name as name from principal
     where kind = 'user' and erased_at is null`.execute(trx);
  return rows;
}

/** A comment's words as a thread holds them (TH-B): no control character but a line feed, 4,000 at most. */
const words = (text: string) =>
  [...text.replace(/(?!\n)\p{Cc}/gu, ' ').trim()].slice(0, 4000).join('') || '(No text)';

/**
 * A component's suggestions and threads made from its Word authors' changes and comments (IM-G), each
 * made by the importer and attributed as the policy says (IM-I), beside it (IMP-011): a mapped member
 * is attribution only, never the author, since a file names whoever its writer typed. Answers how
 * many authors' changes could not be made a suggestion.
 */
async function suggestAndDiscuss(
  trx: TenantTransaction,
  input: {
    readonly import: string;
    readonly importer: string;
    readonly version: StoredVersion;
    readonly changes: readonly ProposedChange[];
    readonly threads: readonly ProposedThread[];
    readonly applied: Parameters<typeof attributionOf>[1];
    /** The blocks its changes are made to: the version's, unless an import again proposes others. */
    readonly base?: readonly BlockNode[];
  },
): Promise<number> {
  const { version } = input;
  const content = version.content as ContentDocument;
  const attribute = async (
    made: { suggestion_id?: string; thread_id?: string; comment_id?: string },
    who: { readonly member: string | null; readonly attributedTo: string | null },
  ) => {
    await sql`insert into import_attribution
        (import_id, suggestion_id, thread_id, comment_id, policy, attributed_to, member)
      values (${input.import}, ${made.suggestion_id ?? null}, ${made.thread_id ?? null},
              ${made.comment_id ?? null}, ${input.applied.policy}, ${who.attributedTo},
              ${who.member})`.execute(trx);
  };
  let skipped = 0;
  const authors = [...new Set(input.changes.map((change) => change.author))];
  for (const author of authors) {
    const blocks = suggestedBlocks(
      input.base ?? content.content,
      input.changes.filter((change) => change.author === author),
    );
    let proposed: ContentDocument;
    try {
      proposed = parseContentDocument({ ...content, content: blocks });
    } catch {
      skipped += 1;
      continue;
    }
    const who = attributionOf(author, input.applied);
    const made = await makeSuggestion(trx, {
      component: version.artifactId,
      version: version.id,
      proposed,
      by: input.importer,
    });
    if (made.answer !== 'made') {
      skipped += 1;
      continue;
    }
    await attribute({ suggestion_id: made.suggestion }, who);
  }
  for (const thread of input.threads) {
    const who = attributionOf(thread.author, input.applied);
    const start = (anchor: object) =>
      startThread(trx, {
        on: version.artifactId,
        version: version.id,
        anchor,
        parts: [{ text: words(thread.text) }],
        author: input.importer,
      });
    let started = thread.span
      ? await start({
          kind: 'span',
          block: thread.block,
          quote: thread.quote,
          before: thread.before,
        })
      : await start({ kind: 'component' });
    if (started.answer === 'anchor.invalid') started = await start({ kind: 'component' });
    if (started.answer !== 'done') continue;
    await attribute({ thread_id: started.thread }, who);
    for (const reply of thread.replies) {
      const by = attributionOf(reply.author, input.applied);
      const added = await addComment(trx, {
        thread: started.thread,
        parts: [{ text: words(reply.text) }],
        author: input.importer,
      });
      if (added.answer === 'done') {
        await attribute({ comment_id: added.comment }, by);
      }
    }
  }
  return skipped;
}

/** The tenant's identity policy (IM-I; IMP-010). */
export async function importPolicy(trx: TenantTransaction): Promise<ImportPolicy> {
  const { rows } = await sql<{ policy: ImportPolicy }>`select policy from import_policy`.execute(
    trx,
  );
  return rows[0]?.policy ?? 'map';
}

/** The tenant's identity policy set; the caller decided `administer` at the tenant. */
export async function setImportPolicy(
  trx: TenantTransaction,
  policy: ImportPolicy,
): Promise<ImportPolicy> {
  await sql`update import_policy set policy = ${policy}`.execute(trx);
  return importPolicy(trx);
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
