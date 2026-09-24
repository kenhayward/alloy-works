import type {
  AdmonitionCatalogue,
  CatalogueKind,
  CharacterCatalogue,
  CitationCatalogue,
  ImageCatalogue,
  ParagraphCatalogue,
  TableCatalogue,
  Theme,
  Typeface,
} from './schema.js';

/**
 * **The product's default theme** (themes 1, ruling R3): the theme every environment is given, and
 * every publication is set from until TPL lets a template bind another. As data - a `theme/1` and its
 * six `catalogue/1` versions - which the store seeds as literals and a test recomputes from here.
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
 * The six catalogue versions the theme binds, by the artifact-version identifier the store seeds each
 * under: fixed, because the theme's own content names them and the migration writes both as literals.
 */
export const DEFAULT_CATALOGUE_VERSIONS: Readonly<Record<CatalogueKind, string>> = {
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

/** STIX Two Math 2.13 b171: one face, in a 1000-unit em. */
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
 * The paragraph catalogue. Every heading keeps with what follows it, as template 11's `sticky` did;
 * widow control is on and hyphenation off, which is what the engine did with template 11's left-aligned
 * text (the widow and orphan costs at their default of 100%, and `hyphenate: auto` hyphenating only
 * justified text).
 */
const paragraph: ParagraphCatalogue = {
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
const character: CharacterCatalogue = {
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
const table: TableCatalogue = {
  schemaVersion: 1,
  kind: 'table',
  styles: [{ id: 'table', name: 'Table', appliesTo: ['table'] }],
};

const image: ImageCatalogue = {
  schemaVersion: 1,
  kind: 'image',
  styles: [
    { id: 'figure', name: 'Figure', appliesTo: ['figure'] },
    { id: 'inline', name: 'Inline image', appliesTo: ['inlineImage'] },
  ],
};

/** Nothing to style yet (TH-C): STY-003 asks for the six, and an empty catalogue costs a row. */
const admonition: AdmonitionCatalogue = { schemaVersion: 1, kind: 'admonition', styles: [] };
const citation: CitationCatalogue = { schemaVersion: 1, kind: 'citation', styles: [] };

/** The six catalogues' contents, by kind. */
export const DEFAULT_CATALOGUES: {
  readonly paragraph: ParagraphCatalogue;
  readonly character: CharacterCatalogue;
  readonly table: TableCatalogue;
  readonly image: ImageCatalogue;
  readonly admonition: AdmonitionCatalogue;
  readonly citation: CitationCatalogue;
} = { paragraph, character, table, image, admonition, citation };

/** The same six, by the version identifier the theme names each by: what `readTheme` is handed. */
export const DEFAULT_CATALOGUES_BY_VERSION: ReadonlyMap<string, unknown> = new Map(
  (Object.keys(DEFAULT_CATALOGUE_VERSIONS) as CatalogueKind[]).map((kind) => [
    DEFAULT_CATALOGUE_VERSIONS[kind],
    DEFAULT_CATALOGUES[kind],
  ]),
);

/** The default theme's content, `theme/1`. */
export const DEFAULT_THEME: Theme = {
  schemaVersion: 1,
  name: 'Default',
  paper: '#ffffff',
  typefaces: [serif, mono, maths],
  maths: 'maths',
  catalogues: { ...DEFAULT_CATALOGUE_VERSIONS },
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
