import { JsonNumber } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { fromJson, plainDecimal } from './cells.js';
import { countAgrees, firstRows, MAX_JSON_LINE_BYTES, parseJson, withinDepth } from './json.js';
import { JSON_MAX_BYTES } from './rows.js';

const body = (text: string) => Buffer.from(text, 'utf8');

/** Every row a body holds, or the code and the row it was refused with. */
function readRows(bytes: Buffer, format: Parameters<typeof firstRows>[1]) {
  const read = firstRows(bytes, format, Infinity);
  if (!('failure' in read)) return read;
  const { code, row } = read.failure;
  return { refused: code, ...(row === undefined ? {} : { row }) };
}

describe('JSON and JSON Lines', () => {
  it('DAT-095 reads rows at a pointer to an array of objects, or a line at a time, each column by a pointer into its row', () => {
    const read = readRows(body('{"data":{"items":[{"id":1,"site":{"name":"North"}},{"id":2}]}}'), {
      kind: 'json',
      rows: '/data/items',
    });
    expect('rows' in read && read.rows).toHaveLength(2);
    const lines = readRows(body('{"id":1}\r\n\n{"id":2}\n'), { kind: 'jsonLines' });
    expect('rows' in lines && lines.rows.map((row) => (row.id as JsonNumber).source)).toEqual([
      '1',
      '2',
    ]);
    // A pointer to something not an array, an item not an object, a line not an object, and text
    // that is not JSON or not UTF-8: none of them rows.
    expect(readRows(body('{"data":{"items":{}}}'), { kind: 'json', rows: '/data/items' })).toEqual({
      refused: 'result_mismatch',
    });
    expect(readRows(body('[{"id":1},2]'), { kind: 'json', rows: '' })).toEqual({
      refused: 'result_mismatch',
      row: 2,
    });
    expect(readRows(body('{"id":1}\n[1]'), { kind: 'jsonLines' })).toEqual({
      refused: 'result_mismatch',
      row: 2,
    });
    expect(readRows(body('{"items":'), { kind: 'json', rows: '/items' })).toEqual({
      refused: 'result_mismatch',
    });
    expect(readRows(Buffer.from([0x7b, 0xff, 0x7d]), { kind: 'json', rows: '' })).toEqual({
      refused: 'result_mismatch',
    });
    // A byte order mark is dropped, as RFC 8259 lets a reader.
    expect(
      'rows' in
        readRows(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body('[{}]')]), {
          kind: 'json',
          rows: '',
        }),
    ).toBe(true);
  });

  it('DAT-095 reads a number from its source text: a 30-digit integer and a decimal exactly, never through a double', () => {
    const value = parseJson('{"big":123456789012345678901234567890,"places":0.10,"tiny":1e-7}');
    const row = value as Record<string, JsonNumber>;
    expect(row.big!.source).toBe('123456789012345678901234567890');
    expect(fromJson(row.big, { base: 'integer' })).toEqual({
      value: '123456789012345678901234567890',
    });
    expect(fromJson(row.places, { base: 'decimal', precision: 4, scale: 2 })).toEqual({
      value: '0.1',
    });
    expect(fromJson(row.tiny, { base: 'decimal', precision: 10, scale: 7 })).toEqual({
      value: '0.0000001',
    });
    // More places than declared is refused by name, never rounded.
    expect(fromJson(row.tiny, { base: 'decimal', precision: 10, scale: 2 })).toEqual({
      refused: 'precision_lost',
    });
    expect(fromJson(new JsonNumber('1.5'), { base: 'integer' })).toEqual({
      refused: 'precision_lost',
    });
    expect(fromJson(new JsonNumber('1.50e1'), { base: 'integer' })).toEqual({ value: '15' });
    expect(plainDecimal('-1.2e-3')).toBe('-0.0012');
    expect(plainDecimal('12E+2')).toBe('1200');
    // A decimal an API sends as text, to keep its places.
    expect(fromJson('12.50', { base: 'decimal', precision: 5, scale: 2 })).toEqual({
      value: '12.5',
    });
  });

  it('DAT-095 refuses a nested object or array, nested_value, unless its column is text, and writes it canonically', () => {
    const one = parseJson('{"detail":{"b":1.50,"a":[2, 3]}}') as Record<string, never>;
    const two = parseJson('{"detail":{ "a" : [2,3], "b" : 1.50 }}') as Record<string, never>;
    expect(fromJson(one.detail, { base: 'integer' })).toEqual({ refused: 'nested_value' });
    expect(fromJson([] as never, { base: 'date' })).toEqual({ refused: 'nested_value' });
    // The canonical text: reformatting and reordering at the source move nothing.
    expect(fromJson(one.detail, { base: 'text' })).toEqual({ value: '{"a":[2,3],"b":1.50}' });
    expect(fromJson(two.detail, { base: 'text' })).toEqual(fromJson(one.detail, { base: 'text' }));
  });

  it('reads each type from its JSON kind: dates and times as ISO text, an instant by its zone', () => {
    expect(fromJson(true, { base: 'boolean' })).toEqual({ value: true });
    expect(fromJson('true', { base: 'boolean' })).toEqual({ refused: 'result_mismatch' });
    expect(fromJson(null, { base: 'integer' })).toEqual({ value: null });
    expect(fromJson(undefined, { base: 'text' })).toEqual({ value: null });
    expect(fromJson(new JsonNumber('7'), { base: 'text' })).toEqual({ value: '7' });
    expect(fromJson('2026-02-28', { base: 'date' })).toEqual({ value: '2026-02-28' });
    expect(fromJson('2026-02-30', { base: 'date' })).toEqual({ refused: 'value_unrepresentable' });
    expect(fromJson('03:04:05.500', { base: 'time', fraction: 3 })).toEqual({
      value: '03:04:05.5',
    });
    expect(fromJson('2026-01-02T03:04:05', { base: 'localDateTime', fraction: 0 })).toEqual({
      value: '2026-01-02T03:04:05',
    });
    expect(fromJson('2026-01-02T03:04:05.25Z', { base: 'instant', fraction: 2 })).toEqual({
      value: '2026-01-02T03:04:05.25Z',
    });
    // An offset moved to UTC, across a day and a year.
    expect(fromJson('2026-01-01T00:30:00+01:00', { base: 'instant', fraction: 0 })).toEqual({
      value: '2025-12-31T23:30:00Z',
    });
    expect(fromJson('2026-01-02T03:04:05', { base: 'instant', fraction: 0 })).toEqual({
      refused: 'zone_missing',
    });
    expect(fromJson('2026-01-02T03:04:05.123Z', { base: 'instant', fraction: 2 })).toEqual({
      refused: 'precision_lost',
    });
  });

  it('refuses a JSON line longer than a JSON body may be, byte_limit, before it is parsed', () => {
    const line = (bytes: number) => `{"a":"${'x'.repeat(bytes - 8)}"}`;
    expect(line(MAX_JSON_LINE_BYTES)).toHaveLength(MAX_JSON_LINE_BYTES);
    expect(MAX_JSON_LINE_BYTES).toBe(JSON_MAX_BYTES);
    const lines = (...texts: string[]) => body(`${texts.join('\n')}\n`);
    expect(
      readRows(lines(line(16), line(MAX_JSON_LINE_BYTES)), { kind: 'jsonLines' }),
    ).toMatchObject({
      rows: [{}, {}],
    });
    expect(readRows(lines(line(16), line(MAX_JSON_LINE_BYTES + 1)), { kind: 'jsonLines' })).toEqual(
      { refused: 'byte_limit', row: 2 },
    );
    // The last line, with no line feed after it, is held to it too.
    expect(readRows(body(line(MAX_JSON_LINE_BYTES + 1)), { kind: 'jsonLines' })).toEqual({
      refused: 'byte_limit',
      row: 1,
    });
  });

  it('refuses JSON nesting deeper than 64 before it is parsed, and checks a stated count', () => {
    const deep = (levels: number) => '['.repeat(levels) + ']'.repeat(levels);
    expect(withinDepth(deep(64))).toBe(true);
    expect(withinDepth(deep(65))).toBe(false);
    // Brackets inside a string are text, an escaped quote among them.
    expect(withinDepth(`["${'['.repeat(100)}\\"${'{'.repeat(100)}"]`)).toBe(true);
    expect(parseJson(deep(100_000))).toBeUndefined();
    expect(countAgrees(new JsonNumber('3'), 3)).toBe(true);
    expect(countAgrees(new JsonNumber('3.0'), 3)).toBe(false);
    expect(countAgrees('3', 3)).toBe(false);
    expect(countAgrees(undefined, 0)).toBe(false);
  });
});
