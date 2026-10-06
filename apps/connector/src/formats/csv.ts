import { isUtf8 } from 'node:buffer';

import { dataFailure, type DataFailure, type DataFormat } from '@alloy-works/domain';
import { CsvError, parse } from 'csv-parse/sync';

/**
 * CSV read in the child (data.md, "The fetch"; ADR-0035; the D6 plan, D6-H): by `csv-parse`, which
 * reports whether each field was quoted, so the declared convention for null is kept exactly - under
 * `empty` an unquoted empty field is null and a quoted one `""` is empty text; under `never` every
 * field is text. A record is bounded by `max_record_size`, past which it is `byte_limit`; a record of
 * another width, a quote left open and text that is not UTF-8 are `result_mismatch`. A record is
 * handed on as it is parsed and none is kept, so a body's records are never held whole.
 */

export type CsvFormat = Extract<DataFormat, { kind: 'csv' }>;

/** A field as read: its text, or null under `empty` for an unquoted empty field. */
export type CsvField = string | null;

/** What a visitor answers of a record: nothing where it took it, or the failure that stops the read. */
export type RecordVisitor = (record: readonly CsvField[], index: number) => DataFailure | undefined;

const DELIMITERS: Readonly<Record<CsvFormat['delimiter'], string>> = {
  comma: ',',
  semicolon: ';',
  tab: String.fromCharCode(9),
  pipe: '|',
};

/** A stop the reader is told of from inside the parser: the failure the visitor answered. */
class Stopped extends Error {
  constructor(readonly failure: DataFailure) {
    super(failure.code);
  }
}

/**
 * Each record a body holds, in order: the header first where the format says the first record is
 * one, then each data record counted from 0. An empty line is no record. A leading byte order mark
 * is dropped.
 */
export function eachRecord(
  body: Buffer,
  format: CsvFormat,
  maxRecordBytes: number,
  visit: RecordVisitor,
  header?: (names: readonly CsvField[]) => DataFailure | undefined,
): { readonly records: number } | { readonly failure: DataFailure } {
  if (!isUtf8(body)) return { failure: dataFailure('result_mismatch') };
  const nullEmpty = format.null === 'empty';
  let records = 0;
  let headed = !format.headerRow;
  try {
    parse(body, {
      bom: true,
      delimiter: DELIMITERS[format.delimiter]!,
      quote: '"',
      escape: '"',
      max_record_size: maxRecordBytes,
      relax_column_count: false,
      skip_empty_lines: true,
      // Whether a field was quoted is what tells an empty field from empty text (D6-H).
      cast: (value, context) => (nullEmpty && value === '' && !context.quoting ? null : value),
      on_record: (record: CsvField[]) => {
        if (!headed) {
          headed = true;
          const refused = header?.(record);
          if (refused !== undefined) throw new Stopped(refused);
          return null;
        }
        const refused = visit(record, records);
        if (refused !== undefined) throw new Stopped(refused);
        records += 1;
        // Nothing is kept: the reader's own array stays empty.
        return null;
      },
    });
  } catch (error) {
    if (error instanceof Stopped) return { failure: error.failure };
    if (error instanceof CsvError && error.code === 'CSV_MAX_RECORD_SIZE') {
      return { failure: dataFailure('byte_limit') };
    }
    if (error instanceof CsvError) {
      return { failure: dataFailure('result_mismatch', { row: records + 1 }) };
    }
    // An error thrown from inside the parser's own callbacks may come back wrapped.
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Stopped) return { failure: cause.failure };
    throw error;
  }
  return { records };
}
