// M1 - space between paragraphs, and contextual spacing, with the default theme's quotation values:
// spaceBefore 16.5pt (330 twips), spaceAfter 12.65pt (253), lineSpacing 14.35pt (287, atLeast),
// contextualSpacing true; body spaceAfter 2.75pt (55), contextualSpacing false.
import { docx, p, sect, NORMAL, COMPAT15, OUT } from './common.mjs';

const LINE = '<w:spacing w:line="287" w:lineRule="atLeast"/>';
const styles =
  NORMAL +
  `<w:style w:type="paragraph" w:styleId="body"><w:name w:val="Body"/><w:pPr><w:spacing w:before="0" w:after="55" w:line="287" w:lineRule="atLeast"/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="quotation"><w:name w:val="Quotation"/><w:basedOn w:val="body"/><w:pPr><w:spacing w:before="330" w:after="253" w:line="287" w:lineRule="atLeast"/><w:contextualSpacing/><w:ind w:left="220" w:right="220"/></w:pPr></w:style>`;

const Q = (text, extra = '') => p(text, `<w:pStyle w:val="quotation"/>${extra}`);
const B = (text) => p(text, '<w:pStyle w:val="body"/>');
const OFF = '<w:contextualSpacing w:val="0"/>';
const head = (label) => p(label, '<w:pageBreakBefore/>' + LINE);

const cases = [
  ['control', p('A control', LINE) + p('B control', LINE)],
  [
    'a',
    p('A a', '<w:spacing w:after="253" w:line="287" w:lineRule="atLeast"/>') +
      p('B a', '<w:spacing w:before="330" w:line="287" w:lineRule="atLeast"/>'),
  ],
  ['b', Q('A b') + Q('B b')],
  ['c1', Q('A c1') + Q('B c1', OFF)],
  ['c2', Q('A c2', OFF) + Q('B c2')],
  ['c3', Q('A c3', OFF) + Q('B c3', OFF)],
  ['d1', B('T0 d1') + Q('Q1a d1') + Q('Q1b d1') + Q('Q2a d1') + Q('Q2b d1') + B('T1 d1')],
  ['d2', B('T0 d2') + Q('Q1a d2') + Q('Q1b d2', OFF) + Q('Q2a d2', OFF) + Q('Q2b d2') + B('T1 d2')],
  [
    'd3',
    B('T0 d3') +
      Q('Q1a d3', OFF + '<w:spacing w:after="0"/>') +
      Q('Q1b d3', OFF + '<w:spacing w:before="0"/>') +
      Q('Q2a d3', OFF + '<w:spacing w:after="0"/>') +
      Q('Q2b d3', OFF + '<w:spacing w:before="0"/>') +
      B('T1 d3'),
  ],
  ['d4', B('T0 d4') + Q('Q1a d4') + Q('Q1b d4') + Q('Q2a d4', OFF) + Q('Q2b d4') + B('T1 d4')],
  ['d5', B('T0 d5') + Q('Q1a d5') + Q('Q1b d5', OFF) + Q('Q2a d5') + Q('Q2b d5') + B('T1 d5')],
  // d6: every space written on the paragraph below it as the sum STY-050 adds, spaces after zero.
  [
    'd6',
    p('T0 d6', '<w:pStyle w:val="body"/><w:spacing w:after="0"/>') +
      Q('Q1a d6', '<w:spacing w:before="385" w:after="0"/>') +
      Q('Q1b d6', '<w:spacing w:after="0"/>') +
      Q('Q2a d6', OFF + '<w:spacing w:before="583" w:after="0"/>') +
      Q('Q2b d6', '<w:spacing w:after="0"/>') +
      p('T1 d6', '<w:pStyle w:val="body"/><w:spacing w:before="253"/>'),
  ],
  // d7: style values kept; the following quotation's first paragraph off, its before 41.8 (836).
  [
    'd7',
    B('T0 d7') +
      Q('Q1a d7') +
      Q('Q1b d7') +
      Q('Q2a d7', OFF + '<w:spacing w:before="836"/>') +
      Q('Q2b d7') +
      B('T1 d7'),
  ],
  // d8: the style's contextual spacing kept; the last paragraph of a quotation that another follows
  // off with before 0, the first paragraph of the following quotation off with after 0.
  [
    'd8',
    B('T0 d8') +
      Q('Q1a d8') +
      Q('Q1b d8', OFF + '<w:spacing w:before="0"/>') +
      Q('Q2a d8', OFF + '<w:spacing w:after="0"/>') +
      Q('Q2b d8') +
      B('T1 d8'),
  ],
];
const body = cases.map(([k, xml]) => head('case ' + k) + xml).join('') + sect();
docx(OUT + 'm1-compat15.docx', { body, styles, settings: COMPAT15 });
docx(OUT + 'm1-nocompat.docx', { body, styles });
docx(OUT + 'm1-htmlflag.docx', {
  body,
  styles,
  settings: COMPAT15.replace('<w:compat>', '<w:compat><w:doNotUseHTMLParagraphAutoSpacing/>'),
});
