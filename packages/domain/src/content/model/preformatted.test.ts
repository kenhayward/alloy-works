import { describe, expect, it } from 'vitest';

import { forbiddenInPreformatted, isLanguageLabel } from './preformatted.js';

describe('what preformatted text may hold', () => {
  it('forbids every control character but a tab and a line feed, and the two Unicode separators', () => {
    const control = (codePoint: number) =>
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    for (let codePoint = 0; codePoint <= 0x2100; codePoint += 1) {
      const expected =
        codePoint !== 0x9 &&
        codePoint !== 0xa &&
        (control(codePoint) || codePoint === 0x2028 || codePoint === 0x2029);
      if (codePoint === 0x2100) break;
      expect(forbiddenInPreformatted(codePoint), codePoint.toString(16)).toBe(expected);
    }
    expect(forbiddenInPreformatted(0x2028)).toBe(true);
    expect(forbiddenInPreformatted(0x2029)).toBe(true);
    expect(forbiddenInPreformatted(0x20)).toBe(false);
  });

  it('knows a language label when it sees one', () => {
    expect(isLanguageLabel('shell-session')).toBe(true);
    expect(isLanguageLabel('a'.repeat(32))).toBe(true);
    expect(isLanguageLabel('a'.repeat(33))).toBe(false);
    expect(isLanguageLabel('_x')).toBe(false);
  });
});
