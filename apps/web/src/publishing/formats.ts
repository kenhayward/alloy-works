import { formats, words as say } from '../words/words.js';
/**
 * The words for what a publication was made in and what its outputs report (Word 1, ruling R14). Each
 * format and each report entry has one plain sentence, read by an author rather than a developer.
 */

/** A format by the name an author knows it by; one this renderer does not know, as the service said it. */
const FORMAT_WORDS: Record<string, string> = {
  get pdf() {
    return say('publishing.pdf');
  },
  get docx() {
    return say('publishing.word');
  },
  get html() {
    return say('publishing.html');
  },
};

/** `PDF`, `Word` or `PDF and Word`: the formats a publication holds, in the order it names them. */
export function formatsWords(held: readonly string[]): string {
  return formats().list(held.map((format) => FORMAT_WORDS[format] ?? format));
}

/** The kinds a report says of one table (Word 2, ruling R7). */
const TABLE_KINDS = [
  'header_column_lost',
  'header_repeated',
  'continuation_label_omitted',
  // TB3 (TB3-J): a table the PDF scaled to its measure, which Word reflows.
  'table_reflowed',
] as const;
type TableKind = (typeof TABLE_KINDS)[number];

/**
 * The kinds a report names by their place alone (W14.6, PUB-100): a structure the PDF tags that Word
 * sets as paragraphs or runs in their styles. The page says each kind once, counting its places, since
 * a sentence said again for each place would tell an author nothing more. Every place is a block's: a
 * heading carries no mark (the final review of W14.6).
 */
const PLACED_KINDS = [
  'quotation_not_structure',
  'quoted_phrase_not_structure',
  'inline_code_not_structure',
  'preformatted_not_structure',
  'definition_list_not_structure',
  'description_language_lost',
] as const;
type PlacedKind = (typeof PLACED_KINDS)[number];

/**
 * The titles template 13 tags as headings that Word sets as body text (the final review of W14.6), in
 * the order they stand, the document's always first.
 */
const UNHEADED_TITLES = ['document', 'contents', 'lists'] as const;
type UnheadedTitle = (typeof UNHEADED_TITLES)[number];

/** One entry of an output's report, as the contract gives it: checked, never trusted. */
export type ReportEntry =
  | { readonly kind: 'face_substituted'; readonly family: string; readonly wordFamily: string }
  | { readonly kind: 'no_page_cited_output' }
  | { readonly kind: 'pages_cite_the_pdf' }
  | {
      readonly kind: TableKind;
      readonly node: string;
      readonly block: string;
      readonly label: string | null;
    }
  | {
      readonly kind: 'equation_flattened';
      readonly node: string;
      readonly block: string | null;
      readonly label: string | null;
    }
  | { readonly kind: PlacedKind; readonly node: string; readonly block: string }
  | {
      readonly kind: 'equation_numbered_as_table';
      readonly node: string;
      readonly block: string;
      readonly label: string;
    }
  | { readonly kind: 'equation_alternative_lost' }
  | { readonly kind: 'maths_coverage_unchecked'; readonly wordFamily: string }
  | { readonly kind: 'titles_not_headings'; readonly titles: readonly UnheadedTitle[] }
  | { readonly kind: 'list_not_linked'; readonly sequence: 'figure' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The entries of a report this renderer can say, member by member. One of a kind it does not know is
 * left out rather than guessed at: a report says what Word could not carry, and a wrong sentence about
 * that is worse than none.
 */
export function reportIn(value: unknown): ReportEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ReportEntry[] => {
    if (!isRecord(entry)) return [];
    if (
      entry.kind === 'face_substituted' &&
      typeof entry.family === 'string' &&
      typeof entry.wordFamily === 'string'
    ) {
      return [{ kind: 'face_substituted', family: entry.family, wordFamily: entry.wordFamily }];
    }
    if (entry.kind === 'no_page_cited_output' || entry.kind === 'pages_cite_the_pdf') {
      return [{ kind: entry.kind }];
    }
    const kind = TABLE_KINDS.find((each) => each === entry.kind);
    if (
      kind !== undefined &&
      typeof entry.node === 'string' &&
      typeof entry.block === 'string' &&
      (typeof entry.label === 'string' || entry.label === null)
    ) {
      return [{ kind, node: entry.node, block: entry.block, label: entry.label }];
    }
    // A heading's or a caption's (the final review of Word 4, I2): a heading names no block.
    if (
      entry.kind === 'equation_flattened' &&
      typeof entry.node === 'string' &&
      (typeof entry.block === 'string' || entry.block === null) &&
      (typeof entry.label === 'string' || entry.label === null)
    ) {
      return [{ kind: entry.kind, node: entry.node, block: entry.block, label: entry.label }];
    }
    // W14.6's: each by its place, which is always a block's.
    const placed = PLACED_KINDS.find((each) => each === entry.kind);
    if (placed !== undefined && typeof entry.node === 'string' && typeof entry.block === 'string') {
      return [{ kind: placed, node: entry.node, block: entry.block }];
    }
    if (
      entry.kind === 'equation_numbered_as_table' &&
      typeof entry.node === 'string' &&
      typeof entry.block === 'string' &&
      typeof entry.label === 'string'
    ) {
      return [{ kind: entry.kind, node: entry.node, block: entry.block, label: entry.label }];
    }
    if (entry.kind === 'equation_alternative_lost') return [{ kind: entry.kind }];
    if (entry.kind === 'maths_coverage_unchecked' && typeof entry.wordFamily === 'string') {
      return [{ kind: entry.kind, wordFamily: entry.wordFamily }];
    }
    if (entry.kind === 'titles_not_headings') {
      const titles = unheaded(entry.titles);
      return titles === null ? [] : [{ kind: entry.kind, titles }];
    }
    if (entry.kind === 'list_not_linked' && entry.sequence === 'figure') {
      return [{ kind: entry.kind, sequence: entry.sequence }];
    }
    return [];
  });
}

