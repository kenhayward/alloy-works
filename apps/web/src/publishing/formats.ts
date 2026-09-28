/**
 * The words for what a publication was made in and what its outputs report (Word 1, ruling R14). Each
 * format and each report entry has one plain sentence, read by an author rather than a developer.
 */

/** A format by the name an author knows it by; one this renderer does not know, as the service said it. */
const FORMAT_WORDS: Record<string, string> = { pdf: 'PDF', docx: 'Word' };

/** `PDF`, `Word` or `PDF and Word`: the formats a publication holds, in the order it names them. */
export function formatsWords(formats: readonly string[]): string {
  return formats.map((format) => FORMAT_WORDS[format] ?? format).join(' and ');
}

/** The kinds a report says of one table (Word 2, ruling R7). */
const TABLE_KINDS = [
  'header_column_lost',
  'header_repeated',
  'continuation_label_omitted',
] as const;
type TableKind = (typeof TABLE_KINDS)[number];

/**
 * The kinds a report names by their place alone (W14.6, PUB-100): a structure the PDF tags that Word
 * sets as paragraphs or runs in their styles. The page says each kind once, counting its places, since
 * a sentence said again for each place would tell an author nothing more; a quoted phrase's and inline
 * code's place may be a heading's, which names no block.
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
/** The placed kinds whose place is always a block's. */
const BLOCK_PLACED: readonly PlacedKind[] = [
  'quotation_not_structure',
  'preformatted_not_structure',
  'definition_list_not_structure',
  'description_language_lost',
];

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
  | { readonly kind: PlacedKind; readonly node: string; readonly block: string | null }
  | {
      readonly kind: 'equation_numbered_as_table';
      readonly node: string;
      readonly block: string;
      readonly label: string;
    }
  | { readonly kind: 'equation_alternative_lost' }
  | { readonly kind: 'maths_coverage_unchecked'; readonly wordFamily: string };

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
    // W14.6's: each by its place, a quoted phrase's and inline code's perhaps a heading's.
    const placed = PLACED_KINDS.find((each) => each === entry.kind);
    if (
      placed !== undefined &&
      typeof entry.node === 'string' &&
      (typeof entry.block === 'string' || (entry.block === null && !BLOCK_PLACED.includes(placed)))
    ) {
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
    return [];
  });
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
  count === 1 ? `one ${one}` : `${count} ${many}`;

/** One sentence for a kind named by its place, and how many places it holds (W14.6). */
function placedWords(kind: PlacedKind, count: number): string {
  switch (kind) {
    case 'quotation_not_structure':
      return `Word has no mark for a quotation, so it sets a quotation as paragraphs in the quotation style, which a screen reader reads as ordinary text. This applies to ${counting(count, 'quotation', 'quotations')}.`;
    case 'quoted_phrase_not_structure':
      return `Word has no mark for a quotation, so it sets a quoted phrase in its character style alone, which a screen reader reads as ordinary text. This applies to quoted phrases in ${counting(count, 'place', 'places')}.`;
    case 'inline_code_not_structure':
      return `Word has no mark for code, so it sets inline code in its character style alone, which a screen reader reads as ordinary text. This applies to inline code in ${counting(count, 'place', 'places')}.`;
    case 'preformatted_not_structure':
      return `Word has no mark for code, so it sets preformatted text as paragraphs in its style, which a screen reader reads as ordinary text. This applies to ${counting(count, 'block', 'blocks')} of preformatted text.`;
    case 'definition_list_not_structure':
      return `Word has no list of terms, so it sets a definition list as its terms and definitions in paragraphs, which a screen reader does not read as a list. This applies to ${counting(count, 'definition list', 'definition lists')}.`;
    case 'description_language_lost':
      return `Word cannot record the language an image's description is written in, so a screen reader may read a description in another language as if it were in the document's. This applies to descriptions in ${counting(count, 'place', 'places')}.`;
  }
}

/** One sentence per kind of entry, in plain language (R13). */
export function reportWords(entry: ReportEntry): string {
  switch (entry.kind) {
    case 'face_substituted':
      return `The typeface ${entry.family} cannot be embedded in a Word document, so Word shows its text in ${entry.wordFamily}.`;
    case 'no_page_cited_output':
      return 'This publication has no PDF, so nothing in it can be cited by page number.';
    case 'pages_cite_the_pdf':
      return "Word lays out its own pages, so its page numbers can differ from the PDF's. A page number cited from this publication is the PDF's.";
    // A table by its label, as the PDF prints it; one with no number is named as such, since this
    // page does not hold the outline its place is in.
    case 'header_column_lost':
      return `${tableName(entry)} has a header column, which a Word document cannot mark as one, so in Word its cells are read as ordinary cells.`;
    case 'header_repeated':
      return `${tableName(entry)} repeats its header rows on every page it reaches in Word, though its table style does not: Word marks header rows only by repeating them.`;
    case 'continuation_label_omitted':
      return `${tableName(entry)} has no continuation label in Word on the pages it continues on, since Word cannot set one.`;
    // A heading by its number and a caption by its label, as the PDF prints them.
    case 'equation_flattened':
      return `${flattenedName(entry)} holds an equation that Word sets as its characters in a row ${
        entry.block === null
          ? 'where it rebuilds the heading, in the contents or a running head, once it updates them'
          : 'in the list after the contents once it updates the list'
      }, so a fraction, a script or a root there reads differently from the PDF.`;
    case 'equation_numbered_as_table':
      return `${entry.label} is set in Word as a table of one row, the equation in one cell and its number in the other, so a screen reader announces a table; numbered equations that follow one another are one table.`;
    case 'equation_alternative_lost':
      return 'Word reads each equation aloud by its own reading of the maths, not by the description written for it, which the PDF gives a screen reader.';
    case 'maths_coverage_unchecked':
      return `Word sets equations in ${entry.wordFamily}, whose characters are not checked here: a character it lacks is drawn from another typeface, so it can look different from the PDF.`;
    default:
      return placedWords(entry.kind, 1);
  }
}

const flattenedName = (entry: { readonly block: string | null; readonly label: string | null }) =>
  entry.block === null
    ? entry.label === null
      ? 'A heading with no number'
      : `The heading numbered ${entry.label}`
    : entry.label === null
      ? 'A caption with no number'
      : `${entry.label}'s caption`;

const tableName = (entry: { readonly label: string | null }) =>
  entry.label ?? 'A table with no number';

/** An entry's key among its report's, which says each thing once. */
export function reportKey(entry: ReportEntry): string {
  switch (entry.kind) {
    case 'face_substituted':
      return `${entry.kind} ${entry.family}`;
    case 'no_page_cited_output':
    case 'pages_cite_the_pdf':
    case 'equation_alternative_lost':
      return entry.kind;
    case 'maths_coverage_unchecked':
      return `${entry.kind} ${entry.wordFamily}`;
    default:
      return `${entry.kind} ${entry.node} ${entry.block ?? ''}`;
  }
}
