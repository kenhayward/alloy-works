import { z } from 'zod';

import { canonicalJson } from '../stored/canonical.js';
import type { Binding } from './binding.js';
import { valueProblem, type CanonicalResult, type CanonicalValue } from './canonical.js';
import {
  imageColumnTypeSchema,
  valueTypeSchema,
  type ImageColumnType,
  type ValueType,
} from './columns.js';
import type { Column } from './definition.js';

/**
 * Why a take holds no value (the B1 plan, B1-E; bindings.md, "Taking"), in the order `takeValue` finds
 * them: a column the version never declared, then no row or more than one, then no row the key names,
 * then a null cell, then a text of no characters or spaces alone - and for an image (the B6 plan,
 * B6-D), a description cell that is null or spaces alone (DAT-097).
 */
export const TAKE_FAILURES = [
  'take_invalid',
  'value_none',
  'value_many',
  'row_missing',
  'value_null',
  'value_empty',
  'image_description_missing',
] as const;

export type TakeFailure = (typeof TAKE_FAILURES)[number];

type Take = Binding['take'];

/**
 * What a take gave: the cell, a string or a boolean in its canonical form, with the column it was
 * declared as - its name and its type, never its source `from`, which only a reader of the definition
 * may see - or an image (B6-D): the cell's hash, its description - the text the same row holds in the
 * column the type names, or `decorative` where the type says so - and the column; or the failure, with
 * the count where there were many rows, for `take_invalid` the column - taken, key or description - the
 * version does not have, and for `image_description_missing` the description's column.
 */
export type TakeOutcome =
  | {
      readonly value: string | boolean;
      readonly column: { readonly name: string; readonly type: ValueType };
    }
  | {
      readonly image: string;
      readonly description: string;
      readonly column: { readonly name: string; readonly type: ImageColumnType };
    }
  | { readonly failure: TakeFailure; readonly count?: number; readonly column?: string };

/** Where a failure names a column: one the version does not have, or an image's description's. */
const NAMES_A_COLUMN: readonly TakeFailure[] = ['take_invalid', 'image_description_missing'];

/** Every code point `White_Space` (Q4): `\s` would take U+FEFF and leave U+0085. */
const SPACES_ALONE = /^\p{White_Space}*$/u;

/**
 * The outcome, strict at every level, as `dataset_take` holds it (stored-shape row 7): a value with
 * exactly its column, canonical in the column's type (`valueProblem`) and, for text, not `White_Space`
 * alone - nothing `takeValue` would not answer - or an image (B6-D): a hash, its image column, and a
 * description that is `decorative` exactly where the type says so and otherwise not `White_Space`
 * alone; or exactly a failure, `count` an integer above 1 present exactly for `value_many`, `column` a
 * name present exactly for `take_invalid` and `image_description_missing`. Whether the column is the
 * version's is the writer's (`recordTake`).
 */
// Cast only for `exactOptionalPropertyTypes`: zod infers an optional member as `T | undefined`, and a
// strict parse never yields an `undefined` it was not given.
export const takeOutcomeSchema = z.union([
  z
    .strictObject({
      value: z.union([z.string(), z.boolean()]),
      column: z.strictObject({ name: z.string().min(1), type: valueTypeSchema }),
    })
    .refine((outcome) => valueProblem(outcome.column.type, outcome.value) === null, {
      message: "A value is written in its column's canonical form",
    })
    .refine((outcome) => typeof outcome.value !== 'string' || !SPACES_ALONE.test(outcome.value), {
      message: 'A text of White_Space alone is value_empty, never a value',
    }),
  z
    .strictObject({
      image: z.string().regex(/^[0-9a-f]{64}$/),
      description: z.string().min(1),
      column: z.strictObject({ name: z.string().min(1), type: imageColumnTypeSchema }),
    })
    .refine(
      (outcome) =>
        outcome.column.type.description === 'decorative'
          ? outcome.description === 'decorative'
          : !SPACES_ALONE.test(outcome.description),
      {
        message:
          'An image is decorative exactly where its column says so, and otherwise described in words',
      },
    ),
  z
    .strictObject({
      failure: z.enum(TAKE_FAILURES),
      count: z.number().int().min(2).optional(),
      column: z.string().min(1).optional(),
    })
    .refine((outcome) => (outcome.failure === 'value_many') === (outcome.count !== undefined), {
      message: 'A count is given exactly where there were many rows',
    })
    .refine(
      (outcome) => NAMES_A_COLUMN.includes(outcome.failure) === (outcome.column !== undefined),
      {
        message:
          "A column is named exactly where the version does not have it, or where it holds an image's missing description",
      },
    ),
]) as unknown as z.ZodType<TakeOutcome>;

