import { describe, expect, it } from 'vitest';

import { citedPlace } from './citedPlace.js';

describe('where a citation goes', () => {
  const placed = new Map([['n1', 'c1']]);

  it('marks the node placing a part in this document', () => {
    expect(citedPlace('c1', placed)).toEqual({ node: 'n1' });
  });

  it('opens a part outside this document on its own page', () => {
    expect(citedPlace('c2', placed)).toEqual({ href: '#/components/c2' });
  });
});
