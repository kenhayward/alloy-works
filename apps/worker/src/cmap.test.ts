import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codePoints } from './cmap.js';
import { FONT_DIRECTORY, PINNED_FONT_FILES } from './fonts.js';

/**
 * The least a face can be for `codePoints`: a table directory naming one table, `cmap`, holding one
 * Windows full-repertoire (3, 10) subtable in format 12 with these groups of `[start, end, glyph]`.
 */
function faceWithFormat12(groups: readonly (readonly [number, number, number])[]): Buffer {
  const subtable = Buffer.alloc(16 + 12 * groups.length);
  subtable.writeUInt16BE(12, 0);
  subtable.writeUInt32BE(subtable.length, 4);
  subtable.writeUInt32BE(groups.length, 12);
  groups.forEach(([start, end, glyph], index) => {
    subtable.writeUInt32BE(start, 16 + 12 * index);
    subtable.writeUInt32BE(end, 20 + 12 * index);
    subtable.writeUInt32BE(glyph, 24 + 12 * index);
  });
  const cmap = Buffer.alloc(12);
  cmap.writeUInt16BE(1, 2);
  cmap.writeUInt16BE(3, 4);
  cmap.writeUInt16BE(10, 6);
  cmap.writeUInt32BE(cmap.length, 8);
  const directory = Buffer.alloc(12 + 16);
  directory.writeUInt32BE(0x00010000, 0);
  directory.writeUInt16BE(1, 4);
  directory.write('cmap', 12, 'latin1');
  directory.writeUInt32BE(directory.length, 20);
  directory.writeUInt32BE(cmap.length + subtable.length, 24);
  return Buffer.concat([directory, cmap, subtable]);
}

describe("a face's character map", () => {
  it('reads a format 12 subtable beyond U+FFFF, leaving out a character mapped to .notdef', () => {
    const covered = codePoints(
      faceWithFormat12([
        [0x10000, 0x10000, 0],
        [0x1f600, 0x1f602, 5],
      ]),
    );
    expect([...covered].sort((a, b) => a - b)).toEqual([0x1f600, 0x1f601, 0x1f602]);
  });

  it('finds nothing beyond U+FFFF in the pinned faces, which carry format 4 and no format 12', async () => {
    for (const pinned of PINNED_FONT_FILES) {
      const covered = [...codePoints(await readFile(join(FONT_DIRECTORY, pinned.file)))];
      expect(covered.length, pinned.file).toBeGreaterThan(0);
      expect(Math.max(...covered), pinned.file).toBeLessThan(0x10000);
    }
  });
});
