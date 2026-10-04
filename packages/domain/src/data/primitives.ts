import { z } from 'zod';

import { storableText } from '../stored/storable.js';
import { MAX_TEXT_VALUE } from './parameters.js';

/**
 * The pieces a query definition's shape and the builder's tree share (the D2 plan; the D4 plan, D4-B):
 * kept apart from both so the builder's schema, which the definition's holds, imports nothing of it.
 */

/** A parameter's name and a variation's key: lower case, a letter first, as PostgreSQL's names go. */
export const PARAMETER_NAME = /^[a-z][a-z0-9_]{0,62}$/;

/** Any control character: C0, DEL and C1. */
export const CONTROL = /\p{Cc}/u;

export const characters = (value: string) => [...value].length;
/** A whole number with its thousands separated by commas, as the product writes one. */
export const grouped = (value: number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

export const storable = (what: string) =>
  z.string().refine(storableText, { message: `${what} holds a character that cannot be stored` });

export const parameterName = z.string().regex(PARAMETER_NAME, {
  message: 'A name is a lower-case letter, then up to 62 lower-case letters, digits or underscores',
});

/** A name as PostgreSQL holds one: 1 to 63 bytes, no control character, nothing unstorable. */
export const sourceName = (what: string) =>
  storable(what)
    .refine((value) => utf8Bytes(value) >= 1 && utf8Bytes(value) <= 63, {
      message: `${what} is 1 to 63 bytes of UTF-8`,
    })
    .refine((value) => !CONTROL.test(value), { message: `${what} holds no control character` });

// A permitted value's text is counted in characters, as a parameter's value is (D2-R), never left to
// how the schema library happens to count a string's length. A binding's literal is held to the same
// (the D3 plan, D3-C): canonical in its parameter's type is decided where it is resolved.
export const canonicalValueSchema = z.union([
  storable('A value')
    // Published as JSON Schema's maxLength, which counts characters too.
    .max(MAX_TEXT_VALUE)
    .refine((value) => characters(value) <= MAX_TEXT_VALUE, {
      message: 'A value is at most 1,000 characters',
    }),
  z.boolean(),
  z.null(),
]);
