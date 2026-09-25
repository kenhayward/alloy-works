// Heading styles and numbering shared by M2-M4, M8, M9 (M2's measured setup).
import { p, lvl } from './common.mjs';
export const hstyle = (n, name, withLvl) =>
  `<w:style w:type="paragraph" w:styleId="heading-${n}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
  `<w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="${n - 1}"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="200" w:after="90"/>${withLvl ? `<w:outlineLvl w:val="${n - 1}"/>` : ''}</w:pPr>` +
  `<w:rPr><w:b/><w:sz w:val="${n === 1 ? 32 : 26}"/></w:rPr></w:style>`;

export const numbering =
  `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'decimal', '%1', '<w:pStyle w:val="heading-1"/>')}${lvl(1, 'decimal', '%1.%2', '<w:pStyle w:val="heading-2"/>')}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'lowerRoman', '%1')}${lvl(1, 'decimal', '%1.%2')}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'upperLetter', '%1')}${lvl(1, 'decimal', '%1.%2')}</w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="3"/></w:num>`;

export const H = (n, text, numId) =>
  p(
    text,
    `<w:pStyle w:val="heading-${n}"/>${numId ? `<w:numPr><w:ilvl w:val="${n - 1}"/><w:numId w:val="${numId}"/></w:numPr>` : ''}`,
  );
export const CAPTION = `<w:style w:type="paragraph" w:styleId="caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>`;
export const HEADING_STYLES = hstyle(1, 'Heading 1', true) + hstyle(2, 'Heading 2', true);