/** The titles an entry names, where they are the document's first and each other once, in order. */
function unheaded(value: unknown): UnheadedTitle[] | null {
  if (!Array.isArray(value) || value[0] !== 'document') return null;
  const titles: UnheadedTitle[] = [];
  for (const each of value) {
    const title = UNHEADED_TITLES.find((known) => known === each);
    const last = titles[titles.length - 1];
    if (title === undefined) return null;
    if (last !== undefined && UNHEADED_TITLES.indexOf(title) <= UNHEADED_TITLES.indexOf(last)) {
      return null;
    }
    titles.push(title);
  }
  return titles;
}

/**
 * **The lines a report is said in** (W14.6): one per entry, but the kinds named by their place
 * alone, each said once where its first place stands, counting its places.
 */
export function reportLines(
  entries: readonly ReportEntry[],
): { readonly key: string; readonly words: string }[] {
  const counted = new Map<PlacedKind, number>();
  for (const entry of entries) {
    if (isPlaced(entry)) counted.set(entry.kind, (counted.get(entry.kind) ?? 0) + 1);
  }
  const said = new Set<PlacedKind>();
  return entries.flatMap((entry) => {
    if (!isPlaced(entry)) return [{ key: reportKey(entry), words: reportWords(entry) }];
    if (said.has(entry.kind)) return [];
    said.add(entry.kind);
    return [{ key: entry.kind, words: placedWords(entry.kind, counted.get(entry.kind)!) }];
  });
}

const isPlaced = (entry: ReportEntry): entry is Extract<ReportEntry, { kind: PlacedKind }> =>
  (PLACED_KINDS as readonly string[]).includes(entry.kind);

/** `one quotation` or `2 quotations`. */
const counting = (count: number, one: string, many: string) =>
  count === 1 ? say('publishing.one', { one }) : `${count} ${many}`;

/** One sentence for a kind named by its place, and how many places it holds (W14.6). */
function placedWords(kind: PlacedKind, count: number): string {
  switch (kind) {
    case 'quotation_not_structure':
      return say('publishing.word-has-no-mark-for', {
        value1: counting(count, 'quotation', 'quotations'),
      });
    case 'quoted_phrase_not_structure':
      return say('publishing.word-has-no-mark-for-2', {
        value1: counting(count, 'place', 'places'),
      });
    case 'inline_code_not_structure':
      return say('publishing.word-has-no-mark-for-3', {
        value1: counting(count, 'place', 'places'),
      });
    case 'preformatted_not_structure':
      return say('publishing.word-has-no-mark-for-4', {
        value1: counting(count, 'block', 'blocks'),
      });
    case 'definition_list_not_structure':
      return say('publishing.word-has-no-list-of', {
        value1: counting(count, 'definition list', 'definition lists'),
      });
    // Written on the image's run, but not measured in a screen reader (the final review of W14.6).
    case 'description_language_lost':
      return say('publishing.word-records-no-language-for', {
        value1: counting(count, 'place', 'places'),
      });
  }
}

