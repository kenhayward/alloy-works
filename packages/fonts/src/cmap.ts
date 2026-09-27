/**
 * The characters a TrueType or OpenType face maps to a glyph, read from its `cmap` table's Unicode
 * subtables - format 4 for the Basic Multilingual Plane and format 12 beyond it, which between them
 * are what every face the product ships carries. A character mapped to glyph 0, `.notdef`, is not
 * covered: that is the empty box.
 */
export function codePoints(font: Buffer): Set<number> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  let cmap = -1;
  for (let table = 0; table < view.getUint16(4); table += 1) {
    const record = 12 + 16 * table;
    if (font.toString('latin1', record, record + 4) === 'cmap') cmap = view.getUint32(record + 8);
  }
  if (cmap < 0) throw new Error('The face has no cmap table');

  const covered = new Set<number>();
  for (let subtable = 0; subtable < view.getUint16(cmap + 2); subtable += 1) {
    const platform = view.getUint16(cmap + 4 + 8 * subtable);
    const encoding = view.getUint16(cmap + 6 + 8 * subtable);
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const at = cmap + view.getUint32(cmap + 8 + 8 * subtable);
    const format = view.getUint16(at);
    if (format === 4) {
      const segments = view.getUint16(at + 6) / 2;
      const ends = at + 14;
      const starts = ends + 2 * segments + 2;
      const deltas = starts + 2 * segments;
      const offsets = deltas + 2 * segments;
      for (let s = 0; s < segments; s += 1) {
        const end = view.getUint16(ends + 2 * s);
        const start = view.getUint16(starts + 2 * s);
        const delta = view.getInt16(deltas + 2 * s);
        const offset = view.getUint16(offsets + 2 * s);
        for (let code = start; code <= end && code !== 0xffff; code += 1) {
          const raw =
            offset === 0 ? code : view.getUint16(offsets + 2 * s + offset + 2 * (code - start));
          const glyph = offset !== 0 && raw === 0 ? 0 : (raw + delta) & 0xffff;
          if (glyph !== 0) covered.add(code);
        }
      }
    } else if (format === 12) {
      for (let group = 0; group < view.getUint32(at + 12); group += 1) {
        const start = view.getUint32(at + 16 + 12 * group);
        const end = view.getUint32(at + 20 + 12 * group);
        const glyph = view.getUint32(at + 24 + 12 * group);
        for (let code = start; code <= end; code += 1) {
          if (glyph + (code - start) !== 0) covered.add(code);
        }
      }
    }
  }
  return covered;
}
