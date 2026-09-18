import { describe, expect, it } from 'vitest';
import { blockIdentifierFrom } from './identifier.js';

describe('a block identifier', () => {
  it('spells sixteen bytes as twenty-six lower-case base32 characters', () => {
    expect(blockIdentifierFrom(new Uint8Array(16))).toBe('a'.repeat(26));
    expect(blockIdentifierFrom(new Uint8Array(16).fill(255))).toMatch(/^[a-z2-7]{26}$/);
  });

  it('refuses anything but sixteen bytes, so an identifier is never short of its bits', () => {
    expect(() => blockIdentifierFrom(new Uint8Array(15))).toThrow(/sixteen bytes/);
  });
});
