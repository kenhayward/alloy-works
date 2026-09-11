import { escapeXml } from '../content/ooxml/xml.js';
import type { ResolvedParagraphStyle, ResolvedTheme } from './resolve.js';
import { markNames, type CharacterStyle, type MarkName } from './schema.js';

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
 */

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const MARK_STYLE_NAMES: Record<MarkName, string> = { strong: 'Strong', emphasis: 'Emphasis' };

export function markStyleId(mark: MarkName): string {
  return `mark-${mark}`;
}

export function projectStylesXml(theme: ResolvedTheme): string {
  const paragraphs = theme.paragraphStyles.map((style) => paragraphStyle(theme, style));
  const characters = markNames.flatMap((mark) => {
    const style = theme.characterStyles[mark];
    return style === undefined ? [] : [characterStyle(mark, style)];
  });
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<w:styles ${W_NS}>${paragraphs.join('')}${characters.join('')}</w:styles>`
  );
}

function paragraphStyle(theme: ResolvedTheme, style: ResolvedParagraphStyle): string {
  const p = style.properties;
  const face = theme.typefaces[p.typeface];
  if (face === undefined) throw new Error(`Unresolved typeface "${p.typeface}"`);
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

function characterStyle(mark: MarkName, style: CharacterStyle): string {
  const bold = style.bold === undefined ? '' : `<w:b w:val="${style.bold ? 1 : 0}"/>`;
  const italic = style.italic === undefined ? '' : `<w:i w:val="${style.italic ? 1 : 0}"/>`;
  return (
    `<w:style w:type="character" w:styleId="${markStyleId(mark)}">` +
    `<w:name w:val="${MARK_STYLE_NAMES[mark]}"/><w:qFormat/>` +
    `<w:rPr>${bold}${italic}</w:rPr>` +
    '</w:style>'
  );
}

function twips(points: number): number {
  return Math.round(points * 20);
}

function halfPoints(points: number): number {
  return Math.round(points * 2);
}
