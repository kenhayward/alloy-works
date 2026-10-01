import {
  dataFailure,
  type DataFailure,
  type DataFailureCode,
  type SourceRefusal,
} from '@alloy-works/domain';

/** A failure as the connector's answer parses one, where an absent detail may read as undefined. */
export interface FailureIn {
  readonly code: DataFailureCode;
  readonly source?: SourceRefusal | undefined;
  readonly column?: string | undefined;
  readonly row?: number | undefined;
}

/**
 * What a person is told of each data failure (data.md, "Failures"): one reason, naming no address, and
 * where the failure names them, the column, the row and what the source said. A failure crossing the
 * API carries these words beside its code, its attribution and those details, so a page shows them as
 * they are and a client may write its own from the code.
 */
const MESSAGES: Partial<Record<DataFailureCode, string>> = {
  connection_failed:
    'Could not connect to the source or sign in to it. Check its settings and its credential.',
  address_refused: 'The connector may not reach the address of this source.',
  timeout: 'The source did not answer in time.',
  row_limit: 'The query returned more rows than its row limit allows. Nothing was kept.',
  byte_limit: 'The result is larger than its size limit allows. Nothing was kept.',
  result_incomplete: 'What arrived from the source did not match what it said it sent.',
  result_mismatch: 'The result does not fit the declared columns, key or order.',
  precision_lost:
    'A value has more digits or places than its declared type holds. Nothing was rounded.',
  value_unrepresentable:
    'A value cannot be held by its declared type: not a number, an infinity, or a date or time out of range.',
  definition_unbindable:
    'The SQL cannot be bound: a fragment runs into the SQL around it where it is placed. Change the fragment.',
  empty_result:
    'The query returned no rows, and this definition says no rows is not a valid answer.',
  source_refused: 'The source refused the statement.',
  sql_not_permitted: 'SQL may not run on this connection.',
  parameter_invalid: 'A value does not fit its parameter.',
  connector_error: 'The connector failed while it was working on this. Try again.',
  source_unsupported:
    'This source is older than PostgreSQL 14, which the connector cannot check. Use a newer one.',
  connector_unavailable: 'No connector is available to reach the source. Try again later.',
  connector_busy: 'The connector is busy. Try again in a moment.',
};

/** Where a failure names a column or a row, the words for it, as the start of a sentence. */
function where(failure: DataFailure): string {
  const { column, row } = failure;
  if (column !== undefined && row !== undefined) return `In column ${column}, row ${row}: `;
  if (column !== undefined) return `In column ${column}: `;
  if (row !== undefined) return `In row ${row}: `;
  return '';
}

/**
 * A mismatch's words by what it names (D2-M, DAT-106): a column with no row is a column of the result
 * that does not fit its declaration; a row alone is a row out of the declared order or repeating the
 * key of the one before it, which a text sort key not ordered by code point is the likeliest cause of;
 * both is a key with no value.
 */
function mismatch(failure: DataFailure): string {
  const { column, row } = failure;
  if (column !== undefined && row !== undefined) {
    return `Row ${row} has no value in the key column ${column}.`;
  }
  if (column !== undefined) {
    return (
      `The column ${column} is missing from the result, not declared, or of a type its declaration does not take. ` +
      'Cast it in the SQL, or declare it again.'
    );
  }
  if (row !== undefined) {
    return (
      `Rows are not in the declared order: row ${row} comes before row ${row - 1}, or repeats the key of an earlier row. ` +
      'Order text columns with COLLATE "C".'
    );
  }
  return 'The statement returns no columns to declare.';
}

/** A failure's words: its code's, with the column, the row and what the source said where it has them. */
export function failureMessage(failure: DataFailure): string {
  if (failure.code === 'result_mismatch') return mismatch(failure);
  if (failure.code === 'source_refused' && failure.source) {
    return `The source refused the statement (SQLSTATE ${failure.source.sqlstate}): ${failure.source.message}`;
  }
  const words = MESSAGES[failure.code] ?? 'This could not be done.';
  const at = where(failure);
  return at === '' ? words : `${at}${words.charAt(0).toLowerCase()}${words.slice(1)}`;
}

/** A failure as the API answers it: its code, its attribution, its details and its words (DAT-049). */
export function failureView(failure: FailureIn | DataFailureCode) {
  // Made again from the code, so the attribution is always the code's own (DAT-049).
  const whole =
    typeof failure === 'string'
      ? dataFailure(failure)
      : dataFailure(failure.code, {
          ...(failure.source === undefined ? {} : { source: failure.source }),
          ...(failure.column === undefined ? {} : { column: failure.column }),
          ...(failure.row === undefined ? {} : { row: failure.row }),
        });
  return {
    ...whole,
    ...(whole.source === undefined ? {} : { source: { ...whole.source } }),
    message: failureMessage(whole),
  };
}
