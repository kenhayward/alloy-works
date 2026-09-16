import { describe, expect, it } from 'vitest';

import { formatLevel, parseLevel, sameLevel } from './level.js';

const ID = '0b6f4b8e-4d0e-4c36-9a57-2f1d5d4b7a10';

describe('a level, as a target is named', () => {
  it('is the tenant, a space or an artifact, and reads back as it was written', () => {
    for (const level of [
      { kind: 'tenant' },
      { kind: 'space', id: ID },
      { kind: 'artifact', id: ID },
    ] as const) {
      expect(parseLevel(formatLevel(level))).toEqual(level);
    }
    expect(formatLevel({ kind: 'space', id: ID })).toBe(`space:${ID}`);
  });

  it('names an identifier only as a lower-case hyphenated UUID', () => {
    for (const text of [
      '',
      'tenant:',
      'space',
      `space:${ID.toUpperCase()}`,
      `artifact:${ID}x`,
      `document:${ID}`,
      'space:not-a-uuid',
    ]) {
      expect(parseLevel(text), text).toBeUndefined();
    }
  });

  it('is the same level only as the same kind and identifier', () => {
    expect(sameLevel({ kind: 'tenant' }, { kind: 'tenant' })).toBe(true);
    expect(sameLevel({ kind: 'space', id: ID }, { kind: 'artifact', id: ID })).toBe(false);
    expect(sameLevel({ kind: 'space', id: ID }, { kind: 'space', id: ID })).toBe(true);
  });
});
