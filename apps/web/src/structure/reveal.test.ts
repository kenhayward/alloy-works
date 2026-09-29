import { describe, expect, it } from 'vitest';
import { revealedAt } from './reveal.js';

describe('where a pane scrolls to show one of its items (issue #336)', () => {
  const view = { top: 100, bottom: 400 };

  it('stays where it is while the item is already shown', () => {
    expect(revealedAt(250, view, { top: 150, bottom: 180 })).toBe(250);
    expect(revealedAt(250, view, { top: 100, bottom: 400 })).toBe(250);
  });

  it('brings an item below what it shows up to its foot', () => {
    expect(revealedAt(250, view, { top: 420, bottom: 450 })).toBe(300);
  });

  it('brings an item above what it shows down to its top', () => {
    expect(revealedAt(250, view, { top: 40, bottom: 70 })).toBe(190);
  });

  it('shows the top of an item taller than itself', () => {
    expect(revealedAt(250, view, { top: 420, bottom: 900 })).toBe(570);
  });

  it('never scrolls above its top', () => {
    expect(revealedAt(10, view, { top: 20, bottom: 50 })).toBe(0);
  });
});
