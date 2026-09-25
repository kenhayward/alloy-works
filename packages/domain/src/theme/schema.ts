import { z } from 'zod';

import { artifactIdentifierSchema } from '../content/model/identifier.js';
import { PUBLISHED_MARK_ORDER } from '../publishing/published.js';
import { storableEverywhere, storableText } from '../stored/storable.js';

/**
 * A presentation theme and its catalogues, as data (docs/design/themes.md; themes 1, ruling R1).
 *
 * Two stored shapes. A **catalogue** (`catalogue/2`, and `catalogue/1` before it) is one kind's
 * styles; a **theme** (`theme/1`) binds one catalogue of each kind by artifact version, declares its
 * typefaces and its paper, and says which paragraph style each place and each role takes. Both are
 * artifact kinds whose versions are insert-only, so **each shape is closed at every version**: every
 * object is strict at every depth, and whatever a parse accepted a later reader must go on accepting.
 * A property nothing projects yet - small capitals, letter spacing (TH-D) - is refused rather than
 * stored, and arrives with the schema version that reads it, as a table's rules arrived with
 * `catalogue/2`.
 *
 * Every value is typed, and the free text that reaches a renderer - identifiers and family names - is
 * restricted to characters that cannot escape the syntax it is written into (STY-N03): an identifier is
 * a CSS class, a Typst dictionary key and a Word style id verbatim, and a family name is quoted in CSS.
 *
 * **`catalogue/2`** (themes 2, ruling R1) is one new version for every kind. It gives a table style
 * its header row and column, banding, rules, padding and breaks; an image style what it fixes, the
 * most the other dimension may be, its placement and its alignment; and a paragraph style
 * `contextualSpacing`. Every property of a table or image style is required - neither kind inherits,
 * so each style is whole as it stands. `catalogue/1` stays exactly as it was (`catalogueSchema1`),
 * since rows hold it, and the reader upgrades one in memory (`upgradeCatalogue1` in `read.ts`).
 */

export const THEME_SCHEMA_VERSION = 1;
export const CATALOGUE_SCHEMA_VERSION = 2;

/** The six kinds of catalogue (STY-003), fixed: a seventh is a schema version, not a configuration. */
export const CATALOGUE_KINDS = [
  'paragraph',
  'character',
  'table',
  'image',
  'admonition',
  'citation',
] as const;

export type CatalogueKind = (typeof CATALOGUE_KINDS)[number];

/**
 * Where an author's paragraph stands (TH-E). The theme names a default paragraph style for each, and a
 * stored `body` - which the editor has written on every paragraph since the content model was built -
 * means that default, so a footnote is not set at the body's size.
 */
export const PLACES = ['text', 'listItem', 'quotation', 'tableCell', 'footnote'] as const;

export type Place = (typeof PLACES)[number];

/**
 * What the template generates, each set in the paragraph style the theme gives it (TH-E): headings by
 * depth, a deeper one taking `heading6`; the cover's `title` and the draft notice's sentence beneath it;
 * the page's `notice`; the contents' title and entries, and the generated lists' (`list`, `listEntry`);
 * a caption, a table's note, a quotation's attribution, preformatted text and its label, and the
 * running heads and feet. An author cannot choose a role; the template reaches it.
 */
export const ROLES = [
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'title',
  'notice',
  'noticeSentence',
  'contents',
  'contentsEntry',
  'list',
  'listEntry',
  'caption',
  'tableNote',
  'attribution',
  'preformatted',
  'preformattedLabel',
  'running',
] as const;

export type Role = (typeof ROLES)[number];

/** What a paragraph style may apply to: a place or a role (STY-006). */
export type StyleTarget = Place | Role;

/**
 * The marks a character catalogue styles: the nine a published run carries (`PUBLISHED_MARK_ORDER`),
 * one style each. The other marks - a comment, a suggestion, a condition, a defined term - never
 * reach a publication, so nothing styles them.
 */
export const STYLED_MARKS = PUBLISHED_MARK_ORDER;

export type StyledMark = (typeof STYLED_MARKS)[number];

