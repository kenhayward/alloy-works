import { describe, expect, it } from 'vitest';
import { COVERAGE } from './coverage.js';
import { covers, familyOfFile, PINNED_FONT_FILES } from './index.js';
import { coverageOfFiles, FONT_DIRECTORY, renderCoverage } from './node.js';

describe('the characters each pinned family covers, as data', () => {
  it('is what the files themselves cover, regenerated and compared, as openapi.json is', async () => {
    // `pnpm --filter @alloy-works/fonts generate` rewrites coverage.ts from the files.
    expect(renderCoverage(await coverageOfFiles(FONT_DIRECTORY))).toBe(
      renderCoverage(new Map(Object.entries(COVERAGE))),
    );
  });

  it('names every pinned family, and covers a character only where every face of it does', async () => {
    expect(Object.keys(COVERAGE).sort()).toEqual(
      [...new Set(PINNED_FONT_FILES.map((each) => each.family))].sort(),
    );
    expect(covers(0x41, 'Liberation Serif')).toBe(true); // A
    expect(covers(0x3b1, 'Liberation Serif')).toBe(true); // Greek alpha
    expect(covers(0x627, 'Liberation Serif')).toBe(false); // Arabic alef, which no pinned face sets
    expect(covers(0x1d465, 'STIX Two Math')).toBe(true); // mathematical italic x
    expect(covers(0x1d465, 'Liberation Serif')).toBe(false);
    // A family nobody holds covers nothing, as the worker's `covers` says.
    expect(covers(0x41, 'Liberation Sans')).toBe(false);
  });

  it('knows each pinned file by its hash, which is how a theme names it', () => {
    for (const pinned of PINNED_FONT_FILES) {
      expect(familyOfFile(pinned.sha256)).toBe(pinned.family);
    }
    expect(familyOfFile('0'.repeat(64))).toBeUndefined();
  });
});
