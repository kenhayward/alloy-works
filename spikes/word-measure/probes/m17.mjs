// M17 - a numbered display equation that survives being too wide.
// (a) a borderless one-row, two-cell table: m:oMathPara in the wide first cell, "(SEQ Equation)"
//     right-aligned in a narrow fixed second cell, a bookmark around the SEQ field and a REF to it;
// (b) the same with an equation too wide for its cell;
// (c) Word's own equation-array numbering: m:eqArr, the equation, "#", then "(n)" - short and too wide;
// (d) the fallback: the too-wide m:oMathPara, then the number alone in a right-aligned paragraph.
import { docx, p, para, run, sect, NORMAL, COMPAT15, OUT, fld, bm } from './common.mjs';

const r = (t) => `<m:r><m:t xml:space="preserve">${t.replace(/&/g, '&amp;')}</m:t></m:r>`;
const sSub = (b, s) => `<m:sSub><m:e>${b}</m:e><m:sub>${s}</m:sub></m:sSub>`;
const sSup = (b, s) => `<m:sSup><m:e>${b}</m:e><m:sup>${s}</m:sup></m:sSup>`;
const dparen = (x) =>
  `<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e>${x}</m:e></m:d>`;
const short = r('E') + r('=') + r('m') + sSup(r('c'), r('2'));
const wide =
  r('y') +
  r('=') +
  Array.from(
    { length: 24 },
    (_, k) => sSub(r('a'), r(String(k + 1))) + sSup(r('x'), r(String(k + 1))),
  ).join(r('+'));
const oMathPara = (x) => `<w:p><m:oMathPara><m:oMath>${x}</m:oMath></m:oMathPara></w:p>`;

const NONE = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((s) => `<w:${s} w:val="nil"/>`)
  .join('');
let bmId = 10;
const numberCell = (n, name) =>
  `<w:tc><w:tcPr><w:tcW w:w="900" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
  para(
    run('(') + bm(bmId++, name, fld('SEQ Equation /* ARABIC', '9')) + run(')'),
    '<w:jc w:val="right"/>',
  ) +
  '</w:tc>';
const eqTable = (x, n, name) =>
  `<w:tbl><w:tblPr><w:tblW w:w="9026" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${NONE}</w:tblBorders>` +
  `<w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="8126"/><w:gridCol w:w="900"/></w:tblGrid>` +
  `<w:tr><w:tc><w:tcPr><w:tcW w:w="8126" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>${oMathPara(x)}</w:tc>${numberCell(n, name)}</w:tr></w:tbl>`;
const eqArrNumbered = (x, n) =>
  `<w:p><m:oMathPara><m:oMath><m:eqArr><m:e>${x}${r('#')}${dparen(r(String(n)))}</m:e></m:eqArr></m:oMath></m:oMathPara></w:p>`;

const body =
  p('(a) short equation in a two-cell table:') +
  eqTable(short, 1, '_Ref000000011') +
  p('(b) too wide, in a two-cell table:') +
  eqTable(wide, 2, '_Ref000000012') +
  p('(c) eqArr with # numbering, short:') +
  eqArrNumbered(short, 3) +
  p('(c) eqArr with # numbering, too wide:') +
  eqArrNumbered(wide, 4) +
  p('(d) too wide, number in its own paragraph below:') +
  oMathPara(wide) +
  para(run('(') + fld('SEQ Equation /* ARABIC', '9') + run(')'), '<w:jc w:val="right"/>') +
  para(
    run('References: (a) is ') +
      fld('REF _Ref000000011 /h', '8') +
      run(', (b) is ') +
      fld('REF _Ref000000012 /h', '8') +
      run('.'),
  ) +
  sect();
const mathPr =
  '<m:mathPr><m:mathFont m:val="Cambria Math"/><m:dispDef/><m:wrapIndent m:val="1440"/></m:mathPr>';
docx(OUT + 'm17.docx', { body, styles: NORMAL, settings: COMPAT15 + mathPr });
