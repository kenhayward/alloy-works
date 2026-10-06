import { defaultLimits, type Column, type DataFormat, type Limits } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import {
  cell,
  deflateFrom,
  hugeSharedString,
  makeZip,
  row,
  rowsXml,
  sheetXml,
  workbook,
  workbookEntries,
  type WorkbookParts,
} from '../testing/xlsx.js';
import { proposeColumns, readRows, XLSX_MAX_BYTES } from './rows.js';
import { readZip } from './zip.js';

const XLSX = { kind: 'xlsx', sheet: 'Readings', headerRow: true } as const satisfies DataFormat;

const col = (name: string, type: Column['type'], from: Column['from'] = { header: name }) =>
  ({ name, from, type }) as Column;

/** One sheet named Readings, its rows given. */
const book = (rows: string, over: Partial<WorkbookParts> = {}) =>
  workbook({ sheets: [{ name: 'Readings', xml: sheetXml(rows) }], ...over });

/** The rows a body reads to, or the failure's code and what it names. */
function read(
  body: Buffer,
  columns: Column[],
  format: DataFormat = XLSX,
  limits: Limits = { ...defaultLimits },
) {
  const answer = readRows(body, format, columns, limits);
  if ('failure' in answer) {
    const { code, column, row: at } = answer.failure;
    return { refused: code, ...(column ? { column } : {}), ...(at ? { row: at } : {}) };
  }
  return answer.rows;
}

const header = (...names: string[]) =>
  row(
    1,
    names.map((name, at) => cell.text(`${String.fromCharCode(65 + at)}1`, name)),
  );

