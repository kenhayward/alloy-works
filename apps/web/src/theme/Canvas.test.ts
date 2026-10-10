import { describe, expect, it } from 'vitest';

import { fitZoom, keepReachable, SHEET_MARGIN } from './Canvas.js';

describe('the sheet on the desk (ADR-0056)', () => {
  it('fits the measure alone across a column that is the paper', () => {
    // 450pt is 600 CSS pixels: across 600 pixels of room, the printed size.
    expect(fitZoom(600, 450, false)).toBe(1);
    expect(fitZoom(300, 450, false)).toBe(0.5);
  });

  it('fits the measure and its margins either side across the desk, the margins scaling with it', () => {
    expect(SHEET_MARGIN).toBe(70);
    // 600 pixels of measure and 70 either side: 740 at the printed size.
    expect(fitZoom(740, 450, true)).toBe(1);
    expect(fitZoom(370, 450, true)).toBe(0.5);
  });

  it('keeps the printed size where there is no room to measure', () => {
    expect(fitZoom(0, 450, true)).toBe(1);
  });
});

describe('a desk narrower than its sheet (ADR-0056)', () => {
  const desk = (scrollWidth: number, clientWidth: number) => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'scrollWidth', { value: scrollWidth });
    Object.defineProperty(element, 'clientWidth', { value: clientWidth });
    return element;
  };

  it('takes the focus while it scrolls sideways, so the keyboard can scroll it, and not otherwise', () => {
    const narrow = desk(900, 500);
    keepReachable(narrow);
    expect(narrow.tabIndex).toBe(0);
    const wide = desk(500, 500);
    wide.tabIndex = 0;
    keepReachable(wide);
    expect(wide.hasAttribute('tabindex')).toBe(false);
  });
});
