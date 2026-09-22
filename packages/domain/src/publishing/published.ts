import type { OutlineMatter } from '../structure/outline.js';

import type { SlotPart } from './layout.js';

/**
 * The published document (docs/design/publishing.md, "The published document"): the one intermediate
 * every writer reads, holding everything a writer needs and nothing it must decide. Version
 * `publishing/6` is the document under a layout whose runs carry their marks and whose blocks may be
 * lists, quotations, preformatted text and tables, with its generated lists after the contents, which
 * `apps/worker/templates/publication/6/` reads. It is never stored - only its digest is,
 * on the publication - so a later shape is a new schema string and a new template version, not a
 * migration.
 */
export const PUBLISHING_SCHEMA = 'publishing/6';

/**
 * The first slice's shape, before layouts: what `assemble` still makes, byte for byte, for a request
 * made before migration 0018 recorded a layout on it, so that such a request publishes exactly as it
 * would have then, with template 1 (Ken's answer F, 2026-09-19).
 */
export const PUBLISHING_SCHEMA_1 = 'publishing/1';

/**
 * The document under a layout as it stood before a run carried its marks, frozen. Nothing makes one
 * now - every request under a layout is assembled as `publishing/3` - and the string is kept because
 * `apps/worker/templates/publication/2/` asserts it and a template version is immutable: template 2,
 * and the publications made with it, are a record rather than something to migrate.
 */
export const PUBLISHING_SCHEMA_2 = 'publishing/2';

/**
 * The document under a layout as it stood when a block could only be a paragraph, frozen. Nothing
 * makes one now - every request under a layout is assembled as `publishing/4` - and the string is
 * kept for the reason `publishing/2`'s is: `apps/worker/templates/publication/3/` asserts it, and a
 * template version and the publications made with it are a record rather than something to migrate.
 */
export const PUBLISHING_SCHEMA_3 = 'publishing/3';

/**
 * The document under a layout as it stood when a block could be a paragraph or a list and nothing
 * else, frozen by editor 5 for the reason `publishing/3` is: `apps/worker/templates/publication/4/`
 * asserts it, and a template version and the publications made with it are a record.
 */
export const PUBLISHING_SCHEMA_4 = 'publishing/4';

/**
 * The document under a layout as it stood before a block could be a table, frozen by tables 2 for the
 * reason `publishing/4` is: `apps/worker/templates/publication/5/` asserts it, and a template version
 * and the publications made with it are a record.
 */
export const PUBLISHING_SCHEMA_5 = 'publishing/5';

/**
 * A BCP 47 tag as Typst can carry it: a language of two or three letters and, where there is one, a
 * region of two. A tag with a script subtag, a numeric region or any variant is refused, naming it,
 * and never shortened to fit (Ken's answer K, 2026-09-19).
 */
export interface PublishedLanguage {
  readonly lang: string;
  readonly region: string | null;
}

/**
 * A mark a published run carries: nine of the content model's thirteen, each as the kind the template
 * branches on, and the two that carry more than their kind carrying it beside.
 *
 * A hyperlink's `title` is **not** carried: a PDF link annotation has no place for it, and inventing
 * one would tell a reader something the author did not say. A language arrives as
 * `publishedLanguage` reads it, refused by name where the engine cannot carry the tag rather than
 * shortened to something the author never wrote.
 *
 * The four that are not here - `definedTerm`, `condition`, `suggestion` and `comment` - are refused
 * by name by `assemble`, never dropped: nothing resolves a term, and a condition, a suggestion or a
 * comment carried through would set text a reader was not meant to be shown.
 */
export type PublishedMark =
  | {
      readonly kind:
        | 'emphasis'
        | 'strong'
        | 'underline'
        | 'subscript'
        | 'superscript'
        | 'inlineCode'
        | 'quotedPhrase';
    }
  | { readonly kind: 'hyperlink'; readonly href: string }
  | { readonly kind: 'language'; readonly language: PublishedLanguage };

/**
 * The order a run's marks are written in, outermost first, so that one document makes one PDF: a
 * publication's digest is of these bytes, and the repository holds three orders that disagree (the
 * content model's `markTypes`, the editor schema's declaration order and the toolbar's), so the
 * published order is pinned here and nowhere else.
 *
 * `inlineCode` is last, and so innermost, because the template sets it with Typst's `raw`, which
 * takes text rather than a body: anything applied inside it would be lost.
 */
export const PUBLISHED_MARK_ORDER = [
  'language',
  'hyperlink',
  'quotedPhrase',
  'emphasis',
  'strong',
  'underline',
  'subscript',
  'superscript',
  'inlineCode',
] as const satisfies readonly PublishedMark['kind'][];

