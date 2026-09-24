import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_DIRECTORY } from './fonts.js';
import { faceMetrics } from './metrics.js';

/**
 * The least a face can be for `faceMetrics`: a table directory naming `head`, `hhea` and `hmtx`, with
 * the units per em, the ascender and descender, and one advance for each of the glyphs given.
 */
function faceWith(unitsPerEm: number, ascender: number, descender: number, advances: number[]) {
  const head = Buffer.alloc(54);
  head.writeUInt16BE(unitsPerEm, 18);
  const hhea = Buffer.alloc(36);
  hhea.writeInt16BE(ascender, 4);
  hhea.writeInt16BE(descender, 6);
  hhea.writeUInt16BE(advances.length, 34);
  const hmtx = Buffer.alloc(4 * advances.length);
  advances.forEach((advance, index) => hmtx.writeUInt16BE(advance, 4 * index));
  const tables = [
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
  ] as const;
  const directory = Buffer.alloc(12 + 16 * tables.length);
  directory.writeUInt32BE(0x00010000, 0);
  directory.writeUInt16BE(tables.length, 4);
  let offset = directory.length;
  tables.forEach(([tag, table], index) => {
    directory.write(tag, 12 + 16 * index, 'latin1');
    directory.writeUInt32BE(offset, 20 + 16 * index);
    directory.writeUInt32BE(table.length, 24 + 16 * index);
    offset += table.length;
  });
  return Buffer.concat([directory, ...tables.map(([, table]) => table)]);
}

describe("a face's vertical metrics and advances", () => {
  it('reads the units per em from head, the ascender and descender from hhea, and every advance from hmtx', () => {
    expect(faceMetrics(faceWith(1000, 800, -200, [500, 0, 600]))).toEqual({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      // Glyph 1 advances nothing - a combining mark - and says nothing of the face's spacing.
      advances: new Set([500, 600]),
    });
  });

  it("reads Liberation Serif's and Liberation Mono's own, a single advance for every glyph of the monospace", async () => {
    const serif = faceMetrics(await readFile(join(FONT_DIRECTORY, 'LiberationSerif-Regular.ttf')));
    expect(serif).toMatchObject({ unitsPerEm: 2048, ascender: 1825, descender: -443 });
    expect(serif.advances.size).toBeGreaterThan(1);
    const mono = faceMetrics(await readFile(join(FONT_DIRECTORY, 'LiberationMono-Regular.ttf')));
    expect(mono).toMatchObject({ unitsPerEm: 2048, ascender: 1705, descender: -615 });
    expect([...mono.advances]).toEqual([1229]);
  });
});
