import { Buffer } from 'node:buffer';

import type { Column, ColumnType, DataFormat } from '@alloy-works/domain';

import { cell, row, sheetXml, workbook } from './xlsx.js';

/**
 * Case 6's one logical result (ADR-0035; the D6 plan, task 3) - `sample.typed` in the PostgreSQL
 * source's seed - written as each file format writes it, so one table read from PostgreSQL, JSON,
 * JSON Lines, CSV and XLSX, over HTTP and over S3, gives one checksum. Each format carries each value
 * as it can: JSON a number by its digits; CSV everything as text, null an unquoted empty field; XLSX a
 * number as a double where one holds it exactly and as text where none does (a 28-digit decimal, an
 * int64), a date or a time as a serial in the 1900 system, and an instant, which a serial cannot
 * zone, as text. `deploy/sources` holds these bytes, which the suite checks it still does.
 */

/** The columns, by name and type, as the PostgreSQL definition declares them. */
export const TYPED_COLUMNS: readonly (readonly [string, ColumnType])[] = [
  ['k', { base: 'integer' }],
  ['dec', { base: 'decimal', precision: 28, scale: 10 }],
  ['big', { base: 'integer' }],
  ['amount', { base: 'decimal', precision: 19, scale: 4 }],
  ['d', { base: 'date' }],
  ['ldt', { base: 'localDateTime', fraction: 6 }],
  ['inst', { base: 'instant', fraction: 6 }],
  ['tm', { base: 'time', fraction: 6 }],
  ['flag', { base: 'boolean' }],
  ['note', { base: 'text' }],
  ['empty', { base: 'text' }],
  ['txt', { base: 'text' }],
];

/** A value as a file holds it: a number by its text, text, a boolean, or null. */
type Held = { readonly number: string } | string | boolean | null;

/** A date and a time, as text and as its 1900-system serial's parts. */
interface Moment {
  readonly text: string;
  readonly days: number;
  readonly seconds: number;
}

/** The three rows of `sample.typed`, each value as the source holds it. */
const ROWS: readonly {
  readonly k: string;
  readonly dec: string;
  readonly big: string;
  readonly amount: string;
  readonly d: Moment;
  readonly ldt: Moment;
  readonly inst: string;
  readonly tm: Moment;
  readonly flag: boolean | null;
  readonly note: string | null;
  readonly empty: string | null;
  readonly txt: string;
}[] = [
  {
    k: '1',
    dec: '123456789012345678.1234567891',
    big: '9223372036854775807',
    amount: '1234.5600',
    d: { text: '2026-03-29', days: 46110, seconds: 0 },
    ldt: { text: '2026-03-29T01:30:00.123456', days: 46110, seconds: 5400.123456 },
    inst: '2026-03-29T01:30:00.123456+01:00',
    tm: { text: '23:59:59.999999', days: 0, seconds: 86399.999999 },
    flag: true,
    note: null,
    empty: '',
    txt: 'Αθήνα 東京 𠮷',
  },
  {
    k: '2',
    dec: '-0.0000000001',
    big: '-9223372036854775808',
    amount: '922337203685477.5807',
    d: { text: '1900-03-01', days: 61, seconds: 0 },
    ldt: { text: '1900-03-01T00:00:00', days: 61, seconds: 0 },
    inst: '1969-12-31T23:59:59.999999Z',
    tm: { text: '00:00:00', days: 0, seconds: 0 },
    flag: false,
    note: 'x',
    empty: '',
    txt: 'café',
  },
  {
    k: '3',
    dec: '0',
    big: '9007199254740993',
    amount: '0.1000',
    d: { text: '2000-02-29', days: 36585, seconds: 0 },
    ldt: { text: '2026-10-25T01:30:00', days: 46320, seconds: 5400 },
    inst: '2026-10-25T00:30:00Z',
    tm: { text: '12:00:00.5', days: 0, seconds: 43200.5 },
    flag: null,
    note: '',
    empty: null,
    txt: 'café',
  },
];

const NAMES = TYPED_COLUMNS.map(([name]) => name);
const LF = String.fromCharCode(10);

/** Each row as JSON writes it: numbers by their digits, dates and times as ISO text. */
const jsonRows = () =>
  ROWS.map((each) => {
    const held: Record<string, Held> = {
      k: { number: each.k },
      dec: { number: each.dec },
      big: { number: each.big },
      amount: { number: each.amount },
      d: each.d.text,
      ldt: each.ldt.text,
      inst: each.inst,
      tm: each.tm.text,
      flag: each.flag,
      note: each.note,
      empty: each.empty,
      txt: each.txt,
    };
    const members = NAMES.map((name) => {
      const value = held[name]!;
      const text =
        value !== null && typeof value === 'object' ? value.number : JSON.stringify(value);
      return `${JSON.stringify(name)}:${text}`;
    });
    return `{${members.join(',')}}`;
  });

