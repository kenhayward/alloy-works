// M6 - a table style (borders, cell margins, firstRow/firstCol/band1Horz), a repeating header row,
// a cantSplit row taller than a page, and tblCaption/tblDescription.
import { docx, p, sect, NORMAL, COMPAT15, OUT } from './common.mjs';

const B = (side) => `<w:${side} w:val="single" w:sz="8" w:space="0" w:color="000000"/>`;
const shd = (fill) => `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;
const styles =
  NORMAL +
  `<w:style w:type="table" w:styleId="table"><w:name w:val="Table"/><w:tblPr><w:tblStyleRowBandSize w:val="1"/>` +
  `<w:tblBorders>${B('top')}${B('left')}${B('bottom')}${B('right')}${B('insideH')}${B('insideV')}</w:tblBorders>` +
  `<w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
  `<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr><w:tcPr>${shd('D9E2F3')}</w:tcPr></w:tblStylePr>` +
  `<w:tblStylePr w:type="firstCol"><w:tcPr>${shd('E2EFD9')}</w:tcPr></w:tblStylePr>` +
  `<w:tblStylePr w:type="band1Horz"><w:tcPr>${shd('FFF2CC')}</w:tcPr></w:tblStylePr>` +
  `</w:style>`;

const tc = (text) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
const tr = (cells, trPr = '') => `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}${cells}</w:tr>`;
const tbl = (rows, extra = '') =>
  `<w:tbl><w:tblPr><w:tblStyle w:val="table"/><w:tblW w:w="5000" w:type="pct"/>` +
  `<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>${extra}</w:tblPr>` +
  `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows}</w:tbl>`;

let rows = tr(tc('Name') + tc('Value') + tc('Note'), '<w:tblHeader/>');
for (let i = 1; i <= 60; i++)
  rows += tr(tc('Row ' + i) + tc(String(i * 7)) + tc('Measured by Ada'));
const long = tbl(
  rows,
  '<w:tblCaption w:val="Values by Ada"/><w:tblDescription w:val="Sixty rows of values that Ada measured."/>',
);

// A second table: header row, then one cantSplit row holding more lines than a page.
let tall = '';
for (let i = 1; i <= 80; i++) tall += p('Tall line ' + i);
const cantSplit = tbl(
  tr(tc('Head A') + tc('Head B') + tc('Head C'), '<w:tblHeader/>') +
    tr(tc('Before') + tc('x') + tc('y')) +
    tr(
      `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${tall}</w:tc>` +
        tc('tall') +
        tc('row'),
      '<w:cantSplit/>',
    ) +
    tr(tc('After') + tc('x') + tc('y')),
);

const body =
  p('Table one follows.') +
  long +
  p('Between the tables.', '<w:pageBreakBefore/>') +
  cantSplit +
  p('After table two.') +
  sect();
docx(OUT + 'm6.docx', { body, styles, settings: COMPAT15 });