/** A run of `publishing/4`: its text, and the marks over it in `PUBLISHED_MARK_ORDER`. */
export interface PublishedRun {
  readonly text: string;
  readonly marks: readonly PublishedMark[];
}

export interface PublishedParagraph {
  readonly type: 'paragraph';
  readonly id: string;
  readonly runs: readonly PublishedRun[];
}

/**
 * One item of a published list. It carries **no identifier**, because a stored item carries none
 * either: an item is a position in its list, and the list is what a failure inside one names.
 *
 * `term` is the term this item defines, as runs, on a definition list's item and on no other - where
 * a term may stand at all is `checkBlock`'s rule, in `content/model/document.ts`, rather than a
 * second copy of it here. It is **null where the author has not typed one yet**, which is a state
 * the model deliberately admits (an author writing the definition before the word is mid-edit, not
 * in error, as CNT-124's empty paragraph is), so **a template maps it guarded**: an item with no
 * term prints an empty label, which is honest about an item nobody has finished.
 */
export interface PublishedItem {
  readonly term: readonly PublishedRun[] | null;
  readonly blocks: readonly PublishedBlock[];
}

/**
 * A list of `publishing/4`, in the three kinds CNT-117 names. `start` and `format` are an ordered
 * list's alone (`checkBlock` again) and are **null rather than absent** where there are none, so the
 * template branches on one spelling. An item holds blocks, so nesting is by construction and
 * CNT-118's six levels is a floor.
 */
export interface PublishedList {
  readonly type: 'list';
  readonly id: string;
  readonly kind: 'ordered' | 'unordered' | 'definition';
  readonly start: number | null;
  readonly format: 'decimal' | 'alphabetic' | 'roman' | null;
  readonly items: readonly PublishedItem[];
}

/**
 * Preformatted text of `publishing/5` (CNT-018): its lines, **each tab already expanded** to the
 * stops the surface shows, because the engine ignores `tab-size` without a language and a language
 * would delete whitespace. `label` is the author's language label, printed above the block, and
 * **null rather than absent** where there is none, so a template has one spelling to branch on.
 */
export interface PublishedPreformatted {
  readonly type: 'preformatted';
  readonly id: string;
  readonly label: string | null;
  readonly lines: readonly string[];
}

/**
 * A quotation of `publishing/5` (CNT-019): the blocks it quotes, and its attribution as runs, or null
 * where it has none. The template sets the attribution itself, with **no character before it** - never
 * through the engine's own attribution, which writes an em dash the author never typed (decision D).
 */
export interface PublishedQuotation {
  readonly type: 'blockquote';
  readonly id: string;
  readonly blocks: readonly PublishedBlock[];
  readonly attribution: readonly PublishedRun[] | null;
}

/** One cell of a published table: its blocks - paragraphs and lists - and the grid it covers. */
export interface PublishedCell {
  readonly blocks: readonly PublishedBlock[];
  readonly colspan: number;
  readonly rowspan: number;
  /**
   * What the cell heads, from where it starts in the grid: `column` in a header row, `row` in a
   * header column, `both` in the corner where they meet, and null for a data cell. Worked out here,
   * where the grid is already known to be whole, so a template sets a cell without placing spans.
   */
  readonly scope: 'column' | 'row' | 'both' | null;
}

/**
 * A table of `publishing/6` (tables 2, ruling R2). `label` is `number`'s - "Table 1.1" - set as text,
 * never Typst's counter (decision F of the first slice), and null where a caption before any numbered
 * appendix takes no number. The caption is runs, which a template sets above the table as its
 * caption. The header counts are the stored table's, and the template makes the header rows one
 * repeating header and a header column's cells row headers.
 */
export interface PublishedTable {
  readonly type: 'table';
  readonly id: string;
  readonly label: string | null;
  readonly caption: readonly PublishedRun[];
  readonly headerRows: number;
  readonly headerColumns: number;
  /** How many columns the grid is wide, which a template gives its table as that many equal columns. */
  readonly columns: number;
  readonly rows: readonly { readonly cells: readonly PublishedCell[] }[];
}

export type PublishedBlock =
  PublishedParagraph | PublishedList | PublishedPreformatted | PublishedQuotation | PublishedTable;

/** A generated list the template sets after the contents: which sequence, under which title. */
export interface PublishedGeneratedList {
  readonly sequence: string;
  readonly title: string;
}

/**
 * A run of `publishing/1` and `publishing/2`, before a run carried its marks: its text and nothing
 * else. Frozen with the schemas that hold it - `assemble` refuses a marked inline outright when it
 * is making one - so that a request made before layouts still publishes byte for byte as it did.
 */