/**
 * The size a subscript or a superscript is set at, as a fraction of the text it stands in. No theme
 * states it: a character style's `position` says only that a mark is lowered or raised. It is Typst
 * 0.15.1's own - `sub` and `super` take `size: auto`, the face's OS/2 subscript and superscript size -
 * which both pinned text faces record as 1331 of their 2048 units, measured from a compiled PDF as a
 * subscript in 11pt Liberation Serif and in 11pt Liberation Mono painted at 7.149pt. Stated here so
 * that the Typst projection hands it to the template, which sets every script at it rather than
 * leaving it to the engine, and so that contrast judges a script at the size it is set at (the final
 * review of themes 1, I3). A script nested in a script takes it twice.
 */
export const SCRIPT_SCALE = 1331 / 2048;

/** What a table style may apply to. */
export const TABLE_TARGETS = ['table'] as const;
/** What an image style may apply to: a figure, or an image in a line of text. */
export const IMAGE_TARGETS = ['figure', 'inlineImage'] as const;

/**
 * Points: the one length unit a theme is written in. None below zero, and none beyond 1584 - 22
 * inches, the most Word holds for an indent - so no value is one an output cannot state.
 */
const points = z.number().min(0).max(1584);

/**
 * A size, in points: above nothing, and at most 144 - two inches. Not Word's own most, 1638: the final
 * review of themes 1 (I1) set a word at 1638pt on an A4 page, and the engine painted it off the page
 * with nothing said, since a line of type is never broken. 144pt is a display size, and a line of it
 * fits the text block of any paper size in use; nothing yet holds a theme's sizes to the page a layout
 * declares, which may be smaller (the final review's M2, left as found). A theme is stored
 * insert-only, so the bound is set here, before any theme but the default is stored, rather than
 * lowered under a stored one.
 */
const size = z.number().positive().max(144);

/**
 * A line spacing, in points: above nothing, and at most 288, twice the largest size. That it is no
 * less than its style's size is the reader's to say, since a style inherits the two apart (I2).
 */
const lineSpacing = z.number().positive().max(288);

/** sRGB as lower-case hex. One spelling, so no projection ever has to normalise. */
const colour = z.string().regex(/^#[0-9a-f]{6}$/, 'not a colour as #rrggbb');

/**
 * A stable style identifier (STY-005). Restricted so that it is safe verbatim as a CSS class, a Typst
 * dictionary key and a Word style id - every projection keys on it without escaping.
 */
export const styleIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'not a style identifier');

/** A typeface's identifier within its theme, spelled as a style's is. */
const typefaceIdSchema = styleIdSchema;

/** A family name as the font files declare it: letters, digits, spaces, and `.`, `_`, `-`. */
const familyName = z.string().regex(/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,62}$/u, 'not a family name');

/** A name a person reads - a style's, a theme's - which Postgres can store. */
const name = z
  .string()
  .min(1)
  .max(80)
  .refine(storableText, 'holds a character that cannot be stored');

/**
 * Every paragraph property of `catalogue/1`, as a catalogue's `base` states them all (TH-D, STY-008). A
 * style states any of them, and inherits the rest along its `basedOn` chain to the base.
 */
const paragraphPropertyShape1 = {
  /** The identifier of a typeface the theme declares. */
  typeface: typefaceIdSchema,
  size,
  bold: z.boolean(),
  italic: z.boolean(),
  colour,
  /** A fill behind the paragraph, or none: its text then stands on whatever is behind it. */
  background: z.union([colour, z.literal('none')]),
  /**
   * Space between the fill's edge and the text, on every side - preformatted text's panel. Drawn only
   * where there is a fill: with `background` none it sets nothing, since there is no edge to measure
   * from.
   */
  padding: points,
  /** Start and end, never left and right: they follow the text's direction. */
  alignment: z.enum(['start', 'end', 'centre', 'justify']),
  firstLineIndent: points,
  startIndent: points,
  endIndent: points,
  /** Added to the previous block's space after, in every output (STY-050). */
  spaceBefore: points,
  spaceAfter: points,
  /**
   * A minimum distance from baseline to baseline, never a multiple (STY-051), and never less than the
   * size: a line is one em tall, so a line spacing below it would set one line over the next. The
   * reader refuses a resolved style whose line spacing is below its size (`line_spacing_below_size`).
   */
  lineSpacing,
  /**
   * The four pagination-bound properties: set by the PDF and Word, shown in the editor only by
   * preview (STY-037). Widow control on means two lines at least, either side of a break, as Word's.
   */
  keepWithNext: z.boolean(),
  keepTogether: z.boolean(),
  widowControl: z.boolean(),
  hyphenate: z.boolean(),
};

