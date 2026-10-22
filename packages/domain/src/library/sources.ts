import { z } from 'zod';

import { CONTROL } from '../data/primitives.js';
import { admitCsl, cslItemSchema, type CslItem } from './entry.js';

/**
 * Reference sources (reference-sources.md; ADR-0068; the XR plan, XR-A, XR-B): a declared, versioned
 * list, each source's host fixed here and never taken from a request, with its operations, its
 * requests' paths and its answers' mapping to CSL-JSON, admitted as an import is. Platform-free: the
 * connector makes the calls.
 */
export const REFERENCE_SOURCES_VERSION = 1;

export const REFERENCE_OPERATIONS = ['search', 'fetch', 'check'] as const;
export type ReferenceOperation = (typeof REFERENCE_OPERATIONS)[number];

export const REFERENCE_SOURCE_IDS = ['crossref', 'pubmed'] as const;
export type ReferenceSourceId = (typeof REFERENCE_SOURCE_IDS)[number];

export interface ReferenceSource {
  readonly id: ReferenceSourceId;
  readonly name: string;
  readonly host: string;
  /** What a record is fetched by, as CSL names it. */
  readonly identifier: 'DOI' | 'PMID';
  readonly operations: readonly ReferenceOperation[];
}

export const REFERENCE_SOURCES: readonly ReferenceSource[] = [
  {
    id: 'crossref',
    name: 'Crossref',
    host: 'api.crossref.org',
    identifier: 'DOI',
    operations: REFERENCE_OPERATIONS,
  },
  {
    id: 'pubmed',
    name: 'PubMed',
    host: 'eutils.ncbi.nlm.nih.gov',
    identifier: 'PMID',
    operations: REFERENCE_OPERATIONS,
  },
];

export const referenceSource = (id: string): ReferenceSource | undefined =>
  REFERENCE_SOURCES.find((each) => each.id === id);

/** The most results a search answers. */
export const REFERENCE_RESULTS_MOST = 20;

/** The most bytes a source's answer may be, by operation (XR-B). */
export const REFERENCE_MOST_BYTES: Readonly<Record<ReferenceOperation, number>> = {
  search: 512 * 1024,
  fetch: 128 * 1024,
  check: 128 * 1024,
};

const DOI = /^10\.[0-9]{4,9}\/\S{1,280}$/;
const PMID = /^[1-9][0-9]{0,9}$/;

/** Whether an identifier is one this source fetches by. */
export const identifierFits = (source: ReferenceSourceId, identifier: string): boolean =>
  (source === 'crossref' ? DOI : PMID).test(identifier);

/** A contact address, sent as the sources' polite use asks. */
export const REFERENCE_CONTACT = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

/** One request of a source, by step: Crossref's search or work; PubMed's search or summaries. */
export type ReferenceStep =
  | { readonly step: 'search'; readonly terms: string }
  | { readonly step: 'work'; readonly identifier: string }
  /** Crossref's notices updating a work, by its DOI (XRb): `filter=updates:{doi}`. */
  | { readonly step: 'updates'; readonly identifier: string }
  | { readonly step: 'summary'; readonly ids: readonly string[] };

/** A step's path and query on the source's host, every value encoded as a query parameter or segment. */
export function referencePath(
  source: ReferenceSourceId,
  step: ReferenceStep,
  contact?: string,
): string {
  const query = new URLSearchParams();
  let path: string;
  if (source === 'crossref') {
    if (step.step === 'search') {
      path = '/works';
      query.set('query', step.terms);
      query.set('rows', String(REFERENCE_RESULTS_MOST));
    } else if (step.step === 'updates') {
      path = '/works';
      query.set('filter', `updates:${step.identifier}`);
      query.set('rows', String(REFERENCE_RESULTS_MOST));
    } else {
      path = `/works/${encodeURIComponent(step.step === 'work' ? step.identifier : (step.ids[0] ?? ''))}`;
    }
    if (contact !== undefined) query.set('mailto', contact);
  } else {
    query.set('db', 'pubmed');
    query.set('retmode', 'json');
    if (step.step === 'search') {
      path = '/entrez/eutils/esearch.fcgi';
      query.set('retmax', String(REFERENCE_RESULTS_MOST));
      query.set('term', step.terms);
    } else {
      path = '/entrez/eutils/esummary.fcgi';
      query.set('id', (step.step === 'summary' ? step.ids : [step.identifier]).join(','));
    }
    if (contact !== undefined) {
      query.set('tool', 'alloy-works');
      query.set('email', contact);
    }
  }
  const search = query.toString();
  return search === '' ? path : `${path}?${search}`;
}

