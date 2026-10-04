import { z } from 'zod';

import { canonicalJson } from '../stored/canonical.js';
import type { Binding } from './binding.js';
import type { CanonicalResult, CanonicalValue } from './canonical.js';
import { valueTypeSchema, type ValueType } from './columns.js';
import type { Column } from './definition.js';

/**
 * Why a take holds no value (the B1 plan, B1-E; bindings.md, "Taking"), in the order `takeValue` finds
 * them: a column the version never declared, then no row or more than one, then no row the key names,
 * then a null cell, then a text of no characters or spaces alone.
 */
export const TAKE_FAILURES = [
  'take_invalid',
  'value_none',
  'value_many',
  'row_missing',
  'value_null',
  'value_empty',
] as const;

export type TakeFailure = (typeof TAKE_FAILURES)[number];

type Take = Binding['take'];

/**
 * What a take gave: the cell, a string or a boolean in its canonical form, with the column it was
 * declared as - its name and its type, never its source `from`, which only a reader of the definition
 * may see - or the failure, with the count where there were many rows.
 */
export type TakeOutcome =
  | {
      readonly value: string | boolean;
      readonly column: { readonly name: string; readonly type: ValueType };
    }
  | { readonly failure: TakeFailure; readonly count?: number };

/**
 * The outcome, strict at every level, as `dataset_take` holds it (stored-shape row 7): a value with
 * exactly its column, or exactly a failure, `count` an integer above 1 present exactly for
 * `value_many`. Whether the value is canonical in its column's type is the writer's (`recordTake`).
 */
// Cast only for `exactOptionalPropertyTypes`: zod infers an optional `count` as `number | undefined`,
// and a strict parse never yields an `undefined` it was not given.
export const takeOutcomeSchema = z.union([
  z.strictObject({
    value: z.union([z.string(), z.boolean()]),
    column: z.strictObject({ name: z.string().min(1), type: valueTypeSchema }),
  }),
  z
    .strictObject({
      failure: z.enum(TAKE_FAILURES),
      count: z.number().int().min(2).optional(),
    })
    .refine((outcome) => (outcome.failure === 'value_many') === (outcome.count !== undefined), {
      message: 'A count is given exactly where there were many rows',
    }),
]) as unknown as z.ZodType<TakeOutcome>;

/** Every code point `White_Space` (Q4): `\s` would take U+FEFF and leave U+0085. */
const SPACES_ALONE = /^\p{White_Space}*$/u;

/**
 * **The one rule a value is taken by** (B1-E; DAT-031, DAT-032), pure: the page, the editor and the
 * publish take a value from a stored result by it and by nothing else. `columns` are the dataset
 * version's provenance's - what the result was run as - never the definition's latest, which a
 * floating definition can have changed since.
 *
 * In this order: a column, or a key column, the provenance does not declare is `take_invalid`; a
 * `{ column }` take of no rows is `value_none`, of more than one `value_many` with the count, never the
 * first; a `{ key, column }` take matches each row on every key column by canonical equality - a
 * string to a string, a boolean to a boolean - and finds none `row_missing` or more than one
 * `value_many`, since a key's uniqueness (D2-M) is not trusted here; then a null cell is `value_null`,
 * and a text whose every code point is `White_Space` - none at all among them - `value_empty`.
 */
export function takeValue(
  take: Take,
  result: CanonicalResult,
  columns: readonly Column[],
): TakeOutcome {
  const declared = new Map(columns.map((column) => [column.name, column]));
  const index = new Map(result.columns.map(([name], at) => [name, at]));
  const keyNames = 'key' in take ? Object.keys(take.key) : [];
  for (const name of [take.column, ...keyNames]) {
    if (!declared.has(name) || !index.has(name)) return { failure: 'take_invalid' };
  }

  let rows: readonly (readonly CanonicalValue[])[] = result.rows;
  if ('key' in take) {
    rows = rows.filter((row) => keyNames.every((name) => row[index.get(name)!] === take.key[name]));
    if (rows.length === 0) return { failure: 'row_missing' };
  } else if (rows.length === 0) {
    return { failure: 'value_none' };
  }
  if (rows.length > 1) return { failure: 'value_many', count: rows.length };

  const cell = rows[0]![index.get(take.column)!];
  if (cell === null || cell === undefined) return { failure: 'value_null' };
  const column = declared.get(take.column)!;
  if (column.type.base === 'text' && typeof cell === 'string' && SPACES_ALONE.test(cell)) {
    return { failure: 'value_empty' };
  }
  return { value: cell, column: { name: column.name, type: column.type } };
}

/**
 * The input to a take's digest, which `dataset_take` keys an outcome by: its canonical form, with no
 * set rule, since a key's values are never arrays. Hashed by the caller, as a binding's is.
 */
export function takeDigestInput(take: Take): string {
  return canonicalJson(take);
}
