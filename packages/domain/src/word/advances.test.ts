import { describe, expect, it } from 'vitest';

import { faceAdvances } from './advances.js';
import { syntheticFace } from './face.fixture.js';

const BULLET = 0x2022;
const CIRCLE = 0x25e6;

describe('faceAdvances: how wide a face sets a character, read from its file', () => {
  const advances = new Map([
    [0x31, 1024],
    [0x2e, 512],
    [BULLET, 716],
    [0x1f600, 2048],
  ]);

  for (const format of [4, 12] as const) {
    it(`reads each character's advance through a format ${format} character map, in ems`, () => {
      const face = faceAdvances(syntheticFace(advances, { format }))!;
      expect(face.width('1.')).toBe(0.75);
      expect(face.width(String.fromCodePoint(BULLET))).toBeCloseTo(716 / 2048, 10);
    });
  }

  it('takes the missing glyph for a character the face does not map, as a renderer draws it', () => {
    const face = faceAdvances(syntheticFace(advances))!;
    expect(face.width(String.fromCodePoint(CIRCLE))).toBe(0.5);
  });

  it('reads past the first plane through format 12, and by the units per em the face declares', () => {
    const face = faceAdvances(syntheticFace(advances, { unitsPerEm: 1000 }))!;
    expect(face.width(String.fromCodePoint(0x1f600))).toBe(2.048);
  });

  it('answers null for bytes that are not a face it can read', () => {
    expect(faceAdvances(new Uint8Array(96).fill(7))).toBeNull();
    expect(faceAdvances(new Uint8Array(4))).toBeNull();
  });
});
