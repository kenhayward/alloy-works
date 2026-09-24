import { escapeXml } from '../content/ooxml/xml.js';
import type { ResolvedCharacterStyle, ResolvedParagraphStyle, ResolvedTheme } from './read.js';
import { STYLED_MARKS, type StyledMark } from './schema.js';

/**
 * Word's projection: resolved styles as `word/styles.xml` (PUB-027, docs/design/themes.md).
 *
 * Every paragraph style states every property. `basedOn` is kept so Word's styles pane shows the
 * hierarchy, but nothing is left for Word to inherit: Word's inheritance is not the resolver's, and
 * a Word document that quietly disagrees with its PDF is worse than one whose parent style does not
 * cascade when a recipient edits it.
 *
 * - Spacing in twentieths of a point; Word adds space after to the next space before, which is the
 *   canonical rule (STY-050), so it is stated as it is.
 * - Line spacing as `atLeast`, never `exact`: exact clips a line holding an inline equation or
 *   image, and the other two targets let such a line grow (STY-051).
 * - Elements in the order the schema requires (CT_PPrBase, CT_RPr), because Word refuses a file
 *   with them out of order rather than reading past them.
 *
 * **What it projects is what the prototype projected, no more** (themes 1, ruling R1): a paragraph's
 * keep-with-next, spacing, line spacing, first-line indent, face (or its Word face), weight, posture,
 * colour and size, and a mark's weight and posture under the catalogue's name. **Not yet projected**,
 * until the Word slice: a paragraph's `background` (`w:shd`), `alignment` (`w:jc`), `startIndent` and
 * `endIndent` (the rest of `w:ind`), `keepTogether` (`w:keepLines`), `widowControl`
 * (`w:widowControl`) and `hyphenate` (`w:suppressAutoHyphens`), and a mark's `underline`, `colour`,
 * `typeface` and `position` (`w:u`, `w:color`, `w:rFonts`, `w:vertAlign`) - and a typeface's
 * `embedding.word`, which the Word slice reads to embed a face or report its substitute (STY-052).
 */

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/**
 * A mark's Word style id. Prefixed, because a paragraph style and a character style share Word's one
 * namespace of style ids, and a catalogue's identifiers are unique only within their catalogue.
 */
export function markStyleId(mark: StyledMark): string {
  return `mark-${mark}`;
}

export function projectStylesXml(theme: ResolvedTheme): string {
  const paragraphs = [...theme.paragraphStyles.values()].map(paragraphStyle);
  const characters = STYLED_MARKS.map((mark) => characterStyle(theme.characterStyles[mark]));
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<w:styles ${W_NS}>${paragraphs.join('')}${characters.join('')}</w:styles>`
  );
}

function paragraphStyle(style: ResolvedParagraphStyle): string {
  const p = style.properties;
  const face = style.typeface;
  const family = escapeXml(face.wordFamily ?? face.family);
  return (
    `<w:style w:type="paragraph" w:styleId="${style.id}">` +
    `<w:name w:val="${escapeXml(style.name)}"/>` +
    (style.basedOn === undefined ? '' : `<w:basedOn w:val="${style.basedOn}"/>`) +
    '<w:qFormat/>' +
    '<w:pPr>' +
    (p.keepWithNext ? '<w:keepNext/>' : '') +
    `<w:spacing w:before="${twips(p.spaceBefore)}" w:after="${twips(p.spaceAfter)}" ` +
    `w:line="${twips(p.lineSpacing)}" w:lineRule="atLeast"/>` +
    `<w:ind w:firstLine="${twips(p.firstLineIndent)}"/>` +
    '</w:pPr>' +
    '<w:rPr>' +
    `<w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}" w:eastAsia="${family}"/>` +
    `<w:b w:val="${p.bold ? 1 : 0}"/>` +
    `<w:i w:val="${p.italic ? 1 : 0}"/>` +
    `<w:color w:val="${p.colour.slice(1).toUpperCase()}"/>` +
    `<w:sz w:val="${halfPoints(p.size)}"/>` +
    `<w:szCs w:val="${halfPoints(p.size)}"/>` +
    '</w:rPr>' +
    '</w:style>'
  );
}

function characterStyle(style: ResolvedCharacterStyle): string {
  const { bold, italic } = style.properties;
  return (
    `<w:style w:type="character" w:styleId="${markStyleId(style.mark)}">` +
    `<w:name w:val="${escapeXml(style.name)}"/><w:qFormat/>` +
    '<w:rPr>' +
    (bold === undefined ? '' : `<w:b w:val="${bold ? 1 : 0}"/>`) +
    (italic === undefined ? '' : `<w:i w:val="${italic ? 1 : 0}"/>`) +
    '</w:rPr>' +
    '</w:style>'
  );
}

function twips(points: number): number {
  return Math.round(points * 20);
}

function halfPoints(points: number): number {
  return Math.round(points * 2);
}
