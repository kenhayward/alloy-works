// Prints what axe could not decide in each state the browser suite checked, from the report the last
// `pnpm test:browser` wrote, for the WCAG audit a person makes before a release
// (docs/guides/auditing-a-release.md). It reads the report; it runs nothing.
import { readFileSync } from 'node:fs';
import { undecided, type Report } from '../src/undecided.js';

const path = new URL('../../../.trace-results/browser.json', import.meta.url);
let report: Report;
try {
  report = JSON.parse(readFileSync(path, 'utf8')) as Report;
} catch {
  console.error('No .trace-results/browser.json: run pnpm test:browser against the stack first.');
  process.exit(1);
}
console.log(undecided(report).join('\n'));
