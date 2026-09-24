/**
 * A face's own vertical metrics and advances, read from its tables as `codePoints` reads its character
 * map: `head`'s units per em, `hhea`'s ascender and descender - the metrics a theme records for a
 * typeface (ADR-0014: "a typeface carries its vertical metrics, read from the font file"), and which
 * the template puts each baseline by - and every advance `hmtx` holds. A monospaced face holds one
 * advance for every glyph that advances at all, which is what a column of preformatted text is
 * counted in. The theme's numbers are the file's or the test that reads both fails (themes 1, R8).
 */
export interface FaceMetrics {
  readonly unitsPerEm: number;
  /** Above the baseline, in font units: positive. */
  readonly ascender: number;
  /** Below the baseline, in font units: negative, as the table writes it. */
  readonly descender: number;
  /** Every distinct advance a glyph has, in font units, leaving out a glyph that advances nothing. */
  readonly advances: ReadonlySet<number>;
}

export function faceMetrics(font: Buffer): FaceMetrics {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = new Map<string, number>();
  for (let table = 0; table < view.getUint16(4); table += 1) {
    const record = 12 + 16 * table;
    tables.set(font.toString('latin1', record, record + 4), view.getUint32(record + 8));
  }
  const at = (tag: string) => {
    const offset = tables.get(tag);
    if (offset === undefined) throw new Error(`The face has no ${tag} table`);
    return offset;
  };
  const head = at('head');
  const hhea = at('hhea');
  const hmtx = at('hmtx');
  const advances = new Set<number>();
  // Each long horizontal metric is an advance and a left side bearing, four bytes; a glyph beyond
  // `numberOfHMetrics` takes the last advance, which is already in the set.
  for (let glyph = 0; glyph < view.getUint16(hhea + 34); glyph += 1) {
    const advance = view.getUint16(hmtx + 4 * glyph);
    if (advance !== 0) advances.add(advance);
  }
  return {
    unitsPerEm: view.getUint16(head + 18),
    ascender: view.getInt16(hhea + 4),
    descender: view.getInt16(hhea + 6),
    advances,
  };
}
