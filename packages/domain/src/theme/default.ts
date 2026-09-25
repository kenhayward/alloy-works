import type {
  AdmonitionCatalogue1,
  CatalogueKind,
  CharacterCatalogue1,
  CitationCatalogue1,
  ImageCatalogue,
  ImageCatalogue1,
  ParagraphCatalogue,
  ParagraphCatalogue1,
  TableCatalogue,
  TableCatalogue1,
  Theme,
  Typeface,
} from './schema.js';

/**
 * **The product's default theme** (themes 1, ruling R3): the theme every environment is given, and
 * every publication is set from until TPL lets a template bind another. As data - a `theme/1` and the
 * six catalogue versions it binds - which the store seeds as literals and a test recomputes from here.
 *
 * **Three versions, all stated, because all are stored.** **0.1**, the `FIRST_` constants, is exactly
 * what migration 0024 seeded: six `catalogue/1` versions and the theme naming them. Frozen - the rows
 * are insert-only and the store's test recomputes their hashes from these - so nothing in it may change.
 * **0.2** is themes 2's (ruling R3), seeded by 0025: new versions of the paragraph, table and image
 * catalogues at `catalogue/2`, giving a table and an image their look and the quotation its set-off,
 * and the theme naming them; the character, admonition and citation catalogues are 0.1's. Its
 * catalogues are the unprefixed `DEFAULT_CATALOGUE` constants, and its theme, frozen too, is
 * `SECOND_DEFAULT_THEME`. **0.3**, `DEFAULT_THEME`, is Word 1's (ruling R5), seeded by 0026: 0.2 with
 * the maths face's Word face declared, binding the same six catalogues.
 *
 * **Its numbers are template 11's wherever template 11 wrote one** - the body at 11pt, headings at 16
 * and 13pt bold, preformatted text at 8.8pt on `luma(240)`, which is `#f0f0f0`, in a 6pt panel, its
 * label at 8pt, a table's note at 10pt, the notice and the running slots at 9pt - so a publication's
 * look moves only by what the line rules change. **Where template 11 left a value to the engine, or
 * wrote one the line rules mean differently** - every line spacing and every space before and after, a
 * footnote's size, a quotation's inset, a third heading's size - the value is **measured from a
 * template 11 PDF** (themes 1, task 4): baselines read with the worker's PDF reader, and each value
 * the one that, by ADR-0014's rule, puts the next baseline where template 11 put it.
 *
 * - **Line spacing** is template 11's baseline-to-baseline distance within a paragraph of that style:
 *   its 0.65em leading and the face's cap height, 1.3048 of the size - 14.35 at 11pt, 20.88 at 16pt,
 *   16.96 at 13pt, 13.05 at 10pt, 11.74 at 9pt, 10.44 at 8pt; preformatted text 11.52 by Liberation
 *   Mono's own cap height, and a footnote 10.8 at the engine's 0.85 of 11pt, 9.35, and its half-em
 *   leading.
 * - **Spaces** are what, added as STY-050 adds them, reproduce template 11's distances from one
 *   baseline to the next: 17.10 between two paragraphs (a body's 2.75 after), 20.00 from a first
 *   heading into text and 32.88 from text into one (4.57 after it and 10.33 before), 17.60 and 26.71
 *   at the second level (2.82 and 7.43), 16.00 and 22.60 at the third (1.65 and 5.50), 11.62 between
 *   two footnotes, 17.10 below a table's note (2.97), and a preformatted panel's 21.70 below the
 *   text before it and 23.10 above the text after it. A contents entry has no space after, as template
 *   11's entries stood a line apart. Where two of template 11's distances cannot both be kept - a heading
 *   straight into a heading, the space around a quotation, a table's note and its table - the text's
 *   are kept, and themes 1's plan records by how much the others moved.
 *
 * Colours are black on white, as template 11's were: the engine's default ink, which no template
 * stated, on its default paper.
 */

/**
 * The six catalogue versions the theme's 0.1 binds, by the artifact-version identifier migration 0024
 * seeded each under: fixed, because the theme's own content names them and the migration writes both
 * as literals.
 */
