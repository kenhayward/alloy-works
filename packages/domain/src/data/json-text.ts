import { z } from 'zod';

import { CONTROL } from './primitives.js';

/**
 * JSON as the connector reads it (data.md, "The fetch"; DAT-095; the D6 plan, D6-G and D6-H): every
 * number kept as its source text, never through a double, and a nested value written in one canonical
 * form, so reformatting or reordering at the source moves no checksum.
 */

/** A JSON number, by the text it was written with. */
export class JsonNumber {
  constructor(readonly source: string) {}
}

/** A JSON value with its numbers by their source text. */
export type JsonValue =
  | string
  | boolean
  | null
  | JsonNumber
  | readonly JsonValue[]
  | { readonly [name: string]: JsonValue };

/** Whether a value is an object of members, rather than an array, a number or a leaf. */
export function isJsonObject(value: JsonValue): value is { readonly [name: string]: JsonValue } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof JsonNumber)
  );
}

/**
 * A nested value's canonical text (D6-G): members sorted by UTF-16 code unit and strings escaped as
 * RFC 8785 sets out, no whitespace, and every number its source text verbatim, which RFC 8785 would
 * write through a double and DAT-095 forbids. So whitespace and member order at the source move no
 * checksum, and a number's spelling does.
 */
export function canonicalJsonText(value: JsonValue): string {
  if (value instanceof JsonNumber) return value.source;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${(value as readonly JsonValue[]).map(canonicalJsonText).join(',')}]`;
  }
  const object = value as { readonly [name: string]: JsonValue };
  const names = Object.keys(object).sort();
  return `{${names.map((name) => `${JSON.stringify(name)}:${canonicalJsonText(object[name]!)}`).join(',')}}`;
}

/** RFC 6901's JSON Pointer: empty, or tokens each after a `/`, `~` escaped as `~0` and `/` as `~1`. */
const POINTER = /^(?:\/(?:[^~/]|~[01])*)*$/;

/** A JSON Pointer as a definition holds one: RFC 6901's, 1,024 characters, no control character. */
export const jsonPointerSchema = z
  .string()
  .max(1024)
  .refine((value) => POINTER.test(value) && !CONTROL.test(value), {
    message: 'A pointer is a JSON Pointer: empty, or names each after a /, with ~0 and ~1 escapes',
  });

/** A pointer's tokens, unescaped. */
export function pointerTokens(pointer: string): string[] {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));
}

/** A pointer to a member by its name: the name's `~` and `/` escaped. */
export function pointerTo(name: string): string {
  return `/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

/**
 * The value a pointer names, or undefined where it names nothing (RFC 6901): an object's own member
 * by name, never one inherited, and an array's item by a decimal index without a leading zero.
 */
export function resolvePointer(value: JsonValue, pointer: string): JsonValue | undefined {
  let at: JsonValue = value;
  for (const token of pointerTokens(pointer)) {
    if (Array.isArray(at)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token)) return undefined;
      const item = (at as readonly JsonValue[])[Number(token)];
      if (item === undefined) return undefined;
      at = item;
    } else if (isJsonObject(at)) {
      if (!Object.hasOwn(at, token)) return undefined;
      at = at[token]!;
    } else {
      return undefined;
    }
  }
  return at;
}
