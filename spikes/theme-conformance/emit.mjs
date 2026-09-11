// Throwaway harness, run on the host after `pnpm --filter @alloy-works/domain build`.
//
// Resolves the example theme once, projects it three ways, and writes one fixture document in each
// target's form, ready for Docker to render: editor.html (the CSS projection), typst/ (theme.json
// for the template), and word/ (styles.xml plus a document whose runs come from wordRun).
/* global console */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const themeModule = join(here, '..', '..', 'packages', 'domain', 'dist', 'theme', 'index.js');
const t = await import(pathToFileURL(themeModule).href);

const doc = JSON.parse(readFileSync(join(here, 'fixture-document.json'), 'utf8'));
const theme = t.resolveTheme(t.exampleTheme());
const out = join(here, 'out');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'typst'), { recursive: true });

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const token = (line) => line[0].text.split(' ')[0];

// ---- editor.html: the CSS projection, on a canvas at the layout's measure (CNT-115) -------------
function htmlRun(run) {
  let html = esc(run.text);
  const marks = run.marks ?? [];
  if (marks.length > 0) html = `<span data-word="${esc(run.text)}">${html}</span>`;
  for (const mark of [...marks].reverse()) html = `<span class="aw-mark-${mark}">${html}</span>`;
  return html;
}

function htmlLine(line) {
  const [first, ...rest] = line;
  const tok = token(line);
  const head =
    `<span class="m" data-t="${tok}"></span><span data-tok="${tok}">${tok}</span>` +
    esc(first.text.slice(tok.length));
  return head + rest.map(htmlRun).join('');
}

const editor =
  '<!DOCTYPE html>\n<html><head><meta charset="utf-8"/><style>\n' +
  t.projectCss(theme) +
  // A4 less 25mm margins: the measure the Typst and Word pages have.
  'body { margin: 0; }\n.aw-canvas { width: 160mm; padding: 25mm; }\n' +
  '.m { display: inline-block; width: 0; height: 0; vertical-align: baseline; }\n' +
  '</style></head><body><div class="aw-canvas">\n' +
  doc.blocks
    .map((b) => `<p class="aw-p-${b.style}">${b.lines.map(htmlLine).join('<br/>')}</p>`)
    .join('\n') +
  '\n</div></body></html>\n';
writeFileSync(join(out, 'editor.html'), editor);

// ---- Typst: theme.json for the template, the document as data ----------------------------------
writeFileSync(join(out, 'typst', 'theme.json'), JSON.stringify(t.projectTypst(theme), null, 2));
writeFileSync(join(out, 'typst', 'doc.json'), JSON.stringify(doc, null, 2));
copyFileSync(join(here, 'template.typ'), join(out, 'typst', 'template.typ'));

// ---- Word: styles.xml from the projection, runs from wordRun ------------------------------------
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function wordRunXml(paragraph, run) {
  const w = t.wordRun(theme, paragraph, run.marks ?? []);
  const props =
    (w.characterStyle === undefined
      ? ''
      : `<w:rStyle w:val="${t.markStyleId(w.characterStyle)}"/>`) +
    (w.pins.bold === undefined ? '' : `<w:b w:val="${w.pins.bold ? 1 : 0}"/>`) +
    (w.pins.italic === undefined ? '' : `<w:i w:val="${w.pins.italic ? 1 : 0}"/>`);
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
}

const body = doc.blocks
  .map((b) => {
    const paragraph = t.resolveStyle(theme, b.style);
    const lines = b.lines.map((line) => line.map((run) => wordRunXml(paragraph, run)).join(''));
    return `<w:p><w:pPr><w:pStyle w:val="${b.style}"/></w:pPr>${lines.join('<w:r><w:br/></w:r>')}</w:p>`;
  })
  .join('');

const parts = {
  '[Content_Types].xml':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>',
  '_rels/.rels':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>',
  'word/_rels/document.xml.rels':
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>',
  'word/styles.xml': t.projectStylesXml(theme),
  'word/document.xml':
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body}` +
    // A4, 25mm margins: 11906 x 16838 twips, 1417 twips a side.
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>',
};
for (const [name, content] of Object.entries(parts)) {
  const path = join(out, 'word', 'parts', name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
console.log('emitted: editor.html, typst/, word/parts/');
