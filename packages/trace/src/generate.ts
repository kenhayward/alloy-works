// Rewrites trace.json from the requirement and design documents. The file is committed so that a
// change to the corpus is a change in a diff a reviewer reads, and so that an auditor reading a tag
// gets the model without running anything. `trace.test.ts` fails when the two drift apart.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT, compile } from './compile.js';

const file = new URL('../trace.json', import.meta.url);
writeFileSync(file, `${JSON.stringify(compile(REPO_ROOT), null, 2)}\n`);
console.log(`Wrote ${fileURLToPath(file)}`);
