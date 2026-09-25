// M9 - contents and a list of figures as TOC fields before the body, prefilled (a) empty and
// (b) with entries but no page numbers; the body spreads headings and captions over pages.
import { docx, p, para, run, sect, NORMAL, COMPAT15, OUT, fld } from './common.mjs';
import { H, numbering, HEADING_STYLES, CAPTION } from './headings.mjs';

const PB = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const cap = (chap, n, text) =>
  para(
    run('Figure ') +
      fld('STYLEREF 1 /s', chap) +
      run('.') +
      fld('SEQ Figure /* ARABIC /s 1', String(n)) +
      run(' ' + text),
    '<w:pStyle w:val="caption"/>',
  );
const TOCSTYLES =
  [1, 2]
    .map(
      (n) =>
        `<w:style w:type="paragraph" w:styleId="TOC${n}"><w:name w:val="toc ${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="${(n - 1) * 220}"/></w:pPr></w:style>`,
    )
    .join('') +
  `<w:style w:type="paragraph" w:styleId="TableofFigures"><w:name w:val="table of figures"/><w:basedOn w:val="Normal"/></w:style>`;

// A multi-paragraph field: begin + instr + separate in the first paragraph, end in the last.
const fieldBlock = (code, entries, styleId) => {
  if (!entries.length) return para(fld(code, ''));
  const begin = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code.replace(/ \/([a-z])/g, (_, c) => ' ' + String.fromCharCode(92) + c)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
  return entries
    .map((e, i) =>
      para(
        (i === 0 ? begin : '') +
          run(e) +
          (i === entries.length - 1 ? '<w:r><w:fldChar w:fldCharType="end"/></w:r>' : ''),
        `<w:pStyle w:val="${styleId}"/>`,
      ),
    )
    .join('');
};

const build = (prefill) =>
  p('Contents') +
  fieldBlock(
    'TOC /o "1-3" /h /z /u',
    prefill ? ['1 Introduction', '1.1 Scope', '2 Method', 'A Tables of values'] : [],
    'TOC1',
  ) +
  p('List of figures') +
  fieldBlock(
    'TOC /h /z /c "Figure"',
    prefill
      ? ['Figure 1.1 First figure', 'Figure 2.1 Second figure', 'Figure A.1 Appendix figure']
      : [],
    'TableofFigures',
  ) +
  PB +
  H(1, 'Introduction') +
  p('Text.') +
  cap('1', 1, 'First figure') +
  PB +
  H(2, 'Scope') +
  p('Text.') +
  PB +
  H(1, 'Method') +
  cap('2', 1, 'Second figure') +
  PB +
  H(1, 'Tables of values', 3) +
  cap('A', 1, 'Appendix figure') +
  sect();

const styles = NORMAL + HEADING_STYLES + CAPTION + TOCSTYLES;
docx(OUT + 'm9-empty.docx', { body: build(false), styles, numbering, settings: COMPAT15 });
docx(OUT + 'm9-entries.docx', { body: build(true), styles, numbering, settings: COMPAT15 });
