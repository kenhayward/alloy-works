import { escapeXml } from '../content/ooxml/xml.js';
import type { PublishedLanguage } from '../publishing/published.js';
import type { ResolvedCharacterStyle, ResolvedParagraphStyle, ResolvedTheme } from './read.js';
import { ROLES, STYLED_MARKS, type StyledMark, type TableStyle, type Typeface } from './schema.js';

/**
 * Word's projection: resolved styles as `word/styles.xml` (PUB-027, docs/design/themes.md, and
 * word-output.md's "Styles are the theme's, all of them, every property").
 *
 * Every paragraph style states every property. `basedOn` is kept so Word's styles pane shows the
 * hierarchy, but nothing is left for Word to inherit: Word's inheritance is not the resolver's, and
 * a Word document that quietly disagrees with its PDF is worse than one whose parent style does not
 * cascade when a recipient edits it. So a property that is off is written off - `w:keepNext
 * w:val="0"`, a border of `nil` - since a parent that has it on would otherwise hand it down.
 *
 * - Spacing in twentieths of a point. Word adds space after to the next space before only under
 *   `w:doNotUseHTMLParagraphAutoSpacing` (measured, M1), which the writer's settings carry; that is
 *   the canonical rule (STY-050), so it is stated as it is.
 * - Line spacing as `atLeast`, never `exact`: exact clips a line holding an inline equation or
 *   image, and the other two targets let such a line grow (STY-051).
 * - Every size as `w:szCs` beside `w:sz`, and weight and posture as `w:bCs` and `w:iCs` beside
 *   `w:b` and `w:i`: a right-to-left run reads the complex-script member, and without `w:szCs` is
 *   set at 10pt (measured, M15).
 * - Start and end, of an alignment and of the indents, as Word's `left` and `right`, which Word reads
 *   as the leading and trailing edge of a right-to-left paragraph (measured for the Word slice): a
 *   style knows no direction, and the one spelling serves a paragraph in either.
 * - Elements in the order the schema requires (CT_PPrBase, CT_RPr), because Word refuses a file
 *   with them out of order rather than reading past them.
 *
 * - Each table style as a Word table style (Word 2, ruling R7; `tableStyle`).
 *
 * **What it does not project**: an image style, which Word has no style for - the writer places and
 * sizes each image by its own (Word 2, ruling R8) - and a mark's `scale`, which is of the text the
 * mark stands in and so cannot be a character style's: `wordRun` sets the size on the run.
 */

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** What the document defaults carry that no style knows: the publication's language and direction. */
export interface WordDocument {
  readonly language: PublishedLanguage;
  readonly direction: 'ltr' | 'rtl';
}

/**
 * A mark's Word style id. Prefixed, because a paragraph style and a character style share Word's one
 * namespace of style ids, and a catalogue's identifiers are unique only within their catalogue.
 */
export function markStyleId(mark: StyledMark): string {
  return `mark-${mark}`;
}

/** A published language as Word's `w:lang` spells it: `en-GB`, or `en` where there is no region. */
export function wordLanguage(language: PublishedLanguage): string {
  return language.region === null ? language.lang : `${language.lang}-${language.region}`;
}

/** The family Word is told to set a face in: its Word face where it declares one (STY-052). */
export function wordFamily(face: Typeface): string {
  return face.wordFamily ?? face.family;
}

/**
 * What the Word writer adds to the theme's styles (Word 1, ruling R7): `headingList`, the `w:numId` of
 * the list the headings are numbered by, which each heading role's style links to at its depth - and
 * from which every other style is taken off, since Word hands a style's number down to a style based
 * on it, as it does an outline level; and `extraStyles`, styles of the writer's own - a contents
 * entry's at each level Word names - written after the theme's. Without either, the projection is the
 * theme's alone.
 */
export interface WordStylesOptions {
  readonly headingList?: number;
  readonly extraStyles?: readonly string[];
}

