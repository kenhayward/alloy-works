// Rewrites src/interface/content-languages.ts from the pinned CLDR and the default faces, and
// src/interface/plural-rules.ts from its cardinal plural rules. Run after either changes;
// declared-languages.test.ts and plurals.test.ts fail until it has been.
import { writeFileSync } from 'node:fs';

import {
  deriveContentLanguages,
  renderContentLanguages,
} from '../src/interface/declared-languages.js';
import { compilePluralRules, renderPluralRules } from '../src/interface/plurals.js';
import { cldrInputs, cldrPluralRules, coveredByDefaultFaces } from './cldr-inputs.js';

writeFileSync(
  new URL('../src/interface/content-languages.ts', import.meta.url),
  renderContentLanguages(deriveContentLanguages(cldrInputs(), coveredByDefaultFaces)),
);
writeFileSync(
  new URL('../src/interface/plural-rules.ts', import.meta.url),
  renderPluralRules(compilePluralRules(cldrPluralRules())),
);