describe('the XLSX reader', () => {
  it("reads its declared sheet: shared and inline strings, numbers by their source text, booleans, an absent cell null, a formula's cached value, a phonetic run left out", () => {
    const body = workbook({
      sheets: [
        { name: 'Other', xml: sheetXml(row(1, [cell.text('A1', 'not this one')])) },
        {
          name: 'Readings',
          xml: sheetXml(
            header('id', 'site', 'depth', 'active', 'note') +
              row(2, [
                cell.number('A2', '1'),
                cell.shared('B2', 0),
                cell.number('C2', '12.5'),
                cell.boolean('D2', true),
                cell.shared('E2', 1),
              ]) +
              row(3, [
                cell.formula('A3', 'A2+1', '2'),
                cell.text('B3', 'South weir'),
                cell.number('C3', '7.25'),
                cell.boolean('D3', false),
              ]) +
              // A row of nothing but styles is no row.
              '<row r="4"><c r="A4" s="1"/></row>' +
              row(5, [
                cell.number('A5', '3'),
                cell.text('B5', 'East gauge'),
                cell.number('C5', '0.75'),
                cell.boolean('D5', true),
                cell.text('E5', ''),
              ]),
          ),
        },
      ],
      shared: ['North weir', ['Gauge', ', east bank']],
      // A phonetic run in a shared string is no part of its text.
      replace: {},
    });
    expect(
      read(body, [
        col('id', { base: 'integer' }),
        col('site', { base: 'text' }),
        col('depth', { base: 'decimal', precision: 8, scale: 2 }),
        col('active', { base: 'boolean' }),
        col('note', { base: 'text' }),
      ]),
    ).toEqual([
      ['1', 'North weir', '12.5', true, 'Gauge, east bank'],
      ['2', 'South weir', '7.25', false, null],
      ['3', 'East gauge', '0.75', true, ''],
    ]);
    const phonetic = book(row(1, [cell.shared('A1', 0)]), {
      replace: {
        'xl/sharedStrings.xml': Buffer.from(
          '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><r><t>東京</t></r><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></si></sst>',
        ),
      },
    });
    expect(
      read(phonetic, [col('city', { base: 'text' }, { letter: 'A' })], {
        ...XLSX,
        headerRow: false,
      }),
    ).toEqual([['東京']]);
  });

  it('reads a column by its header or its letter as a CSV is read, and refuses a header missing or named twice, a sheet not in the workbook, and rows or cells out of order, result_mismatch', () => {
    const rows =
      header('id', 'site', 'id') + row(2, [cell.number('A2', '1'), cell.text('B2', 'x')]);
    expect(
      read(book(rows), [
        col('site', { base: 'text' }),
        col('a', { base: 'integer' }, { letter: 'A' }),
      ]),
    ).toEqual([['x', '1']]);
    expect(read(book(rows), [col('id', { base: 'integer' })])).toEqual({
      refused: 'result_mismatch',
      column: 'id',
    });
    expect(read(book(rows), [col('depth', { base: 'text' })])).toEqual({
      refused: 'result_mismatch',
      column: 'depth',
    });
    // A letter past every cell a row holds reads null, as an absent cell.
    expect(read(book(rows), [col('z', { base: 'text' }, { letter: 'Z' })])).toEqual([[null]]);
    expect(
      read(book(rows), [col('site', { base: 'text' })], { ...XLSX, sheet: 'Missing' }),
    ).toEqual({ refused: 'result_mismatch' });
    const site = [col('site', { base: 'text' }, { letter: 'A' })];
    const plain = { ...XLSX, headerRow: false };
    for (const disordered of [
      row(2, [cell.text('A2', 'x')]) + row(2, [cell.text('A2', 'y')]),
      row(3, [cell.text('A3', 'x')]) + row(2, [cell.text('A2', 'y')]),
      row(1, [cell.text('B1', 'x'), cell.text('A1', 'y')]),
      row(1, [cell.text('A2', 'x')]),
      row(1, [cell.shared('A1', 5)]),
    ]) {
      expect(read(book(disordered), site, plain), disordered).toEqual({
        refused: 'result_mismatch',
      });
    }
  });

  it("converts serials in the workbook's date system: 1900's either side of its serial 60 and 1904's from its own epoch, a date and time to the microsecond", () => {
    const columns = [
      col('d', { base: 'date' }, { letter: 'A' }),
      col('at', { base: 'localDateTime', fraction: 6 }, { letter: 'B' }),
      col('tm', { base: 'time', fraction: 6 }, { letter: 'C' }),
    ];
    const plain = { ...XLSX, headerRow: false };
    const rows = (dates: readonly string[]) =>
      dates
        .map((date, at) =>
          row(at + 1, [
            cell.number(`A${at + 1}`, date, 1),
            cell.number(`B${at + 1}`, '46110.06250142889', 3),
            cell.number(`C${at + 1}`, '0.999999999988426', 3),
          ]),
        )
        .join('');
    expect(read(book(rows(['1', '59', '61', '46024'])), columns, plain)).toEqual([
      ['1900-01-01', '2026-03-29T01:30:00.123456', '23:59:59.999999'],
      ['1900-02-28', '2026-03-29T01:30:00.123456', '23:59:59.999999'],
      ['1900-03-01', '2026-03-29T01:30:00.123456', '23:59:59.999999'],
      ['2026-01-02', '2026-03-29T01:30:00.123456', '23:59:59.999999'],
    ]);
    // The same days in the 1904 system, its serials 1,462 fewer; read as 1900's, four years early.
    const in1904 = book(
      row(1, [cell.number('A1', '0', 1)]) + row(2, [cell.number('A2', String(46024 - 1462), 1)]),
      { date1904: true },
    );
    expect(read(in1904, [columns[0]!], plain)).toEqual([['1904-01-01'], ['2026-01-02']]);
    // A time of day whose fraction carries it into the next day is no time of day.
    expect(
      read(
        book(row(1, [cell.number('A1', '1.5')])),
        [col('t', { base: 'time', fraction: 0 }, { letter: 'A' })],
        plain,
      ),
    ).toEqual({ refused: 'value_unrepresentable', column: 't', row: 1 });
  });

  it('DAT-080 refuses what a sheet cannot deliver exactly in its declared type by name: serial 60 nonexistent_date, 0.30000000000000004 into scale 2 precision_lost, an uncached formula and an error cell cell_error, a serial too coarse for microseconds precision_not_carried, and an instant zone_missing', () => {
    const plain = { ...XLSX, headerRow: false };
    const one = (xml: string, type: Column['type']) =>
      read(book(row(1, [xml])), [col('v', type, { letter: 'A' })], plain);
    expect(one(cell.number('A1', '60', 1), { base: 'date' })).toEqual({
      refused: 'nonexistent_date',
      column: 'v',
      row: 1,
    });
    expect(one(cell.number('A1', '60.5', 2), { base: 'localDateTime', fraction: 0 })).toMatchObject(
      { refused: 'nonexistent_date' },
    );
    expect(
      one(cell.number('A1', '0.30000000000000004'), { base: 'decimal', precision: 10, scale: 2 }),
    ).toMatchObject({ refused: 'precision_lost' });
    // The same number is its own source text as text, never a double's.
    expect(one(cell.number('A1', '0.30000000000000004'), { base: 'text' })).toEqual([
      ['0.30000000000000004'],
    ]);
    expect(one(cell.formula('A1', 'B1*2'), { base: 'integer' })).toMatchObject({
      refused: 'cell_error',
    });
    expect(one(cell.error('A1'), { base: 'text' })).toMatchObject({ refused: 'cell_error' });
    // 2080-01-01 and 0.123456 seconds: past serial 65536 a double spaces microseconds 1.26 apart.
    expect(
      one(cell.number('A1', '65746.00000142888', 3), { base: 'localDateTime', fraction: 6 }),
    ).toMatchObject({ refused: 'precision_not_carried' });
    // Read to milliseconds, the serial holds more than was declared.
    expect(
      one(cell.number('A1', '65746.00000142888', 3), { base: 'localDateTime', fraction: 3 }),
    ).toMatchObject({ refused: 'precision_lost' });
    expect(one(cell.number('A1', '46024.5', 1), { base: 'date' })).toMatchObject({
      refused: 'precision_lost',
    });
    expect(one(cell.number('A1', '46024', 1), { base: 'instant', fraction: 0 })).toMatchObject({
      refused: 'zone_missing',
    });
    // An instant typed as text, with its zone, is read as its text says.
    expect(
      one(cell.text('A1', '2026-03-29T01:30:00+01:00'), { base: 'instant', fraction: 0 }),
    ).toEqual([['2026-03-29T00:30:00Z']]);
  });

  it('proposes columns from a sample by header, a number under a date format a date', () => {
    const body = book(
      header('id', 'site', 'measured', 'taken', 'active') +
        row(2, [
          cell.number('A2', '1'),
          cell.text('B2', 'North weir'),
          cell.number('C2', '46024', 1),
          cell.number('D2', '46024.127841435184', 3),
          cell.boolean('E2', true),
        ]),
    );
    const proposed = proposeColumns(body, XLSX);
    expect(proposed).toEqual({
      columns: [
        { name: 'id', sourceType: 'number', proposed: { base: 'integer' }, header: 'id' },
        { name: 'site', sourceType: 'string', proposed: { base: 'text' }, header: 'site' },
        { name: 'measured', sourceType: 'date', proposed: { base: 'date' }, header: 'measured' },
        {
          name: 'taken',
          sourceType: 'date',
          proposed: { base: 'localDateTime', fraction: 3 },
          header: 'taken',
        },
        { name: 'active', sourceType: 'boolean', proposed: { base: 'boolean' }, header: 'active' },
      ],
      parameters: [],
    });
  });
});

