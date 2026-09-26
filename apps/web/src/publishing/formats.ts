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
    };

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
    return [];
  });
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
  }
}

const tableName = (entry: { readonly label: string | null }) =>
  entry.label ?? 'A table with no number';

/** An entry's key among its report's, which says each thing once. */
export function reportKey(entry: ReportEntry): string {
  switch (entry.kind) {
    case 'face_substituted':
      return `${entry.kind} ${entry.family}`;
    case 'no_page_cited_output':
    case 'pages_cite_the_pdf':
      return entry.kind;
    default:
      return `${entry.kind} ${entry.node} ${entry.block}`;
  }
}
