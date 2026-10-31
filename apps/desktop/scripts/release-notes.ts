import { readFileSync } from 'node:fs';

import { notesFor } from '../src/release-notes.js';

// The release workflow's notes: `tsx scripts/release-notes.ts <CHANGELOG.md> <version>` prints the
// version's entry, or fails the release where there is none.
const [changelog, version] = process.argv.slice(2);
if (changelog === undefined || version === undefined) {
  throw new Error('Usage: release-notes <CHANGELOG.md> <version>');
}
process.stdout.write(`${notesFor(readFileSync(changelog, 'utf8'), version)}\n`);