describe('a hostile workbook', () => {
  const site = [col('site', { base: 'text' }, { letter: 'A' })];
  const plain = { ...XLSX, headerRow: false };
  const small = () =>
    workbookEntries({
      sheets: [{ name: 'Readings', xml: sheetXml(row(1, [cell.text('A1', 'x')])) }],
    });

  it('DAT-110 refuses a sheet bomb, a shared-strings bomb and a flood of empty entries, byte_limit, every inflated byte counted', async () => {
    // A sheet of real rows that inflates to four times the ceiling from under the ceiling deflated.
    const sheet = await deflateFrom(rowsXml(70_000, 'x'.repeat(1000)));
    expect(sheet.size).toBeGreaterThan(4 * XLSX_MAX_BYTES);
    const sheetBomb = makeZip(
      small().map((entry) =>
        entry.name === 'xl/worksheets/sheet1.xml' ? { name: entry.name, deflated: sheet } : entry,
      ),
    );
    expect(sheetBomb.length).toBeLessThan(XLSX_MAX_BYTES);
    expect(
      read(sheetBomb, site, plain, { rows: 100_000, bytes: 25 * 1024 * 1024, seconds: 30 }),
    ).toEqual({
      refused: 'byte_limit',
    });
    // One shared string past the ceiling, read before the sheet.
    const strings = await deflateFrom(hugeSharedString(2 * XLSX_MAX_BYTES));
    const stringBomb = makeZip(
      small().map((entry) =>
        entry.name === 'xl/sharedStrings.xml' ? { name: entry.name, deflated: strings } : entry,
      ),
    );
    expect(read(stringBomb, site, plain)).toEqual({ refused: 'byte_limit' });
    // A flood of entries is refused from the directory, before anything inflates: 65,000, the most
    // a zip without ZIP64 states but one; and 100,000, which only ZIP64 can state, refused as that.
    const flood = (count: number) =>
      makeZip([
        ...small(),
        ...Array.from({ length: count }, (_, at) => ({ name: `e/${at}`, stored: true })),
      ]);
    expect(read(flood(65_000), site, plain)).toEqual({ refused: 'byte_limit' });
    expect(read(flood(100_000), site, plain)).toEqual({ refused: 'result_mismatch' });
    // A byte limit under the ceiling bounds what inflates the same way.
    const rows = await deflateFrom(rowsXml(20_000));
    const modest = makeZip(
      small().map((entry) =>
        entry.name === 'xl/worksheets/sheet1.xml' ? { name: entry.name, deflated: rows } : entry,
      ),
    );
    expect(
      read(modest, site, plain, { ...defaultLimits, rows: 100_000, bytes: 1024 * 1024 }),
    ).toEqual({
      refused: 'byte_limit',
    });
  });

  it('DAT-110 refuses one shared string read into many cells past the byte limit, byte_limit, before the rows are finished', () => {
    const many = Array.from({ length: 2000 }, (_, at) =>
      row(at + 1, [cell.shared(`A${at + 1}`, 0)]),
    );
    const body = book(many.join(''), { shared: ['x'.repeat(4096)] });
    expect(body.length).toBeLessThan(64 * 1024);
    expect(read(body, site, plain, { ...defaultLimits, bytes: 1024 * 1024 })).toEqual({
      refused: 'byte_limit',
    });
  });

  it('refuses a DOCTYPE in any part, an entity declared in it or not, result_mismatch', () => {
    const LT = '<';
    const entity = `${LT}!DOCTYPE sst [${LT}!ENTITY x "${'y'.repeat(10)}">]>`;
    const external = `${LT}!DOCTYPE worksheet [${LT}!ENTITY e SYSTEM "file:///etc/passwd">]>`;
    const sheet = sheetXml(row(1, [cell.text('A1', 'x')]));
    for (const body of [
      book('', {
        replace: {
          'xl/sharedStrings.xml': Buffer.from(
            `${entity}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>&x;</t></si></sst>`,
          ),
        },
      }),
      book('', {
        replace: { 'xl/worksheets/sheet1.xml': Buffer.from(sheet.replace('?>', `?>${external}`)) },
      }),
      book('', {
        replace: {
          'xl/worksheets/sheet1.xml': Buffer.from(
            sheet.replace('?>', `?>${LT}!DOCTYPE worksheet>`),
          ),
        },
      }),
    ]) {
      expect(read(body, site, plain)).toEqual({ refused: 'result_mismatch' });
    }
  });

  it('refuses a zip whose local headers disagree with its directory, whose entries overlap, or whose sizes or checksums lie, result_mismatch', () => {
    const entries = small();
    const lying = (name: string, lie: object) =>
      makeZip(entries.map((entry) => (entry.name === name ? { ...entry, ...lie } : entry)));
    const sheet = 'xl/worksheets/sheet1.xml';
    for (const body of [
      // The local header names another part than the directory does.
      lying(sheet, { localName: 'xl/worksheets/sheet2.xml' }),
      lying(sheet, { localSize: 3 }),
      // The directory understates what inflates, or states another checksum.
      lying(sheet, { centralSize: 10, localSize: 10 }),
      lying(sheet, { centralCrc: 1 }),
      // A part named twice reads one way here and another elsewhere.
      makeZip([...entries, { name: 'XL/workbook.xml', data: Buffer.from('<workbook/>') }]),
      // Not a zip at all.
      Buffer.from('id,site\n1,North weir\n'),
    ]) {
      expect(read(body, site, plain)).toEqual({ refused: 'result_mismatch' });
    }
    // Overlapping entries: the first's stated length runs over the second's local header.
    const whole = makeZip([
      { name: 'a', data: Buffer.from('aaaa'), stored: true },
      { name: 'b', data: Buffer.from('bbbb'), stored: true },
    ]);
    expect('entries' in readZip(whole)).toBe(true);
    const overlapping = Buffer.from(whole);
    // Entry a's compressed size, in its local header (offset 18) and its directory record.
    const directory = overlapping.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    overlapping.writeUInt32LE(20, 18);
    overlapping.writeUInt32LE(20, directory + 20);
    expect(readZip(overlapping)).toEqual({
      failure: { code: 'result_mismatch', attribution: 'query' },
    });
  });
});