/**
 * Every paragraph property of `catalogue/2`: version 1's, and **contextual spacing** (themes 2, ruling
 * R1), as Word's `w:contextualSpacing` - between two consecutive paragraphs of one style that both ask
 * for it, neither's space before or after is added, so a quotation's own paragraphs stand a line apart
 * while the space around the quotation stays.
 */
const paragraphPropertyShape = {
  ...paragraphPropertyShape1,
  contextualSpacing: z.boolean(),
};

/** A catalogue's base: every property stated, the root every chain ends in. */
export const paragraphBaseSchema = z.strictObject(paragraphPropertyShape);

/** What a style states: any of the properties, none required. */
export const paragraphPropertiesSchema = z.strictObject(paragraphPropertyShape).partial();

const styleTarget = z.enum([...PLACES, ...ROLES]);

/** A list of targets, at least one and each once. */
const targets = <T extends string>(schema: z.ZodType<T>) =>
  z
    .array(schema)
    .min(1)
    .refine((list) => new Set(list).size === list.length, 'names a target twice');

export const paragraphStyleSchema = z.strictObject({
  id: styleIdSchema,
  name,
  basedOn: styleIdSchema.optional(),
  /** Every place or role it may be given (STY-006); anything else is refused, never ignored. */
  appliesTo: targets(styleTarget),
  properties: paragraphPropertiesSchema,
});

/**
 * How a mark renders in this theme (STY-009, STY-010): each property optional, and a stated one
 * overriding the paragraph's. A mark's meaning that is not appearance - a link's target, a quoted
 * phrase's tagging, a language's - stays the template's. The same in both catalogue versions.
 */
export const characterPropertiesSchema = z
  .strictObject({
    bold: z.boolean(),
    italic: z.boolean(),
    underline: z.boolean(),
    colour,
    typeface: typefaceIdSchema,
    position: z.enum(['subscript', 'superscript']),
    /**
     * A size relative to the text the mark stands in, as a fraction of it: inline code at 0.8 of a
     * heading is larger than at 0.8 of a footnote, as template 11's `0.8em` was. From a half to twice.
     */
    scale: z.number().min(0.5).max(2),
  })
  .partial();

export const characterStyleSchema = z.strictObject({
  id: styleIdSchema,
  name,
  /** The one mark it styles, which is what it applies to. */
  mark: z.enum(STYLED_MARKS),
  properties: characterPropertiesSchema,
});

/**
 * A rule a table draws: a width in points and a colour, or none. From a quarter of a point, the finest
 * line a printer holds, to twelve, far past any rule a table is ruled with.
 */
const ruleSchema = z.union([
  z.literal('none'),
  z.strictObject({ width: z.number().min(0.25).max(12), colour }),
]);

/** A fill behind a header or a band, or none: the text then stands on the paper. */
const fill = z.union([colour, z.literal('none')]);

/**
 * How a header row or a header column is set: its fill, whether its text is bold - bold as the
 * contrast rule judges it, and bold over whatever the cell's paragraph style says - and the rule it
 * draws on its body side, below the row or after the column, over the table's own rules.
 */
const headerSchema = z.strictObject({ fill, bold: z.boolean(), rule: ruleSchema });

