// M7 - figures and images: inline with docPr descr; floated at the margin's top and bottom,
// wrapTopAndBottom, anchored halfway down a page; the decorative flag in docPr's extLst.
import { docx, p, para, sect, NORMAL, COMPAT15, OUT } from './common.mjs';
import { solidPng } from './png.mjs';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const CX = 1828800,
  CY = 914400; // 144pt x 72pt
const graphic = (id, rid) =>
  `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="img${id}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${CX}" cy="${CY}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
const DECOR =
  '<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>';
const docPr = (id, descr, decorative) =>
  `<wp:docPr id="${id}" name="Picture ${id}"${descr ? ` descr="${descr}"` : ''}>${decorative ? DECOR : ''}</wp:docPr>`;
const inline = (id, rid, descr, decorative = false) =>
  `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${CX}" cy="${CY}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${docPr(id, descr, decorative)}` +
  `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>${graphic(id, rid)}</wp:inline></w:drawing></w:r>`;
const anchor = (id, rid, descr, align) =>
  `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0">` +
  `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="margin"><wp:align>${align}</wp:align></wp:positionV>` +
  `<wp:extent cx="${CX}" cy="${CY}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapTopAndBottom/>${docPr(id, descr)}<wp:cNvGraphicFramePr/>${graphic(id, rid)}</wp:anchor></w:drawing></w:r>`;

const filler = (tag, n) =>
  Array.from({ length: n }, (_, i) =>
    p(`${tag} line ${i + 1} of filler text written for Grace.`),
  ).join('');
const PB = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const body =
  p('Inline figure next:') +
  para(inline(1, 'rImg1', 'A red bar drawn by Ada'), '<w:jc w:val="center"/>') +
  p('Decorative inline next:') +
  para(inline(2, 'rImg2', '', true), '<w:jc w:val="center"/>') +
  p('After the decorative image.') +
  PB +
  filler('P2 before', 25) +
  para(
    anchor(3, 'rImg1', 'Float at the top', 'top') +
      '<w:r><w:t>P2 ANCHOR paragraph for the top float.</w:t></w:r>',
  ) +
  filler('P2 after', 10) +
  PB +
  filler('P3 before', 25) +
  para(
    anchor(4, 'rImg2', 'Float at the bottom', 'bottom') +
      '<w:r><w:t>P3 ANCHOR paragraph for the bottom float.</w:t></w:r>',
  ) +
  filler('P3 after', 10) +
  sect();
docx(OUT + 'm7.docx', {
  body,
  styles: NORMAL,
  settings: COMPAT15,
  media: {
    'red.png': solidPng(40, 20, [200, 30, 30]),
    'blue.png': solidPng(40, 20, [30, 60, 200]),
  },
  extraRels: [
    ['rImg1', REL, 'media/red.png'],
    ['rImg2', REL, 'media/blue.png'],
  ],
});