export const FIRST_DEFAULT_CATALOGUE_VERSIONS: Readonly<Record<CatalogueKind, string>> = {
  paragraph: 'ea96cd55-858a-4041-b5f7-9a91b8e6b9b5',
  character: '04b5f4de-0264-49b4-9d64-f64af70b0cfe',
  table: '29dc6b2e-b37a-47a7-9416-7d02feca8922',
  image: 'e92731c6-c7da-440d-8106-355f66a8a837',
  admonition: '9d239242-93b6-4e7f-b5e2-7a030a159d65',
  citation: '4fa1d4bb-f13a-4be0-ab88-50bcafd9e754',
};

/**
 * The three families pinned in the worker's image (TH-B), each file by the hash
 * `apps/worker/src/fonts.ts` pins it at, each under the SIL Open Font Licence 1.1 (ADR-0010), which
 * permits embedding anywhere. The metrics are the faces' own: hhea's ascender and descender over the
 * head table's units per em, and Liberation Mono's advance, 1229 of 2048 units, the one every glyph
 * shares, by which `columnsAt` in `publishing/measure.ts` counts columns. Written as the fractions
 * they are - each exact in binary - so a test can hold them to the files without a tolerance. The
 * worker's test does.
 */
const serif: Typeface = {
  id: 'serif',
  family: 'Liberation Serif',
  files: [
    {
      sha256: '058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74',
      weight: 'regular',
      posture: 'normal',
    },
    {
      sha256: '0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e',
      weight: 'regular',
      posture: 'italic',
    },
    {
      sha256: 'd754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce',
      weight: 'bold',
      posture: 'normal',
    },
    {
      sha256: 'f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7',
      weight: 'bold',
      posture: 'italic',
    },
  ],
  licence: 'OFL-1.1',
  embedding: { pdf: true, word: true },
  ascent: 1825 / 2048,
  descent: 443 / 2048,
};

const mono: Typeface = {
  id: 'mono',
  family: 'Liberation Mono',
  files: [
    {
      sha256: 'f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1',
      weight: 'regular',
      posture: 'normal',
    },
    {
      sha256: '605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1',
      weight: 'regular',
      posture: 'italic',
    },
    {
      sha256: 'bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb',
      weight: 'bold',
      posture: 'normal',
    },
    {
      sha256: '79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130',
      weight: 'bold',
      posture: 'italic',
    },
  ],
  licence: 'OFL-1.1',
  embedding: { pdf: true, word: true },
  ascent: 1705 / 2048,
  descent: 615 / 2048,
  advance: 1229 / 2048,
};

/** STIX Two Math 2.13 b171: one face, in a 1000-unit em, as the theme's 0.1 and 0.2 declare it. */
const maths: Typeface = {
  id: 'maths',
  family: 'STIX Two Math',
  files: [
    {
      sha256: '3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c',
      weight: 'regular',
      posture: 'normal',
    },
  ],
  licence: 'OFL-1.1',
  embedding: { pdf: true, word: true },
  ascent: 762 / 1000,
  descent: 238 / 1000,
};

/**
 * The paragraph catalogue at 0.1. Every heading keeps with what follows it, as template 11's `sticky` did;
 * widow control is on and hyphenation off, which is what the engine did with template 11's left-aligned
 * text (the widow and orphan costs at their default of 100%, and `hyphenate: auto` hyphenating only
 * justified text).
 */
