import {
  dataFailure,
  indexLetter,
  isJsonObject,
  JsonNumber,
  letterIndex,
  pointerTo,
  resolvePointer,
  sourceNameSchema,
  type CanonicalValue,
  type Column,
  type DataFailure,
  type DataFormat,
  type DescribeSqlAnswer,
  type JsonValue,
  type Limits,
  type ProposedType,
} from '@alloy-works/domain';

import { readImage } from '../image.js';
import { fromJson, type Cell } from './cells.js';
import { eachRecord, type CsvField } from './csv.js';
import { countAgrees, eachRow, firstRows } from './json.js';
import { fromSerial } from './serial.js';
import { eachSheetRow, type XlsxCell } from './xlsx.js';

/**
 * A body's rows in every format, whatever carried it (the D6 plan, D6-F): JSON, JSON Lines and CSV
 * read into canonical cells by their declared columns, a row at a time and let go as it goes, and
 * the first rows of a sample proposed as columns (DAT-105). HTTP and S3 alike read through here.
 */

/**
 * The most a body of each format may be, whatever the byte limit (the D6 plan's measurement): the
 * connector's concurrency is sized by D2's run at the ceilings, which peaked at 371 MiB in its child.
 * `JSON.parse` with a reviver holds many times a body's size while it parses - a JSON body of 25 MiB
 * peaked at 588 MiB on Windows; on Linux (node:24, as CI) one of 8 MiB peaked at 356, 6 MiB at 332 to
 * 347 and 4 MiB at 230 to 298 - so JSON takes 4 MiB. JSON Lines, a line at a time, peaked on Linux at
 * about 410 MiB for 20 MiB, 371 for 16 and 272 for 12 - so it takes 12 MiB. CSV, a record at a time
 * by `csv-parse`, is denser in rows than JSON Lines, and peaked on Linux at 375 to 401 MiB for 12 MiB
 * (75,000 rows), 339 to 354 for 8 and 233 for 6 (37,800 rows, three runs alike) - so it takes 6 MiB.
 * XLSX's ceiling holds both the body and every byte inflated from it, across every part read (D6.3):
 * a workbook of 16 columns, numbers and shared strings in turn, peaked on Linux at 203 to 218 MiB
 * inflating 15 MiB (18,000 rows), 208 to 221 for 19, 232 to 291 for 23 and 307 to 319 for 24 - so it
 * takes 16 MiB. Past its ceiling a body is `byte_limit`.
 */
export const JSON_MAX_BYTES = 4 * 1024 * 1024;
export const JSON_LINES_MAX_BYTES = 12 * 1024 * 1024;
export const CSV_MAX_BYTES = 6 * 1024 * 1024;
export const XLSX_MAX_BYTES = 16 * 1024 * 1024;

const CEILINGS: Readonly<Record<DataFormat['kind'], number>> = {
  json: JSON_MAX_BYTES,
  jsonLines: JSON_LINES_MAX_BYTES,
  csv: CSV_MAX_BYTES,
  xlsx: XLSX_MAX_BYTES,
};

/** The most a body of a format may be, under a run's byte limit. */
export const bodyLimit = (format: DataFormat, bytes: number) =>
  Math.min(bytes, CEILINGS[format.kind]);

/** What a read came to: canonical rows and the images they hold, or why it stopped. */
export type Read =
  | {
      readonly rows: CanonicalValue[][];
      readonly images: Map<string, Buffer>;
      readonly imageBytes: number;
    }
  | { readonly failure: DataFailure };

/** A CSV field as a JSON value for its column: a boolean's text as a boolean, else as it is. */
function fromCsv(field: CsvField, column: Column): JsonValue | undefined {
  if (field === null) return null;
  if (column.type.base !== 'boolean') return field;
  if (field === 'true' || field === 'TRUE') return true;
  if (field === 'false' || field === 'FALSE') return false;
  return field;
}