const tenant = z.string().regex(/^[0-9a-z]{1,40}$/);

/** The connector asked of a source (XR-B): by its id and operation, never a URL. */
export const referenceRequestSchema = z
  .strictObject({
    requestId: z.uuid(),
    tenant,
    source: z.enum(REFERENCE_SOURCE_IDS),
    op: z.enum(REFERENCE_OPERATIONS),
    query: z
      .string()
      .min(1)
      .max(300)
      .refine((value) => !CONTROL.test(value) && value.trim() !== '')
      .optional(),
    identifier: z.string().min(1).max(300).optional(),
  })
  .refine((request) =>
    request.op === 'search'
      ? request.query !== undefined && request.identifier === undefined
      : request.query === undefined &&
        request.identifier !== undefined &&
        identifierFits(request.source, request.identifier),
  );
export type ReferenceRequest = z.infer<typeof referenceRequestSchema>;

/** What a source reports of a record (XR-F): retracted, or corrected. */
export const REFERENCE_NOTICE_KINDS = ['retraction', 'correction'] as const;

/** A retraction or correction a source reports: the notice's own identifier and date, where given. */
export const referenceNoticeSchema = z.strictObject({
  kind: z.enum(REFERENCE_NOTICE_KINDS),
  identifier: z.string().min(1).max(300).optional(),
  date: z
    .string()
    .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/)
    .optional(),
});
export type ReferenceNotice = z.infer<typeof referenceNoticeSchema>;

export const referenceResultSchema = z.strictObject({
  identifier: z.string().min(1).max(300),
  csl: cslItemSchema,
  /** The fields the source gave that an entry cannot hold, left out. */
  dropped: z.array(z.string().max(200)).max(200),
  /** A check's retractions and corrections (XRb); absent from a search or fetch. */
  notices: z.array(referenceNoticeSchema).max(50).optional(),
});
export type ReferenceResult = z.infer<typeof referenceResultSchema>;

/** Why a source could not answer, which is the source's (XR-B): never its words. */
export const REFERENCE_FAILURES = [
  'refused',
  'timeout',
  'too_large',
  'status',
  'unreadable',
  'connector',
] as const;

export const referenceAnswerSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('found'),
    results: z.array(referenceResultSchema).max(REFERENCE_RESULTS_MOST),
  }),
  z.strictObject({
    type: z.literal('failed'),
    code: z.literal('reference_unavailable'),
    source: z.enum(REFERENCE_SOURCE_IDS),
    reason: z.enum(REFERENCE_FAILURES),
  }),
]);
export type ReferenceAnswer = z.infer<typeof referenceAnswerSchema>;

/**
 * The line the supervisor writes to a reference call's child: the host it reaches, from the list here
 * (a test's own, never configuration's), the guard's ranges, the private ones always among them.
 */
export const childReferenceRequestSchema = z.strictObject({
  kind: z.literal('reference'),
  request: referenceRequestSchema,
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  deny: z.array(z.string()),
  connectTimeoutMs: z.number().int().min(1).max(60_000),
  contact: z.string().regex(REFERENCE_CONTACT).optional(),
  ca: z
    .string()
    .max(256 * 1024)
    .optional(),
});
export type ChildReferenceRequest = z.infer<typeof childReferenceRequestSchema>;

type Json = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const firstText = (value: unknown): string | undefined =>
  Array.isArray(value) ? textOf(value[0]) : textOf(value);

/** Each field set, the empty left out. */
const defined = (fields: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));

/** A record mapped to CSL, admitted as an import is: what it cannot hold dropped and named. */
function admitted(identifier: string, record: Record<string, unknown>): ReferenceResult[] {
  const { csl, dropped } = admitCsl(record);
  return csl === undefined ? [] : [{ identifier, csl: csl as CslItem, dropped: [...dropped] }];
}

/** Crossref's work types, as CSL's; any other a `document`. */
const CROSSREF_TYPES: Readonly<Record<string, string>> = {
  'journal-article': 'article-journal',
  'book-chapter': 'chapter',
  'book-section': 'chapter',
  'book-part': 'chapter',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  'proceedings-article': 'paper-conference',
  'posted-content': 'article',
  report: 'report',
  dissertation: 'thesis',
  dataset: 'dataset',
  standard: 'standard',
  'reference-entry': 'entry',
  'peer-review': 'review',
};

