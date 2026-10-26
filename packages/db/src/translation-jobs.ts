import {
  parseContentDocument,
  translationLanguageRefusal,
  xliffTarget,
  type ContentDocument,
  type XliffPart,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { artifactPlace, recordEvent } from './audit.js';
import { isDeleted } from './deletion.js';
import { serialise } from './editing.js';
import { cutReturned } from './promotion.js';
import { enqueueJob } from './queue.js';
import type { TenantTransaction } from './tables.js';
import { beginTranslation, jobsStored, translationSource, translationsOf } from './translation.js';

/**
 * **Translation jobs** (docs/design/translation.md, "Translation jobs"; the XL plan, XL-D, XL-E): a
 * document's components needing a language, sent as one file. Each item records the source version
 * sent and the line's head as it stood, so what comes back (XLb) is known to be against them. Whether
 * the caller may is theirs to have decided: edit on the document, and on each component as listed.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The most jobs a document's listing names, newest first (API-058). */
export const JOBS_LISTED = 50;

/** Why a component a job lists was not sent (XL-D). */
export type NotSent = 'needs_revision' | 'not_editable' | 'other_source';

export interface JobItem {
  readonly component: string;
  /** Its language line, the source version sent and the line's head then; null where not sent. */
  readonly line: string | null;
  readonly sourceVersion: string | null;
  readonly lineHead: string | null;
  readonly notSent: NotSent | null;
  /** What came back (XLb); null while it is out. */
  readonly outcome: 'returned' | 'held' | 'refused' | null;
  readonly version: string | null;
  /** Who recorded the outcome - the uploader, or the person who decided a held item - and when. */
  readonly decided: { readonly by: string; readonly at: Date } | null;
}

/** A job's file returned (XL-F): who sent it and when, and what reading it did. */
export interface JobReturn {
  readonly id: string;
  readonly job: string;
  readonly by: string;
  readonly at: Date;
  readonly state: 'reading' | 'read' | 'failed';
  readonly failure: string | null;
  readonly returned: number | null;
  readonly held: number | null;
  readonly refused: number | null;
  readonly objectKey: string;
  readonly sha256: string;
}

export interface TranslationJob {
  readonly id: string;
  readonly document: string;
  readonly documentVersion: string;
  readonly language: string;
  readonly vendor: string | null;
  readonly by: string;
  readonly at: Date;
  readonly closed: { readonly by: string; readonly at: Date } | null;
  readonly items: readonly JobItem[];
  /** Each file returned to it, newest first. */
  readonly returns: readonly JobReturn[];
}

/** Whether 0164 has run; a tenant before it holds no return. */
async function returnsStored(trx: TenantTransaction): Promise<boolean> {
  const { rows } = await sql<{
    present: boolean;
  }>`select to_regclass('translation_job_return') is not null as present`.execute(trx);
  return rows[0]?.present === true;
}

const returnOf = (row: {
  id: string;
  job_id: string;
  by: string;
  at: Date;
  state: 'reading' | 'read' | 'failed';
  failure: string | null;
  returned: number | null;
  held: number | null;
  refused: number | null;
  object_key: string;
  sha256: string;
}): JobReturn => ({
  id: row.id,
  job: row.job_id,
  by: row.by,
  at: row.at,
  state: row.state,
  failure: row.failure,
  returned: row.returned,
  held: row.held,
  refused: row.refused,
  objectKey: row.object_key,
  sha256: row.sha256,
});

async function jobsWhere(
  trx: TenantTransaction,
  documentId: string,
  jobId?: string,
): Promise<TranslationJob[]> {
  if (!UUID.test(documentId) || (jobId !== undefined && !UUID.test(jobId))) return [];
  if (!(await jobsStored(trx))) return [];
  const jobs = await trx
    .selectFrom('translation_job')
    .selectAll()
    .where('document_id', '=', documentId)
    .$if(jobId !== undefined, (query) => query.where('id', '=', jobId!))
    .orderBy('at', 'desc')
    .orderBy('id')
    .limit(JOBS_LISTED)
    .execute();
  if (jobs.length === 0) return [];
  // Never the words held for review, which a listing does not show.
  const items = await trx
    .selectFrom('translation_job_item')
    .select([
      'job_id',
      'component_id',
      'line_id',
      'source_version',
      'line_head',
      'not_sent',
      'outcome',
      'version_id',
      'decided_by',
      'decided_at',
    ])
    .where(
      'job_id',
      'in',
      jobs.map((job) => job.id),
    )
    .orderBy('job_id')
    .orderBy('position')
    .execute();
  const returns = (await returnsStored(trx))
    ? await trx
        .selectFrom('translation_job_return')
        .selectAll()
        .where(
          'job_id',
          'in',
          jobs.map((job) => job.id),
        )
        .orderBy('at', 'desc')
        .orderBy('id')
        .execute()
    : [];
  return jobs.map((job) => ({
    id: job.id,
    document: job.document_id,
    documentVersion: job.document_version,
    language: job.language,
    vendor: job.vendor,
    by: job.by,
    at: job.at,
    closed:
      job.closed_by === null || job.closed_at === null
        ? null
        : { by: job.closed_by, at: job.closed_at },
    items: items
      .filter((item) => item.job_id === job.id)
      .map((item) => ({
        component: item.component_id,
        line: item.line_id,
        sourceVersion: item.source_version,
        lineHead: item.line_head,
        notSent: item.not_sent,
        outcome: item.outcome,
        version: item.version_id,
        decided:
          item.decided_by === null || item.decided_at === null
            ? null
            : { by: item.decided_by, at: item.decided_at },
      })),
    returns: returns.filter((each) => each.job_id === job.id).map(returnOf),
  }));
}

/** A document's jobs, newest first, at most `JOBS_LISTED`. */
export const translationJobsOf = (trx: TenantTransaction, documentId: string) =>
  jobsWhere(trx, documentId);

/** One of a document's jobs, or undefined where it holds no such job. */
export async function readTranslationJob(
  trx: TenantTransaction,
  documentId: string,
  jobId: string,
): Promise<TranslationJob | undefined> {
  return (await jobsWhere(trx, documentId, jobId))[0];
}

export type MakeTranslationJobAnswer =
  | { readonly answer: 'made'; readonly job: TranslationJob }
  | { readonly answer: 'translation.language_invalid' | 'translation.nothing_to_send' };

/**
 * **A job made from a document** (XL-D; LOC-033): of each component it places, in order, one in
 * another language that needs translating into `language` - no translation yet, untranslated, or out
 * of date by a change declared to need it - and no job already holds out. The maker may edit it, or
 * it is listed as not sent; a translation is begun where none is, or it is listed as needing a
 * designated revision. Refused where nothing would be sent. Audited `translation.job_sent`.
 */
export async function makeTranslationJob(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly documentVersion: string;
    readonly language: string;
    readonly vendor?: string | undefined;
    readonly by: string;
    /** The components the document places that the maker may read, in order, and whether each they may edit. */
    readonly components: readonly { readonly id: string; readonly editable: boolean }[];
  },
): Promise<MakeTranslationJobAnswer> {
  if (translationLanguageRefusal('und', input.language) === 'translation.language_invalid') {
    return { answer: 'translation.language_invalid' };
  }
  const components = [...new Map(input.components.map((each) => [each.id, each])).values()];
  const translations = await translationsOf(
    trx,
    components.map((each) => each.id),
  );
  const items: {
    component_id: string;
    line_id: string | null;
    source_version: string | null;
    line_head: string | null;
    not_sent: NotSent | null;
  }[] = [];
  // One file names one source language: the first sent's (the XL final review).
  let sourceLanguage: string | undefined;
  const listed = (id: string, notSent: NotSent) =>
    items.push({
      component_id: id,
      line_id: null,
      source_version: null,
      line_head: null,
      not_sent: notSent,
    });
  for (const component of components) {
    // A component deleted since it was placed is sent nothing (the XL final review).
    if (await isDeleted(trx, component.id)) continue;
    const source = await translationSource(trx, component.id);
    if (!source || source.kind !== 'component') continue;
    const language = parseContentDocument(source.content).language;
    if (language === input.language) continue;
    const held = translations.get(component.id)?.find((each) => each.language === input.language);
    const needed =
      held === undefined ||
      held.status.status === 'untranslated' ||
      (held.status.status === 'outOfDate' && held.status.retranslate);
    if (!needed) continue;
    if (!component.editable) {
      listed(component.id, 'not_editable');
      continue;
    }
    if (sourceLanguage !== undefined && language !== sourceLanguage) {
      listed(component.id, 'other_source');
      continue;
    }
    let line = held?.line;
    if (line === undefined) {
      const begun = await beginTranslation(trx, {
        artifactId: component.id,
        language: input.language,
        by: input.by,
      });
      if (begun.answer === 'translation.needs_revision') {
        listed(component.id, 'needs_revision');
        continue;
      }
      if (begun.answer !== 'begun') continue;
      line = begun.line.id;
    }
    const head = await trx
      .selectFrom('artifact_version')
      .select('id')
      .where('line_id', '=', line)
      .orderBy('version_no', 'desc')
      .limit(1)
      .executeTakeFirst();
    items.push({
      component_id: component.id,
      line_id: line,
      source_version: source.id,
      line_head: head?.id ?? null,
      not_sent: null,
    });
    sourceLanguage = language;
  }
  const sent = items.filter((item) => item.not_sent === null).length;
  if (sent === 0) return { answer: 'translation.nothing_to_send' };
  const job = await trx
    .insertInto('translation_job')
    .values({
      document_id: input.documentId,
      document_version: input.documentVersion,
      language: input.language,
      vendor: input.vendor ?? null,
      by: input.by,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('translation_job_item')
    .values(items.map((item, position) => ({ ...item, position, job_id: job.id })))
    .execute();
  const place = await artifactPlace(trx, input.documentId);
  await recordEvent(
    trx,
    {
      kind: 'translation.job_sent',
      subject: { kind: 'document', id: input.documentId, version: place.version },
      space: place.space,
      detail: { job: job.id, language: input.language, sent, notSent: items.length - sent },
    },
    place.labels,
  );
  return { answer: 'made', job: (await readTranslationJob(trx, input.documentId, job.id))! };
}

export type CloseTranslationJobAnswer =
  | { readonly answer: 'closed'; readonly job: TranslationJob }
  | { readonly answer: 'job.missing' | 'translation.job_closed' };

/** Closes a document's job (XL-D), ending what is still out. Audited `translation.job_closed`. */
export async function closeTranslationJob(
  trx: TenantTransaction,
  input: { readonly documentId: string; readonly job: string; readonly by: string },
): Promise<CloseTranslationJobAnswer> {
  const job = await readTranslationJob(trx, input.documentId, input.job);
  if (!job) return { answer: 'job.missing' };
  const closed = await trx
    .updateTable('translation_job')
    .set({ closed_by: input.by, closed_at: new Date() })
    .where('id', '=', job.id)
    .where('closed_at', 'is', null)
    .returning('id')
    .executeTakeFirst();
  if (!closed) return { answer: 'translation.job_closed' };
  const place = await artifactPlace(trx, input.documentId);
  await recordEvent(
    trx,
    {
      kind: 'translation.job_closed',
      subject: { kind: 'document', id: input.documentId, version: place.version },
      space: place.space,
      detail: {
        job: job.id,
        outstanding: job.items.filter((item) => item.line !== null && item.outcome === null).length,
      },
    },
    place.labels,
  );
  return { answer: 'closed', job: (await readTranslationJob(trx, input.documentId, job.id))! };
}

/** One component of a job's file, as it was sent (XL-A, XL-B). */
export interface JobFilePart {
  readonly component: string;
  readonly title: string;
  /** Its component type's name, or null where it has none. */
  readonly type: string | null;
  readonly content: unknown;
}

/**
 * What a job's file is written from (XL-D): each item sent whose component is in `readable`, at the
 * source version sent, with its title and type. The caller decided what they may read now.
 */
export async function jobFileParts(
  trx: TenantTransaction,
  job: TranslationJob,
  readable: ReadonlySet<string>,
): Promise<JobFilePart[]> {
  const sent = job.items.filter(
    (item): item is JobItem & { sourceVersion: string } =>
      item.sourceVersion !== null && readable.has(item.component),
  );
  if (sent.length === 0) return [];
  const { rows } = await sql<{ id: string; content: unknown; type: string | null }>`
    select v.id, v.content, t.content->>'name' as type
      from artifact_version v
      left join artifact_version t on t.id = v.component_type_version_id
     where v.id = any(${sent.map((item) => item.sourceVersion)}::uuid[])`.execute(trx);
  const byVersion = new Map(rows.map((row) => [row.id, row]));
  return sent.flatMap((item) => {
    const row = byVersion.get(item.sourceVersion);
    if (!row) return [];
    return [
      {
        component: item.component,
        title: parseContentDocument(row.content).title,
        type: row.type,
        content: row.content,
      },
    ];
  });
}

/** The most bytes a returned file may hold (XL-F), an import's. */
export const RETURN_MAX_BYTES = 25 * 1024 * 1024;

export type ReceiveReturnAnswer =
  | { readonly answer: 'received'; readonly job: TranslationJob }
  | { readonly answer: 'job.missing' | 'translation.job_closed' };

/**
 * **A job's file returned** (XL-F): kept by the key and hash the caller stored it under, and the
 * `translation_return` job queued to read it. The caller decided edit on the document.
 */
export async function receiveReturn(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly job: string;
    readonly key: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly by: string;
  },
): Promise<ReceiveReturnAnswer> {
  const job = await readTranslationJob(trx, input.documentId, input.job);
  if (!job) return { answer: 'job.missing' };
  if (job.closed !== null) return { answer: 'translation.job_closed' };
  const made = await trx
    .insertInto('translation_job_return')
    .values({
      job_id: job.id,
      object_key: input.key,
      sha256: input.sha256,
      bytes: input.bytes,
      by: input.by,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await enqueueJob(trx, 'translation_return', made.id);
  return { answer: 'received', job: (await readTranslationJob(trx, input.documentId, job.id))! };
}

/** A return and its job, as the worker reads them; undefined where this tenant holds no such return. */
export async function readReturn(
  trx: TenantTransaction,
  id: string,
): Promise<{ readonly return: JobReturn; readonly job: TranslationJob } | undefined> {
  if (!UUID.test(id) || !(await returnsStored(trx))) return undefined;
  const row = await trx
    .selectFrom('translation_job_return as r')
    .innerJoin('translation_job as j', 'j.id', 'r.job_id')
    .selectAll('r')
    .select('j.document_id')
    .where('r.id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  const job = await readTranslationJob(trx, row.document_id, row.job_id);
  return job && { return: returnOf(row), job };
}

/** Why a return's file was refused whole (XL-F), as its code. */
export type ReturnFailure =
  | 'file_unreadable'
  | 'file_unsafe'
  | 'file_too_large'
  | 'file_not_xliff'
  | 'language_mismatch'
  | 'unknown_file'
  | 'translation_job_closed'
  | 'reading_failed';

async function finishReturn(
  trx: TenantTransaction,
  found: { readonly return: JobReturn; readonly job: TranslationJob },
  outcome:
    | { readonly failure: ReturnFailure }
    | { readonly returned: number; readonly held: number; readonly refused: number },
): Promise<void> {
  const failure = 'failure' in outcome ? outcome.failure : null;
  const counts = 'failure' in outcome ? { returned: 0, held: 0, refused: 0 } : outcome;
  await trx
    .updateTable('translation_job_return')
    .set({
      state: failure === null ? 'read' : 'failed',
      failure,
      ...counts,
      read_at: new Date(),
    })
    .where('id', '=', found.return.id)
    .execute();
  const place = await artifactPlace(trx, found.job.document);
  await recordEvent(
    trx,
    {
      kind: 'translation.job_returned',
      subject: { kind: 'document', id: found.job.document, version: place.version },
      space: place.space,
      detail: { job: found.job.id, return: found.return.id, ...counts, failure },
    },
    place.labels,
  );
}

/** A return's file refused whole (XL-F): nothing of it is applied, and the job stays out. */
export async function failReturn(
  trx: TenantTransaction,
  id: string,
  failure: ReturnFailure,
): Promise<void> {
  const found = await readReturn(trx, id);
  if (!found || found.return.state !== 'reading') return;
  await finishReturn(trx, found, { failure });
}

/** Each unit a file says, by the file's id: what `readXliff` answers. */
export type ReturnedFiles = ReadonlyMap<string, ReadonlyMap<string, readonly XliffPart[] | null>>;

/** Whether an item can still take what comes back: sent, and not returned or held already. */
const open = (item: JobItem) =>
  item.line !== null && (item.outcome === null || item.outcome === 'refused');

/**
 * **A returned file applied** (XL-F; LOC-018, LOC-033, LOC-035), by the worker for its uploader: the
 * file in the job's language, naming no component the job did not send, each component's units read
 * back against the source version sent by the mapping. Each one whose source and line are as they were
 * sent, and whose line nobody holds, is cut by `cutReturned`; one that moved is held with its words for
 * a person (XL-G); one that does not read back, or that the uploader may no longer edit, is refused.
 * A component the file leaves out stays out. Audited `translation.job_returned`.
 */
export async function applyReturn(
  trx: TenantTransaction,
  input: {
    readonly id: string;
    readonly target: string | null;
    readonly files: ReturnedFiles;
    /** Whether the uploader may edit each component now: decided where the facts are. */
    readonly mayEdit: (component: string) => Promise<boolean>;
  },
): Promise<void> {
  const found = await readReturn(trx, input.id);
  if (!found || found.return.state !== 'reading') return;
  const { job } = found;
  if (job.closed !== null) return finishReturn(trx, found, { failure: 'translation_job_closed' });
  if (input.target?.toLowerCase() !== job.language.toLowerCase()) {
    return finishReturn(trx, found, { failure: 'language_mismatch' });
  }
  const sent = new Map(job.items.filter(open).map((item) => [`f.${item.component}`, item]));
  for (const file of input.files.keys()) {
    const item = job.items.find((each) => `f.${each.component}` === file);
    if (!item || item.line === null) return finishReturn(trx, found, { failure: 'unknown_file' });
  }
  const by = found.return.by;
  const counts = { returned: 0, held: 0, refused: 0 };
  for (const [file, units] of input.files) {
    const item = sent.get(file);
    // Returned or held already: a second file does not overwrite it.
    if (!item) continue;
    const outcome = await returnItem(trx, job, item, units, by, input.mayEdit, found.return.id);
    if (outcome) counts[outcome] += 1;
  }
  await finishReturn(trx, found, counts);
}

async function returnItem(
  trx: TenantTransaction,
  job: TranslationJob,
  item: JobItem,
  units: ReadonlyMap<string, readonly XliffPart[] | null>,
  by: string,
  mayEdit: (component: string) => Promise<boolean>,
  returnId: string,
): Promise<'returned' | 'held' | 'refused' | undefined> {
  // Serialised on the component, and the item read again under it, so two returns at once, or a
  // return beside a decision, never both write it (the XL final review).
  await serialise(trx, item.component);
  const now = await trx
    .selectFrom('translation_job_item')
    .select('outcome')
    .where('job_id', '=', job.id)
    .where('component_id', '=', item.component)
    .executeTakeFirst();
  if (now?.outcome !== null && now?.outcome !== 'refused') return undefined;
  const record = (
    outcome: 'returned' | 'held' | 'refused',
    extra: { version?: string; held?: ContentDocument } = {},
  ) =>
    trx
      .updateTable('translation_job_item')
      .set({
        outcome,
        version_id: extra.version ?? null,
        decided_by: by,
        decided_at: new Date(),
        held_content: extra.held === undefined ? null : JSON.stringify(extra.held),
        return_id: returnId,
      })
      .where('job_id', '=', job.id)
      .where('component_id', '=', item.component)
      .execute()
      .then(() => outcome);
  const source = await trx
    .selectFrom('artifact_version')
    .select('content')
    .where('id', '=', item.sourceVersion!)
    .executeTakeFirst();
  if (!source || !(await mayEdit(item.component))) return record('refused');
  // Every unit given a target; one a tool left untranslated refuses the component, not the file.
  const targets = new Map<string, readonly XliffPart[]>();
  for (const [unit, parts] of units) {
    if (parts === null) return record('refused');
    targets.set(unit, parts);
  }
  const read = xliffTarget(parseContentDocument(source.content), targets, job.language);
  if (!read.ok) return record('refused');
  // The source and the line as they were sent, checked by the cut under its own serialisation.
  const cut = await cutReturned(trx, {
    artifactId: item.component,
    line: item.line!,
    content: read.content,
    translates: item.sourceVersion!,
    by,
    expect: { head: item.lineHead, source: item.sourceVersion! },
  });
  if (cut.answer === 'recorded') return record('returned', { version: cut.version.id });
  // Locked, or moved since it was sent: a person decides.
  if (
    cut.answer === 'lock.held' ||
    cut.answer === 'translation.moved' ||
    cut.answer === 'version.precondition'
  ) {
    return record('held', { held: read.content });
  }
  return record('refused');
}

/** A held item as a person reviews it (XL-G): the words that came back, and the source versions. */
export interface HeldItem {
  readonly item: JobItem;
  readonly content: ContentDocument;
}

/** A job's held item, its words read back; undefined where the job holds no such held item. */
export async function readHeld(
  trx: TenantTransaction,
  input: { readonly documentId: string; readonly job: string; readonly component: string },
): Promise<HeldItem | undefined> {
  const job = await readTranslationJob(trx, input.documentId, input.job);
  const item = job?.items.find((each) => each.component === input.component);
  if (!job || !item || item.outcome !== 'held' || !UUID.test(input.component)) return undefined;
  const row = await trx
    .selectFrom('translation_job_item')
    .select('held_content')
    .where('job_id', '=', job.id)
    .where('component_id', '=', input.component)
    .executeTakeFirst();
  if (!row || row.held_content === null) return undefined;
  return { item, content: parseContentDocument(row.held_content) };
}

export type DecideAnswer =
  | { readonly answer: 'decided'; readonly job: TranslationJob }
  | {
      readonly answer:
        | 'item.missing'
        | 'translation.job_closed'
        | 'lock.held'
        /** The words could not be cut: a fixed value refuses them, or the line is gone. */
        | 'translation.not_applied';
    };

/**
 * **A held item decided by a person** (XL-G; LOC-035): accepted, its words cut by `cutReturned` as a
 * translation of the source version sent - out of date at once where the source moved since - or
 * rejected, the words dropped and the component out of the job. The caller decided edit on the
 * document and on the component. Audited `translation.job_decided`.
 */
export async function decideHeld(
  trx: TenantTransaction,
  input: {
    readonly documentId: string;
    readonly job: string;
    readonly component: string;
    readonly decision: 'accept' | 'reject';
    readonly by: string;
  },
): Promise<DecideAnswer> {
  // Serialised on the component, so two decisions, or a decision beside a return, never both act.
  if (!UUID.test(input.component)) return { answer: 'item.missing' };
  await serialise(trx, input.component);
  const held = await readHeld(trx, input);
  if (!held) return { answer: 'item.missing' };
  const job = (await readTranslationJob(trx, input.documentId, input.job))!;
  if (job.closed !== null) return { answer: 'translation.job_closed' };
  let version: string | null = null;
  if (input.decision === 'accept') {
    const cut = await cutReturned(trx, {
      artifactId: input.component,
      line: held.item.line!,
      content: held.content,
      translates: held.item.sourceVersion!,
      by: input.by,
    });
    if (cut.answer === 'lock.held') return { answer: 'lock.held' };
    if (cut.answer === 'recorded') version = cut.version.id;
    else if (cut.answer === 'version.unchanged') version = cut.current.id;
    else return { answer: 'translation.not_applied' };
  }
  await trx
    .updateTable('translation_job_item')
    .set({
      outcome: input.decision === 'accept' ? 'returned' : 'refused',
      version_id: version,
      decided_by: input.by,
      decided_at: new Date(),
      held_content: null,
    })
    .where('job_id', '=', job.id)
    .where('component_id', '=', input.component)
    .where('outcome', '=', 'held')
    .execute();
  const place = await artifactPlace(trx, input.documentId);
  await recordEvent(
    trx,
    {
      kind: 'translation.job_decided',
      subject: { kind: 'document', id: input.documentId, version: place.version },
      space: place.space,
      detail: { job: job.id, component: input.component, decision: input.decision, version },
    },
    place.labels,
  );
  return { answer: 'decided', job: (await readTranslationJob(trx, input.documentId, job.id))! };
}
