import { parseContentDocument, translationLanguageRefusal } from '@alloy-works/domain';
import { sql } from 'kysely';
import { artifactPlace, recordEvent } from './audit.js';
import type { TenantTransaction } from './tables.js';
import {
  beginTranslation,
  jobsStored,
  translationSource,
  translationsOf,
} from './translation.js';

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
export type NotSent = 'needs_revision' | 'not_editable';

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
}

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
  const items = await trx
    .selectFrom('translation_job_item')
    .selectAll()
    .where(
      'job_id',
      'in',
      jobs.map((job) => job.id),
    )
    .orderBy('job_id')
    .orderBy('component_id')
    .execute();
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
      })),
  }));
}

/** A document's jobs, newest first, at most `JOBS_LISTED`. */
export const translationJobsOf = (trx: TenantTransaction, documentId: string) => jobsWhere(trx, documentId);

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
  for (const component of components) {
    const source = await translationSource(trx, component.id);
    if (!source || source.kind !== 'component') continue;
    if (parseContentDocument(source.content).language === input.language) continue;
    const held = translations.get(component.id)?.find((each) => each.language === input.language);
    const needed =
      held === undefined ||
      held.status.status === 'untranslated' ||
      (held.status.status === 'outOfDate' && held.status.retranslate);
    if (!needed) continue;
    if (!component.editable) {
      items.push({
        component_id: component.id,
        line_id: null,
        source_version: null,
        line_head: null,
        not_sent: 'not_editable',
      });
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
        items.push({
          component_id: component.id,
          line_id: null,
          source_version: null,
          line_head: null,
          not_sent: 'needs_revision',
        });
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
    .values(items.map((item) => ({ ...item, job_id: job.id })))
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
  | { readonly answer: 'job.missing' | 'job.closed' };

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
  if (!closed) return { answer: 'job.closed' };
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
