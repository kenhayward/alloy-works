// M2 - heading styles named as Word's built-ins, and heading numbering (one abstractNum linked from
// the styles, plus per-matter numbering as direct numPr).
import { docx, p, para, sect, NORMAL, COMPAT15, OUT, fld, lvl } from './common.mjs';

const hstyle = (n, name, withLvl) =>
  `<w:style w:type="paragraph" w:styleId="heading-${n}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
  `<w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="${n - 1}"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="200" w:after="90"/>${withLvl ? `<w:outlineLvl w:val="${n - 1}"/>` : ''}</w:pPr>` +
  `<w:rPr><w:b/><w:sz w:val="${n === 1 ? 32 : 26}"/></w:rPr></w:style>`;

const numbering =
  `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'decimal', '%1', '<w:pStyle w:val="heading-1"/>')}${lvl(1, 'decimal', '%1.%2', '<w:pStyle w:val="heading-2"/>')}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'lowerRoman', '%1')}${lvl(1, 'decimal', '%1.%2')}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'upperLetter', '%1')}${lvl(1, 'decimal', '%1.%2')}</w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="3"/></w:num>`;

const H = (n, text, numId) =>
  p(
    text,
    `<w:pStyle w:val="heading-${n}"/>${numId ? `<w:numPr><w:ilvl w:val="${n - 1}"/><w:numId w:val="${numId}"/></w:numPr>` : ''}`,
  );
const T = (t) => p(t);
const toc = para(fld('TOC /o "1-3" /h /z /u', '')) + p('---') + para(fld('TOC /o "1-3" /h', ''));

const body =
  toc +
  H(1, 'Preface by Ada', 2) +
  T('Front text.') +
  H(1, 'Foreword by Grace', 2) +
  T('Front text.') +
  H(1, 'Introduction') +
  T('Body text.') +
  H(2, 'Scope') +
  H(2, 'Terms') +
  H(1, 'Method') +
  H(2, 'Samples') +
  H(1, 'Tables of values', 3) +
  H(2, 'First values', 3) +
  H(2, 'Second values', 3) +
  H(1, 'Glossary', 3) +
  sect();

for (const [name, h1, h2, withLvl] of [
  ['m2-named', 'Heading 1', 'Heading 2', true],
  ['m2-nolvl', 'Heading 1', 'Heading 2', false],
  ['m2-lowercase', 'heading 1', 'heading 2', false],
  ['m2-other', 'Section Heading', 'Subsection Heading', true],
]) {
  docx(OUT + name + '.docx', {
    body,
    styles: NORMAL + hstyle(1, h1, withLvl) + hstyle(2, h2, withLvl),
    numbering,
    settings: COMPAT15,
  });
}