export function projectStylesXml(
  theme: ResolvedTheme,
  document: WordDocument,
  options: WordStylesOptions = {},
): string {
  const headings = headingDepths(theme);
  const paragraphs = [...theme.paragraphStyles.values()].map((style) =>
    paragraphStyle(style, headings.get(style.id), options.headingList),
  );
  const characters = STYLED_MARKS.map((mark) => characterStyle(theme.characterStyles[mark]));
  // Word keeps one namespace of names across every kind of style.
  const taken = new Set(
    [
      ...[...theme.paragraphStyles.values()].map((style) =>
        wordStyleName(style, headings.get(style.id)),
      ),
      ...STYLED_MARKS.map((mark) => theme.characterStyles[mark].name),
    ].map((name) => name.toLowerCase()),
  );
  const tables = [...theme.tableStyles.values()].map((style) => tableStyle(style, taken));
  const extra = (options.extraStyles ?? []).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<w:styles ${W_NS}>${docDefaults(theme, document)}${paragraphs.join('')}${characters.join('')}${tables.join('')}${extra}</w:styles>`
  );
}

/**
 * A table style's Word style id. Its own spelling, as a mark's is, because Word keeps one namespace of
 * style ids and a catalogue's identifiers are unique only within their catalogue: with a capital
 * letter, which no catalogue identifier holds.
 */
export function tableStyleId(id: string): string {
  return `Table-${id}`;
}

/**
 * **A table style as Word's** (Word 2, ruling R7; measured, M6, M14 and for this slice): the table's
 * outer rule as its borders and the horizontal and vertical ones as the rules inside it, each in
 * eighths of a point, where Word draws the nearest width it has (2pt drew as 2.25pt, measured); the
 * padding as every cell's margins; bands a row high. Then its conditions, which the writer's
 * `w:tblLook` turns on for each table as it has header rows, a header column and a band:
 *
 * - `firstRow`, which Word applies to every header row, measured with two: its fill, its weight, and
 *   its rule, which Word draws below the last header row alone, as the PDF does;
 * - `firstCol`, the first column's: its fill, its weight, and its rule after it;
 * - `band1Horz`, the band: Word counts bands from the first row after the header rows, so band one is
 *   the first body row and every other one after it, the rows template 13 fills (measured; `band2Horz`,
 *   which the plan named from M14, fills the others).
 *
 * A header's weight is stated either way. By Word's toggle rule a bold header sets bold the text of a
 * cell style that is not, and regular the text of one that is, measured - which is why the writer
 * also sets a bold header's runs bold, as template 13 sets them over whatever their style says - and a
 * header stated not bold leaves a bold cell style's text bold and a regular one's regular, as the PDF
 * does (measured). A fill or a rule of `none` is not stated, so that the band and the table's own
 * rules show through it, as they do in the PDF.
 */
function tableStyle(style: TableStyle, taken: ReadonlySet<string>): string {
  const name = taken.has(style.name.toLowerCase()) ? `${style.name} (${style.id})` : style.name;
  const header = (stated: TableStyle['headerRow'], side: 'bottom' | 'right') =>
    `<w:rPr>${toggle('b', stated.bold)}</w:rPr>` +
    (stated.fill === 'none' && stated.rule === 'none'
      ? ''
      : '<w:tcPr>' +
        (stated.rule === 'none'
          ? ''
          : `<w:tcBorders>${tableRule(side, stated.rule)}</w:tcBorders>`) +
        (stated.fill === 'none' ? '' : shading(stated.fill)) +
        '</w:tcPr>');
  const margin = twips(style.padding);
  const { outer, horizontal, vertical } = style.rules;
  return (
    `<w:style w:type="table" w:styleId="${tableStyleId(style.id)}">` +
    `<w:name w:val="${escapeXml(name)}"/>` +
    '<w:tblPr><w:tblStyleRowBandSize w:val="1"/>' +
    '<w:tblBorders>' +
    tableRule('top', outer) +
    tableRule('left', outer) +
    tableRule('bottom', outer) +
    tableRule('right', outer) +
    tableRule('insideH', horizontal) +
    tableRule('insideV', vertical) +
    '</w:tblBorders>' +
    '<w:tblCellMar>' +
    ['top', 'left', 'bottom', 'right']
      .map((side) => `<w:${side} w:w="${margin}" w:type="dxa"/>`)
      .join('') +
    '</w:tblCellMar></w:tblPr>' +
    `<w:tblStylePr w:type="firstRow">${header(style.headerRow, 'bottom')}</w:tblStylePr>` +
    `<w:tblStylePr w:type="firstCol">${header(style.headerColumn, 'right')}</w:tblStylePr>` +
    (style.banding.fill === 'none'
      ? ''
      : `<w:tblStylePr w:type="band1Horz"><w:tcPr>${shading(style.banding.fill)}</w:tcPr></w:tblStylePr>`) +
    '</w:style>'
  );
}

/** Word's widths for a single rule, in eighths of a point: a quarter of a point to twelve. */
const THINNEST_RULE = 2;
const WIDEST_RULE = 96;

/**
 * A table's rule on one side, as a table's and a cell's borders spell it: single, in eighths of a
 * point, or none. The writer draws a cell's own rule the same way.
 */
export function tableRule(side: string, rule: TableStyle['rules']['outer']): string {
  if (rule === 'none') return `<w:${side} w:val="nil"/>`;
  const width = Math.min(WIDEST_RULE, Math.max(THINNEST_RULE, Math.round(rule.width * 8)));
  return `<w:${side} w:val="single" w:sz="${width}" w:space="0" w:color="${hex(rule.colour)}"/>`;
}

/** A cell's fill, as a table style's conditions and the writer's own cells spell it. */
export function shading(colour: string): string {
  return `<w:shd w:val="clear" w:color="auto" w:fill="${hex(colour)}"/>`;
}

/**
 * The defaults every run starts from before its styles: the text's face and size, and the document's
 * language - where a paragraph or a run in a field, a separator or anything else the writer makes
 * without a style of the theme's falls back to. A right-to-left document's language is its complex
 * script's too, which a right-to-left run reads (measured, M12).
 */
function docDefaults(theme: ResolvedTheme, document: WordDocument): string {
  const text = theme.paragraphStyles.get(theme.places.text)!;
  const tag = wordLanguage(document.language);
  return (
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    rFonts(text.typeface) +
    size(text.properties.size) +
    `<w:lang w:val="${tag}"${document.direction === 'rtl' ? ` w:bidi="${tag}"` : ''}/>` +
    '</w:rPr></w:rPrDefault></w:docDefaults>'
  );
}

/**
 * The depth of each style a heading role is set in, by its identifier: a style two heading roles share
 * takes the shallower's. The Word writer asks it too, to know which headings their style numbers.
 */
export function headingDepths(theme: ResolvedTheme): Map<string, number> {
  const depths = new Map<string, number>();
  // In ROLES' order, heading1 first.
  for (const role of ROLES) {
    const depth = /^heading([1-6])$/.exec(role)?.[1];
    const id = theme.roles[role];
    if (depth !== undefined && !depths.has(id)) depths.set(id, Number(depth));
  }
  return depths;
}

/**
 * Word takes a style named "Heading N" as its own built-in Heading N, whatever its identifier and the
 * name's case, with the outline level that gives it a place in a contents field (measured, M2). So
 * the style each heading role is set in is named `Heading 1` to `Heading 6`, whatever the catalogue
 * calls it; and any other style whose catalogue name Word would read as a heading's is given its
 * identifier beside the name, so a caption named "Heading 2" does not find its way into the contents.
 */
function wordStyleName(style: ResolvedParagraphStyle, depth: number | undefined): string {
  if (depth !== undefined) return `Heading ${depth}`;
  return /^heading [1-9]$/i.test(style.name) ? `${style.name} (${style.id})` : style.name;
}

/**
 * Where a background is padded: Word pads a fill by borders in its own colour spaced from the text,
 * and its fill then reaches this much past that spacing - the border's width and more of Word's own,
 * measured for the Word slice at 1.9 to 2.0pt with a half-point border, whatever the spacing. The
 * indents take the padding and this, so the fill stands at the style's own indents, as the PDF's
 * panel does; the text stands this much further in than the PDF's.
 */
const PANEL_REACH = 2;

/**
 * How far in from a style's own indents its text stands in Word: where it has a background, its
 * padding and `PANEL_REACH`, which the projection adds to its indents; otherwise nothing. The Word
 * writer asks it where a container moves a paragraph in from its style's indents (Word 2).
 */
export function panelInset(properties: ResolvedParagraphStyle['properties']): number {
  return properties.background === 'none' ? 0 : properties.padding + PANEL_REACH;
}

/** A border's width in eighths of a point: a half point, as the measurement was made with. */
const PANEL_BORDER = 4;

/** The most Word can space a border from its text, in its whole points (ST_PointMeasure). */
const MOST_BORDER_SPACE = 31;

/**
 * A paragraph style, every property stated. Its outline level too: a heading's is implied by its name,
 * but Word hands it down `basedOn` to a style that is no heading - measured for the Word slice, the
 * default theme's Title and Contents heading, based on Heading 1, read as level 1 headings without
 * it, and a contents field would list them - so a heading role's style states its depth and every
 * other style states body text, 9.
 */
function paragraphStyle(
  style: ResolvedParagraphStyle,
  depth: number | undefined,
  headingList: number | undefined,
): string {
  const p = style.properties;
  const filled = p.background !== 'none';
  const inset = panelInset(p);
  const fill = filled ? hex(p.background) : '';
  const border = (side: string) =>
    filled
      ? `<w:${side} w:val="single" w:sz="${PANEL_BORDER}" ` +
        `w:space="${Math.min(MOST_BORDER_SPACE, Math.round(p.padding))}" w:color="${fill}"/>`
      : `<w:${side} w:val="nil"/>`;
  return (
    `<w:style w:type="paragraph" w:styleId="${style.id}">` +
    `<w:name w:val="${escapeXml(wordStyleName(style, depth))}"/>` +
    (style.basedOn === undefined ? '' : `<w:basedOn w:val="${style.basedOn}"/>`) +
    '<w:qFormat/>' +
    '<w:pPr>' +
    onOff('keepNext', p.keepWithNext) +
    onOff('keepLines', p.keepTogether) +
    onOff('widowControl', p.widowControl) +
    (headingList === undefined
      ? ''
      : depth === undefined
        ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>'
        : `<w:numPr><w:ilvl w:val="${depth - 1}"/><w:numId w:val="${headingList}"/></w:numPr>`) +
    `<w:pBdr>${['top', 'left', 'bottom', 'right'].map(border).join('')}</w:pBdr>` +
    (filled ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '<w:shd w:val="nil"/>') +
    onOff('suppressAutoHyphens', !p.hyphenate) +
    `<w:spacing w:before="${twips(p.spaceBefore)}" w:after="${twips(p.spaceAfter)}" ` +
    `w:line="${twips(p.lineSpacing)}" w:lineRule="atLeast"/>` +
    `<w:ind w:left="${twips(p.startIndent + inset)}" w:right="${twips(p.endIndent + inset)}" ` +
    `w:firstLine="${twips(p.firstLineIndent)}"/>` +
    onOff('contextualSpacing', p.contextualSpacing) +
    `<w:jc w:val="${JUSTIFICATION[p.alignment]}"/>` +
    `<w:outlineLvl w:val="${depth === undefined ? 9 : depth - 1}"/>` +
    '</w:pPr>' +
    '<w:rPr>' +
    rFonts(style.typeface) +
    toggle('b', p.bold) +
    toggle('i', p.italic) +
    `<w:color w:val="${hex(p.colour)}"/>` +
    size(p.size) +
    '</w:rPr>' +
    '</w:style>'
  );
}

const JUSTIFICATION = { start: 'left', end: 'right', centre: 'center', justify: 'both' } as const;

/**
 * A mark's character style states only what the mark states: an unstated property leaves the text's
 * alone, in Word as in the theme. A scale is not among them (see the top of this file).
 */
function characterStyle(style: ResolvedCharacterStyle): string {
  const { bold, italic, colour, underline, position } = style.properties;
  return (
    `<w:style w:type="character" w:styleId="${markStyleId(style.mark)}">` +
    `<w:name w:val="${escapeXml(style.name)}"/><w:qFormat/>` +
    '<w:rPr>' +
    (style.typeface === undefined ? '' : rFonts(style.typeface)) +
    (bold === undefined ? '' : toggle('b', bold)) +
    (italic === undefined ? '' : toggle('i', italic)) +
    (colour === undefined ? '' : `<w:color w:val="${hex(colour)}"/>`) +
    (underline === undefined ? '' : `<w:u w:val="${underline ? 'single' : 'none'}"/>`) +
    (position === undefined ? '' : `<w:vertAlign w:val="${position}"/>`) +
    '</w:rPr>' +
    '</w:style>'
  );
}

/**
 * A face, a toggle, a size and a colour as the styles spell them - and so as the Word writer spells a
 * value it pins on a run (`wordRun`), in pairs where Word reads a complex script's apart.
 */
export function rFonts(face: Typeface): string {
  const family = escapeXml(wordFamily(face));
  return `<w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}" w:eastAsia="${family}"/>`;
}

/** A toggle property and its complex-script twin, stated either way. */
export function toggle(name: 'b' | 'i', on: boolean): string {
  const value = on ? 1 : 0;
  return `<w:${name} w:val="${value}"/><w:${name}Cs w:val="${value}"/>`;
}

/** An on-off paragraph property: bare where on, as Word writes it, and `0` where off. */
function onOff(name: string, on: boolean): string {
  return on ? `<w:${name}/>` : `<w:${name} w:val="0"/>`;
}

export function size(points: number): string {
  return `<w:sz w:val="${halfPoints(points)}"/><w:szCs w:val="${halfPoints(points)}"/>`;
}

export function hex(colour: string): string {
  return colour.slice(1).toUpperCase();
}

function twips(points: number): number {
  return Math.round(points * 20);
}

function halfPoints(points: number): number {
  return Math.round(points * 2);
}
