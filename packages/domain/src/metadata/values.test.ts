import { describe, expect, it } from 'vitest';

import { hasMember, isClear, sameValue } from './values.js';

describe('hasMember', () => {
  it('is true for a member present with any value, including null and an empty list', () => {
    expect(hasMember({ name: 'Ada' }, 'name')).toBe(true);
    expect(hasMember({ name: null }, 'name')).toBe(true);
    expect(hasMember({ name: [] }, 'name')).toBe(true);
  });

  it('is false for a member never given a value', () => {
    expect(hasMember({}, 'name')).toBe(false);
    expect(hasMember({ other: 'Grace' }, 'name')).toBe(false);
  });

  it('is false for a member explicitly set to undefined', () => {
    expect(hasMember({ name: undefined }, 'name')).toBe(false);
  });

  it('is false for an inherited property such as toString, which is not the object’s own', () => {
    expect(hasMember({ name: 'Ada' }, 'toString')).toBe(false);
  });
});

describe('isClear', () => {
  it('is true for null and an empty list', () => {
    expect(isClear(null)).toBe(true);
    expect(isClear([])).toBe(true);
  });

  it('is false for a zero, an empty string, false, a non-empty list and a non-empty object', () => {
    expect(isClear(0)).toBe(false);
    expect(isClear('')).toBe(false);
    expect(isClear(false)).toBe(false);
    expect(isClear([0])).toBe(false);
    expect(isClear({ name: 'Ada' })).toBe(false);
  });
});

describe('sameValue', () => {
  it('is true for two values that are equal as written', () => {
    expect(sameValue('Ada', 'Ada')).toBe(true);
    expect(sameValue(3, 3)).toBe(true);
    expect(sameValue({ name: 'Ada', city: 'Leeds' }, { name: 'Ada', city: 'Leeds' })).toBe(true);
  });

  it('is true for two values normalisation makes equal: the same object with its members in a different order', () => {
    expect(sameValue({ name: 'Ada', city: 'Leeds' }, { city: 'Leeds', name: 'Ada' })).toBe(true);
  });

  it('is true for the same text in two Unicode forms, since canonicalJson normalises to NFC', () => {
    expect(sameValue('café', 'café')).toBe(true);
  });

  it('is false for two different values', () => {
    expect(sameValue('Ada', 'Grace')).toBe(false);
    expect(sameValue({ name: 'Ada' }, { name: 'Grace' })).toBe(false);
  });

  it('is false for the same content held as different types', () => {
    expect(sameValue('3', 3)).toBe(false);
    expect(sameValue(null, [])).toBe(false);
  });
});
