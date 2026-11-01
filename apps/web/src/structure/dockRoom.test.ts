import { describe, expect, it } from 'vitest';

import { dockRoom } from './dockRoom.js';

describe('the room the dock has, from where it stands (issue #868)', () => {
  it('runs from where it stands now to a gap above the status bar, not from its sticky top', () => {
    // As measured on the page at its top: standing at 229, the window 1000 high, the bar 53.
    expect(dockRoom({ top: 229, viewport: 1000, status: 53, gap: 12 })).toBe(706);
    // Scrolled until it sticks at 143: the room grows by as much.
    expect(dockRoom({ top: 143, viewport: 1000, status: 53, gap: 12 })).toBe(792);
  });

  it('keeps a usable height in a window too short to give one', () => {
    expect(dockRoom({ top: 400, viewport: 500, status: 53, gap: 12 })).toBe(240);
  });
});
