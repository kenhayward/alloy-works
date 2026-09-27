import { describe, expect, it } from 'vitest';

import { byName } from './people.js';

describe('the people a user field offers', () => {
  it('orders them by name, and by id where two share one, whatever order they came in', () => {
    const people = [
      { id: 'p3', name: 'Grace' },
      { id: 'p2', name: 'Ada' },
      { id: 'p1', name: 'Grace' },
      { id: 'p4', name: 'alice' },
    ];
    expect(byName(people).map((each) => each.id)).toEqual(['p2', 'p4', 'p1', 'p3']);
    // Its own copy: the listing's order is left as it was.
    expect(people.map((each) => each.id)).toEqual(['p3', 'p2', 'p1', 'p4']);
  });
});
