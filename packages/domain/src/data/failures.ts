import { z } from 'zod';

import { storableText } from '../stored/storable.js';

/** Who a failure is laid at (DAT-049): the source's side, the query's author, or the product. */
export type Attribution = 'connector' | 'query' | 'product';

/**
 * Every data failure, its attribution fixed by its code (data.md, "Failures"), with the D1 plan's
 * additions: `connector_error` (the child ended without an answer), `connector_unavailable` and
 * `connector_busy` (D1-Q), and `source_unsupported`, a source too old to be checked once authenticated
 * (D1-M); and the D2 plan's two (D2-H): `source_refused`, the source refused the author's statement -
 * a syntax error, a permission, a division by zero - and `value_unrepresentable`, a value no canonical
 * form of its declared type can hold, a numeric `NaN` or an infinite date among them; and the re-review's
 * `definition_unbindable`, a definition whose binding the binder refused - a fragment running into the
 * SQL around it - which the definition's checks refuse when it is written, answered as the query's
 * should one reach a run unchecked, and never sent; and the D7 plan's `account_holds_privilege`, an
 * account that may read data of its own where a person's identity is asserted (DAT-112, D7-D), and the
 * review's `identity_role_unsafe`, a person's role that could log in, create, or own SQL that sets
 * another role; and the D6 plan's `describe_not_supported`, a describe of a source whose type lists no
 * relations (D6-A).
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
  account_holds_privilege: 'connector',
  identity_role_unsafe: 'connector',
  sql_not_permitted: 'product',
  parameter_invalid: 'product',
  binding_unresolved: 'product',
  connector_error: 'connector',
  connector_unavailable: 'product',
  connector_busy: 'product',
  source_unsupported: 'connector',
  source_refused: 'query',
  value_unrepresentable: 'query',
  definition_unbindable: 'query',
  describe_not_supported: 'product',
} as const satisfies Record<string, Attribution>);

export type DataFailureCode = keyof typeof dataFailures;

export const dataFailureCodes = Object.freeze(Object.keys(dataFailures) as DataFailureCode[]);

/** What the source said of a statement it refused: its SQLSTATE and its message, cut (D2-H). */
export interface SourceRefusal {
  readonly sqlstate: string;
  readonly message: string;
}

/**
 * A failure: its code and the attribution the code fixes; for `source_refused`, what the source said;
 * and the column or the row, counted from 1, where a failure names one.
 */
export type DataFailure = {
  readonly code: DataFailureCode;
  readonly attribution: Attribution;
  readonly source?: SourceRefusal;
  /** An HTTP source's refusal: its status alone, never its body (the D6 plan, D6-D). */
  readonly status?: number;
  readonly column?: string;
  readonly row?: number;
};

/** The most of a source's message a failure carries, in characters (D2-H). */
export const SOURCE_MESSAGE_MAX = 1000;

/** A source's message cut to 1,000 characters, a whole character at a time. */
export function sourceMessage(message: string): string {
  const characters = [...message];
  return characters.length > SOURCE_MESSAGE_MAX
    ? characters.slice(0, SOURCE_MESSAGE_MAX).join('')
    : message;
}

/** A failure made from its code alone, so nothing can attribute it otherwise. */
export function dataFailure(
  code: DataFailureCode,
  detail: {
    readonly source?: SourceRefusal;
    readonly status?: number;
    readonly column?: string;
    readonly row?: number;
  } = {},
): DataFailure {
  return { code, attribution: dataFailures[code], ...detail };
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

/**
 * A failure as it crosses a boundary: its code known, its attribution the code's own, what the source
 * said only where the source refused, and a column's name as PostgreSQL holds one.
 */
export const dataFailureSchema = z
  .strictObject({
    code: z.enum(dataFailureCodes as [DataFailureCode, ...DataFailureCode[]]),
    attribution: z.enum(['connector', 'query', 'product']),
    source: z
      .strictObject({
        sqlstate: z.string().regex(/^[0-9A-Z]{5}$/),
        message: z
          .string()
          .refine((value) => [...value].length <= SOURCE_MESSAGE_MAX && storableText(value), {
            message: `A source's message is at most ${SOURCE_MESSAGE_MAX} characters`,
          }),
      })
      .optional(),
    column: z
      .string()
      .refine((value) => utf8Bytes(value) >= 1 && utf8Bytes(value) <= 63 && storableText(value), {
        message: 'A column is named as PostgreSQL holds a name',
      })
      .optional(),
    row: z.number().int().min(1).optional(),
    status: z.number().int().min(100).max(599).optional(),
  })
  .refine((failure) => dataFailures[failure.code] === failure.attribution, {
    message: 'A failure carries the attribution its code fixes',
  })
  .refine(
    (failure) =>
      (failure.source !== undefined || failure.status !== undefined) ===
        (failure.code === 'source_refused') &&
      !(failure.source !== undefined && failure.status !== undefined),
    {
      message:
        "A failure carries what the source said, or an HTTP source's status, exactly when the source refused",
    },
  );