export interface PublishedRun1 {
  readonly text: string;
}

export interface PublishedParagraph1 {
  readonly type: 'paragraph';
  readonly id: string;
  readonly runs: readonly PublishedRun1[];
}

export type PublishedBlock1 = PublishedParagraph1;

/**
 * One outline node in `publishing/1`, set as a heading at its depth. `number` is `number`'s, set as
 * text; `language` and `direction` are present only where the node's own words differ from the
 * document's - a reference whose component's base language or direction is not the document's.
 */
export interface PublishedNode1 {
  readonly id: string;
  readonly depth: number;
  readonly number: string | null;
  readonly title: string;
  readonly language: PublishedLanguage | null;
  readonly direction: 'ltr' | 'rtl' | null;
  readonly blocks: readonly PublishedBlock1[];
  readonly children: readonly PublishedNode1[];
}

/**
 * One outline node in `publishing/2`: as in `publishing/1`, and the matter it is in - its top-level
 * node's, carried to every node beneath it, so the template pages and numbers it with no walk upwards.
 */
export interface PublishedNode {
  readonly id: string;
  readonly depth: number;
  readonly matter: OutlineMatter;
  readonly number: string | null;
  readonly title: string;
  readonly language: PublishedLanguage | null;
  readonly direction: 'ltr' | 'rtl' | null;
  readonly blocks: readonly PublishedBlock[];
  readonly children: readonly PublishedNode[];
}

/**
 * What every page, and once the tagged text, says of a draft (issue #142): `publishing/1`'s words, and
 * the source of the default layout's (decision H), which declares them in its own language (#144).
 */
export const DRAFT_NOTICE = {
  page: 'Not approved',
  text: 'Not approved. This is a draft publication, not made from an approved baseline.',
} as const;

/** The first slice's published document, for a request made before layouts. */
export interface PublishedDocument1 {
  readonly schema: typeof PUBLISHING_SCHEMA_1;
  readonly title: string;
  readonly language: PublishedLanguage;
  readonly direction: 'ltr' | 'rtl';
  readonly status: 'draft';
  readonly notice: { readonly page: string; readonly text: string };
  readonly nodes: readonly PublishedNode1[];
}

/**
 * A page number's pattern as Typst's `numbering` takes it: one per `NumberFormat`, mapped by name
 * (`lowerAlpha` is `a`, `lowerRoman` is `i`), never by position.
 */
export type PublishedPattern = '1' | 'i' | 'I' | 'a' | 'A';

/**
 * The layout's PDF member as the template sets it (PUB-007, PUB-008, PUB-009): the page in points, in
 * the portrait sense with its orientation beside it; the three slots of the running head and foot;
 * and each matter's page numbering as a pattern.
 */
export interface PublishedPdfFormat {
  readonly width: number;
  readonly height: number;
  readonly orientation: 'portrait' | 'landscape';
  readonly margins: {
    readonly top: number;
    readonly bottom: number;
    readonly inside: number;
    readonly outside: number;
  };
  readonly gutter: number;
  readonly head: readonly [readonly SlotPart[], readonly SlotPart[], readonly SlotPart[]];
  readonly foot: readonly [readonly SlotPart[], readonly SlotPart[], readonly SlotPart[]];
  readonly pageNumbering: Readonly<
    Record<OutlineMatter, { readonly pattern: PublishedPattern; readonly restart: boolean }>
  >;
}

/**
 * The document under its layout. `words` are the layout's, in the layout's language, which is not
 * necessarily the document's (`en` serves `en-GB`); `revision` is the document version's
 * `revision.version`, what a running foot's `revision` field prints. `front.contents` is null where the
 * layout declares none **and** where it would hold no entry: a contents of nothing is not published
 * (decision K).
 */
export interface PublishedDocument {
  readonly schema: typeof PUBLISHING_SCHEMA;
  readonly title: string;
  readonly language: PublishedLanguage;
  readonly direction: 'ltr' | 'rtl';
  readonly status: 'draft';
  readonly revision: string;
  readonly words: {
    readonly language: PublishedLanguage;
    readonly contents: string;
    readonly notice: string;
    readonly noticeSentence: string;
  };
  readonly format: PublishedPdfFormat;
  readonly front: {
    readonly cover: boolean;
    readonly contents: { readonly depth: number } | null;
    /** The lists the layout declares that have an entry, in its order; an empty one is not set. */
    readonly lists: readonly PublishedGeneratedList[];
  };
  readonly appendices: { readonly newPage: boolean };
  readonly nodes: readonly PublishedNode[];
}
