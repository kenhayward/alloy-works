import { z } from 'zod';

/**
 * The most columns a relation a describe lists, or a definition declares, may have: a table holds at
 * most 1,600, and a view's select list at most 1,664 (PostgreSQL's `MaxTupleAttributeNumber`).
 */
export const MAX_COLUMNS = 1664;

const fraction = z.number().int().min(0).max(6);

const text = z.strictObject({ base: z.literal('text') });
const integer = z.strictObject({ base: z.literal('integer') });
const decimal = z
  .strictObject({
    base: z.literal('decimal'),
    precision: z.number().int().min(1).max(1000),
    scale: z.number().int().min(0).max(1000),
  })
  .refine((type) => type.scale <= type.precision, {
    message: 'A decimal has no more places than digits',
  });
const date = z.strictObject({ base: z.literal('date') });
const time = z.strictObject({ base: z.literal('time'), fraction });
const localDateTime = z.strictObject({ base: z.literal('localDateTime'), fraction });
const instant = z.strictObject({ base: z.literal('instant'), fraction });
const boolean = z.strictObject({ base: z.literal('boolean') });

/**
 * A column's type (data.md, "The columns, a second step"; DAT-080): the eight bases and `image`, read
 * from base64 text or a binary column, its description a declared text column or `decorative` (D8-A).
 * A parameter is never an image, and takes `valueTypeSchema`.
 */
export const columnTypeSchema = z.discriminatedUnion('base', [
  text,
  integer,
  decimal,
  date,
  time,
  localDateTime,
  instant,
  boolean,
  imageTypeSchema(),
]);

/** An image column's type (D8-A): its encoding, and its description's column or `decorative`. */
function imageTypeSchema() {
  return z.strictObject({
    base: z.literal('image'),
    encoding: z.enum(['base64', 'binary']),
    description: z.union([z.strictObject({ column: z.string().min(1) }), z.literal('decorative')]),
  });
}

export type ColumnType = z.infer<typeof columnTypeSchema>;

/** An image column's type alone, as a take of one answers it (the B6 plan, B6-D). */
export const imageColumnTypeSchema = imageTypeSchema();

export type ImageColumnType = Extract<ColumnType, { base: 'image' }>;

/** The eight bases a value can have: a parameter's type, and a D2 column's (the D2 plan, rows 5 and 9). */
export const valueTypeSchema = z.discriminatedUnion('base', [
  text,
  integer,
  decimal,
  date,
  time,
  localDateTime,
  instant,
  boolean,
]);

export type ValueType = z.infer<typeof valueTypeSchema>;

/**
 * What a describe proposes for a source column (D8-A): one of the eight, or an image for a binary
 * column, its description left for the author to declare.
 */
export const proposedTypeSchema = z.discriminatedUnion('base', [
  text,
  integer,
  decimal,
  date,
  time,
  localDateTime,
  instant,
  boolean,
  z.strictObject({ base: z.literal('image'), encoding: z.literal('binary') }),
]);

export type ProposedType = z.infer<typeof proposedTypeSchema>;

/** A column type's base, as a canonical result names each column's type (ADR-0035). */
export type ColumnBase = ColumnType['base'];
