// Rewrites src/interface/content-languages.ts from the pinned CLDR and the default faces. Run after
// either changes; declared-languages.test.ts fails until it has been.
import { writeFileSync } from 'node:fs';

import {
  deriveContentLanguages,
  renderContentLanguages,
} from '../src/interface/declared-languages.js';
import { cldrInputs, coveredByDefaultFaces } from './cldr-inputs.js';

writeFileSync(
  new URL('../src/interface/content-languages.ts', import.meta.url),
  renderContentLanguages(deriveContentLanguages(cldrInputs(), coveredByDefaultFaces)),
);
