// Build a .docx from its parts. Probe kit only - never product code.
import {
  zipSync,
  strToU8,
} from '../../node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/esm/index.mjs';
import { writeFileSync } from 'node:fs';

export const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ' +
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.';

/**
 * parts: { body, styles, numbering?, footnotes?, settings?, headers?: {id: {kind:'header'|'footer', xml}},
 *          media?: {name: Uint8Array}, extraRels?: [id, type, target][] }
 */
export function docx(path, parts) {
  const {
    body,
    styles = '',
    numbering = '',
    footnotes = '',
    settings = '',
    headers = {},
    media = {},
    extraRels = [],
    files: extraFiles = {},
    overrides: extraOverrides = [],
    defaults = [],
  } = parts;
  const rels = [
    ['rStyles', REL + 'styles', 'styles.xml'],
    ['rSettings', REL + 'settings', 'settings.xml'],
  ];
  const overrides = [
    ['/word/document.xml', CT + 'document.main+xml'],
    ['/word/styles.xml', CT + 'styles+xml'],
    ['/word/settings.xml', CT + 'settings+xml'],
  ];
  const files = {};
  const part = (name, root, inner) =>
    (files['word/' + name] = strToU8(DECL + `<${root} ${NS}>${inner}</${root}>`));
  part('document.xml', 'w:document', `<w:body>${body}</w:body>`);
  part('styles.xml', 'w:styles', styles);
  part('settings.xml', 'w:settings', settings);
  if (numbering) {
    part('numbering.xml', 'w:numbering', numbering);
    rels.push(['rNumbering', REL + 'numbering', 'numbering.xml']);
    overrides.push(['/word/numbering.xml', CT + 'numbering+xml']);
  }
  if (footnotes) {
    part('footnotes.xml', 'w:footnotes', footnotes);
    rels.push(['rFootnotes', REL + 'footnotes', 'footnotes.xml']);
    overrides.push(['/word/footnotes.xml', CT + 'footnotes+xml']);
  }
  for (const [id, { kind, xml }] of Object.entries(headers)) {
    part(`${id}.xml`, kind === 'header' ? 'w:hdr' : 'w:ftr', xml);
    rels.push([id, REL + kind, `${id}.xml`]);
    overrides.push([`/word/${id}.xml`, CT + kind + '+xml']);
  }
  for (const [name, bytes] of Object.entries(media)) files['word/media/' + name] = bytes;
  rels.push(...extraRels);
  // Probe extension: arbitrary extra package files, content-type overrides and defaults (e.g. fontTable, fonts).
  for (const [name, bytes] of Object.entries(extraFiles))
    files[name] = typeof bytes === 'string' ? strToU8(bytes) : bytes;
  overrides.push(...extraOverrides);
  files['[Content_Types].xml'] = strToU8(
    DECL +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      defaults.map(([e, t]) => `<Default Extension="${e}" ContentType="${t}"/>`).join('') +
      overrides.map(([n, t]) => `<Override PartName="${n}" ContentType="${t}"/>`).join('') +
      '</Types>',
  );
  files['_rels/.rels'] = strToU8(
    DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `<Relationship Id="rDoc" Type="${REL}officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  files['word/_rels/document.xml.rels'] = strToU8(
    DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      rels
        .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
        .join('') +
      '</Relationships>',
  );
  writeFileSync(path, zipSync(files));
}

export const run = (text, rpr = '') =>
  `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
export const para = (content, ppr = '') =>
  `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${content}</w:p>`;
export const p = (text, ppr = '', rpr = '') => para(run(text, rpr), ppr);
export const style = (id, ppr = '', rpr = '', extra = '') =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/>${extra}${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}</w:style>`;
export const NORMAL =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Liberation Serif" w:hAnsi="Liberation Serif" w:cs="Liberation Serif"/><w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>';
export const sect = (extra = '') =>
  `<w:sectPr>${extra}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