export const typedJson = () =>
  Buffer.from(`{"items":${`[${jsonRows().join(',')}]`},"count":${ROWS.length}}${LF}`, 'utf8');

export const typedJsonLines = () => Buffer.from(`${jsonRows().join(LF)}${LF}`, 'utf8');

/** As CSV: every value text, quoted; null an unquoted empty field. */
export function typedCsv(): Buffer {
  const field = (value: string | boolean | null) =>
    value === null ? '' : `"${String(value).replace(/"/g, '""')}"`;
  const lines = ROWS.map((each) =>
    [
      each.k,
      each.dec,
      each.big,
      each.amount,
      each.d.text,
      each.ldt.text,
      each.inst,
      each.tm.text,
      each.flag,
      each.note,
      each.empty,
      each.txt,
    ]
      .map(field)
      .join(','),
  );
  return Buffer.from([NAMES.join(','), ...lines].join(LF) + LF, 'utf8');
}

/** A serial's text, as a writer computes it: the days, and the seconds as a fraction of one. */
const serial = (moment: Moment) => String(moment.days + moment.seconds / 86_400);

/** Whether a number's text is one a double holds exactly, digit for digit. */
const exact = (text: string) =>
  String(Number(text)) === text.replace(/(\.[0-9]*?)0+$/, '$1').replace(/\.$/, '');

/**
 * As XLSX, written stored so the bytes are the same wherever they are written: a header row, then a
 * row each, a number where a double holds it and its text where none does, the texts shared.
 */
export function typedXlsx(): Buffer {
  const shared: string[] = [];
  const share = (text: string) => {
    const at = shared.indexOf(text);
    if (at >= 0) return at;
    shared.push(text);
    return shared.length - 1;
  };
  const letter = (at: number) => String.fromCharCode(65 + at);
  const header = row(
    1,
    NAMES.map((name, at) => cell.shared(`${letter(at)}1`, share(name))),
  );
  const rows = ROWS.map((each, index) => {
    const r = index + 2;
    const ref = (name: string) => `${letter(NAMES.indexOf(name))}${r}`;
    const numeric = (name: string, text: string) =>
      exact(text) ? cell.number(ref(name), String(Number(text))) : cell.text(ref(name), text);
    const cells = [
      numeric('k', each.k),
      // -1E-10, as a writer puts a small number.
      each.dec === '-0.0000000001' ? cell.number(ref('dec'), '-1E-10') : numeric('dec', each.dec),
      numeric('big', each.big),
      numeric('amount', each.amount),
      cell.number(ref('d'), serial(each.d), 1),
      cell.number(ref('ldt'), serial(each.ldt), 3),
      cell.text(ref('inst'), each.inst),
      cell.number(ref('tm'), serial(each.tm), 3),
      ...(each.flag === null ? [] : [cell.boolean(ref('flag'), each.flag)]),
      ...(each.note === null ? [] : [cell.text(ref('note'), each.note)]),
      ...(each.empty === null ? [] : [cell.shared(ref('empty'), share(each.empty))]),
      cell.shared(ref('txt'), share(each.txt)),
    ];
    return row(r, cells);
  });
  return workbook({
    sheets: [{ name: 'Typed', xml: sheetXml(header + rows.join('')) }],
    shared,
    stored: true,
  });
}

/** Each fixture by its file's name. */
export const TYPED_FILES: Readonly<Record<string, () => Buffer>> = {
  'typed.json': typedJson,
  'typed.jsonl': typedJsonLines,
  'typed.csv': typedCsv,
  'typed.xlsx': typedXlsx,
};

/** Each format, with its columns, by the file's name. */
export function typedFormat(file: string): { format: DataFormat; columns: Column[] } {
  const by = (from: (name: string) => Column['from']) =>
    TYPED_COLUMNS.map(([name, type]) => ({ name, from: from(name), type }));
  if (file.endsWith('.json')) {
    return {
      format: { kind: 'json', rows: '/items', count: '/count' },
      columns: by((name) => ({ pointer: `/${name}` })),
    };
  }
  if (file.endsWith('.jsonl')) {
    return { format: { kind: 'jsonLines' }, columns: by((name) => ({ pointer: `/${name}` })) };
  }
  if (file.endsWith('.csv')) {
    return {
      format: { kind: 'csv', delimiter: 'comma', headerRow: true, null: 'empty' },
      columns: by((header) => ({ header })),
    };
  }
  return {
    format: { kind: 'xlsx', sheet: 'Typed', headerRow: true },
    columns: by((header) => ({ header })),
  };
}
