// M10 - fonts: Liberation Serif Regular embedded as an obfuscated font (ECMA-376 Part 1 17.8.1: the
// first 32 bytes XORed with the GUID key, byte order reversed), and STIX Two Math (CFF) embedded the
// same way as the maths font; each also without embedding. m10-broken is a control: an unknown element,
// to show how the harness sees a file Word must repair.
import { readFileSync } from 'node:fs';
import { docx, p, para, run, sect, NORMAL, COMPAT15, OUT } from './common.mjs';

const FONTS = new URL('../../../apps/worker/fonts/', import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  '$1',
);
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

export function obfuscate(bytes, guid) {
  const hex = guid.replace(/[{}-]/g, '');
  const key = [];
  for (let i = 0; i < 16; i++) key.push(parseInt(hex.substr(30 - 2 * i, 2), 16));
  const out = new Uint8Array(bytes);
  for (let i = 0; i < 32; i++) out[i] ^= key[i % 16];
  return out;
}

const embed = (fonts) => {
  // fonts: [{ name, file, guid, extra }]
  const table = fonts
    .map(
      (f, i) =>
        `<w:font w:name="${f.name}">${f.extra ?? ''}<w:embedRegular r:id="rFont${i}" w:fontKey="${f.guid}"/></w:font>`,
    )
    .join('');
  const files = {
    'word/fontTable.xml': DECL + `<w:fonts ${W}>${table}</w:fonts>`,
    'word/_rels/fontTable.xml.rels':
      DECL +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      fonts
        .map(
          (f, i) =>
            `<Relationship Id="rFont${i}" Type="${REL}font" Target="fonts/font${i}.odttf"/>`,
        )
        .join('') +
      '</Relationships>',
  };
  fonts.forEach(
    (f, i) =>
      (files[`word/fonts/font${i}.odttf`] = obfuscate(readFileSync(FONTS + f.file), f.guid)),
  );
  return {
    files,
    defaults: [['odttf', 'application/vnd.openxmlformats-officedocument.obfuscatedFont']],
    overrides: [
      [
        '/word/fontTable.xml',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml',
      ],
    ],
    extraRels: [['rFontTable', REL + 'fontTable', 'fontTable.xml']],
  };
};

const SERIF = {
  name: 'Liberation Serif',
  file: 'LiberationSerif-Regular.ttf',
  guid: '{3F2504E0-4F89-11D3-9A0C-0305E82C3301}',
  extra: '<w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/>',
};
const STIX = {
  name: 'STIX Two Math',
  file: 'STIXTwoMath-Regular.otf',
  guid: '{6B29FC40-CA47-1067-B31D-00DD010662DA}',
  extra: '<w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/>',
};

const serifBody =
  p('Ada writes in Liberation Serif: The quick brown fox jumps over the lazy dog 0123456789.') +
  sect();
const SETTINGS_EMBED = '<w:embedTrueTypeFonts/>' + COMPAT15;
docx(OUT + 'm10-serif-embedded.docx', {
  body: serifBody,
  styles: NORMAL,
  settings: SETTINGS_EMBED,
  ...embed([SERIF]),
});
docx(OUT + 'm10-serif-plain.docx', { body: serifBody, styles: NORMAL, settings: COMPAT15 });

const mr = (t, rpr = '') => `<m:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<m:t>${t}</m:t></m:r>`;
const STIXR = '<w:rFonts w:ascii="STIX Two Math" w:hAnsi="STIX Two Math"/>';
const eq = (rpr) =>
  `<m:oMath>${mr('x', rpr)}${mr('=', rpr)}<m:f><m:num>${mr('a', rpr)}</m:num><m:den>${mr('b', rpr)}</m:den></m:f>${mr('+∑', rpr)}</m:oMath>`;
const mathBody =
  para(run('Equation with no run font: ') + eq('')) +
  para(run('Equation with runs in STIX Two Math: ') + eq(STIXR)) +
  para(run('Plain text run set in STIX Two Math: xyz', STIXR)) +
  sect();
const mathPr = (font) => `<m:mathPr><m:mathFont m:val="${font}"/><m:dispDef/></m:mathPr>`;
docx(OUT + 'm10-stix-embedded.docx', {
  body: mathBody,
  styles: NORMAL,
  settings: SETTINGS_EMBED + mathPr('STIX Two Math'),
  ...embed([STIX]),
});
docx(OUT + 'm10-stix-plain.docx', {
  body: mathBody,
  styles: NORMAL,
  settings: COMPAT15 + mathPr('STIX Two Math'),
});
docx(OUT + 'm10-both-embedded.docx', {
  body: serifBody.replace(/<w:sectPr>.*$/, '') + mathBody,
  styles: NORMAL,
  settings: SETTINGS_EMBED + mathPr('STIX Two Math'),
  ...embed([SERIF, STIX]),
});
docx(OUT + 'm10-broken.docx', {
  body: para('<w:bogusElement/>' + run('Control: an unknown element.')) + sect(),
  styles: NORMAL,
  settings: COMPAT15,
});
