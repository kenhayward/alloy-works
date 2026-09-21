import { describe, expect, it } from 'vitest';

import { whenChanged } from './changed.js';

// Local times throughout, so the bands read the same in any time zone the suite runs in.
const now = new Date(2026, 8, 21, 15, 30);
const at = (month: number, day: number, hour: number, minute: number, year = 2026) =>
  new Date(year, month - 1, day, hour, minute).toISOString();

describe('when a component was last changed, as the list says it', () => {
  it('says just now within a minute', () => {
    expect(whenChanged(new Date(2026, 8, 21, 15, 29, 30).toISOString(), now)).toBe('Just now');
  });

  it('counts minutes within the hour, and hours within the day', () => {
    expect(whenChanged(at(9, 21, 15, 16), now)).toBe('14 minutes ago');
    expect(whenChanged(at(9, 21, 14, 29), now)).toBe('1 hour ago');
    expect(whenChanged(at(9, 21, 13, 10), now)).toBe('2 hours ago');
    expect(whenChanged(at(9, 21, 0, 5), now)).toBe('15 hours ago');
  });

  it('names yesterday with its time', () => {
    expect(whenChanged(at(9, 20, 16, 20), now)).toBe('Yesterday, 16:20');
  });

  it('gives the day and month this year, and the year before that', () => {
    expect(whenChanged(at(9, 18, 9, 48), now)).toBe('18 Sep, 09:48');
    expect(whenChanged(at(12, 3, 11, 0, 2025), now)).toBe('3 Dec 2025');
  });

  it('says 1 minute, not 1 minutes', () => {
    expect(whenChanged(at(9, 21, 15, 28, 2026), new Date(2026, 8, 21, 15, 29, 30))).toBe(
      '1 minute ago',
    );
  });
});
