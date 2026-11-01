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

  it('says a bound table is one, never its marker', () => {
    expect(valueLine('n2', 'Sites', { taken: { table: true } })).toBe(
      'At n2, from Sites: a bound table, whose rows this tool does not read',
    );
  });
});
