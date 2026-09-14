import { describe, expect, it } from 'vitest';

import { areaListing, readDraftInput } from './cli.js';
import type { TraceModel } from './model.js';

/**
 * `readDraftInput`'s flag form, exercised directly rather than through `main` - `main` reads the real
 * corpus via `compile(REPO_ROOT)` and shells out to `gh`, neither of which this file's fixes touch.
 * Importing `cli.ts` at all only works because of the `isMain` guard at the bottom of it: without
 * that guard, importing this module would run the real CLI against Vitest's own `process.argv`.
 */
describe('reading the flag form of draft input', () => {
  it('accepts an uppercase MUST, the same as the issue-form path now does', () => {
    const result = readDraftInput([
      '--area',
      'ZZZ',
      '--statement',
      'A footnote MUST carry a citation.',
    ]);

    expect('error' in result).toBe(false);
  });

  it('treats a trailing --tranche with no value as absent, not the literal empty string', () => {
    const result = readDraftInput([
      '--area',
      'ZZZ',
      '--statement',
      'A widget must glow.',
      '--tranche',
    ]);

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.filed.tranche).toBeUndefined();
    }
  });

  it('refuses an area the schema rejects, with a legible message rather than a raw zod dump', () => {
    const result = readDraftInput(['--area', 'zz9', '--statement', 'A widget must glow.']);

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).not.toMatch(/ZodError|invalid_format|pattern \//);
      expect(result.error).toMatch(/area/i);
    }
  });

  it('refuses a statement with neither must nor should, the same as the issue-form path', () => {
    const result = readDraftInput(['--area', 'ZZZ', '--statement', 'A widget looks nice.']);

    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toMatch(/must say must or should/);
    }
  });
});

/**
 * The `area` command's decision, exercised directly for the same reason as `readDraftInput`: `main`
 * reads the real corpus. The index is passed as a function, because only `--all` needs it and a
 * single-area listing should not read a document it does not use.
 */
describe('the area command', () => {
  const model: TraceModel = {
    requirements: [
      {
        id: 'ZZZ-001',
        area: 'ZZZ',
        statement: 'A widget must carry a footnote',
        tranche: 'T1',
        status: 'Specified',
        document: 'ZZZ-invented-area.md',
        line: 7,
      },
    ],
    nonRequirements: [],
    questions: [],
    designs: [],
    citations: [],
  };
  const noIndex = (): never => {
    throw new Error('a single-area listing must not read the index');
  };

  it('lists one area by its code, in any case, without reading the index', () => {
    expect(areaListing('zzz', model, noIndex)).toEqual({
      output: 'ZZZ-001  Specified   A widget must carry a footnote',
    });
  });

  it('lists every area with --all, under headings from the index', () => {
    const result = areaListing('--all', model, () => [{ code: 'ZZZ', name: 'Invented area' }]);

    expect(result).toEqual({
      output:
        'ZZZ - Invented area - 1 requirement\nZZZ-001  Specified   A widget must carry a footnote',
    });
  });

  it('refuses a missing argument, naming both forms', () => {
    const result = areaListing(undefined, model, noIndex);

    expect('error' in result && result.error).toMatch(/three-letter code.*--all/);
  });

  it('refuses an area the corpus does not hold', () => {
    expect(areaListing('ZZQ', model, noIndex)).toEqual({ error: 'No area ZZQ in the corpus.' });
  });
});