/**
 * **A table style** (STY-076, STY-013; TH-I): its header row and header column, banding on alternate
 * body rows, the outer, horizontal and vertical rules, the cells' padding on every side, and how it
 * breaks across pages - whether the header repeats on each page it crosses, whether a row is kept
 * whole, and whether a continued page carries a label, whose words are the layout's
 * (`words.continued`), since a theme has no language. Every property required: nothing inherits.
 */
export const tableStyleSchema = z.strictObject({
  id: styleIdSchema,
  name,
  appliesTo: targets(z.enum(TABLE_TARGETS)),
  headerRow: headerSchema,
  headerColumn: headerSchema,
  banding: z.strictObject({ fill }),
  rules: z.strictObject({ outer: ruleSchema, horizontal: ruleSchema, vertical: ruleSchema }),
  /** A cell's inset from its edges, in points, from none to half an inch. */
  padding: z.number().min(0).max(36),
  breaks: z.strictObject({
    repeatHeader: z.boolean(),
    keepRowsWhole: z.boolean(),
    continuationLabel: z.boolean(),
  }),
});

/** The units an image's size is given in (STY-015, STY-017). */
export const IMAGE_UNITS = ['pt', 'measure', 'textHeight', 'em'] as const;

/** A fraction of a whole: above nothing, and at most all of it. */
const fraction = z.number().positive().max(1);

/**
 * An image's size in one dimension: in points; as a fraction of the measure, which only a width can
 * be; as a fraction of the text block's height, which only a height can be; or in ems of the text an
 * inline image stands in, which only an inline image can be. Which unit fits which dimension and which
 * target is the reader's to refuse, by name (`image_unit_wrong_dimension`, `image_unit_not_applicable`),
 * since it depends on the style's other properties. An em is bounded at four: an image in a line is
 * a glyph among glyphs, and at ten ems the style could stand one taller than a small page's text block
 * (the final whole-branch review of themes 2, I2), where `assemble` holds it besides.
 */
const lengthOptions = <T extends z.ZodRawShape>(extra: T) =>
  [
    z.strictObject({ ...extra, value: z.number().positive().max(1584), unit: z.literal('pt') }),
    z.strictObject({ ...extra, value: fraction, unit: z.literal('measure') }),
    z.strictObject({ ...extra, value: fraction, unit: z.literal('textHeight') }),
    z.strictObject({ ...extra, value: z.number().positive().max(4), unit: z.literal('em') }),
  ] as const;

const imageStyleShape = {
  id: styleIdSchema,
  name,
  appliesTo: targets(z.enum(IMAGE_TARGETS)),
  /** The dimension the style fixes and its value (STY-015); the other follows the asset (STY-016). */
  fixed: z.discriminatedUnion('unit', lengthOptions({ dimension: z.enum(['width', 'height']) })),
  /** The most the other dimension may be, in the same units (STY-017). */
  maximum: z.discriminatedUnion('unit', lengthOptions({})),
};

/**
 * **An image style** (STY-015 to STY-018; TH-J): the dimension it fixes and at what, the most the other
 * may be, and whether the image stands in its line, as a block, or floated - to the head or the foot
 * of the page, a band of its own, the only float the engine has. A block or a floated image is aligned
 * start, centre or end within its band; an image in a line of text stands where its text puts it, so
 * an inline style states no alignment, which would do nothing. `inline` only for a style that applies
 * to `inlineImage`, and the other two only for `figure`: the reader's to refuse, by name
 * (`image_placement_not_applicable`).
 */
export const imageStyleSchema = z.discriminatedUnion('placement', [
  z.strictObject({ ...imageStyleShape, placement: z.literal('inline') }),
  z.strictObject({
    ...imageStyleShape,
    placement: z.enum(['block', 'float']),
    alignment: z.enum(['start', 'centre', 'end']),
  }),
]);

const version = z.literal(CATALOGUE_SCHEMA_VERSION);

/**
 * Every catalogue version written at `catalogue/2`. Whether its identifiers are unique, its marks each
 * styled once, its chains unbroken, and an image style's units and placement fit what it fixes and
 * applies to is the reader's (`readCatalogue`), which names each failure by code.
 */