/** A cell a format has already read to its declared type: a spreadsheet's serial, or its error. */
class Converted {
  constructor(readonly cell: Cell) {}
}

const DATED = new Set(['date', 'time', 'localDateTime', 'instant']);

/**
 * An XLSX cell as a value for its column (D6-I): a number as its source text, or as a serial where
 * the column is a date or a time; text and a boolean as JSON's would be, `true` or `TRUE` text a
 * boolean as CSV's; an error, or a formula with no cached value, `cell_error`.
 */
function fromXlsx(cell: XlsxCell | undefined, column: Column, date1904: boolean) {
  if (cell === undefined || cell === null) return null;
  switch (cell.kind) {
    case 'error':
      return new Converted({ refused: 'cell_error' });
    case 'number':
      return DATED.has(column.type.base)
        ? new Converted(fromSerial(cell.text, column.type as never, date1904))
        : new JsonNumber(cell.text);
    case 'boolean':
      return cell.value;
    default:
      return fromCsv(cell.text, column);
  }
}

/** A sheet's cell as a header names a column: its text, a number's or a boolean's. */
function headerText(cell: XlsxCell | undefined): string | null {
  if (cell === undefined || cell === null || cell.kind === 'error') return null;
  if (cell.kind === 'boolean') return cell.value ? 'TRUE' : 'FALSE';
  return cell.text;
}

/**
 * Each column's place in a record or a row by its letter, and a header's found among the names the
 * first record or row holds - or the column a header cannot find once.
 */
function placesOf(columns: readonly Column[]) {
  const at: number[] = columns.map((column) =>
    'letter' in column.from ? letterIndex(column.from.letter) : -1,
  );
  const header = (names: readonly (string | null)[]): DataFailure | undefined => {
    for (const [index, column] of columns.entries()) {
      if (!('header' in column.from)) continue;
      const name = column.from.header;
      const found = names.flatMap((each, place) => (each === name ? [place] : []));
      // A header missing, or named twice, cannot say which field is meant.
      if (found.length !== 1) return dataFailure('result_mismatch', { column: column.name });
      at[index] = found[0]!;
    }
    return undefined;
  };
  return { at, header };
}

/**
 * One value read for its column as a canonical cell (DAT-095, DAT-080): an image from its base64
 * text, kept once by its hash; anything else by its declared type.
 */
function cellOf(
  value: JsonValue | undefined | Converted,
  column: Column,
  row: number,
  images: Map<string, Buffer>,
): { readonly cell: CanonicalValue; readonly added: number } | DataFailure {
  const named = { column: column.name, row: row + 1 };
  if (value instanceof Converted) {
    if ('refused' in value.cell) return dataFailure(value.cell.refused, named);
    return { cell: value.cell.value, added: 0 };
  }
  if (column.type.base === 'image') {
    if (value === undefined || value === null) return { cell: null, added: 0 };
    const image =
      typeof value === 'string' && column.type.encoding === 'base64'
        ? readImage(value, 'base64')
        : ({ refused: true } as const);
    if ('refused' in image) return dataFailure('image_refused', named);
    if (images.has(image.hash)) return { cell: image.hash, added: 0 };
    images.set(image.hash, image.bytes);
    return { cell: image.hash, added: image.bytes.length };
  }
  const cell = fromJson(value, column.type);
  if ('refused' in cell) return dataFailure(cell.refused, named);
  return { cell: cell.value, added: 0 };
}

/**
 * A body's rows as canonical cells, read by the format and let go as they are read (the D6 plan's
 * measurement): each row kept where `keep` says - a file's filter (D6-J) - and the kept rows held to
 * the row limit; a JSON body's stated count checked against every row it holds (DAT-108); a CSV
 * record bounded by `maxRecordBytes`. A CSV or XLSX column by its header is found in the header
 * record or row, once. A sheet's kept text is counted as it is kept, since one shared string may be
 * read into many cells: past the byte limit it is `byte_limit` before the rows are finished.
 */
