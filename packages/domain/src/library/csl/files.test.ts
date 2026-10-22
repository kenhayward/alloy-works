import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CSL_LOCALES, SEEDED_STYLE_FILES } from './files.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('the CSL files carried as strings', () => {
  it('are the files beside them, regenerated and compared, as openapi.json is', () => {
    // `pnpm --filter @alloy-works/domain generate` rewrites files.ts from the files.
    for (const [name, xml] of Object.entries(SEEDED_STYLE_FILES)) {
      expect(xml).toBe(read(`./styles/${name}.csl`));
    }
    for (const [language, xml] of Object.entries(CSL_LOCALES)) {
      expect(xml).toBe(read(`./locales/locales-${language}.xml`));
    }
    expect(Object.keys(SEEDED_STYLE_FILES).sort()).toEqual([
      'cse-name-year',
      'harvard-cite-them-right',
      'nlm-citation-sequence',
    ]);
    expect(Object.keys(CSL_LOCALES).sort()).toEqual(['de-DE', 'en-GB', 'en-US', 'fr-FR']);
  });
});
