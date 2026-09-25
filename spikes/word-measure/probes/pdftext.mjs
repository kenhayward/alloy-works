// Print a PDF's text items with baselines (points from the page top) and the real font names.
// Usage: node pdftext.mjs <file.pdf> [--fonts] [--page N]
import { readFileSync } from 'node:fs';
const pdfjs = await import(
  new URL(
    '../../../node_modules/.pnpm/pdfjs-dist@6.3.289/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
    import.meta.url,
  ).href
);
const file = process.argv[2];
const onlyPage = process.argv.includes('--page')
  ? Number(process.argv[process.argv.indexOf('--page') + 1])
  : null;
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 })
  .promise;
const fontsAll = new Set();
for (let n = 1; n <= doc.numPages; n++) {
  if (onlyPage && n !== onlyPage) continue;
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  await page.getOperatorList();
  const tc = await page.getTextContent();
  const names = {};
  for (const it of tc.items) {
    if (!it.fontName || names[it.fontName]) continue;
    try {
      names[it.fontName] = page.commonObjs.get(it.fontName).name;
    } catch {
      names[it.fontName] = it.fontName;
    }
    fontsAll.add(names[it.fontName]);
  }
  if (process.argv.includes('--fonts')) continue;
  console.log(`--- page ${n} (${vp.width}x${vp.height})`);
  for (const it of tc.items) {
    if (!it.str.trim()) continue;
    const [, , , d, e, f] = it.transform;
    console.log(
      `${(vp.height - f).toFixed(2).padStart(8)} x=${e.toFixed(2).padStart(7)} sz=${Math.abs(d).toFixed(2)} ${names[it.fontName]} | ${it.str}`,
    );
  }
}
console.log('fonts: ' + [...fontsAll].join(', '));
