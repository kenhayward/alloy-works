import { z } from 'zod';

import { definitionIdentity } from './definition.js';
import { dateTimeInstant, isCanonicalDecimal, isIsoDate, isIsoTime } from './lexical.js';

/** Closed (MET-002). Adding one is a definition schema version with a migration, never configuration. */
export const dataTypes = ['text', 'number', 'date', 'time', 'dateTime', 'boolean', 'user'] as const;

export type DataType = (typeof dataTypes)[number];

const cardinality = {
  multiplicity: z.enum(['one', 'many']),
  maxValues: z.number().int().min(1).optional(),
};

const length = z.number().int().min(0).optional();
const decimal = z.string().refine(isCanonicalDecimal, 'not a canonical decimal string').optional();
const date = z.string().refine(isIsoDate, 'not a date, YYYY-MM-DD').optional();
const time = z.string().refine(isIsoTime, 'not a time, HH:MM or HH:MM:SS').optional();
const dateTime = z
  .string()
  .refine((value) => dateTimeInstant(value) !== undefined, 'not a date and time with an offset')
  .optional();

const field = <T extends DataType, V extends z.ZodRawShape>(dataType: T, validation: V) =>
  z.strictObject({
    ...definitionIdentity,
    dataType: z.literal(dataType),
    ...cardinality,
    validation: z.strictObject(validation),
  });

/**
 * A field (MET-001). `validation` is what a value IS (MET-004), declared per data type.
 *
 * `pattern` is deliberately absent from `text`: metadata.md's open question on keeping a pattern from
 * backtracking exponentially is unanswered, and the design says `pattern` does not ship until it is.
 * The strict object refuses it, so a definition written today cannot carry one that nothing enforces.
 */
export const fieldDefinitionSchema = z
  .discriminatedUnion('dataType', [
    field('text', { minLength: length, maxLength: length }),
    field('number', {
      min: decimal,
      max: decimal,
      integer: z.boolean().optional(),
      scale: z.number().int().min(0).optional(),
    }),
    field('date', { min: date, max: date }),
    field('time', { min: time, max: time }),
    field('dateTime', { min: dateTime, max: dateTime }),
    field('boolean', {}),
    field('user', {}),
  ])
  .superRefine((definition, context) => {
    if (definition.maxValues !== undefined && definition.multiplicity !== 'many') {
      context.addIssue({
        code: 'custom',
        path: ['maxValues'],
        message: 'maxValues is declared only on a field holding several values',
      });
    }
  });

export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;
