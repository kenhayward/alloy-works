import { z } from 'zod';

/**
 * **How a table's column of values is printed** (tables.md, "Formatting"; the TB1 plan, TB1-E): every
 * member optional, merged member by member over the table style's format for the column's type
 * (TAB-012, TAB-037). Declared on a bound table's column and, by type, on a table style (STY-014), so
 * one shape serves both. Whether a member means anything for a column's type is decided where the
 * result's columns are known (`format_mismatch`), never here.
 */

/** Whether a text, spaces taken out, reads as a number: digits, separators, a sign, parentheses, `%`. */
export function readsAsANumber(text: string): boolean {
  const bare = text.replace(/\s/gu, '');
  return /^[+\-\u2212(]?[\d.,']*\d[\d.,']*\)?%?$/u.test(bare);
}

/** A string held to a length in code points and to NFC, as every string the digest covers is. */
export const boundedText = (least: number, most: number) =>
  z
    .string()
    .refine((text) => {
      const length = [...text].length;
      return length >= least && length <= most;
    }, `is ${least} to ${most} characters`)
    .refine((text) => text === text.normalize('NFC'), 'is in NFC');

export const fieldFormatSchema = z.strictObject({
  style: z.enum(['number', 'currency', 'percent', 'duration']).optional(),
  places: z.number().int().min(0).max(20).optional(),
  rounding: z.enum(['halfAwayFromZero', 'halfEven']).optional(),
  negative: z.enum(['minus', 'parentheses']).optional(),
  negativeColour: z.boolean().optional(),
  currency: z
    .strictObject({
      symbol: boundedText(1, 8),
      position: z.enum(['before', 'after']),
      space: z.boolean(),
    })
    .optional(),
  percent: z.enum(['fraction', 'hundred']).optional(),
  duration: z
    .strictObject({
      from: z.enum(['seconds', 'minutes']),
      show: z.enum(['h:mm', 'h:mm:ss']),
    })
    .optional(),
  fraction: z.number().int().min(0).max(6).optional(),
  /** What a null prints (TAB-017): never empty, and never what a reader would take for a number. */
  null: boundedText(1, 40)
    .refine((text) => !readsAsANumber(text), 'never reads as a number')
    .optional(),
});

export type FieldFormat = z.infer<typeof fieldFormatSchema>;

/** An alignment a column, or a table style by type, declares (TAB-046, STY-077). */
export const COLUMN_ALIGNMENTS = ['start', 'centre', 'end', 'decimal'] as const;

export type ColumnAlignment = (typeof COLUMN_ALIGNMENTS)[number];

/** The types a table style declares a format and an alignment for: every base but an image. */
export type FieldKey =
  'integer' | 'decimal' | 'date' | 'time' | 'localDateTime' | 'instant' | 'boolean' | 'text';

/**
 * **The product's formats by type** (TB1-F), where a style names none: a number as a number, rounded
 * half away from zero, a negative with a minus; every other type as `formatValue` prints it.
 */
export const DEFAULT_TABLE_FIELDS: Readonly<Partial<Record<FieldKey, FieldFormat>>> = Object.freeze(
  {
    integer: Object.freeze({ style: 'number', rounding: 'halfAwayFromZero', negative: 'minus' }),
    decimal: Object.freeze({ style: 'number', rounding: 'halfAwayFromZero', negative: 'minus' }),
  } as const,
);

/** **The product's alignment by type** (STY-077): text at the start, numbers on their separator. */
export const DEFAULT_TABLE_ALIGN: Readonly<Record<FieldKey, ColumnAlignment>> = Object.freeze({
  text: 'start',
  integer: 'decimal',
  decimal: 'decimal',
  date: 'end',
  time: 'end',
  localDateTime: 'end',
  instant: 'end',
  boolean: 'end',
});
