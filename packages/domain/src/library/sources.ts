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

export const referenceResultSchema = z.strictObject({
  identifier: z.string().min(1).max(300),
  csl: cslItemSchema,
  /** The fields the source gave that an entry cannot hold, left out. */
  dropped: z.array(z.string().max(200)).max(200),
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

/**
 * A source's answer, as parsed JSON, mapped to CSL-JSON results: Crossref's work or work list, or
 * PubMed's summaries. Undefined where it is not the source's shape; a record that does not map is
 * left out.
 */
export function readReferenceAnswer(
  source: ReferenceSourceId,
  op: ReferenceOperation,
  answer: unknown,
): ReferenceResult[] | undefined {
  if (!isRecord(answer)) return undefined;
  if (source === 'crossref') {
    const message = answer.message;
    if (!isRecord(message)) return undefined;
    if (op !== 'search') return crossrefItem(message);
    if (!Array.isArray(message.items)) return undefined;
    return message.items.slice(0, REFERENCE_RESULTS_MOST).flatMap(crossrefItem);
  }
  const result = answer.result;
  if (!isRecord(result) || !Array.isArray(result.uids)) return undefined;
  return result.uids
    .slice(0, REFERENCE_RESULTS_MOST)
    .flatMap((uid) => (typeof uid === 'string' ? pubmedItem(result[uid]) : []));
}