const firstParagraph: ParagraphCatalogue1 = {
  schemaVersion: 1,
  kind: 'paragraph',
  base: {
    typeface: 'serif',
    size: 11,
    bold: false,
    italic: false,
    colour: '#000000',
    background: 'none',
    padding: 0,
    alignment: 'start',
    firstLineIndent: 0,
    startIndent: 0,
    endIndent: 0,
    spaceBefore: 0,
    spaceAfter: 2.75,
    lineSpacing: 14.35,
    keepWithNext: false,
    keepTogether: false,
    widowControl: true,
    hyphenate: false,
  },
  styles: [
    { id: 'body', name: 'Body', appliesTo: ['text', 'listItem'], properties: {} },
    // A table's cells, centred as template 11's were: a figure centres what it holds, and a table
    // is set in one.
    {
      id: 'table-cell',
      name: 'Table cell',
      basedOn: 'body',
      appliesTo: ['tableCell'],
      properties: { alignment: 'centre' },
    },
    {
      id: 'quotation',
      name: 'Quotation',
      basedOn: 'body',
      appliesTo: ['quotation'],
      properties: {
        startIndent: 11,
        endIndent: 11,
      },
    },
    {
      id: 'footnote',
      name: 'Footnote',
      basedOn: 'body',
      appliesTo: ['footnote'],
      properties: {
        size: 9.35,
        spaceAfter: 0.82,
        lineSpacing: 10.8,
      },
    },
    {
      id: 'heading-1',
      name: 'Heading 1',
      basedOn: 'body',
      appliesTo: ['heading1'],
      properties: {
        size: 16,
        bold: true,
        spaceBefore: 10.33,
        spaceAfter: 4.57,
        lineSpacing: 20.88,
        keepWithNext: true,
      },
    },
    {
      id: 'heading-2',
      name: 'Heading 2',
      basedOn: 'heading-1',
      appliesTo: ['heading2'],
      properties: {
        size: 13,
        spaceBefore: 7.43,
        spaceAfter: 2.82,
        lineSpacing: 16.96,
      },
    },
    {
      id: 'heading-3',
      name: 'Heading 3',
      basedOn: 'heading-1',
      appliesTo: ['heading3'],
      properties: {
        size: 11,
        spaceBefore: 5.5,
        spaceAfter: 1.65,
        lineSpacing: 14.35,
      },
    },
    {
      id: 'heading-4',
      name: 'Heading 4',
      basedOn: 'heading-3',
      appliesTo: ['heading4'],
      properties: {},
    },
    {
      id: 'heading-5',
      name: 'Heading 5',
      basedOn: 'heading-3',
      appliesTo: ['heading5'],
      properties: {},
    },
    {
      id: 'heading-6',
      name: 'Heading 6',
      basedOn: 'heading-3',
      appliesTo: ['heading6'],
      properties: {},
    },
    // The cover's title, and the contents' and the lists' titles, are headings in template 11.
    { id: 'title', name: 'Title', basedOn: 'heading-1', appliesTo: ['title'], properties: {} },
    {
      id: 'contents-heading',
      name: 'Contents heading',
      basedOn: 'heading-1',
      appliesTo: ['contents', 'list'],
      properties: {},
    },
    {
      id: 'contents-entry',
      name: 'Contents entry',
      basedOn: 'body',
      appliesTo: ['contentsEntry', 'listEntry'],
      properties: { spaceAfter: 0 },
    },
    {
      id: 'notice-sentence',
      name: 'Notice sentence',
      basedOn: 'body',
      appliesTo: ['noticeSentence'],
      properties: { bold: true },
    },
    {
      id: 'notice',
      name: 'Notice',
      basedOn: 'body',
      appliesTo: ['notice'],
      properties: {
        size: 9,
        alignment: 'end',
        spaceAfter: 2.25,
        lineSpacing: 11.74,
      },
    },
    {
      id: 'running',
      name: 'Running head and foot',
      basedOn: 'body',
      appliesTo: ['running'],
      properties: {
        size: 9,
        lineSpacing: 11.74,
      },
    },
    // Centred, as template 11's captions were: a figure centres what it holds.
    {
      id: 'caption',
      name: 'Caption',
      basedOn: 'body',
      appliesTo: ['caption'],
      properties: { alignment: 'centre' },
    },
    {
      id: 'table-note',
      name: 'Table note',
      basedOn: 'body',
      appliesTo: ['tableNote'],
      properties: {
        size: 10,
        spaceAfter: 2.97,
        lineSpacing: 13.05,
      },
    },
    {
      id: 'attribution',
      name: 'Attribution',
      basedOn: 'body',
      appliesTo: ['attribution'],
      properties: { alignment: 'end' },
    },
    {
      id: 'preformatted',
      name: 'Preformatted',
      basedOn: 'body',
      appliesTo: ['preformatted'],
      properties: {
        typeface: 'mono',
        size: 8.8,
        background: '#f0f0f0',
        padding: 6, // template 11's panel, `inset: 6pt`
        spaceBefore: 1.69,
        spaceAfter: 2.49,
        lineSpacing: 11.52,
      },
    },
    {
      id: 'preformatted-label',
      name: 'Preformatted label',
      basedOn: 'body',
      appliesTo: ['preformattedLabel'],
      properties: {
        size: 8,
        spaceBefore: 1.3,
        spaceAfter: 3.4,
        lineSpacing: 10.44,
      },
    },
  ],
};

/**
 * One style for each of the nine marks a publication carries, in `PUBLISHED_MARK_ORDER`, rendering
 * each as template 11 did. A language, a link and a quoted phrase state nothing: template 11 gave them
 * no appearance, only their meaning, which stays the template's. Inline code is set in the monospaced
 * face at 0.8 of the text it stands in, template 11's `0.8em`.
 */
