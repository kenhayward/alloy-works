import { writeFile } from 'node:fs/promises';
import { coverageOfFiles, FONT_DIRECTORY, renderCoverage } from '../src/node.js';

// Rewrites src/coverage.ts from the pinned files. Run after a pinned file changes; coverage.test.ts
// fails until it has been.
await writeFile(
  new URL('../src/coverage.ts', import.meta.url),
  renderCoverage(await coverageOfFiles(FONT_DIRECTORY)),
);
