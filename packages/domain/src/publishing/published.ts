import type { OutlineMatter } from '../structure/outline.js';

import type { SlotPart } from './layout.js';

/**
 * The published document (docs/design/publishing.md, "The published document"): the one intermediate
 * every writer reads, holding everything a writer needs and nothing it must decide. Version
 * `publishing/10` is the document under a layout whose runs carry their marks and may be images,
 * footnotes or cross-references, and whose blocks may be lists, quotations, preformatted text, tables
 * with their notes and figures, each carrying its anchor where a reference names it, with its
 * generated lists after the contents, which `apps/worker/templates/publication/10/` reads. It is never
 * stored - only its digest is, on the publication - so a later shape is a new schema string and a new
 * template version, not a migration.
 */
export const PUBLISHING_SCHEMA = 'publishing/10';

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
 * The document under a layout as it stood before a block could be a figure, frozen by figures 3 for
 * the reason `publishing/5` is: `apps/worker/templates/publication/6/` asserts it, and a template
 * version and the publications made with it are a record.
 */
export const PUBLISHING_SCHEMA_6 = 'publishing/6';

/**
 * The document under a layout as it stood before a run could be an image, frozen by figures 5 for the
 * reason `publishing/6` is: `apps/worker/templates/publication/7/` asserts it, and a template version
 * and the publications made with it are a record.
 */
export const PUBLISHING_SCHEMA_7 = 'publishing/7';

/**
 * The document under a layout as it stood before a run could be a footnote and a table carried its
 * note, frozen by footnotes 2 for the reason `publishing/7` is: `apps/worker/templates/publication/8/`
 * asserts it, and a template version and the publications made with it are a record.
 */
export const PUBLISHING_SCHEMA_8 = 'publishing/8';

/**
 * The document under a layout as it stood before a run could be a cross-reference and a block, a
 * footnote or a node carried an anchor, frozen by cross-references 2 for the reason `publishing/8` is:
 * `apps/worker/templates/publication/9/` asserts it, and a template version and the publications made
 * with it are a record.
 */
export const PUBLISHING_SCHEMA_9 = 'publishing/9';

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

/**
 * An image in a run of text (figures 5, ruling R2): where it stands in the compile root, its printed
 * size in points - one line high - and its alternative text resolved, or null where it is decorative,
 * all as a figure's are. It carries no marks, as the stored image carries none.
 */
export interface PublishedImageRun {
  readonly image: {
    readonly path: string;
    readonly width: number;
    readonly height: number;
    readonly alternative: { readonly text: string; readonly language: PublishedLanguage } | null;
  };
}

/**
 * A footnote (footnotes 2, ruling R2): the numbering table's label for it, which the template sets as
 * its mark and at the foot of the page, and its paragraphs, published as a paragraph's are. Only a
 * paragraph's runs hold one, and a footnote's own paragraphs hold none (CNT-129).
 */
export interface PublishedFootnoteRun {
  readonly footnote: {
    readonly label: string;
    /** Its anchor where a reference names it (cross-references 2, ruling R4), else null. */
    readonly anchor: string | null;
    readonly paragraphs: readonly PublishedParagraph[];
  };
}

/**
 * A cross-reference (cross-references 2, rulings R3 to R5), resolved in the document publishing it:
 * `anchor` is its target's - `b-<node>-<block>` for a block or a footnote of an occurrence, `n-<node>`
 * for a node - which the file carries on that target, or on an empty marker where the target publishes
 * nothing, so a template never names a label the document lacks.
 *
 * - `text` is what it prints - a number, a title, both, or the layout's word for above or below - and
 *   **null where `page` is asked for**, since a page is known only once the document is typeset: the
 *   template prints the target's page number, in the numbering of the matter it stands in.
 * - `link` is whether it is set as a link to its target: in a paragraph's text, and never in a table's
 *   header rows, a caption, a term, an attribution or a table's note, where it is text (XR-D) - a link
 *   in a repeated header row is refused by the engine, and a caption is set again in the lists.
 *
 * It carries no marks, as its stored node carries none.
 */
export interface PublishedReferenceRun {
  readonly reference:
    | {
        readonly anchor: string;
        readonly text: string;
        readonly page: false;
        readonly link: boolean;
      }
    | {
        readonly anchor: string;
        readonly text: null;
        readonly page: true;
        readonly link: boolean;
      };
}

/** One piece of a published run sequence: text with its marks, an image, a footnote or a reference. */
export type PublishedInline =
  PublishedRun | PublishedImageRun | PublishedFootnoteRun | PublishedReferenceRun;

/**
 * Every published block carries `anchor`: the label a template sets on it where a cross-reference in
 * the document names it (`b-<node>-<block>`), and **null where none does** - so the file labels what
 * a reference points at and nothing more (cross-references 2, ruling R4).
 */
export interface PublishedParagraph {
  readonly type: 'paragraph';
  readonly id: string;
  readonly anchor: string | null;
  readonly runs: readonly PublishedInline[];
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
  readonly term: readonly PublishedInline[] | null;
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
  readonly anchor: string | null;
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
  readonly anchor: string | null;
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
  readonly anchor: string | null;
  readonly blocks: readonly PublishedBlock[];
  readonly attribution: readonly PublishedInline[] | null;
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
  readonly anchor: string | null;
  readonly label: string | null;
  readonly caption: readonly PublishedInline[];
  readonly headerRows: number;
  readonly headerColumns: number;
  /** How many columns the grid is wide, which a template gives its table as that many equal columns. */
  readonly columns: number;
  readonly rows: readonly { readonly cells: readonly PublishedCell[] }[];
  /**
   * A note on the table as a whole (CNT-038, footnotes 2), as runs a template sets beneath the table
   * inside its figure, or null where the table has none or it says nothing.
   */
  readonly note: readonly PublishedInline[] | null;
}

/**
 * A figure (figures 3, ruling R2): `number`'s label, or null where none is given, and its caption as
 * runs, which a template sets below the image. The image is named by its **path in the compile root**
 * - its hash and the extension its format declares - and nothing else of the asset reaches a template.
 * Its printed size is `assemble`'s, in points, so a template never decides how big it is and an
 * image never runs off its page. Its alternative text is resolved - its own in the component's
 * language, or the image's in the language that declares - or null where the figure is decorative.
 */
export interface PublishedFigure {
  readonly type: 'figure';
  readonly id: string;
  readonly anchor: string | null;
  readonly label: string | null;
  readonly caption: readonly PublishedInline[];
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly alternative: { readonly text: string; readonly language: PublishedLanguage } | null;
}

/**
 * **A target that publishes nothing** (cross-references 2, ruling R4, XR-D): an empty paragraph, an
 * empty preformatted block, a quotation or a list with nothing in it, named by a reference. Such a
 * block is not published - an empty `P` is no content - but a reference to it must still find its
 * label, or the engine refuses the whole document, so `assemble` emits this in its place: its anchor
 * and nothing else, which a template sets as an empty `metadata` carrying the label, measured to take
 * a link and a page. A block kind rather than a run, because what it stands for is a block and it
 * stands where the block would have; and it is emitted only where a reference names the target, so a
 * document with no references holds none.
 */
export interface PublishedMarker {
  readonly type: 'marker';
  readonly anchor: string;
}

export type PublishedBlock =
  | PublishedParagraph
  | PublishedList
  | PublishedPreformatted
  | PublishedQuotation
  | PublishedTable
  | PublishedFigure
  | PublishedMarker;

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
  /** `n-<node>` where a cross-reference names the node, else null (cross-references 2, ruling R4). */
  readonly anchor: string | null;
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
