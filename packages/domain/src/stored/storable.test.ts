import { describe, expect, it } from 'vitest';

import { storableCopy, storableEverywhere } from './storable.js';

// Built, so that no such character stands in this file.
const NUL = String.fromCharCode(0);
const HALF = String.fromCharCode(0xd800);
const PAIR = String.fromCodePoint(0x1f30a);
const REPLACED = String.fromCharCode(0xfffd);

describe('storableCopy', () => {
  it('replaces what Postgres cannot store, at any depth and in a member name', () => {
    const value = { [`a${NUL}`]: [`b${HALF}c`, { d: `e${NUL}` }], f: 1, g: null, h: true };
    const copy = storableCopy(value);
    expect(storableEverywhere(value)).toBe(false);
    expect(storableEverywhere(copy)).toBe(true);
    expect(copy).toEqual({
      [`a${REPLACED}`]: [`b${REPLACED}c`, { d: `e${REPLACED}` }],
      f: 1,
      g: null,
      h: true,
    });
  });

  it('leaves whole pairs and plain words as they are', () => {
    expect(storableCopy(`weir ${PAIR}`)).toBe(`weir ${PAIR}`);
  });
});