const crossrefNames = (value: unknown): unknown =>
  Array.isArray(value)
    ? value
        .filter(isRecord)
        .map((each) =>
          typeof each.name === 'string'
            ? { literal: each.name }
            : defined({ family: textOf(each.family), given: textOf(each.given) }),
        )
    : undefined;

const crossrefDate = (work: Json): unknown => {
  for (const field of ['issued', 'published-print', 'published-online', 'published']) {
    const date = work[field];
    if (isRecord(date) && Array.isArray(date['date-parts']) && date['date-parts'][0] !== null) {
      return { 'date-parts': date['date-parts'] };
    }
  }
  return undefined;
};

function crossrefItem(work: unknown): ReferenceResult[] {
  if (!isRecord(work)) return [];
  const doi = textOf(work.DOI);
  if (doi === undefined) return [];
  return admitted(
    doi,
    defined({
      type: CROSSREF_TYPES[String(work.type)] ?? 'document',
      title: firstText(work.title),
      author: crossrefNames(work.author),
      editor: crossrefNames(work.editor),
      'container-title': firstText(work['container-title']),
      'container-title-short': firstText(work['short-container-title']),
      issued: crossrefDate(work),
      volume: work.volume,
      issue: work.issue,
      page: work.page,
      publisher: work.publisher,
      'publisher-place': work['publisher-location'],
      DOI: doi,
      ISSN: firstText(work.ISSN),
      ISBN: firstText(work.ISBN),
      URL: work.URL,
      language: work.language,
    }),
  );
}

/** A PubMed author's name, `Family Initials`, as CSL's. */
function pubmedName(name: string): Record<string, string> {
  const at = name.lastIndexOf(' ');
  return at <= 0 ? { family: name } : { family: name.slice(0, at), given: name.slice(at + 1) };
}

/** A PubMed sort date, `YYYY/MM/DD hh:mm`, as CSL's date parts. */
function pubmedDate(record: Json): unknown {
  const sort = /^(\d{4})\/(\d{2})\/(\d{2})/.exec(String(record.sortpubdate ?? ''));
  if (sort) return { 'date-parts': [[Number(sort[1]), Number(sort[2]), Number(sort[3])]] };
  const year = /^(\d{4})/.exec(String(record.pubdate ?? ''));
  return year ? { 'date-parts': [[Number(year[1])]] } : undefined;
}

function pubmedItem(record: unknown): ReferenceResult[] {
  if (!isRecord(record) || record.error !== undefined) return [];
  const pmid = textOf(record.uid);
  if (pmid === undefined || !PMID.test(pmid)) return [];
  const ids = Array.isArray(record.articleids) ? record.articleids.filter(isRecord) : [];
  const id = (type: string) => textOf(ids.find((each) => each.idtype === type)?.value);
  const authors = Array.isArray(record.authors)
    ? record.authors
        .filter(isRecord)
        .filter((each) => each.authtype === undefined || each.authtype === 'Author')
        .flatMap((each) =>
          textOf(each.name) === undefined ? [] : [pubmedName(textOf(each.name)!)],
        )
    : undefined;
  return admitted(
    pmid,
    defined({
      type: 'article-journal',
      title: textOf(record.title),
      author: authors !== undefined && authors.length > 0 ? authors : undefined,
      'container-title': textOf(record.fulljournalname),
      'container-title-short': textOf(record.source),
      issued: pubmedDate(record),
      volume: textOf(record.volume),
      issue: textOf(record.issue),
      page: textOf(record.pages),
      ISSN: textOf(record.issn) ?? textOf(record.essn),
      PMID: pmid,
      PMCID: id('pmc'),
      DOI: id('doi'),
    }),
  );
}

/** The PMIDs a PubMed search answered, at most the results a search takes. */
export function searchIdentifiers(answer: unknown): string[] {
  const found = isRecord(answer) && isRecord(answer.esearchresult) ? answer.esearchresult : {};
  return (Array.isArray(found.idlist) ? found.idlist : [])
    .filter((each): each is string => typeof each === 'string' && PMID.test(each))
    .slice(0, REFERENCE_RESULTS_MOST);
}

/** Crossref's update types, as a notice's kind; any other (a comment, a concern) none. */
const CROSSREF_UPDATES: Readonly<Record<string, ReferenceNotice['kind']>> = {
  retraction: 'retraction',
  withdrawal: 'retraction',
  removal: 'retraction',
  correction: 'correction',
  corrigendum: 'correction',
  erratum: 'correction',
  addendum: 'correction',
  clarification: 'correction',
};