const character: CharacterCatalogue1 = {
  schemaVersion: 1,
  kind: 'character',
  styles: [
    { id: 'language', name: 'Language', mark: 'language', properties: {} },
    { id: 'link', name: 'Link', mark: 'hyperlink', properties: {} },
    { id: 'quoted-phrase', name: 'Quoted phrase', mark: 'quotedPhrase', properties: {} },
    { id: 'emphasis', name: 'Emphasis', mark: 'emphasis', properties: { italic: true } },
    { id: 'strong', name: 'Strong', mark: 'strong', properties: { bold: true } },
    { id: 'underline', name: 'Underline', mark: 'underline', properties: { underline: true } },
    {
      id: 'subscript',
      name: 'Subscript',
      mark: 'subscript',
      properties: { position: 'subscript' },
    },
    {
      id: 'superscript',
      name: 'Superscript',
      mark: 'superscript',
      properties: { position: 'superscript' },
    },
    {
      id: 'inline-code',
      name: 'Inline code',
      mark: 'inlineCode',
      properties: { typeface: 'mono', scale: 0.8 },
    },
  ],
};

/** The identifiers content already carries - `table`, `figure` and `inline` - with no properties yet. */
const firstTable: TableCatalogue1 = {
  schemaVersion: 1,
  kind: 'table',
  styles: [{ id: 'table', name: 'Table', appliesTo: ['table'] }],
};

const firstImage: ImageCatalogue1 = {
  schemaVersion: 1,
  kind: 'image',
  styles: [
    { id: 'figure', name: 'Figure', appliesTo: ['figure'] },
    { id: 'inline', name: 'Inline image', appliesTo: ['inlineImage'] },
  ],
};

/** Nothing to style yet (TH-C): STY-003 asks for the six, and an empty catalogue costs a row. */
const admonition: AdmonitionCatalogue1 = { schemaVersion: 1, kind: 'admonition', styles: [] };
const citation: CitationCatalogue1 = { schemaVersion: 1, kind: 'citation', styles: [] };

/** The six catalogues' contents at the theme's 0.1, by kind, exactly as 0024 stored them. */
export const FIRST_DEFAULT_CATALOGUES: {
  readonly paragraph: ParagraphCatalogue1;
  readonly character: CharacterCatalogue1;
  readonly table: TableCatalogue1;
  readonly image: ImageCatalogue1;
  readonly admonition: AdmonitionCatalogue1;
  readonly citation: CitationCatalogue1;
} = {
  paragraph: firstParagraph,
  character,
  table: firstTable,
  image: firstImage,
  admonition,
  citation,
};

/** The same six, by the version identifier the theme's 0.1 names each by: what `readTheme` is handed. */
export const FIRST_DEFAULT_CATALOGUES_BY_VERSION: ReadonlyMap<string, unknown> = new Map(
  (Object.keys(FIRST_DEFAULT_CATALOGUE_VERSIONS) as CatalogueKind[]).map((kind) => [
    FIRST_DEFAULT_CATALOGUE_VERSIONS[kind],
    FIRST_DEFAULT_CATALOGUES[kind],
  ]),
);

/**
 * **The default theme's 0.1, as migration 0024 stored it**, `theme/1`. Frozen, because the row is
 * insert-only and `default-theme.test.ts` in the store recomputes its hash from this; a publication
 * made under it records it, and is set from it again on a retry.
 */
export const FIRST_DEFAULT_THEME: Theme = {
  schemaVersion: 1,
  name: 'Default',
  paper: '#ffffff',
  typefaces: [serif, mono, maths],
  maths: 'maths',
  catalogues: { ...FIRST_DEFAULT_CATALOGUE_VERSIONS },
  places: {
    text: 'body',
    listItem: 'body',
    quotation: 'quotation',
    tableCell: 'table-cell',
    footnote: 'footnote',
  },
  roles: {
    heading1: 'heading-1',
    heading2: 'heading-2',
    heading3: 'heading-3',
    heading4: 'heading-4',
    heading5: 'heading-5',
    heading6: 'heading-6',
    title: 'title',
    notice: 'notice',
    noticeSentence: 'notice-sentence',
    contents: 'contents-heading',
    contentsEntry: 'contents-entry',
    list: 'contents-heading',
    listEntry: 'contents-entry',
    caption: 'caption',
    tableNote: 'table-note',
    attribution: 'attribution',
    preformatted: 'preformatted',
    preformattedLabel: 'preformatted-label',
    running: 'running',
  },
};

