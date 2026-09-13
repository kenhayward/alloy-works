import { describe, expect, it } from 'vitest';

import { dirtyTreeRefusal } from './pack-guard.js';

/**
 * Critical fix-round finding: `pnpm trace pack` stamped the evidence pack with `git rev-parse HEAD`
 * while the working tree held uncommitted citation edits, so the stamped commit was the *parent* of
 * the commit that actually held the pack's own inputs - the pack could never be reproduced from the
 * commit it names. `dirtyTreeRefusal` is the pure decision `cli.ts` acts on before writing anything.
 */
describe('refusing to pack a dirty working tree', () => {
  it('refuses when `git status --porcelain` reports anything', () => {
    const refusal = dirtyTreeRefusal(' M packages/trace/src/pack.ts\n');

    expect(refusal).toBeDefined();
    expect(refusal).toMatch(/not clean/i);
  });

  it('names why: a pack stamped with a commit that lacks its own inputs is not evidence', () => {
    const refusal = dirtyTreeRefusal('?? docs/trace/9.9.9/matrix.md\n');

    expect(refusal).toMatch(/commit/i);
  });

  it('allows a clean tree through, with no refusal', () => {
    expect(dirtyTreeRefusal('')).toBeUndefined();
  });

  it('treats whitespace-only output as clean', () => {
    expect(dirtyTreeRefusal('\n')).toBeUndefined();
  });
});
