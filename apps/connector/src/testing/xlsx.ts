import { Buffer } from 'node:buffer';
import { createDeflateRaw, crc32, deflateRawSync } from 'node:zlib';

/**
 * Workbooks written by hand for the XLSX reader's suite (the D6 plan, task 3; the spike's
 * `lib/bombs.mjs`): a zip writer that can be made to lie - a local header disagreeing with the
 * directory, entries overlapping, a size or a checksum misstated - and the parts of a workbook, cell
 * by cell, so every cell is exactly what a case names. A bomb is deflated from a generator, never held
 * expanded.
 */

const u16 = (value: number) => {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
};
const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
};

/** An entry to write: its bytes, stored or deflated, or already deflated with its size and CRC. */
export interface ZipEntryInput {
  readonly name: string;
  readonly data?: Buffer;
  /** Stored rather than deflated, so the bytes are the same whatever zlib wrote them. */
  readonly stored?: boolean;
  /** Already deflated, as a bomb is: its compressed bytes, its inflated size and CRC-32. */
  readonly deflated?: { readonly bytes: Buffer; readonly size: number; readonly crc: number };
  /** Lies, each told in one place alone. */
  readonly localName?: string;
  readonly localSize?: number;
  readonly centralSize?: number;
  readonly centralCrc?: number;
}

/** A zip of the entries in order, each with a local header and a directory record. */
export function makeZip(entries: readonly ZipEntryInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = entry.data ?? Buffer.alloc(0);
    const method = entry.stored ? 0 : 8;
    const written =
      entry.deflated?.bytes ?? (method === 0 ? raw : deflateRawSync(raw, { level: 6 }));
    const size = entry.deflated?.size ?? raw.length;
    const crc = entry.deflated?.crc ?? crc32(raw);
    const name = Buffer.from(entry.name, 'utf8');
    const localName = Buffer.from(entry.localName ?? entry.name, 'utf8');
    const header = (sizeStated: number, nameBytes: Buffer, crcStated: number) => [
      u16(20),
      u16(0x800),
      u16(method),
      u16(0),
      u16(0x21),
      u32(crcStated),
      u32(written.length),
      u32(sizeStated),
      u16(nameBytes.length),
    ];
    const local = Buffer.concat([
      u32(0x04034b50),
      ...header(entry.localSize ?? size, localName, crc),
      u16(0),
      localName,
    ]);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        ...header(entry.centralSize ?? size, name, entry.centralCrc ?? crc),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    locals.push(local, written);
    offset += local.length + written.length;
  }
  const directory = Buffer.concat(centrals);
  return Buffer.concat([
    ...locals,
    directory,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(Math.min(entries.length, 0xffff)),
    u16(Math.min(entries.length, 0xffff)),
    u32(directory.length),
    u32(offset),
    u16(0),
  ]);
}