// ---------------------------------------------------------------------------------------------------
// Version 0.2 (themes 2, ruling R3): new versions of the paragraph, table and image catalogues, at
// `catalogue/2`, and the theme naming them. The character, admonition and citation catalogues are
// 0.1's rows, unchanged.
// ---------------------------------------------------------------------------------------------------

/**
 * The paragraph catalogue at 0.2: 0.1's, its base stating contextual spacing, off, and **the quotation
 * given back the set-off template 11 gave it** (themes 1's plan, "What the build changed"). Template 11
 * put 33.6pt from text into a quotation and from a quotation into its attribution, and 27.0pt from the
 * attribution, or from a quotation without one, into the text after it - the last measured again by
 * this slice against the pinned engine. By template 12's rule - the first's space after, the second's
 * space before and its line spacing, 14.35pt for every 11pt style here - those are:
 *
 * - text into a quotation, 2.75 + 16.5 + 14.35: the quotation's **16.5 before**;
 * - a quotation into the text after it, 12.65 + 0 + 14.35: its **12.65 after**, the body's 2.75 and
 *   template 11's 9.9 more;
 * - a quotation into its attribution, 12.65 + 6.6 + 14.35: the attribution's **6.6 before**, so the
 *   quotation's one space after serves both what follows it;
 * - the attribution into the text after it, 12.65 + 0 + 14.35: the attribution's **12.65 after**.
 *
 * The quotation asks for **contextual spacing**, so its own paragraphs stand a line apart, 14.35pt,
 * where template 11 put them 17.1pt: the one distance this moves (ruling R3).
 */
const paragraph: ParagraphCatalogue = {
  ...firstParagraph,
  schemaVersion: 2,
  base: { ...firstParagraph.base, contextualSpacing: false },
  styles: firstParagraph.styles.map((style) =>
    style.id === 'quotation'
      ? {
          ...style,
          properties: {
            ...style.properties,
            spaceBefore: 16.5,
            spaceAfter: 12.65,
            contextualSpacing: true,
          },
        }
      : style.id === 'attribution'
        ? { ...style, properties: { ...style.properties, spaceBefore: 6.6, spaceAfter: 12.65 } }
        : style,
  ),
};

/**
 * The table catalogue at 0.2: its one style, `table`, stating **template 12's look** - the engine's
 * own table, which template 12 left it to draw. Every rule 1pt black, outer, horizontal and vertical;
 * cells padded 5pt; the header neither filled nor bold, and ruled by nothing but the rules; no banding;
 * the header repeated on each page the table crosses and a row allowed to split. **No continuation
 * label**: measured in the design, one leaves an empty header cell in the structure tree on a table's
 * first page, which is a cost a theme should choose rather than be given.
 */
const table: TableCatalogue = {
  schemaVersion: 2,
  kind: 'table',
  styles: [
    {
      id: 'table',
      name: 'Table',
      appliesTo: ['table'],
      headerRow: { fill: 'none', bold: false, rule: 'none' },
      headerColumn: { fill: 'none', bold: false, rule: 'none' },
      banding: { fill: 'none' },
      rules: {
        outer: { width: 1, colour: '#000000' },
        horizontal: { width: 1, colour: '#000000' },
        vertical: { width: 1, colour: '#000000' },
      },
      padding: 5,
      breaks: { repeatHeader: true, keepRowsWhole: false, continuationLabel: false },
    },
  ],
};

/**
 * The image catalogue at 0.2: `figure` and `inline` at **today's rules** (TH-J), which `assemble` and
 * template 12 kept as their own. A figure fixes its width at the measure, is at most 60 per cent of the
 * text block's height, and stands as a block, centred; an image in a line of text fixes its height at
 * 1.2 ems of the text it stands in, is at most the measure wide, and stands where its text puts it.
 */
const image: ImageCatalogue = {
  schemaVersion: 2,
  kind: 'image',
  styles: [
    {
      id: 'figure',
      name: 'Figure',
      appliesTo: ['figure'],
      fixed: { dimension: 'width', value: 1, unit: 'measure' },
      maximum: { value: 0.6, unit: 'textHeight' },
      placement: 'block',
      alignment: 'centre',
    },
    {
      id: 'inline',
      name: 'Inline image',
      appliesTo: ['inlineImage'],
      fixed: { dimension: 'height', value: 1.2, unit: 'em' },
      maximum: { value: 1, unit: 'measure' },
      placement: 'inline',
    },
  ],
};

