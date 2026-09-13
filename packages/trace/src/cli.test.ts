import { describe, expect, it } from 'vitest';

import { readDraftInput } from './cli.js';

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