export const catalogueSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      schemaVersion: version,
      kind: z.literal('paragraph'),
      base: paragraphBaseSchema,
      styles: z.array(paragraphStyleSchema),
    }),
    z.strictObject({
      schemaVersion: version,
      kind: z.literal('character'),
      styles: z.array(characterStyleSchema),
    }),
    z.strictObject({
      schemaVersion: version,
      kind: z.literal('table'),
      styles: z.array(tableStyleSchema),
    }),
    z.strictObject({
      schemaVersion: version,
      kind: z.literal('image'),
      styles: z.array(imageStyleSchema),
    }),
    // Nothing to style yet: no admonition exists, and citations arrive with their processor (TH-C).
    z.strictObject({ schemaVersion: version, kind: z.literal('admonition'), styles: z.tuple([]) }),
    z.strictObject({ schemaVersion: version, kind: z.literal('citation'), styles: z.tuple([]) }),
  ])
  .refine(storableEverywhere, 'holds a character that cannot be stored');

/**
 * **`catalogue/1`, frozen**: exactly the parse themes 1 stored rows against, which the reader holds a
 * version 1 row to before it upgrades it. A table or an image style holds an identifier, a name and
 * what it applies to, and a paragraph no contextual spacing. Nothing here may change: a row is
 * insert-only, and whatever this accepted a reader must go on accepting.
 */
const paragraphStyleSchema1 = z.strictObject({
  id: styleIdSchema,
  name,
  basedOn: styleIdSchema.optional(),
  appliesTo: targets(styleTarget),
  properties: z.strictObject(paragraphPropertyShape1).partial(),
});

const version1 = z.literal(1);

export const catalogueSchema1 = z
  .discriminatedUnion('kind', [
    z.strictObject({
      schemaVersion: version1,
      kind: z.literal('paragraph'),
      base: z.strictObject(paragraphPropertyShape1),
      styles: z.array(paragraphStyleSchema1),
    }),
    z.strictObject({
      schemaVersion: version1,
      kind: z.literal('character'),
      styles: z.array(characterStyleSchema),
    }),
    z.strictObject({
      schemaVersion: version1,
      kind: z.literal('table'),
      styles: z.array(
        z.strictObject({ id: styleIdSchema, name, appliesTo: targets(z.enum(TABLE_TARGETS)) }),
      ),
    }),
    z.strictObject({
      schemaVersion: version1,
      kind: z.literal('image'),
      styles: z.array(
        z.strictObject({ id: styleIdSchema, name, appliesTo: targets(z.enum(IMAGE_TARGETS)) }),
      ),
    }),
    z.strictObject({ schemaVersion: version1, kind: z.literal('admonition'), styles: z.tuple([]) }),
    z.strictObject({ schemaVersion: version1, kind: z.literal('citation'), styles: z.tuple([]) }),
  ])
  .refine(storableEverywhere, 'holds a character that cannot be stored');

/** A fraction of the em: how the face's own metrics measure a distance. */
const em = z.number().positive().max(2);

const typefaceFileSchema = z.strictObject({
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'not a SHA-256 in lower-case hex'),
  weight: z.enum(['regular', 'bold']),
  posture: z.enum(['normal', 'italic']),
});

export const typefaceSchema = z.strictObject({
  id: typefaceIdSchema,
  family: familyName,
  /** The face's files, each by its hash (TH-B): the worker holds the files, and refuses others. */
  files: z
    .array(typefaceFileSchema)
    .min(1)
    .refine(
      (files) =>
        new Set(files.map((file) => `${file.weight} ${file.posture}`)).size === files.length,
      'holds two files of one weight and posture',
    ),
  /** The licence the face is held under, as an SPDX identifier (STY-041). */
  licence: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.+-]{0,63}$/, 'not an SPDX identifier'),
  /**
   * Whether that licence permits embedding the face, in a PDF and in a Word document (STY-041). For
   * Word it is false too where the face's outlines are ones Word does not embed - CFF, as STIX Two
   * Math's are (the default theme's 0.3) - since a Word document can carry the face no more then.
   */
  embedding: z.strictObject({ pdf: z.boolean(), word: z.boolean() }),
  /**
   * STY-052: a permitted face for Word output, where this one may not be embedded there. The reader
   * refuses a face with `embedding.word` false that declares none (`typeface_word_face_missing`).
   */
  wordFamily: familyName.optional(),
  /**
   * Vertical metrics, as fractions of the em, from the face's own tables. They place the baseline
   * inside a line: Word puts a line's extra space above it and its baseline one descender above the
   * line's foot, and matching that in CSS and Typst needs these numbers (STY-054).
   */
  ascent: em,
  descent: em,
  /** A monospaced face's advance, in ems: what a column of preformatted text is measured by. */
  advance: em.optional(),
});

