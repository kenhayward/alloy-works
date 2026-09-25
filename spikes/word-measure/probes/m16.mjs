// M16 - the cover in its own section: section 1 the cover only (titlePg, first header "Not approved",
// empty first footer, no pgNumType), section 2 front matter lowerRoman from 1, section 3 body decimal
// from 1. Heading space before at a page top: the same heading after a nextPage section break and
// after a page break, with the heading style's spaceBefore 0 (m16-before0) and 12pt (m16-before12).
import { docx, p, para, run, NORMAL, COMPAT15, OUT, fld, lvl } from './common.mjs';

const MAR =
  '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>';
const PB = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const headers = {
  hFirst: { kind: 'header', xml: p('Not approved') },
  fFirst: { kind: 'footer', xml: p('') },
  hDefault: {
    kind: 'header',
    xml: para(run('Not approved | ') + fld('STYLEREF "Heading 1"', 'x')),
  },
  fDefault: {
    kind: 'footer',
    xml: para(run('Page ') + fld('PAGE', '0') + run(' of ') + fld('NUMPAGES', '0')),
  },
};
const s1 =
  `<w:sectPr><w:headerReference w:type="default" r:id="hDefault"/><w:headerReference w:type="first" r:id="hFirst"/>` +
  `<w:footerReference w:type="default" r:id="fDefault"/><w:footerReference w:type="first" r:id="fFirst"/>${MAR}<w:titlePg/></w:sectPr>`;
const s2 = `<w:sectPr><w:type w:val="nextPage"/>${MAR}<w:pgNumType w:fmt="lowerRoman" w:start="1"/></w:sectPr>`;
const endSect = (sp, text) => `<w:p><w:pPr>${sp}</w:pPr>${run(text)}</w:p>`;

const hstyle = (before) =>
  `<w:style w:type="paragraph" w:styleId="heading-1"><w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>` +
  `<w:pPr><w:keepNext/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:before="${before}" w:after="90"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>`;
const numbering =
  `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'decimal', '%1', '<w:pStyle w:val="heading-1"/>')}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="multilevel"/>${lvl(0, 'lowerRoman', '%1')}</w:abstractNum>` +
  `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>`;
const H = (t, numId) =>
  p(
    t,
    `<w:pStyle w:val="heading-1"/>${numId ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>` : ''}`,
  );

const body =
  p('A Report by Ada', '<w:jc w:val="center"/>') +
  endSect(s1, 'Cover, end of section one.') +
  H('Preface', 2) +
  p('Front page one.') +
  PB +
  p('Front page two.') +
  endSect(s2, 'End of section two.') +
  H('Introduction') +
  p('Body page one, the heading opened a section.') +
  PB +
  H('Method') +
  p('Body page two, the heading followed a page break.') +
  `<w:sectPr><w:type w:val="nextPage"/>${MAR}<w:pgNumType w:fmt="decimal" w:start="1"/></w:sectPr>`;
for (const before of [0, 240]) {
  docx(OUT + `m16-before${before / 20}.docx`, {
    body,
    styles: NORMAL + hstyle(before),
    numbering,
    headers,
    settings: COMPAT15,
  });
}