export function readRows(
  body: Buffer,
  format: DataFormat,
  columns: readonly Column[],
  limits: Limits,
  keep: (cells: readonly CanonicalValue[]) => boolean = () => true,
): Read {
  const images = new Map<string, Buffer>();
  let imageBytes = 0;
  const out: CanonicalValue[][] = [];
  const take = (
    valueOf: (column: Column, at: number) => JsonValue | undefined | Converted,
    at: number,
  ): DataFailure | undefined => {
    const cells: CanonicalValue[] = [];
    let added = 0;
    const seen: [string, Buffer][] = [];
    for (const [index, column] of columns.entries()) {
      const before = images.size;
      const made = cellOf(valueOf(column, index), column, at, images);
      if ('code' in made) return made;
      if (images.size > before) seen.push([made.cell as string, images.get(made.cell as string)!]);
      cells.push(made.cell);
      added += made.added;
    }
    if (!keep(cells)) {
      // An image only a row filtered out held is not carried.
      for (const [hash] of seen) images.delete(hash);
      return undefined;
    }
    if (out.length >= limits.rows) return dataFailure('row_limit');
    imageBytes += added;
    out.push(cells);
    return undefined;
  };

  if (format.kind === 'xlsx') {
    const { at, header } = placesOf(columns);
    let kept = 0;
    const read = eachSheetRow(
      body,
      format,
      bodyLimit(format, limits.bytes),
      (row, index, date1904) => {
        const before = out.length;
        const refused = take((column, place) => fromXlsx(row[at[place]!], column, date1904), index);
        if (refused !== undefined || out.length === before) return refused;
        for (const value of out[before]!) {
          if (typeof value === 'string') kept += Buffer.byteLength(value, 'utf8');
        }
        return kept > limits.bytes ? dataFailure('byte_limit') : undefined;
      },
      (names) => header(names.map(headerText)),
    );
    if ('failure' in read) return read;
    return { rows: out, images, imageBytes };
  }

  if (format.kind === 'csv') {
    const { at, header } = placesOf(columns);
    let width = -1;
    const read = eachRecord(
      body,
      format,
      Math.min(limits.bytes, CSV_MAX_BYTES),
      (record, index) => {
        if (width < 0) {
          width = record.length;
          const beyond = columns.find((_, place) => at[place]! >= width);
          if (beyond !== undefined) return dataFailure('result_mismatch', { column: beyond.name });
        }
        return take((column, place) => fromCsv(record[at[place]!] ?? null, column), index);
      },
      header,
    );
    if ('failure' in read) return read;
    return { rows: out, images, imageBytes };
  }

  const visited = eachRow(body, format, (row, index) =>
    take(
      (column) => resolvePointer(row, 'pointer' in column.from ? column.from.pointer : ''),
      index,
    ),
  );
  if ('failure' in visited) return visited;
  if (
    format.kind === 'json' &&
    format.count !== undefined &&
    !countAgrees(visited.count, visited.rows)
  ) {
    return { failure: dataFailure('result_incomplete') };
  }
  return { rows: out, images, imageBytes };
}

/** The most rows a sample reads, to propose its columns. */
const PROPOSED_FROM_ROWS = 100;

/** The kind of a JSON value, as a sample names a member's source type. */
function jsonKind(value: JsonValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (isJsonObject(value)) return 'object';
  return typeof value === 'object' ? 'number' : typeof value;
}

/** What text proposes: a date or a time by its spelling, else text. */
function proposedForText(texts: readonly string[]): ProposedType {
  const all = (pattern: RegExp) => texts.every((text) => pattern.test(text));
  if (all(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)) return { base: 'date' };
  if (all(/T[0-9:.]+(?:Z|[+-][0-9]{2}:[0-9]{2})$/)) return { base: 'instant', fraction: 6 };
  if (all(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+$/)) return { base: 'localDateTime', fraction: 6 };
  return { base: 'text' };
}

