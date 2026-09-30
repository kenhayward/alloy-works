import { z } from 'zod';

/** Who a failure is laid at (DAT-049): the source's side, the query's author, or the product. */
export type Attribution = 'connector' | 'query' | 'product';

/**
 * Every data failure, its attribution fixed by its code (data.md, "Failures"), with the D1 plan's
 * additions: `connector_error` (the child ended without an answer), `connector_unavailable` and
 * `connector_busy` (D1-Q), and `source_unsupported`, a source too old to be checked once authenticated
 * (D1-M).
 */
export const dataFailures = Object.freeze({
  connection_failed: 'connector',
  address_refused: 'connector',
  timeout: 'connector',
  row_limit: 'query',
  byte_limit: 'query',
  result_incomplete: 'connector',
  result_mismatch: 'query',
  precision_lost: 'query',
  precision_not_carried: 'query',
  zone_missing: 'query',
  nonexistent_date: 'query',
  cell_error: 'query',
  nested_value: 'query',
  image_refused: 'query',
  empty_result: 'query',
  identity_unavailable: 'product',
  identity_expired: 'connector',
  identity_unmatched: 'connector',
  sql_not_permitted: 'product',
  parameter_invalid: 'product',
  binding_unresolved: 'product',
  connector_error: 'connector',
  connector_unavailable: 'product',
  connector_busy: 'product',
  source_unsupported: 'connector',
} as const satisfies Record<string, Attribution>);

export type DataFailureCode = keyof typeof dataFailures;

export const dataFailureCodes = Object.freeze(Object.keys(dataFailures) as DataFailureCode[]);

export type DataFailure = { readonly code: DataFailureCode; readonly attribution: Attribution };

/** A failure made from its code alone, so nothing can attribute it otherwise. */
export function dataFailure(code: DataFailureCode): DataFailure {
  return { code, attribution: dataFailures[code] };
}

/** A failure as it crosses a boundary: its code known, and its attribution the code's own. */
export const dataFailureSchema = z
  .strictObject({
    code: z.enum(dataFailureCodes as [DataFailureCode, ...DataFailureCode[]]),
    attribution: z.enum(['connector', 'query', 'product']),
  })
  .refine((failure) => dataFailures[failure.code] === failure.attribution, {
    message: 'A failure carries the attribution its code fixes',
  });
