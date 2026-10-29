import { describe, expect, it } from 'vitest';

import { componentIdFor, elementIdFor, uuidV5 } from './ids.js';

describe('the identifiers a delivery derives', () => {
  it('API-070 reads a name-based UUID as RFC 4122 does (the DNS namespace vector)', () => {
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('API-070 gives a section the same component every delivery, and another section another', () => {
    const first = componentIdFor('persist-1', 's1');
    expect(first).toBe(componentIdFor('persist-1', 's1'));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(componentIdFor('persist-1', 's2')).not.toBe(first);
    expect(componentIdFor('persist-2', 's1')).not.toBe(first);
    expect(componentIdFor('persist-1', '~lead')).not.toBe(first);
  });

  it('API-070 keeps the persistent id and the section id apart', () => {
    expect(componentIdFor('ab', 'c')).not.toBe(componentIdFor('a', 'bc'));
  });

  it('API-070 gives an element a 26-character identifier that depends on its owner and its id', () => {
    const owner = componentIdFor('persist-1', 's1');
    const id = elementIdFor(owner, 'p1');
    expect(id).toMatch(/^[a-z2-7]{26}$/);
    expect(elementIdFor(owner, 'p1')).toBe(id);
    expect(elementIdFor(owner, 'p2')).not.toBe(id);
    expect(elementIdFor(componentIdFor('persist-1', 's2'), 'p1')).not.toBe(id);
  });
});