/** What numbers' digits propose: an integer, or a decimal wide enough for the places seen. */
function proposedForNumbers(sources: readonly string[]): ProposedType {
  if (sources.every((source) => /^-?(?:0|[1-9][0-9]*)$/.test(source))) return { base: 'integer' };
  // A sample cannot prove a decimal's precision: the author confirms it (data.md).
  const places = Math.max(...sources.map((source) => /\.([0-9]+)$/.exec(source)?.[1]?.length ?? 0));
  const scale = Math.min(Math.max(places, 2), 30);
  return { base: 'decimal', precision: 30 + scale, scale };
}

/** What a member's JSON values propose: a number's by its digits, text's by its spelling. */
function proposedForJson(values: readonly JsonValue[]): ProposedType {
  const present = values.filter((value) => value !== null);
  if (present.length === 0) return { base: 'text' };
  const kinds = new Set(present.map(jsonKind));
  if (kinds.size !== 1) return { base: 'text' };
  const [kind] = kinds;
  if (kind === 'boolean') return { base: 'boolean' };
  if (kind === 'number') {
    return proposedForNumbers(present.map((value) => (value as { source: string }).source));
  }
  // A nested object or array is read as its canonical text (D6-G).
  return kind === 'string' ? proposedForText(present as string[]) : { base: 'text' };
}

/** What a CSV field's texts propose: a boolean, a number, a date or a time where every one reads so. */
function proposedForFields(fields: readonly CsvField[]): ProposedType {
  const texts = fields.filter((field): field is string => field !== null && field !== '');
  if (texts.length === 0) return { base: 'text' };
  if (texts.every((text) => /^(?:true|false|TRUE|FALSE)$/.test(text))) return { base: 'boolean' };
  if (texts.every((text) => /^-?[0-9]+(?:\.[0-9]+)?$/.test(text))) {
    return texts.every((text) => /^-?(?:0|[1-9][0-9]*)$/.test(text))
      ? { base: 'integer' }
      : proposedForNumbers(texts);
  }
  return proposedForText(texts);
}

/** A column's name as proposed: the source's where a column may be named so, else its letter's. */
const proposedName = (name: string, letter: string, taken: Set<string>) => {
  const wanted = sourceNameSchema.safeParse(name).success ? name : `column_${letter}`;
  let chosen = wanted;
  for (let again = 2; taken.has(chosen); again += 1) chosen = `${wanted}_${again}`;
  taken.add(chosen);
  return chosen;
};

/**
 * A sample's columns (DAT-105): for JSON, each member of the first rows by its pointer, in the order
 * first met, a member whose name a column cannot carry left out; for CSV, each field by its header
 * where the first record is one, else by its letter. The author confirms each.
 */
/** What a sheet's cells propose: by what they hold, a number under a date's format a date or a time. */
function proposedForCells(cells: readonly XlsxCell[]): {
  sourceType: string;
  proposed: ProposedType;
} {
  const present = cells.filter((cell): cell is Exclude<XlsxCell, null> => cell !== null);
  const kinds = new Set(
    present.map((cell) => (cell.kind === 'number' && cell.dated ? 'date' : cell.kind)),
  );
  if (kinds.size !== 1) {
    return { sourceType: kinds.size === 0 ? 'empty' : 'mixed', proposed: { base: 'text' } };
  }
  const [kind] = kinds as Set<string>;
  const texts = present.flatMap((cell) => ('text' in cell ? [cell.text] : []));
  switch (kind) {
    case 'boolean':
      return { sourceType: 'boolean', proposed: { base: 'boolean' } };
    case 'date':
      // A serial with a time in it is a date and time, to the millisecond a serial carries to 9999.
      return {
        sourceType: 'date',
        proposed: texts.every((text) => /^[0-9]+$/.test(text))
          ? { base: 'date' }
          : { base: 'localDateTime', fraction: 3 },
      };
    case 'number':
      return { sourceType: 'number', proposed: proposedForNumbers(texts) };
    case 'string':
      return { sourceType: 'string', proposed: proposedForFields(texts) };
    default:
      return { sourceType: 'error', proposed: { base: 'text' } };
  }
}