/** Every theme version, as it is stored. Whether its references resolve is the reader's. */
export const themeSchema = z
  .strictObject({
    schemaVersion: z.literal(THEME_SCHEMA_VERSION),
    name,
    paper: colour,
    typefaces: z.array(typefaceSchema).min(1),
    /** The typeface every equation is set in. */
    maths: typefaceIdSchema,
    /** One catalogue of each kind, by artifact version (STY-024): immutable, so the theme's version says them all. */
    catalogues: z.strictObject(
      Object.fromEntries(CATALOGUE_KINDS.map((kind) => [kind, artifactIdentifierSchema])) as Record<
        CatalogueKind,
        typeof artifactIdentifierSchema
      >,
    ),
    places: z.strictObject(
      Object.fromEntries(PLACES.map((place) => [place, styleIdSchema])) as Record<
        Place,
        typeof styleIdSchema
      >,
    ),
    roles: z.strictObject(
      Object.fromEntries(ROLES.map((role) => [role, styleIdSchema])) as Record<
        Role,
        typeof styleIdSchema
      >,
    ),
  })
  .refine(storableEverywhere, 'holds a character that cannot be stored');

export type Catalogue = z.infer<typeof catalogueSchema>;
export type ParagraphCatalogue = Extract<Catalogue, { kind: 'paragraph' }>;
export type CharacterCatalogue = Extract<Catalogue, { kind: 'character' }>;
export type TableCatalogue = Extract<Catalogue, { kind: 'table' }>;
export type ImageCatalogue = Extract<Catalogue, { kind: 'image' }>;
export type AdmonitionCatalogue = Extract<Catalogue, { kind: 'admonition' }>;
export type CitationCatalogue = Extract<Catalogue, { kind: 'citation' }>;
export type Theme = z.infer<typeof themeSchema>;
export type Typeface = z.infer<typeof typefaceSchema>;
export type ParagraphProperties = z.infer<typeof paragraphPropertiesSchema>;
export type ResolvedParagraphProperties = z.infer<typeof paragraphBaseSchema>;
export type CharacterProperties = z.infer<typeof characterPropertiesSchema>;
export type ParagraphStyle = z.infer<typeof paragraphStyleSchema>;
export type CharacterStyle = z.infer<typeof characterStyleSchema>;
export type TableStyle = z.infer<typeof tableStyleSchema>;
export type ImageStyle = z.infer<typeof imageStyleSchema>;
/** A rule a table style draws, or `none`. */
export type TableRule = TableStyle['rules']['outer'];
/** An image's size in one dimension, as an image style gives it. */
export type ImageLength = ImageStyle['maximum'];

/** A catalogue as `catalogue/1` stored it: what the default theme's 0.1 rows hold, frozen. */
export type Catalogue1 = z.infer<typeof catalogueSchema1>;
export type ParagraphCatalogue1 = Extract<Catalogue1, { kind: 'paragraph' }>;
export type CharacterCatalogue1 = Extract<Catalogue1, { kind: 'character' }>;
export type TableCatalogue1 = Extract<Catalogue1, { kind: 'table' }>;
export type ImageCatalogue1 = Extract<Catalogue1, { kind: 'image' }>;
export type AdmonitionCatalogue1 = Extract<Catalogue1, { kind: 'admonition' }>;
export type CitationCatalogue1 = Extract<Catalogue1, { kind: 'citation' }>;
