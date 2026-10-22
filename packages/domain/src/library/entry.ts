import { z } from 'zod';

import { characters, CONTROL, storable } from '../data/primitives.js';

/**
 * A bibliography entry version (citations.md, "The entry"; the CI plan, CI-B): one source as CSL-JSON
 * without its `id`, the key fixed at its creation, and where it was obtained and when last checked.
 * The CSL shape is written from CSL 1.0.2's csl-data.json: its item types and variables, and nothing
 * else, so a field beyond CSL's is refused, never kept.
 */
export const ENTRY_SCHEMA_VERSION = 1;

/** CSL 1.0.2's item types. */
export const CSL_TYPES = [
  'article',
  'article-journal',
  'article-magazine',
  'article-newspaper',
  'bill',
  'book',
  'broadcast',
  'chapter',
  'classic',
  'collection',
  'dataset',
  'document',
  'entry',
  'entry-dictionary',
  'entry-encyclopedia',
  'event',
  'figure',
  'graphic',
  'hearing',
  'interview',
  'legal_case',
  'legislation',
  'manuscript',
  'map',
  'motion_picture',
  'musical_score',
  'pamphlet',
  'paper-conference',
  'patent',
  'performance',
  'periodical',
  'personal_communication',
  'post',
  'post-weblog',
  'regulation',
  'report',
  'review',
  'review-book',
  'software',
  'song',
  'speech',
  'standard',
  'thesis',
  'treaty',
  'webpage',
] as const;

/** Its name variables. */
const NAME_VARIABLES = [
  'author',
  'chair',
  'collection-editor',
  'compiler',
  'composer',
  'container-author',
  'contributor',
  'curator',
  'director',
  'editor',
  'editorial-director',
  'editor-translator',
  'executive-producer',
  'guest',
  'host',
  'illustrator',
  'interviewer',
  'narrator',
  'organizer',
  'original-author',
  'performer',
  'producer',
  'recipient',
  'reviewed-author',
  'script-writer',
  'series-creator',
  'translator',
] as const;

/** Its date variables. */
const DATE_VARIABLES = [
  'accessed',
  'available-date',
  'event-date',
  'issued',
  'original-date',
  'submitted',
] as const;

/** Its number variables, which csl-data.json lets be a string or a number. */
const NUMBER_VARIABLES = [
  'chapter-number',
  'citation-number',
  'collection-number',
  'edition',
  'first-reference-note-number',
  'issue',
  'number',
  'number-of-pages',
  'number-of-volumes',
  'page',
  'page-first',
  'part',
  'printing',
  'section',
  'supplement',
  'version',
  'volume',
] as const;

/** Its standard variables, each a string; `shortTitle` and `journalAbbreviation` as csl-data.json keeps them. */
const STRING_VARIABLES = [
  'abstract',
  'annote',
  'archive',
  'archive_collection',
  'archive_location',
  'archive-place',
  'authority',
  'call-number',
  'citation-key',
  'citation-label',
  'collection-title',
  'container-title',
  'container-title-short',
  'dimensions',
  'division',
  'DOI',
  'event',
  'event-title',
  'event-place',
  'genre',
  'ISBN',
  'ISSN',
  'jurisdiction',
  'keyword',
  'language',
  'license',
  'locator',
  'medium',
  'note',
  'original-publisher',
  'original-publisher-place',
  'original-title',
  'part-title',
  'PMCID',
  'PMID',
  'publisher',
  'publisher-place',
  'references',
  'reviewed-genre',
  'reviewed-title',
  'scale',
  'source',
  'status',
  'title',
  'title-short',
  'URL',
  'volume-title',
  'volume-title-short',
  'year-suffix',
  'journalAbbreviation',
  'shortTitle',
] as const;

/** The most characters any one value holds. */
const VALUE_MAX = 10_000;

const text = storable('A value').refine((value) => characters(value) <= VALUE_MAX, {
  message: 'A value is at most 10,000 characters',
});

