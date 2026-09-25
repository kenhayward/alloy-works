// M8 - page furniture: three sections (front lowerRoman from 1, body decimal from 1, appendix decimal
// continuing), a cover as the front section's title page with its own first-page header, "Not approved"
// in every header beside a STYLEREF "Heading 1" running head, and PAGE / NUMPAGES in the footer.
import { docx, p, para, run, NORMAL, COMPAT15, OUT, fld } from './common.mjs';
import { H, numbering, HEADING_STYLES } from './headings.mjs';

const PB = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const MAR =
  '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>';
const headers = {
  hFirst: { kind: 'header', xml: p('Not approved') + p('[cover header]') },
  hDefault: {
    kind: 'header',
    xml: para(
      run('Not approved | head: ') +
        fld('STYLEREF "Heading 1"', 'x') +
        run(' | with /n: ') +
        fld('STYLEREF "Heading 1" /n', 'x'),
    ),
  },
  fDefault: {
    kind: 'footer',
    xml: para(run('Page ') + fld('PAGE', '0') + run(' of ') + fld('NUMPAGES', '0')),
  },
  fFirst: { kind: 'footer', xml: p('[cover footer]') },
};
const s1 =
  `<w:sectPr><w:headerReference w:type="default" r:id="hDefault"/><w:headerReference w:type="first" r:id="hFirst"/>` +
  `<w:footerReference w:type="default" r:id="fDefault"/><w:footerReference w:type="first" r:id="fFirst"/>${MAR}<w:pgNumType w:fmt="lowerRoman" w:start="1"/><w:titlePg/></w:sectPr>`;
const s2 = `<w:sectPr><w:type w:val="nextPage"/>${MAR}<w:pgNumType w:fmt="decimal" w:start="1"/></w:sectPr>`;
const endSect = (sp, text) => `<w:p><w:pPr>${sp}</w:pPr>${run(text)}</w:p>`;

const body =
  p('A Report by Ada', '<w:jc w:val="center"/>') +
  PB +
  H(1, 'Preface', 2) +
  endSect(s1, 'Front text, end of section one.') +
  H(1, 'Introduction') +
  p('Body page one.') +
  PB +
  p('Body page two, before a heading.') +
  H(1, 'Method') +
  p('Method text.') +
  PB +
  p('Body page three, no heading on it.') +
  endSect(s2, 'End of section two.') +
  H(1, 'Tables of values', 3) +
  p('Appendix page one.') +
  PB +
  p('Appendix page two.') +
  `<w:sectPr><w:type w:val="nextPage"/>${MAR}<w:pgNumType w:fmt="decimal"/></w:sectPr>`;
docx(OUT + 'm8.docx', {
  body,
  styles: NORMAL + HEADING_STYLES,
  numbering,
  headers,
  settings: COMPAT15,
});
