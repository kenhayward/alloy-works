// M13 - background and padding: a paragraph style with a w:shd fill (the preformatted panel's
// #F0F0F0) and padding written as w:pBdr borders in the fill colour with w:space = 6pt, against the
// same style without borders. Two panel paragraphs in a row, then text; each case on its own page.
import { docx, p, sect, NORMAL, COMPAT15, OUT } from './common.mjs';

const FILL = 'F0F0F0';
const side = (s) => `<w:${s} w:val="single" w:sz="4" w:space="6" w:color="${FILL}"/>`;
const BDR = `<w:pBdr>${side('top')}${side('left')}${side('bottom')}${side('right')}</w:pBdr>`;
const SHD = `<w:shd w:val="clear" w:color="auto" w:fill="${FILL}"/>`;
const LINE = '<w:spacing w:before="0" w:after="0" w:line="287" w:lineRule="atLeast"/>';
const styles =
  NORMAL +
  `<w:style w:type="paragraph" w:styleId="body"><w:name w:val="Body"/><w:pPr><w:spacing w:after="55" w:line="287" w:lineRule="atLeast"/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="panel"><w:name w:val="Panel"/><w:pPr>${BDR}${SHD}<w:spacing w:before="240" w:after="240" w:line="287" w:lineRule="atLeast"/></w:pPr></w:style>` +
  `<w:style w:type="paragraph" w:styleId="panel-nobdr"><w:name w:val="Panel without borders"/><w:pPr>${SHD}<w:spacing w:before="240" w:after="240" w:line="287" w:lineRule="atLeast"/></w:pPr></w:style>` +
  // The same padding with the panel pulled into the text column by indents equal to the padding.
  `<w:style w:type="paragraph" w:styleId="panel-inset"><w:name w:val="Panel inset"/><w:basedOn w:val="panel"/><w:pPr><w:ind w:left="120" w:right="120"/></w:pPr></w:style>`;

const B = (t) => p(t, '<w:pStyle w:val="body"/>');
const P = (id, t, extra = '') => p(t, `<w:pStyle w:val="${id}"/>${extra}`);
const page = (label, id) =>
  p(label, '<w:pageBreakBefore/>' + LINE) +
  B('Text before the panel.') +
  P(id, 'Panel line one, written by Grace.') +
  P(id, 'Panel line two.') +
  B('Text after the panel.');

const body =
  p('M13', LINE) +
  page('case bordered', 'panel') +
  page('case unbordered', 'panel-nobdr') +
  page('case inset', 'panel-inset') +
  // Two panels that must stay two: a different border (w:between) is not written; a body paragraph between them.
  sect();
docx(OUT + 'm13.docx', { body, styles, settings: COMPAT15 });