const name = z
  .strictObject({
    family: text.optional(),
    given: text.optional(),
    'dropping-particle': text.optional(),
    'non-dropping-particle': text.optional(),
    suffix: text.optional(),
    'comma-suffix': z.union([z.string(), z.number(), z.boolean()]).optional(),
    'static-ordering': z.union([z.string(), z.number(), z.boolean()]).optional(),
    literal: text.optional(),
    'parse-names': z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .refine((each) => each.family !== undefined || each.literal !== undefined, {
    message: 'A name has a family name or a literal one',
  });

const datePart = z.union([z.number().int(), z.string().regex(/^-?\d{1,5}$/)]);

const date = z.strictObject({
  'date-parts': z.array(z.array(datePart).min(1).max(3)).min(1).max(2).optional(),
  season: z.union([z.number().int(), z.string()]).optional(),
  circa: z.union([z.string(), z.number(), z.boolean()]).optional(),
  literal: text.optional(),
  raw: text.optional(),
});

const variables: Record<string, z.ZodType> = {
  ...Object.fromEntries(NAME_VARIABLES.map((each) => [each, z.array(name).max(500).optional()])),
  ...Object.fromEntries(DATE_VARIABLES.map((each) => [each, date.optional()])),
  ...Object.fromEntries(
    NUMBER_VARIABLES.map((each) => [each, z.union([text, z.number().finite()]).optional()]),
  ),
  ...Object.fromEntries(STRING_VARIABLES.map((each) => [each, text.optional()])),
  categories: z.array(text).max(100).optional(),
};

type Name = z.infer<typeof name>;
type CslDate = z.infer<typeof date>;

/** One CSL item, its `id` left out: the entry's artifact is its identity. */
export type CslItem = {
  readonly type: (typeof CSL_TYPES)[number];
  readonly categories?: readonly string[];
} & { readonly [K in (typeof NAME_VARIABLES)[number]]?: readonly Name[] } & {
  readonly [K in (typeof DATE_VARIABLES)[number]]?: CslDate;
} & { readonly [K in (typeof NUMBER_VARIABLES)[number]]?: string | number } & {
  readonly [K in (typeof STRING_VARIABLES)[number]]?: string;
};

export const cslItemSchema = z.strictObject({
  type: z.enum(CSL_TYPES),
  ...variables,
}) as unknown as z.ZodType<CslItem>;

/** Every variable CSL holds, by name. */
export const CSL_VARIABLES: ReadonlySet<string> = new Set(['type', ...Object.keys(variables)]);

/** An entry's key (LIB-046): lower-case ASCII letters and digits. */
export const ENTRY_KEY = /^[a-z0-9]{1,80}$/;

const instant = z.iso.datetime({ offset: true });

export const entrySchema = z.strictObject({
  schemaVersion: z.literal(ENTRY_SCHEMA_VERSION),
  csl: cslItemSchema,
  key: z.string().regex(ENTRY_KEY, { message: 'A key is lower-case letters and digits' }),
  /** Where it was obtained, and when (LIB-011). */
  obtained: z
    .strictObject({
      from: storable('Where it was obtained')
        .refine((value) => characters(value) >= 1 && characters(value) <= 2000, {
          message: 'Where it was obtained is 1 to 2,000 characters',
        })
        .refine((value) => !CONTROL.test(value), {
          message: 'Where it was obtained holds no control character',
        }),
      at: instant,
    })
    .optional(),
  /** When it was last checked against its source (LIB-011). */
  checkedAt: instant.optional(),
});
export type Entry = z.infer<typeof entrySchema>;

export interface EntryProblem {
  readonly rule: 'entry_invalid';
  readonly path: string;
  readonly message: string;
}

/** An entry refused, with every problem found. */
export class EntryRefused extends Error {
  constructor(readonly problems: readonly EntryProblem[]) {
    super(`The entry is refused: ${problems.map((each) => each.path || '(the whole)').join(', ')}`);
  }
}

/** The shape: what a stored version is read back by, and every write parses. Throws `EntryRefused`. */
export function parseEntry(value: unknown): Entry {
  const parsed = entrySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new EntryRefused(
    parsed.error.issues.map((issue) => ({
      rule: 'entry_invalid',
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

/** Lower-case ASCII letters and digits alone: accents taken off, everything else dropped. */
const ascii = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Words lower-cased, accents and punctuation gone, for comparing titles. */
const words = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Words a key passes over in a title or a body's name. */
const INSIGNIFICANT = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const firstSignificant = (value: string) =>
  words(value)
    .split(' ')
    .map(ascii)
    .find((each) => each !== '' && !INSIGNIFICANT.has(each));

/** The issued year, from its parts, else the first four digits its literal or raw form holds. */
export function issuedYear(csl: CslItem): string | undefined {
  const issued = csl.issued;
  if (!issued) return undefined;
  const first = issued['date-parts']?.[0]?.[0];
  if (first !== undefined && /^-?\d+$/.test(String(first))) return String(first);
  return /\d{4}/.exec(issued.literal ?? issued.raw ?? '')?.[0];
}

/** The first author's family name, or a body's literal one. */
const firstAuthor = (csl: CslItem): Name | undefined => csl.author?.[0];

/**
 * The key an entry is given at its creation (LIB-046): the first author's family name, else the first
 * significant word of a body's name or of the title, then the issued year; `entry` where none is.
 * The space's suffix, where it holds the key already, is `keyCandidate`'s.
 */
export function entryKey(csl: CslItem): string {
  const author = firstAuthor(csl);
  const named =
    (author?.family !== undefined ? ascii(author.family) : undefined) ||
    (author?.literal !== undefined ? firstSignificant(author.literal) : undefined) ||
    (csl.title !== undefined ? firstSignificant(csl.title) : undefined) ||
    'entry';
  return `${named}${issuedYear(csl) ?? ''}`.slice(0, 72);
}

/** The `n`th key tried: the key itself, then with `a`, `b`, ... `z`, `aa` and on after it. */
export function keyCandidate(key: string, n: number): string {
  if (n === 0) return key;
  let suffix = '';
  for (let at = n; at > 0; at = Math.floor((at - 1) / 26)) {
    suffix = String.fromCharCode(97 + ((at - 1) % 26)) + suffix;
  }
  return key + suffix;
}

/** How a match was found (LIB-045): by a canonical identifier, or by title, year and first author. */
export type IdentityBy = 'doi' | 'pmid' | 'isbn' | 'issn' | 'work';

export interface EntryIdentity {
  readonly by: IdentityBy;
  readonly value: string;
}

const DOI_PREFIX = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i;

/** An ISBN-10's ISBN-13. */
function isbn13(ten: string): string {
  const stem = `978${ten.slice(0, 9)}`;
  const sum = [...stem].reduce((total, digit, at) => total + Number(digit) * (at % 2 ? 3 : 1), 0);
  return stem + String((10 - (sum % 10)) % 10);
}

/**
 * What a match is found by (LIB-045): its DOI (lower-cased, prefix stripped), PubMed identifier, each
 * ISBN (digits, an ISBN-10 as its 13) and ISSN; only where it holds none of those, its title, issued
 * year and first author's family name, normalised. None where it holds no title either.
 */
export function entryIdentities(csl: CslItem): EntryIdentity[] {
  const found: EntryIdentity[] = [];
  const doi = csl.DOI?.trim().replace(DOI_PREFIX, '').toLowerCase();
  if (doi?.startsWith('10.')) found.push({ by: 'doi', value: doi });
  const pmid = csl.PMID?.trim().replace(/^pmid:\s*/i, '');
  if (pmid !== undefined && /^\d+$/.test(pmid)) {
    found.push({ by: 'pmid', value: pmid.replace(/^0+(?=\d)/, '') });
  }
  for (const each of csl.ISBN?.split(/[,;/]|\s(?=\d{3}[- ]?\d)/) ?? []) {
    const digits = each.replace(/[^0-9Xx]/g, '').toUpperCase();
    const value = /^\d{9}[\dX]$/.test(digits) ? isbn13(digits) : digits;
    if (/^97[89]\d{10}$/.test(value) && !found.some((seen) => seen.value === value)) {
      found.push({ by: 'isbn', value });
    }
  }
  for (const each of csl.ISSN?.split(/[,;/\s]+/) ?? []) {
    const value = each.replace(/[^0-9Xx]/g, '').toUpperCase();
    if (/^\d{7}[\dX]$/.test(value) && !found.some((seen) => seen.value === value)) {
      found.push({ by: 'issn', value });
    }
  }
  if (found.length > 0 || csl.title === undefined || words(csl.title) === '') return found;
  const author = firstAuthor(csl);
  const family = words(author?.family ?? author?.literal ?? '');
  return [{ by: 'work', value: `${words(csl.title)}|${issuedYear(csl) ?? ''}|${family}` }];
}

const LEFT_OUT = new Set(['id', 'citation-key', '_graph']);

/**
 * A record from an interchange format, as an entry's CSL (LIB-009): its `id` and citation-js's
 * bookkeeping left out, and each other field CSL cannot hold, or holds in another shape, dropped and
 * named. Its own label is left out, since the entry is given a key of its own. No CSL at all where it
 * has no type CSL knows.
 */
export function admitCsl(record: unknown): {
  readonly csl: CslItem | undefined;
  readonly dropped: readonly string[];
} {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return { csl: undefined, dropped: [] };
  }
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [field, value] of Object.entries(record)) {
    // Its own label, and citation-js's bookkeeping: the entry's key is its own.
    if (LEFT_OUT.has(field) || value === undefined) continue;
    if (!CSL_VARIABLES.has(field)) {
      dropped.push(field);
      continue;
    }
    kept[field] = value;
  }
  const parsed = cslItemSchema.safeParse(kept);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field === 'type' || field === '') return { csl: undefined, dropped };
      if (!dropped.includes(field)) dropped.push(field);
      delete kept[field];
    }
  }
  const again = cslItemSchema.safeParse(kept);
  return { csl: again.success ? again.data : undefined, dropped: dropped.sort() };
}

/** A match given the fields an incoming record holds and it lacks (LIB-010), each named. */
export function mergeCsl(
  into: CslItem,
  from: CslItem,
): { readonly csl: CslItem; readonly merged: readonly string[] } {
  const merged = Object.keys(from)
    .filter((field) => (into as Record<string, unknown>)[field] === undefined)
    .filter((field) => (from as Record<string, unknown>)[field] !== undefined)
    .sort();
  const csl = { ...into } as Record<string, unknown>;
  for (const field of merged) csl[field] = (from as Record<string, unknown>)[field];
  return { csl: csl as CslItem, merged };
}
