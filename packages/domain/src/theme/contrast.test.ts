import { describe, expect, it } from 'vitest';

import { contrastRatio, requiredContrast } from './contrast.js';

/**
 * WCAG 2's contrast (TH-G): relative luminance from sRGB, and the ratio of the lighter to the darker,
 * each offset by 0.05. The numbers below are WCAG's own worked values, so the formula is checked
 * against the standard rather than against itself.
 */
describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a colour on itself, whichever way round', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 10);
    expect(contrastRatio('#f0f0f0', '#f0f0f0')).toBe(1);
  });

  it('puts #767676 on white just above 4.5:1 and #777777 just below it', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  it('weighs green over red over blue, as the eye does', () => {
    expect(contrastRatio('#00ff00', '#000000')).toBeCloseTo(15.3, 1);
    expect(contrastRatio('#ff0000', '#000000')).toBeCloseTo(5.25, 2);
    expect(contrastRatio('#0000ff', '#000000')).toBeCloseTo(2.44, 2);
  });
});

describe('requiredContrast', () => {
  it('asks 4.5:1 of text, and 3:1 of large text - 18pt, or 14pt bold', () => {
    expect(requiredContrast(11, true)).toBe(4.5);
    expect(requiredContrast(17.9, false)).toBe(4.5);
    expect(requiredContrast(18, false)).toBe(3);
    expect(requiredContrast(13.9, true)).toBe(4.5);
    expect(requiredContrast(14, true)).toBe(3);
    expect(requiredContrast(14, false)).toBe(4.5);
  });
});