/** Crossref's relations naming a notice of the subject (XRb). */
const CROSSREF_RELATIONS: Readonly<Record<string, ReferenceNotice['kind']>> = {
  'is-retracted-by': 'retraction',
  'is-corrected-by': 'correction',
};

const crossrefDay = (value: unknown): string | undefined => {
  const parts = isRecord(value) && Array.isArray(value['date-parts']) ? value['date-parts'][0] : [];
  if (!Array.isArray(parts) || typeof parts[0] !== 'number') return undefined;
  return parts
    .slice(0, 3)
    .map((each, at) => String(each).padStart(at === 0 ? 4 : 2, '0'))
    .join('-');
};

const sameDoi = (a: unknown, b: string) =>
  typeof a === 'string' && a.trim().toLowerCase() === b.toLowerCase();

/** One notice per kind and identifier, the first kept. */
function distinct(notices: readonly ReferenceNotice[]): ReferenceNotice[] {
  const seen = new Set<string>();
  return notices.filter((each) => {
    const key = `${each.kind} ${each.identifier?.toLowerCase() ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A notice, its identifier and date kept only where they are in shape. */
const notice = (
  kind: ReferenceNotice['kind'],
  identifier: unknown,
  date?: string,
): ReferenceNotice =>
  referenceNoticeSchema.safeParse({
    kind,
    ...(textOf(identifier) === undefined ? {} : { identifier: textOf(identifier) }),
    ...(date === undefined ? {} : { date }),
  }).data ?? { kind };

/**
 * A Crossref work's retractions and corrections (XRb): each notice in `updates` (the answer to
 * `filter=updates:{doi}`) whose `update-to` names the work, and the work's own `updated-by` and
 * `relation` (`is-retracted-by`, `is-corrected-by`). Retraction Watch's entries are among them.
 */
function crossrefNotices(work: Json, updates: unknown): ReferenceNotice[] {
  const doi = textOf(work.DOI) ?? '';
  const found: ReferenceNotice[] = [];
  const message = isRecord(updates) && isRecord(updates.message) ? updates.message : {};
  for (const item of Array.isArray(message.items) ? message.items.filter(isRecord) : []) {
    for (const update of Array.isArray(item['update-to']) ? item['update-to'] : []) {
      const kind = isRecord(update) ? CROSSREF_UPDATES[String(update.type)] : undefined;
      if (kind && sameDoi(update.DOI, doi)) {
        found.push(notice(kind, item.DOI, crossrefDay(update.updated)));
      }
    }
  }
  for (const update of Array.isArray(work['updated-by']) ? work['updated-by'] : []) {
    const kind = isRecord(update) ? CROSSREF_UPDATES[String(update.type)] : undefined;
    if (kind) found.push(notice(kind, update.DOI, crossrefDay(update.updated)));
  }
  const relation = isRecord(work.relation) ? work.relation : {};
  for (const [name, kind] of Object.entries(CROSSREF_RELATIONS)) {
    const related = relation[name];
    for (const each of Array.isArray(related) ? related.filter(isRecord) : []) {
      found.push(notice(kind, each.id));
    }
  }
  return distinct(found);
}

/** PubMed's links to a notice, by `reftype` (XRb). */
const PUBMED_REFERENCES: Readonly<Record<string, ReferenceNotice['kind']>> = {
  'Retraction in': 'retraction',
  'Erratum in': 'correction',
  'Corrected and republished in': 'correction',
};

/**
 * A PubMed summary's retractions and corrections (XRb): its `references` linking a notice, and its
 * publication type `Retracted Publication` where no notice is linked.
 */
function pubmedNotices(record: Json): ReferenceNotice[] {
  const found: ReferenceNotice[] = [];
  for (const each of Array.isArray(record.references) ? record.references.filter(isRecord) : []) {
    const kind = PUBMED_REFERENCES[String(each.reftype)];
    if (kind) found.push(notice(kind, PMID.test(String(each.pmid)) ? each.pmid : undefined));
  }
  const types = Array.isArray(record.pubtype) ? record.pubtype : [];
  if (
    types.includes('Retracted Publication') &&
    !found.some((each) => each.kind === 'retraction')
  ) {
    found.unshift({ kind: 'retraction' });
  }
  return distinct(found);
}

/**
 * A source's answer, as parsed JSON, mapped to CSL-JSON results: Crossref's work or work list, or
 * PubMed's summaries. Undefined where it is not the source's shape; a record that does not map is
 * left out. A check's results carry their notices, Crossref's read also from `updates`, its answer to
 * `filter=updates:{doi}`.
 */
export function readReferenceAnswer(
  source: ReferenceSourceId,
  op: ReferenceOperation,
  answer: unknown,
  updates?: unknown,
): ReferenceResult[] | undefined {
  if (!isRecord(answer)) return undefined;
  const checked = (results: ReferenceResult[], notices: () => ReferenceNotice[]) =>
    op === 'check' ? results.map((each) => ({ ...each, notices: notices() })) : results;
  if (source === 'crossref') {
    const message = answer.message;
    if (!isRecord(message)) return undefined;
    if (op !== 'search') {
      return checked(crossrefItem(message), () => crossrefNotices(message, updates));
    }
    if (!Array.isArray(message.items)) return undefined;
    return message.items.slice(0, REFERENCE_RESULTS_MOST).flatMap(crossrefItem);
  }
  const result = answer.result;
  if (!isRecord(result) || !Array.isArray(result.uids)) return undefined;
  return result.uids.slice(0, REFERENCE_RESULTS_MOST).flatMap((uid) => {
    const record = typeof uid === 'string' ? result[uid] : undefined;
    return isRecord(record) ? checked(pubmedItem(record), () => pubmedNotices(record)) : [];
  });
}

/** What a check found of an entry (XR-F): the status's outcome. */
export const ENTRY_CHECK_OUTCOMES = [
  'current',
  'changed',
  'gone',
  'retracted',
  'corrected',
] as const;
export type EntryCheckOutcome = (typeof ENTRY_CHECK_OUTCOMES)[number];

/** The CSL variables a check compares, in this order (XRb). */
export const ENTRY_CHECKED_VARIABLES = [
  'title',
  'issued',
  'author',
  'container-title',
  'DOI',
] as const;

export interface EntryCheck {
  readonly outcome: EntryCheckOutcome;
  /** The variables the source now holds otherwise. */
  readonly differs: string[];
  /** The retraction or correction decided on, where there is one. */
  readonly notice: ReferenceNotice | null;
}

/** A variable's value as a check compares it: spacing and case aside, authors by family name. */
function compared(
  name: (typeof ENTRY_CHECKED_VARIABLES)[number],
  csl: CslItem,
): string | undefined {
  const value = (csl as Record<string, unknown>)[name];
  if (value === undefined) return undefined;
  if (name === 'author') {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    return JSON.stringify(
      value.map((each: Record<string, unknown>) =>
        String(each.family ?? each.literal ?? '')
          .trim()
          .toLowerCase(),
      ),
    );
  }
  if (name === 'issued') return JSON.stringify((value as Record<string, unknown>)['date-parts']);
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * An entry's latest CSL held against what its source now answers (XR-F): `gone` where the source
 * holds no record; else `retracted` or `corrected` where it reports so, a retraction first; else
 * `changed` where a compared variable the source holds differs; else `current`.
 */
export function entryCheck(held: CslItem, results: readonly ReferenceResult[]): EntryCheck {
  const found = results[0];
  if (found === undefined) return { outcome: 'gone', differs: [], notice: null };
  const differs = ENTRY_CHECKED_VARIABLES.filter((name) => {
    const now = compared(name, found.csl);
    return now !== undefined && now !== compared(name, held);
  });
  const notices = found.notices ?? [];
  const notice =
    notices.find((each) => each.kind === 'retraction') ??
    notices.find((each) => each.kind === 'correction') ??
    null;
  const outcome: EntryCheckOutcome = notice
    ? notice.kind === 'retraction'
      ? 'retracted'
      : 'corrected'
    : differs.length > 0
      ? 'changed'
      : 'current';
  return { outcome, differs: [...differs], notice };
}

/** Where an entry was obtained, as `source:identifier` (XRa), read back; undefined if not a source's. */
export function obtainedFrom(
  from: string,
): { readonly source: ReferenceSourceId; readonly identifier: string } | undefined {
  const at = from.indexOf(':');
  const source = REFERENCE_SOURCE_IDS.find((each) => each === from.slice(0, at));
  const identifier = from.slice(at + 1);
  return at > 0 && source !== undefined && identifierFits(source, identifier)
    ? { source, identifier }
    : undefined;
}
