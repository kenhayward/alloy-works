// M14 - even-row banding: M6's table style with the fill on band2Horz only; band1Horz and band2Horz
// with different fills; band2Horz with tblStyleRowBandSize 2; band2Horz with no tblStyleRowBandSize.
// One header row (w:tblHeader, firstRow) and six body rows.
import { docx, p, sect, NORMAL, COMPAT15, OUT } from './common.mjs';

const B = (side) => `<w:${side} w:val="single" w:sz="8" w:space="0" w:color="000000"/>`;
const shd = (fill) => `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;
const tstyle = (id, bandSize, band1, band2) =>
  `<w:style w:type="table" w:styleId="${id}"><w:name w:val="${id}"/><w:tblPr>${bandSize ? `<w:tblStyleRowBandSize w:val="${bandSize}"/>` : ''}` +
  `<w:tblBorders>${B('top')}${B('left')}${B('bottom')}${B('right')}${B('insideH')}${B('insideV')}</w:tblBorders>` +
  `<w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
  `<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr></w:tblStylePr>` +
  (band1 ? `<w:tblStylePr w:type="band1Horz"><w:tcPr>${shd(band1)}</w:tcPr></w:tblStylePr>` : '') +
  (band2 ? `<w:tblStylePr w:type="band2Horz"><w:tcPr>${shd(band2)}</w:tcPr></w:tblStylePr>` : '') +
  `</w:style>`;

const variants = [
  ['band2-only', 1, null, 'FFF2CC'],
  ['band1-and-band2', 1, 'DDEBF7', 'FFF2CC'],
  ['band2-size2', 2, null, 'FFF2CC'],
  ['band2-nosize', 0, null, 'FFF2CC'],
];
const tc = (text) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${p(text)}</w:tc>`;
const table = (id) => {
  let rows = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${tc('Head') + tc('Head') + tc('Head')}</w:tr>`;
  for (let i = 1; i <= 6; i++) rows += `<w:tr>${tc('Body ' + i) + tc('x') + tc('y')}</w:tr>`;
  return (
    p(`Variant ${id}`) +
    `<w:tbl><w:tblPr><w:tblStyle w:val="${id}"/><w:tblW w:w="5000" w:type="pct"/>` +
    `<w:tblLook w:val="0420" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows}</w:tbl>`
  );
};
const styles = NORMAL + variants.map(([id, size, b1, b2]) => tstyle(id, size, b1, b2)).join('');
docx(OUT + 'm14.docx', {
  body: variants.map(([id]) => table(id) + p('')).join('') + sect(),
  styles,
  settings: COMPAT15,
});
