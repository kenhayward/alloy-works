import { describe, expect, it } from 'vitest';

import { instantFor, localIn } from './dateTime.js';

const LONDON = 'Europe/London';

describe('a date and time in a named zone', () => {
  it('stores a local time as the instant with its numeric offset, in winter and in summer', () => {
    expect(instantFor('2026-01-15T09:30', LONDON)).toEqual({
      kind: 'one',
      value: '2026-01-15T09:30+00:00',
    });
    expect(instantFor('2026-07-15T09:30', LONDON)).toEqual({
      kind: 'one',
      value: '2026-07-15T09:30+01:00',
    });
    expect(instantFor('2026-07-15T09:30', 'America/New_York')).toEqual({
      kind: 'one',
      value: '2026-07-15T09:30-04:00',
    });
  });

  it('says a time the zone skips does not exist, and offers both of a time it repeats', () => {
    // The clocks go forward at 01:00 on the last Sunday of March in London.
    expect(instantFor('2026-03-29T01:30', LONDON)).toEqual({ kind: 'none' });
    // And back at 02:00 on the last Sunday of October: 01:30 happens twice.
    expect(instantFor('2026-10-25T01:30', LONDON)).toEqual({
      kind: 'two',
      earlier: '2026-10-25T01:30+01:00',
      later: '2026-10-25T01:30+00:00',
    });
  });

  it('shows a stored instant as the local date and time it is in the zone', () => {
    expect(localIn('2026-07-15T08:30Z', LONDON)).toBe('2026-07-15T09:30');
    expect(localIn('2026-01-15T09:30+00:00', 'America/New_York')).toBe('2026-01-15T04:30');
    expect(localIn('not a time', LONDON)).toBeNull();
  });

  it('refuses what is not a local date and time', () => {
    expect(instantFor('2026-02-30T09:30', LONDON)).toEqual({ kind: 'invalid' });
    expect(instantFor('tomorrow', LONDON)).toEqual({ kind: 'invalid' });
  });
});