/**
 * The six catalogue versions the theme's 0.2 binds: new, fixed identifiers for the paragraph, table
 * and image catalogues' 0.2, which the store seeds and the theme's content names, and 0.1's for the
 * other three.
 */
export const DEFAULT_CATALOGUE_VERSIONS: Readonly<Record<CatalogueKind, string>> = {
  paragraph: '16b4cdba-64f4-48f4-b1cf-20c9983118aa',
  character: FIRST_DEFAULT_CATALOGUE_VERSIONS.character,
  table: 'ea7c2f51-17d2-4b4f-bead-dcb481b4d1cc',
  image: 'f6a95219-0c03-4cc5-a6c1-db552f45a550',
  admonition: FIRST_DEFAULT_CATALOGUE_VERSIONS.admonition,
  citation: FIRST_DEFAULT_CATALOGUE_VERSIONS.citation,
};

/**
 * The six catalogues the theme's 0.2 binds, by kind, each as its row holds it: the paragraph, table
 * and image catalogues at `catalogue/2`, and 0.1's character, admonition and citation catalogues at
 * `catalogue/1`, which the reader upgrades.
 */
export const DEFAULT_CATALOGUES: {
  readonly paragraph: ParagraphCatalogue;
  readonly character: CharacterCatalogue1;
  readonly table: TableCatalogue;
  readonly image: ImageCatalogue;
  readonly admonition: AdmonitionCatalogue1;
  readonly citation: CitationCatalogue1;
} = { paragraph, character, table, image, admonition, citation };

/** The same six, by the version identifier the theme's 0.2 names each by. */
export const DEFAULT_CATALOGUES_BY_VERSION: ReadonlyMap<string, unknown> = new Map(
  (Object.keys(DEFAULT_CATALOGUE_VERSIONS) as CatalogueKind[]).map((kind) => [
    DEFAULT_CATALOGUE_VERSIONS[kind],
    DEFAULT_CATALOGUES[kind],
  ]),
);

/**
 * The fixed identifier the store seeds the default theme's 0.2 under, as the catalogues' are fixed:
 * 0.1's defaulted, and is found through `theme_default`, but a migration guarding on what it inserts
 * is simpler with one it names.
 */
export const SECOND_DEFAULT_THEME_VERSION = '29c4ade2-741b-48fa-bc45-94c06257bd75';

/**
 * **The default theme's 0.2, as migration 0025 stored it**: 0.1 naming the catalogue versions above,
 * nothing else changed. Frozen, as 0.1 is: the row is insert-only, and a request made under it is set
 * from it.
 */
export const SECOND_DEFAULT_THEME: Theme = {
  ...FIRST_DEFAULT_THEME,
  catalogues: { ...DEFAULT_CATALOGUE_VERSIONS },
};

// ---------------------------------------------------------------------------------------------------
// Version 0.3 (Word 1, ruling R5): 0.2 with the maths face's Word face declared. No catalogue changes.
// ---------------------------------------------------------------------------------------------------

/**
 * STIX Two Math as Word takes it: **not embeddable in a Word document, set there in Cambria Math**
 * (STY-052). Its licence permits embedding, but its outlines are CFF - the file's tag is `OTTO` - and
 * Word embeds TrueType outlines only: measured (word-output.md, M10), an embedded STIX Two Math has
 * Word set the equations in Calibri, and without it in Cambria Math. So `embedding.word` says what a
 * Word document can carry, which for this face is decided by its outlines before its licence, and
 * the Word face is the one Word and Office carry. The PDF is unchanged.
 */
const mathsForWord: Typeface = {
  ...maths,
  embedding: { pdf: true, word: false },
  wordFamily: 'Cambria Math',
};

/** The fixed identifier the store seeds the default theme's 0.3 under, by 0026, as 0.2's is fixed. */
export const DEFAULT_THEME_VERSION = '3c00d89a-547f-468e-94a3-8a4b82ab05d3';

/**
 * **The default theme as it stands, 0.3**: 0.2 with the maths face above, nothing else changed - it
 * binds 0.2's six catalogue versions.
 */
export const DEFAULT_THEME: Theme = {
  ...SECOND_DEFAULT_THEME,
  typefaces: [serif, mono, mathsForWord],
};