/** Deflates what a generator yields, holding only the compressed bytes. */
export async function deflateFrom(
  chunks: Iterable<Buffer>,
): Promise<{ bytes: Buffer; size: number; crc: number }> {
  const deflate = createDeflateRaw({ level: 9, memLevel: 9 });
  const out: Buffer[] = [];
  let crc = 0;
  let size = 0;
  deflate.on('data', (chunk: Buffer) => out.push(chunk));
  const done = new Promise((resolve) => deflate.on('end', resolve));
  for (const chunk of chunks) {
    crc = crc32(chunk, crc);
    size += chunk.length;
    if (!deflate.write(chunk)) await new Promise((resolve) => deflate.once('drain', resolve));
  }
  deflate.end();
  await done;
  return { bytes: Buffer.concat(out), size, crc };
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Text as XML holds it. */
export const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A cell, as a sheet's XML writes one. */
export const cell = {
  number: (ref: string, text: string, style?: number) =>
    `<c r="${ref}"${style === undefined ? '' : ` s="${style}"`}><v>${text}</v></c>`,
  text: (ref: string, text: string) =>
    `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`,
  shared: (ref: string, index: number) => `<c r="${ref}" t="s"><v>${index}</v></c>`,
  boolean: (ref: string, value: boolean) => `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`,
  error: (ref: string, text = '#DIV/0!') => `<c r="${ref}" t="e"><v>${text}</v></c>`,
  formula: (ref: string, formula: string, cached?: string) =>
    `<c r="${ref}"><f>${escapeXml(formula)}</f>${cached === undefined ? '' : `<v>${cached}</v>`}</c>`,
};

/** A row of cells, numbered. */
export const row = (r: number, cells: readonly string[]) => `<row r="${r}">${cells.join('')}</row>`;

/** A sheet's XML around its rows. */
export const sheetXml = (rows: string) =>
  `${DECLARATION}<worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData></worksheet>`;

/**
 * Styles a cell may name by its index: 0 general, 1 a date (built-in 14), 2 a date and time
 * (built-in 22), 3 a custom date and time with milliseconds, 4 a percentage.
 */
export const STYLES = `${DECLARATION}<styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd hh:mm:ss.000"/></numFmts><cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="22"/><xf numFmtId="164"/><xf numFmtId="10"/></cellXfs></styleSheet>`;

/** Shared strings, each one run, or more where a string is given as its runs. */
export function sharedStringsXml(strings: readonly (string | readonly string[])[]): string {
  const items = strings.map((each) =>
    typeof each === 'string'
      ? `<si><t xml:space="preserve">${escapeXml(each)}</t></si>`
      : `<si>${each.map((run) => `<r><t xml:space="preserve">${escapeXml(run)}</t></r>`).join('')}</si>`,
  );
  return `${DECLARATION}<sst xmlns="${MAIN}" count="${strings.length}" uniqueCount="${strings.length}">${items.join('')}</sst>`;
}

export interface WorkbookParts {
  /** Each sheet by its name and its XML. */
  readonly sheets: readonly { readonly name: string; readonly xml: string | Buffer }[];
  readonly shared?: readonly (string | readonly string[])[];
  readonly date1904?: boolean;
  readonly styles?: string;
  /** Written stored, so the bytes are the same wherever zlib wrote them. */
  readonly stored?: boolean;
  /** Entries in place of the ones written, by name, or more besides. */
  readonly replace?: Readonly<Record<string, Buffer>>;
}

/** A workbook's entries, in the order a writer puts them. */
export function workbookEntries(parts: WorkbookParts): ZipEntryInput[] {
  const sheets = parts.sheets
    .map(
      (sheet, at) =>
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${at + 1}" r:id="rId${at + 1}"/>`,
    )
    .join('');
  const rels = parts.sheets
    .map(
      (_, at) =>
        `<Relationship Id="rId${at + 1}" Type="${RELATIONSHIPS}/worksheet" Target="worksheets/sheet${at + 1}.xml"/>`,
    )
    .join('');
  const more = parts.sheets.length;
  const entries: [string, Buffer][] = [
    [
      '[Content_Types].xml',
      Buffer.from(
        `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
      ),
    ],
    [
      '_rels/.rels',
      Buffer.from(
        `${DECLARATION}<Relationships xmlns="${PACKAGE}"><Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    ],
    [
      'xl/workbook.xml',
      Buffer.from(
        `${DECLARATION}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><workbookPr${parts.date1904 ? ' date1904="1"' : ''}/><sheets>${sheets}</sheets></workbook>`,
      ),
    ],
    [
      'xl/_rels/workbook.xml.rels',
      Buffer.from(
        `${DECLARATION}<Relationships xmlns="${PACKAGE}">${rels}<Relationship Id="rId${more + 1}" Type="${RELATIONSHIPS}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId${more + 2}" Type="${RELATIONSHIPS}/styles" Target="/xl/styles.xml"/></Relationships>`,
      ),
    ],
    ['xl/sharedStrings.xml', Buffer.from(sharedStringsXml(parts.shared ?? []))],
    ['xl/styles.xml', Buffer.from(parts.styles ?? STYLES)],
    ...parts.sheets.map((sheet, at): [string, Buffer] => [
      `xl/worksheets/sheet${at + 1}.xml`,
      Buffer.isBuffer(sheet.xml) ? sheet.xml : Buffer.from(sheet.xml),
    ]),
  ];
  const replaced = new Map(entries);
  for (const [name, bytes] of Object.entries(parts.replace ?? {})) replaced.set(name, bytes);
  return [...replaced].map(([name, data]) => ({ name, data, stored: parts.stored ?? false }));
}

/** A workbook of the parts given. */
export const workbook = (parts: WorkbookParts) => makeZip(workbookEntries(parts));

/** A sheet of `rows` rows, each a number and some text, as a generator of its XML. */
export function* rowsXml(rows: number, text = 'x'.repeat(96)): Generator<Buffer> {
  yield Buffer.from(`${DECLARATION}<worksheet xmlns="${MAIN}"><sheetData>`);
  const parts: string[] = [];
  for (let r = 1; r <= rows; r += 1) {
    parts.push(row(r, [cell.number(`A${r}`, String(r)), cell.text(`B${r}`, text)]));
    if (parts.length === 2000) {
      yield Buffer.from(parts.join(''));
      parts.length = 0;
    }
  }
  if (parts.length) yield Buffer.from(parts.join(''));
  yield Buffer.from('</sheetData></worksheet>');
}

/** One shared string of `bytes` characters, as a generator of the part's XML. */
export function* hugeSharedString(bytes: number): Generator<Buffer> {
  yield Buffer.from(`${DECLARATION}<sst xmlns="${MAIN}" count="1" uniqueCount="1"><si><t>`);
  const block = Buffer.alloc(1 << 20, 0x78);
  for (let left = bytes; left > 0; left -= block.length) {
    yield left >= block.length ? block : block.subarray(0, left);
  }
  yield Buffer.from('</t></si></sst>');
}
