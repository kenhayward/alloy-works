import { describe, expect, it } from 'vitest';

import { valueLine } from './values-text.js';

describe('a bound value as read_values says it to the model (issue #856)', () => {
  it('says a value where it stands, from the query it came from', () => {
    expect(valueLine('n1', 'Weir levels', { taken: { value: 3.2 } })).toBe(
      'At n1, from Weir levels: 3.2',
    );
    expect(valueLine('n1', null, { taken: { value: { m: 3 } } })).toBe(
      'At n1, from a query you may not read: {"m":3}',
    );
    expect(valueLine('n1', 'Weir levels', null)).toBe('At n1, from Weir levels: nothing held');
  });

  it('reads a bound table as its rows under its headers, a | in a cell escaped (issue #859)', () => {
    const rows = {
      ok: true as const,
      headers: ['Site', 'Level'],
      rows: [
        ['North | upper', '3.2'],
        ['South', ''],
      ],
    };
    expect(valueLine('n2', 'Sites', { taken: { table: true } }, rows)).toBe(
      [
        'At n2, from Sites: a bound table of 2 rows:',
        '| Site | Level |',
        '| --- | --- |',
        '| North \\| upper | 3.2 |',
        '| South |  |',
      ].join('\n'),
    );
  });

  it('says why a bound table has no rows to read, never its marker (issue #859)', () => {
    const line = (reason: 'unresolved' | 'stale' | 'too_long' | 'unreadable') =>
      valueLine('n2', 'Sites', { taken: { table: true } }, { ok: false, reason });
    expect(line('stale')).toBe(
      'At n2, from Sites: a bound table changed since it was resolved; resolve it to read its rows',
    );
    expect(line('too_long')).toBe(
      'At n2, from Sites: a bound table with more rows than a table prints',
    );
    expect(line('unreadable')).toBe(
      'At n2, from Sites: a bound table whose stored rows cannot be read now',
    );
    expect(valueLine('n2', 'Sites', null, { ok: false, reason: 'unresolved' })).toBe(
      'At n2, from Sites: a bound table never resolved',
    );
  });
});
