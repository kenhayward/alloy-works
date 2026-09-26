/**
 * **How wide a face sets a character**, read from the face's own file (Word 2, ruling R4): `head`'s
 * units per em, `hmtx`'s advances and the `cmap` that maps a character to its glyph. The writer asks
 * it of a list's markers, which the PDF's engine stands a list's items beside by their own width - a
 * disc 0.35 of an em, "10." 1.25 - so that Word stands them where the PDF does (`lists.ts`). The
 * domain reads no file: the bytes are the ones the job hands the writer to embed.
 *
 * A character the face does not map is as wide as its missing glyph, which is what a renderer draws
 * for it. No kerning: the engine kerns a pair such as "v." and Word, as the writer asks it, does not,
 * a difference of well under a point in a marker.
 */
export interface FaceAdvances {
  /** How wide these characters are set one after another, in ems. */
  width(text: string): number;
}

/** The face's advances, or null where the bytes are not a face this reads - a TrueType or OpenType file. */
export function faceAdvances(bytes: Uint8Array): FaceAdvances | null {
  try {
    return read(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch {
    // A table missing or cut short reads past the end of the bytes, which `DataView` throws on.
    return null;
  }
}

function read(view: DataView): FaceAdvances | null {
  const tables = new Map<string, number>();
  const count = view.getUint16(4);
  for (let table = 0; table < count; table += 1) {
    const record = 12 + 16 * table;
    const tag = String.fromCharCode(
      view.getUint8(record),
      view.getUint8(record + 1),
      view.getUint8(record + 2),
      view.getUint8(record + 3),
    );
    tables.set(tag, view.getUint32(record + 8));
  }
  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const hmtx = tables.get('hmtx');
  const cmap = tables.get('cmap');
  if (head === undefined || hhea === undefined || hmtx === undefined || cmap === undefined) {
    return null;
  }
  const unitsPerEm = view.getUint16(head + 18);
  const metrics = view.getUint16(hhea + 34);
  const glyphOf = characterMap(view, cmap);
  if (unitsPerEm === 0 || metrics === 0 || glyphOf === null) return null;
  // A glyph past the last long metric takes its advance, as the table defines.
  const advance = (glyph: number) => view.getUint16(hmtx + 4 * Math.min(glyph, metrics - 1));
  return {
    width(text) {
      let units = 0;
      for (const character of text) units += advance(glyphOf(character.codePointAt(0)!));
      return units / unitsPerEm;
    },
  };
}

/**
 * The glyph each code point maps to, by the face's Windows Unicode subtable - its full repertoire in
 * format 12 where it has one, else its first plane in format 4 - or null where it has neither.
 */
function characterMap(view: DataView, cmap: number): ((codePoint: number) => number) | null {
  const subtables = new Map<number, number>();
  for (let index = 0; index < view.getUint16(cmap + 2); index += 1) {
    const record = cmap + 4 + 8 * index;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const at = cmap + view.getUint32(record + 4);
    const format = view.getUint16(at);
    if ((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0) {
      if (!subtables.has(format)) subtables.set(format, at);
    }
  }
  const full = subtables.get(12);
  if (full !== undefined) {
    const groups = view.getUint32(full + 12);
    return (codePoint) => {
      for (let group = 0; group < groups; group += 1) {
        const at = full + 16 + 12 * group;
        const start = view.getUint32(at);
        if (codePoint >= start && codePoint <= view.getUint32(at + 4)) {
          return view.getUint32(at + 8) + codePoint - start;
        }
      }
      return 0;
    };
  }
  const plane = subtables.get(4);
  if (plane === undefined) return null;
  const segments = view.getUint16(plane + 6) / 2;
  const ends = plane + 14;
  const starts = ends + 2 * segments + 2;
  const deltas = starts + 2 * segments;
  const ranges = deltas + 2 * segments;
  return (codePoint) => {
    if (codePoint > 0xffff) return 0;
    for (let segment = 0; segment < segments; segment += 1) {
      if (codePoint > view.getUint16(ends + 2 * segment)) continue;
      const start = view.getUint16(starts + 2 * segment);
      if (codePoint < start) return 0;
      const delta = view.getUint16(deltas + 2 * segment);
      const range = view.getUint16(ranges + 2 * segment);
      if (range === 0) return (codePoint + delta) % 0x10000;
      const glyph = view.getUint16(ranges + 2 * segment + range + 2 * (codePoint - start));
      return glyph === 0 ? 0 : (glyph + delta) % 0x10000;
    }
    return 0;
  };
}