/** A sheet's columns (DAT-105): each by its header where the first row is one, else by its letter. */
function proposeSheetColumns(
  body: Buffer,
  format: Extract<DataFormat, { kind: 'xlsx' }>,
): DescribeSqlAnswer {
  let names: readonly (string | null)[] = [];
  const rows: (readonly XlsxCell[])[] = [];
  const read = eachSheetRow(
    body,
    format,
    XLSX_MAX_BYTES,
    (row) => {
      if (rows.length < PROPOSED_FROM_ROWS) rows.push(row);
      return undefined;
    },
    (header) => {
      names = header.map(headerText);
      return undefined;
    },
    true,
  );
  if ('failure' in read) return { failure: read.failure };
  const width = Math.max(names.length, ...rows.map((row) => row.length));
  const taken = new Set<string>();
  return {
    columns: Array.from({ length: Math.min(width, 1664) }, (_, at) => {
      const letter = indexLetter(at);
      const header = format.headerRow ? (names[at] ?? '') : '';
      const usable = header !== '' && header.length <= 200 && !/\p{Cc}/u.test(header);
      return {
        name: proposedName(usable ? header : '', letter, taken),
        ...proposedForCells(rows.map((row) => row[at] ?? null)),
        ...(format.headerRow && usable ? { header } : { letter }),
      };
    }),
    parameters: [],
  };
}

export function proposeColumns(body: Buffer, format: DataFormat): DescribeSqlAnswer {
  if (format.kind === 'xlsx') return proposeSheetColumns(body, format);
  if (format.kind === 'csv') {
    let names: readonly CsvField[] = [];
    const rows: (readonly CsvField[])[] = [];
    const read = eachRecord(
      body,
      format,
      CSV_MAX_BYTES,
      (record) => {
        if (rows.length < PROPOSED_FROM_ROWS) rows.push(record);
        return undefined;
      },
      (header) => {
        names = header;
        return undefined;
      },
    );
    if ('failure' in read) return { failure: read.failure };
    const width = format.headerRow ? names.length : (rows[0]?.length ?? 0);
    const taken = new Set<string>();
    return {
      columns: Array.from({ length: Math.min(width, 1664) }, (_, at) => {
        const letter = indexLetter(at);
        const header = format.headerRow ? (names[at] ?? '') : '';
        const usable = header !== '' && header.length <= 200 && !/\p{Cc}/u.test(header);
        return {
          name: proposedName(usable ? header : '', letter, taken),
          sourceType: 'text',
          proposed: proposedForFields(rows.map((row) => row[at] ?? null)),
          ...(format.headerRow && usable ? { header } : { letter }),
        };
      }),
      parameters: [],
    };
  }
  const read = firstRows(body, format, PROPOSED_FROM_ROWS);
  if ('failure' in read) return { failure: read.failure };
  const members = new Map<string, JsonValue[]>();
  for (const row of read.rows) {
    for (const [name, value] of Object.entries(row)) {
      if (!sourceNameSchema.safeParse(name).success) continue;
      if (!members.has(name)) members.set(name, []);
      members.get(name)!.push(value);
    }
  }
  return {
    columns: [...members].slice(0, 1664).map(([name, values]) => {
      const kinds = new Set(values.filter((value) => value !== null).map(jsonKind));
      return {
        name,
        sourceType: kinds.size === 1 ? [...kinds][0]! : kinds.size === 0 ? 'null' : 'mixed',
        proposed: proposedForJson(values),
        pointer: pointerTo(name),
      };
    }),
    parameters: [],
  };
}
