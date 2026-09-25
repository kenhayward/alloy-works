// Summarise a measure JSON: per paragraph page, y, and the step from the previous paragraph on its page.
import { readFileSync } from 'node:fs';
const j = JSON.parse(
  readFileSync(process.argv[2], 'utf8')
    .replace(/^\uFEFF/, '')
    .split('\n')[0],
);
let prev = null;
for (const p of j.paragraphs) {
  const step = prev && prev.page === p.page ? (p.y - prev.y).toFixed(2) : '';
  console.log(
    `p${p.page} y=${p.y} step=${step} b=${p.before} a=${p.after} [${p.style}] ${p.list ? '{' + p.list + '} ' : ''}${p.text}`,
  );
  prev = p;
}
