import { describe, expect, it } from 'vitest';

import { canonicalJson } from './canonical.js';

describe('the canonical rules every stored payload takes', () => {
  it('CNT-011 orders members lexicographically, at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: true, c: null } })).toBe(
      '{"a":{"c":null,"d":true},"b":1}',
    );
  });

  it('CNT-056 emits strings in NFC', () => {
    expect(canonicalJson('café')).toBe(canonicalJson('café'));
  });

  it('CNT-011 emits no insignificant whitespace, and omits a member holding undefined', () => {
    expect(canonicalJson({ a: [1, 2], b: undefined })).toBe('{"a":[1,2]}');
  });

  it('MET-030 keeps every array in the order given, even under a member named marks', () => {
    expect(canonicalJson({ marks: ['b', 'a'] })).toBe('{"marks":["b","a"]}');
  });

  it('CNT-011 reorders an array only where the caller names its member as a set', () => {
    const sorted = (member: string, array: readonly unknown[]) =>
      member === 'tags' ? [...(array as string[])].sort() : array;
    expect(canonicalJson({ tags: ['b', 'a'], list: ['b', 'a'] }, sorted)).toBe(
      '{"list":["b","a"],"tags":["a","b"]}',
    );
  });
});