/**
 * **The one rule a value is taken by** (B1-E; DAT-031, DAT-032), pure: the page, the editor and the
 * publish take a value from a stored result by it and by nothing else. `columns` are the dataset
 * version's provenance's - what the result was run as - never the definition's latest, which a
 * floating definition can have changed since.
 *
 * In this order: a column, or a key column, or an image's description column, the provenance does not
 * declare, or the result does not hold, is `take_invalid`, naming it; a
 * `{ column }` take of no rows is `value_none`, of more than one `value_many` with the count, never the
 * first; a `{ key, column }` take matches each row on every key column by canonical equality - a
 * string to a string, a boolean to a boolean - and finds none `row_missing` or more than one
 * `value_many`, since a key's uniqueness (D2-M) is not trusted here; then a null cell is `value_null`,
 * and a text whose every code point is `White_Space` - none at all among them - `value_empty`. An image
 * (B6-D) answers its hash and its description, read from the same row by its type's `description`, or
 * `decorative`; a description cell null or `White_Space` alone is `image_description_missing`.
 * Whether an image may stand where its binding is placed is not the take's (B6-D).
 */
export function takeValue(
  take: Take,
  result: CanonicalResult,
  columns: readonly Column[],
): TakeOutcome {
  const declared = new Map(columns.map((column) => [column.name, column]));
  const index = new Map(result.columns.map(([name], at) => [name, at]));
  const keyNames = 'key' in take ? Object.keys(take.key) : [];
  // An image's description is read from the same row (B6-D), so its column is held as a taken one is.
  const taken = declared.get(take.column)?.type;
  const describing =
    taken?.base === 'image' && taken.description !== 'decorative' ? [taken.description.column] : [];
  for (const name of [take.column, ...keyNames, ...describing]) {
    if (!declared.has(name) || !index.has(name)) return { failure: 'take_invalid', column: name };
  }

  let rows: readonly (readonly CanonicalValue[])[] = result.rows;
  if ('key' in take) {
    rows = rows.filter((row) => keyNames.every((name) => row[index.get(name)!] === take.key[name]));
    if (rows.length === 0) return { failure: 'row_missing' };
  } else if (rows.length === 0) {
    return { failure: 'value_none' };
  }
  if (rows.length > 1) return { failure: 'value_many', count: rows.length };

  const column = declared.get(take.column)!;
  const row = rows[0]!;
  const cell = row[index.get(take.column)!];
  if (cell === null || cell === undefined) return { failure: 'value_null' };
  if (column.type.base === 'image') {
    // Its description (DAT-097): the definition's named column, read from the same row, or decorative
    // where the type says so. Null, or `White_Space` alone, describes nothing.
    const type = column.type;
    const image = cell as string;
    if (type.description === 'decorative') {
      return { image, description: 'decorative', column: { name: column.name, type } };
    }
    const named = type.description.column;
    const description = row[index.get(named)!];
    if (typeof description !== 'string' || SPACES_ALONE.test(description)) {
      return { failure: 'image_description_missing', column: named };
    }
    return { image, description, column: { name: column.name, type } };
  }
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
