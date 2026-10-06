import { describe, expect, it } from 'vitest';

import {
  canonicalJsonText,
  JsonNumber,
  jsonPointerSchema,
  pointerTo,
  resolvePointer,
  type JsonValue,
} from './json-text.js';

/** JSON read as the connector reads it: every number by its source text. */
const read = (text: string): JsonValue =>
  JSON.parse(text, (_key, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' ? new JsonNumber(context!.source!) : value,
  ) as JsonValue;

describe('JSON by its source text', () => {
  it('writes a nested value in one canonical form: members sorted, no whitespace, numbers verbatim', () => {
    const one = read('{"b": [1.50, 2e3, true], "a": {"z": null, "é": "x\\u00e9"}, "A": -0}');
    const two = read('{\n  "A":-0,"a":{"é":"xé",   "z":null},\n  "b":[1.50,2e3,true]}');
    const text = '{"A":-0,"a":{"z":null,"é":"xé"},"b":[1.50,2e3,true]}';
    expect(canonicalJsonText(one)).toBe(text);
    expect(canonicalJsonText(two)).toBe(text);
    // A number's spelling is its own: 1.5 is not 1.50.
    expect(canonicalJsonText(read('[1.5]'))).not.toBe(canonicalJsonText(read('[1.50]')));
    // Strings escaped as RFC 8785 sets out: a control character as \\u, a lone surrogate kept escaped.
    expect(canonicalJsonText(read('["\\u0001\\n\\ud800"]'))).toBe('["\\u0001\\n\\ud800"]');
    // Members sorted by UTF-16 code unit, so an astral character sorts before U+FFFF's neighbours.
    expect(canonicalJsonText(read('{"￿":1,"😀":2}'))).toBe('{"😀":2,"￿":1}');
  });

  it("resolves an RFC 6901 pointer to an object's own member or an array's item", () => {
    const value = read('{"a/b": {"~c": [10, 20]}, "items": [{"id": 1}], "__proto__": {"x": 1}}');
    expect(resolvePointer(value, '')).toBe(value);
    expect(resolvePointer(value, '/a~1b/~0c/1')).toEqual(new JsonNumber('20'));
    expect(resolvePointer(value, '/items/0/id')).toEqual(new JsonNumber('1'));
    expect(resolvePointer(value, '/items/01')).toBeUndefined();
    expect(resolvePointer(value, '/items/1')).toBeUndefined();
    expect(resolvePointer(value, '/toString')).toBeUndefined();
    expect(resolvePointer(value, '/__proto__/x')).toEqual(new JsonNumber('1'));
    expect(resolvePointer(value, '/items/0/id/deeper')).toBeUndefined();
    expect(pointerTo('a/b~c')).toBe('/a~1b~0c');
    for (const good of ['', '/', '/a', '/a~0~1', '/0/b']) {
      expect(jsonPointerSchema.safeParse(good).success, good).toBe(true);
    }
    for (const bad of ['a', '/a~2', '/a~', '/a\u0000']) {
      expect(jsonPointerSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
