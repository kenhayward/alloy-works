import { describe, expect, it } from 'vitest';

import { attestationIsSubstantial } from './model.js';

/**
 * Shared between `parse/baseline.ts` (which refuses a malformed document outright) and `gate.ts`
 * (which must not trust a `Baseline` built programmatically to have gone through the parser at all -
 * `gate` is exported, decides CI, and stage 4's intake work may construct one directly). One
 * predicate, one bar, so the two can never quietly disagree about what counts as substantial.
 */
describe('whether an attestation is substantial enough to accept as evidence', () => {
  it('accepts a `by` that names a person and a date, at least the minimum length', () => {
    expect(attestationIsSubstantial('Ada Lovelace, checked 2026-09-13')).toBe(true);
  });

  it('refuses a one-character `by`', () => {
    expect(attestationIsSubstantial('x')).toBe(false);
  });

  it('refuses a `by` that names a date but is too short overall', () => {
    expect(attestationIsSubstantial('Ada, 2026-09-13')).toBe(false);
  });

  it('refuses a `by` that is long enough but names no date', () => {
    expect(
      attestationIsSubstantial('Ada Lovelace signed off on this one, with no date given at all'),
    ).toBe(false);
  });
});