/** One sentence per kind of entry, in plain language (R13). */
export function reportWords(entry: ReportEntry): string {
  switch (entry.kind) {
    case 'face_substituted':
      return say('publishing.the-typeface-cannot-be-embedded-2', {
        family: entry.family,
        wordFamily: entry.wordFamily,
      });
    case 'no_page_cited_output':
      return say('publishing.this-publication-has-no-pdf');
    case 'pages_cite_the_pdf':
      return say('publishing.word-lays-out-its-own');
    // A table by its label, as the PDF prints it; one with no number is named as such, since this
    // page does not hold the outline its place is in.
    case 'header_column_lost':
      return say('publishing.has-a-header-column-which', { value1: tableName(entry) });
    case 'header_repeated':
      return say('publishing.repeats-its-header-rows-on', { value1: tableName(entry) });
    case 'continuation_label_omitted':
      return say('publishing.has-no-continuation-label-in', { value1: tableName(entry) });
    case 'table_reflowed':
      return say('publishing.is-too-wide-for-the', { value1: tableName(entry) });
    // A heading by its number and a caption by its label, as the PDF prints them.
    case 'equation_flattened':
      return say('publishing.holds-an-equation-that-word', {
        value1: flattenedName(entry),
        value2:
          entry.block === null
            ? 'where it rebuilds the heading, in the contents or a running head, once it updates them'
            : 'in the list after the contents once it updates the list',
      });
    case 'equation_numbered_as_table':
      return say('publishing.is-set-in-word-as', { label: entry.label });
    case 'equation_alternative_lost':
      return say('publishing.word-reads-each-equation-aloud');
    case 'maths_coverage_unchecked':
      return say('publishing.word-sets-equations-in-whose', { wordFamily: entry.wordFamily });
    case 'titles_not_headings':
      return say('publishing.word-sets-as-ordinary-paragraphs', {
        value1: listing(entry.titles.map((title) => TITLE_WORDS[title])),
      });
    case 'list_not_linked':
      return say('publishing.the-list-of-figures-in');
    default:
      return placedWords(entry.kind, 1);
  }
}

const flattenedName = (entry: { readonly block: string | null; readonly label: string | null }) =>
  entry.block === null
    ? entry.label === null
      ? say('publishing.a-heading-with-no-number')
      : say('publishing.the-heading-numbered', { label: entry.label })
    : entry.label === null
      ? say('publishing.a-caption-with-no-number')
      : say('publishing.s-caption', { label: entry.label });

/** Each title Word sets as body text, as an author knows it. */
const TITLE_WORDS: Record<UnheadedTitle, string> = {
  get document() {
    return say('publishing.the-document-s-title');
  },
  get contents() {
    return say('publishing.the-title-of-the-contents');
  },
  get lists() {
    return say('publishing.the-titles-of-the-lists');
  },
};

/** `a`, `a and b`, or `a, b and c`. */
const listing = (items: readonly string[]) => formats().list(items);

const tableName = (entry: { readonly label: string | null }) =>
  entry.label ?? say('publishing.a-table-with-no-number');

/** An entry's key among its report's, which says each thing once. */
export function reportKey(entry: ReportEntry): string {
  switch (entry.kind) {
    case 'face_substituted':
      return `${entry.kind} ${entry.family}`;
    case 'no_page_cited_output':
    case 'pages_cite_the_pdf':
    case 'equation_alternative_lost':
    case 'titles_not_headings':
      return entry.kind;
    case 'maths_coverage_unchecked':
      return `${entry.kind} ${entry.wordFamily}`;
    case 'list_not_linked':
      return `${entry.kind} ${entry.sequence}`;
    default:
      return `${entry.kind} ${entry.node} ${entry.block ?? ''}`;
  }
}
