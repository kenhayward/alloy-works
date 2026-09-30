import { z } from 'zod';

const fraction = z.number().int().min(0).max(6);

/**
 * A column's type (data.md, "The columns, a second step"; DAT-080): the eight bases and `image`. In D1
 * only a describe's proposal carries one, and a proposal is never an image; a definition stores them
 * from D2, when this shape becomes a stored one and its stored-shape check is that plan's.
 */
export const columnTypeSchema = z.discriminatedUnion('base', [
  z.strictObject({ base: z.literal('text') }),
  z.strictObject({ base: z.literal('integer') }),
  z
    .strictObject({
      base: z.literal('decimal'),
      precision: z.number().int().min(1).max(1000),
      scale: z.number().int().min(0).max(1000),
    })
    .refine((type) => type.scale <= type.precision, {
      message: 'A decimal has no more places than digits',
    }),
  z.strictObject({ base: z.literal('date') }),
  z.strictObject({ base: z.literal('time'), fraction }),
  z.strictObject({ base: z.literal('localDateTime'), fraction }),
  z.strictObject({ base: z.literal('instant'), fraction }),
  z.strictObject({ base: z.literal('boolean') }),
  z.strictObject({
    base: z.literal('image'),
    encoding: z.enum(['base64', 'binary']),
    description: z.union([z.strictObject({ column: z.string().min(1) }), z.literal('decorative')]),
  }),
]);

export type ColumnType = z.infer<typeof columnTypeSchema>;
