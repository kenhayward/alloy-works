import { defaultLimits, type Column } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { eachRecord, type CsvField, type CsvFormat } from './csv.js';
import { proposeColumns, readRows } from './rows.js';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const body = (...lines: string[]) => Buffer.from(lines.join(LF) + LF, 'utf8');

const csv = (over: Partial<CsvFormat> = {}): CsvFormat => ({
  kind: 'csv',
  delimiter: 'comma',
  headerRow: true,
  null: 'empty',
  ...over,
});

/** Every record a body holds, or the failure's code and where it names. */
function records(bytes: Buffer, format: CsvFormat, max = 1024 * 1024) {
  const out: (readonly CsvField[])[] = [];
  const read = eachRecord(bytes, format, max, (record) => {
    out.push(record);
    return undefined;
  });
  if ('failure' in read) return { refused: read.failure.code, row: read.failure.row };
  return out;
}

const text = (name: string, from: Column['from']): Column => ({
  name,
  from,
  type: { base: 'text' },
});

describe('CSV', () => {
  it("reads null by the declared convention: an unquoted empty field is null under empty, and a quoted one is empty text; under never, both are text", () => {
    const bytes = body('id,note', '1,', '2,""', '3,"a, b"');
    expect(records(bytes, csv())).toEqual([
      ['1', null],
      ['2', ''],
      ['3', 'a, b'],
    ]);
    expect(records(bytes, csv({ null: 'never' }))).toEqual([
      ['1', ''],
      ['2', ''],
      ['3', 'a, b'],
    ]);
  });

  it('reads each delimiter, CRLF and a byte order mark, a quote doubled within a quoted field, and a line break in one', () => {
    expect(records(Buffer.from(`a;b${CR}${LF}1;2${CR}${LF}`), csv({ delimiter: 'semicolon' }))).toEqual([
      ['1', '2'],
    ]);
    expect(records(Buffer.from(`a${TAB}b${LF}1${TAB}2${LF}`), csv({ delimiter: 'tab' }))).toEqual([
      ['1', '2'],
    ]);
    expect(records(Buffer.from(`a|b${LF}1|2${LF}`), csv({ delimiter: 'pipe' }))).toEqual([['1', '2']]);
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body('a', '"say ""hi"""', `"one${LF}two"`)]);
    expect(records(bom, csv())).toEqual([['say "hi"'], [`one${LF}two`]]);
    // No header: every record is a row.
    expect(records(body('1,2', '3,4'), csv({ headerRow: false }))).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('refuses a record past max_record_size, byte_limit, and a record of another width, an open quote or text not UTF-8, result_mismatch', () => {
    const long = body('a,b', `1,${'x'.repeat(2000)}`);
    expect(records(long, csv(), 1000)).toEqual({ refused: 'byte_limit', row: undefined });
    expect(records(long, csv(), 4000)).toHaveLength(1);
    expect(records(body('a,b', '1,2', '3'), csv())).toEqual({ refused: 'result_mismatch', row: 2 });
    expect(records(body('a,b', '1,"open'), csv())).toEqual({ refused: 'result_mismatch', row: 1 });
    expect(records(Buffer.from([0x61, 0x0a, 0xff, 0x0a]), csv())).toEqual({
      refused: 'result_mismatch',
      row: undefined,
    });
  });

  it('reads each column by its header or its letter into its declared type, and names the column a header does not', () => {
    const bytes = body(
      'id,site,depth,measured,taken,active',
      '1,North weir,12.50,2026-01-02,2026-01-02T03:04:05.5Z,true',
      '2,,7.25,2026-01-03,2026-01-03T04:05:06+01:00,FALSE',
    );
    const columns: Column[] = [
      { name: 'id', from: { letter: 'A' }, type: { base: 'integer' } },
      text('site', { header: 'site' }),
      { name: 'depth', from: { header: 'depth' }, type: { base: 'decimal', precision: 8, scale: 2 } },
      { name: 'measured', from: { letter: 'D' }, type: { base: 'date' } },
      { name: 'taken', from: { header: 'taken' }, type: { base: 'instant', fraction: 3 } },
      { name: 'active', from: { header: 'active' }, type: { base: 'boolean' } },
    ];
    expect(readRows(bytes, csv(), columns, defaultLimits)).toMatchObject({
      rows: [
        ['1', 'North weir', '12.5', '2026-01-02', '2026-01-02T03:04:05.5Z', true],
        ['2', null, '7.25', '2026-01-03', '2026-01-03T03:05:06Z', false],
      ],
    });
    const missing = readRows(bytes, csv(), [text('river', { header: 'river' })], defaultLimits);
    expect(missing).toEqual({
      failure: { code: 'result_mismatch', attribution: 'query', column: 'river' },
    });
    const twice = readRows(body('a,a', '1,2'), csv(), [text('a', { header: 'a' })], defaultLimits);
    expect(twice).toMatchObject({ failure: { code: 'result_mismatch', column: 'a' } });
    const beyond = readRows(body('a', '1'), csv(), [text('c', { letter: 'C' })], defaultLimits);
    expect(beyond).toMatchObject({ failure: { code: 'result_mismatch', column: 'c' } });
    // A value its type cannot hold is named by its row and column.
    const bad = readRows(
      body('id', 'one'),
      csv(),
      [{ name: 'id', from: { header: 'id' }, type: { base: 'integer' } }],
      defaultLimits,
    );
    expect(bad).toMatchObject({ failure: { code: 'result_mismatch', column: 'id', row: 1 } });
  });

  it('DAT-105 proposes a column for each field, by its header where the first record is one and by its letter where not', () => {
    const bytes = body('id,site,depth,measured,active,two words', '1,North,1.5,2026-01-02,true,x');
    expect(proposeColumns(bytes, csv())).toEqual({
      columns: [
        { name: 'id', sourceType: 'text', proposed: { base: 'integer' }, header: 'id' },
        { name: 'site', sourceType: 'text', proposed: { base: 'text' }, header: 'site' },
        {
          name: 'depth',
          sourceType: 'text',
          proposed: { base: 'decimal', precision: 32, scale: 2 },
          header: 'depth',
        },
        { name: 'measured', sourceType: 'text', proposed: { base: 'date' }, header: 'measured' },
        { name: 'active', sourceType: 'text', proposed: { base: 'boolean' }, header: 'active' },
        { name: 'two words', sourceType: 'text', proposed: { base: 'text' }, header: 'two words' },
      ],
      parameters: [],
    });
    expect(proposeColumns(body('1,North'), csv({ headerRow: false }))).toEqual({
      columns: [
        { name: 'column_A', sourceType: 'text', proposed: { base: 'integer' }, letter: 'A' },
        { name: 'column_B', sourceType: 'text', proposed: { base: 'text' }, letter: 'B' },
      ],
      parameters: [],
    });
  });
});
