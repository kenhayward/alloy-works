// Phase 3, case 7: inputs whose expanded size dwarfs their size on the wire or on disk, made in memory
// from generators and never written out expanded. A zip written by hand around Node's native deflate,
// so a gigabyte of XML costs seconds and a megabyte or so of memory.
import zlib from 'node:zlib';

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

async function deflateGen(gen) {
  const d = zlib.createDeflateRaw({ level: 9, memLevel: 9 });
  const out = []; let crc = 0; let size = 0;
  d.on('data', (c) => out.push(c));
  const done = new Promise((r) => d.on('end', r));
  for (const chunk of gen) {
    crc = zlib.crc32(chunk, crc); size += chunk.length;
    if (!d.write(chunk)) await new Promise((r) => d.once('drain', r));
  }
  d.end(); await done;
  return { data: Buffer.concat(out), crc, size };
}

// entries: [{ name, gen: () => iterable of Buffers, declaredSize? }]. `declaredSize` lies about the
// expanded size in both headers, for a reader that trusts them.
export async function makeZip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const e of entries) {
    const { data, crc, size } = await deflateGen(e.gen());
    const name = Buffer.from(e.name);
    const usize = e.declaredSize ?? size;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0x21), u32(crc), u32(data.length), u32(usize), u16(name.length), u16(0), name]);
    locals.push(local, data);
    centrals.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0x21), u32(crc), u32(data.length), u32(usize), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, cd, end]);
}

const WB = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
const ROOTRELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const once = (s) => () => [Buffer.from(s)];

// A sheet of real rows whose XML is `bytes` long: row n is <row r="n"><c r="An"><v>n</v></c><c r="Bn" t="inlineStr"><is><t>xxxx</t></is></c></row>.
function* sheetRows(bytes) {
  const head = Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>');
  const tail = Buffer.from('</sheetData></worksheet>');
  yield head; let n = head.length + tail.length; let r = 0; const parts = [];
  while (true) {
    r++;
    const row = `<row r="${r}"><c r="A${r}"><v>${r}</v></c><c r="B${r}" t="inlineStr"><is><t>xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</t></is></c></row>`;
    if (n + row.length > bytes) break;
    parts.push(row); n += row.length;
    if (parts.length === 2000) { yield Buffer.from(parts.join('')); parts.length = 0; }
  }
  if (parts.length) yield Buffer.from(parts.join(''));
  yield tail;
}
// One shared string of `bytes` characters, and a sheet whose one cell refers to it.
function* hugeSst(bytes) {
  yield Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1"><si><t>');
  const block = Buffer.alloc(1 << 20, 0x78); let left = bytes;
  while (left > 0) { const b = left >= block.length ? block : block.subarray(0, left); yield b; left -= b.length; }
  yield Buffer.from('</t></si></sst>');
}
const oneCellSheet = once('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>');
const emptySst = once('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="0" uniqueCount="0"></sst>');

export function xlsxOfRows(sheetBytes) {
  return makeZip([
    { name: '[Content_Types].xml', gen: once(CT) }, { name: '_rels/.rels', gen: once(ROOTRELS) },
    { name: 'xl/workbook.xml', gen: once(WB) }, { name: 'xl/_rels/workbook.xml.rels', gen: once(RELS) },
    { name: 'xl/worksheets/sheet1.xml', gen: () => sheetRows(sheetBytes) }, { name: 'xl/sharedStrings.xml', gen: emptySst },
  ]);
}
export function xlsxSharedStringBomb(stringBytes) {
  return makeZip([
    { name: '[Content_Types].xml', gen: once(CT) }, { name: '_rels/.rels', gen: once(ROOTRELS) },
    { name: 'xl/workbook.xml', gen: once(WB) }, { name: 'xl/_rels/workbook.xml.rels', gen: once(RELS) },
    { name: 'xl/sharedStrings.xml', gen: () => hugeSst(stringBytes) }, { name: 'xl/worksheets/sheet1.xml', gen: oneCellSheet },
  ]);
}

// CSV: rows of `id,payload` up to `bytes`, or one line with no end.
export function* csvRowsGen(bytes) {
  let n = 0; let r = 0; const parts = [];
  yield Buffer.from('id,payload\n'); n += 11;
  while (true) {
    const line = `${++r},xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n`;
    if (n + line.length > bytes) break;
    parts.push(line); n += line.length;
    if (parts.length === 5000) { yield Buffer.from(parts.join('')); parts.length = 0; }
  }
  if (parts.length) yield Buffer.from(parts.join(''));
}
export function* csvOneLineGen(bytes) {
  yield Buffer.from('id,payload\n1,"');
  const block = Buffer.alloc(1 << 20, 0x78); let left = bytes;
  while (left > 0) { const b = left >= block.length ? block : block.subarray(0, left); yield b; left -= b.length; }
  yield Buffer.from('"\n');
}
