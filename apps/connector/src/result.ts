import { createHash } from 'node:crypto';

import {
  canonicalResultBytes,
  dataFailure,
  orderRows,
  type CanonicalResult,
  type CanonicalValue,
  type DataFailure,
  type DraftDefinition,
  type Limits,
} from '@alloy-works/domain';

/** A run's result, whole and checked: the rows in canonical form, their bytes' checksum, and count. */
export interface Finished {
  readonly result: CanonicalResult;
  readonly checksum: string;
  readonly rowCount: number;
}

/**
 * The rows a run read, held to the declaration (D2-M, DAT-106, DAT-107, DAT-068, DAT-110): in the
 * declared order - checked, never imposed - with no key null or repeated, or sorted as a multiset by
 * their canonical text; empty only where empty is valid; and no more canonical bytes, with the bytes of
 * the images it holds (D8-C), than the byte limit. The checksum is the SHA-256 of the canonical bytes,
 * in hexadecimal.
 */
export function finishResult(
  rows: readonly (readonly CanonicalValue[])[],
  definition: Pick<DraftDefinition, 'columns' | 'key' | 'order' | 'empty'>,
  limits: Limits,
  imageBytes = 0,
): Finished | { readonly failure: DataFailure } {
  const result: CanonicalResult = {
    columns: definition.columns.map((column) => [column.name, column.type.base]),
    rows,
  };
  const ordered = orderRows(result, definition);
  // Two rows sharing a key is its own failure: no order fixes it, and a file, sorted here, has no other.
  if ('mismatch' in ordered && ordered.mismatch === 'key') {
    return { failure: dataFailure('key_repeated', { row: ordered.row }) };
  }
  if ('mismatch' in ordered) {
    return {
      failure: dataFailure('result_mismatch', {
        row: ordered.row,
        ...(ordered.column === undefined ? {} : { column: ordered.column }),
      }),
    };
  }
  if (ordered.rows.length === 0 && definition.empty === 'invalid') {
    return { failure: dataFailure('empty_result') };
  }
  const bytes = canonicalResultBytes(ordered);
  if (Buffer.byteLength(bytes, 'utf8') + imageBytes > limits.bytes)
    return { failure: dataFailure('byte_limit') };
  return {
    result: ordered,
    checksum: createHash('sha256').update(bytes, 'utf8').digest('hex'),
    rowCount: ordered.rows.length,
  };
}
