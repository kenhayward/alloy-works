// Compact view of a measure JSON: paragraphs, then every other non-empty key.
import { readFileSync } from 'node:fs';
const raw = readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, '');
if (raw.startsWith('ERROR')) {
  console.log(raw);
  process.exit(0);
}
const j = JSON.parse(raw.split('\n')[0]);
console.log(`pages=${j.pages} omaths=${j.omaths}`);
const skip = process.argv.includes('--nopara');
if (!skip)
  for (const p of [].concat(j.paragraphs))
    console.log(
      `  p${p.page} y=${p.y} x=${p.x} [${p.style}] o=${p.outline} ${p.list ? '{' + p.list + '} ' : ''}lang=${p.lang} ${p.font}/${p.size} | ${p.text}`,
    );
for (const [k, v] of Object.entries(j)) {
  if (['paragraphs', 'version', 'pages', 'omaths'].includes(k)) continue;
  const arr = [].concat(v ?? []);
  if (!arr.length) continue;
  console.log(k + ':');
  for (const x of arr) console.log('  ' + JSON.stringify(x));
}
