/**
 * A face file shaped as TrueType, holding what the Word writer reads of one (`faceAdvances`): `head`'s
 * units per em, `hhea`'s count of metrics, `hmtx`'s advances and a `cmap` of the one format asked
 * for - and `seed`'s bytes after its tables, which no reader looks at, so that two files made alike
 * still differ. Glyph 0 is the missing glyph, half an em wide; each code point given is a glyph of
 * its own, in code point order, as wide as it says.
 */
export function syntheticFace(
  advances: ReadonlyMap<number, number>,
  options: { readonly unitsPerEm?: number; readonly format?: 4 | 12; readonly seed?: number } = {},
): Uint8Array {
  const unitsPerEm = options.unitsPerEm ?? 2048;
  const codePoints = [...advances.keys()].sort((a, b) => a - b);
  const glyphs = [unitsPerEm / 2, ...codePoints.map((codePoint) => advances.get(codePoint)!)];

  const head = new DataView(new ArrayBuffer(54));
  head.setUint16(18, unitsPerEm);
  const hhea = new DataView(new ArrayBuffer(36));
  hhea.setUint16(34, glyphs.length);
  const hmtx = new DataView(new ArrayBuffer(4 * glyphs.length));
  glyphs.forEach((advance, glyph) => hmtx.setUint16(4 * glyph, advance));
  const cmap = options.format === 4 ? format4(codePoints) : format12(codePoints);

  const tables: [string, DataView][] = [
    ['cmap', cmap],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
  ];
  const seed = Uint8Array.from(
    { length: 16 },
    (_, index) => (index * 31 + (options.seed ?? 0) * 17) % 256,
  );
  let offset = 12 + 16 * tables.length;
  const size = tables.reduce((sum, [, table]) => sum + table.byteLength, offset) + seed.length;
  const bytes = new Uint8Array(size);
  const file = new DataView(bytes.buffer);
  file.setUint32(0, 0x00010000);
  file.setUint16(4, tables.length);
  tables.forEach(([tag, table], index) => {
    const record = 12 + 16 * index;
    for (let at = 0; at < 4; at += 1) file.setUint8(record + at, tag.charCodeAt(at));
    file.setUint32(record + 8, offset);
    file.setUint32(record + 12, table.byteLength);
    bytes.set(new Uint8Array(table.buffer), offset);
    offset += table.byteLength;
  });
  bytes.set(seed, offset);
  return bytes;
}

/** A `cmap` of one Windows Unicode subtable in format 12: a group per code point. */
function format12(codePoints: readonly number[]): DataView {
  const cmap = new DataView(new ArrayBuffer(12 + 16 + 12 * codePoints.length));
  cmap.setUint16(2, 1);
  cmap.setUint16(4, 3);
  cmap.setUint16(6, 10);
  cmap.setUint32(8, 12);
  cmap.setUint16(12, 12);
  cmap.setUint32(16, 16 + 12 * codePoints.length);
  cmap.setUint32(24, codePoints.length);
  codePoints.forEach((codePoint, index) => {
    cmap.setUint32(28 + 12 * index, codePoint);
    cmap.setUint32(32 + 12 * index, codePoint);
    cmap.setUint32(36 + 12 * index, index + 1);
  });
  return cmap;
}

/**
 * A `cmap` of one Windows Unicode subtable in format 4: a segment per code point, mapped by its delta,
 * and the closing segment every such table ends with. Code points past the first plane are left out.
 */
function format4(codePoints: readonly number[]): DataView {
  const segments = [
    ...codePoints
      .filter((codePoint) => codePoint <= 0xfffe)
      .map((codePoint, index) => ({ codePoint, glyph: index + 1 })),
    { codePoint: 0xffff, glyph: 0 },
  ];
  const count = segments.length;
  const length = 16 + 8 * count;
  const cmap = new DataView(new ArrayBuffer(12 + length));
  cmap.setUint16(2, 1);
  cmap.setUint16(4, 3);
  cmap.setUint16(6, 1);
  cmap.setUint32(8, 12);
  const table = 12;
  cmap.setUint16(table, 4);
  cmap.setUint16(table + 2, length);
  cmap.setUint16(table + 6, 2 * count);
  segments.forEach(({ codePoint, glyph }, index) => {
    cmap.setUint16(table + 14 + 2 * index, codePoint);
    cmap.setUint16(table + 16 + 2 * count + 2 * index, codePoint);
    cmap.setUint16(table + 16 + 4 * count + 2 * index, (glyph - codePoint + 0x10000) % 0x10000);
  });
  return cmap;
}
