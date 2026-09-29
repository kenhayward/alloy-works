/**
 * A face's cap height as a fraction of its em: its `OS/2` table's `sCapHeight` over its `head` table's
 * units per em - the height a browser trims a block's first line to (`text-box: trim-both cap`), which
 * the editor places a baseline from (themes.md, "The theme in the editor, measured"). Every face the
 * product ships carries an `OS/2` table of version 2 or later, which is where `sCapHeight` is.
 */
export function capHeight(font: Buffer): number {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = new Map<string, number>();
  for (let table = 0; table < view.getUint16(4); table += 1) {
    const record = 12 + 16 * table;
    tables.set(font.toString('latin1', record, record + 4), view.getUint32(record + 8));
  }
  const head = tables.get('head');
  const os2 = tables.get('OS/2');
  if (head === undefined || os2 === undefined)
    throw new Error('The face has no head or OS/2 table');
  if (view.getUint16(os2) < 2)
    throw new Error('The face states no cap height: its OS/2 is too old');
  return view.getInt16(os2 + 88) / view.getUint16(head + 18);
}
