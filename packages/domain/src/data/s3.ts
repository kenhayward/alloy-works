import { z } from 'zod';

import type { CanonicalValue } from './canonical.js';
import type { Parameter } from './definition.js';
import { httpPartSchema, percentEncode, segmentProblem } from './http-template.js';
import type { ParameterProblem, ParameterValues } from './parameters.js';
import { grouped, utf8Bytes } from './primitives.js';

/**
 * An S3 connection's credential and a file definition's object key (data.md, "The fetch"; the D6 plan,
 * D6-C and task 2). The key pair is a static access key and its secret, sealed together as JSON and
 * never stored in a version or answered; the key is a template of segments, each fixed or a
 * parameter, placed as a path's are (DAT-081), so no value ever splices a `/` into a key.
 */

/** An access key id or its secret: printable ASCII, no space, as every S3 store issues them. */
const KEY_ID = /^[\x21-\x7e]{1,128}$/;
const KEY_SECRET = /^[\x21-\x7e]{1,256}$/;

export const s3KeyPairSchema = z.strictObject({
  accessKeyId: z.string().regex(KEY_ID, {
    message: 'An access key id is 1 to 128 printable ASCII characters, no space',
  }),
  secretAccessKey: z.string().regex(KEY_SECRET, {
    message: 'A secret access key is 1 to 256 printable ASCII characters, no space',
  }),
});
export type S3KeyPair = z.infer<typeof s3KeyPairSchema>;

/** A key pair as it is sealed: JSON of its two members in one order. */
export const keyPairText = (pair: S3KeyPair) =>
  JSON.stringify({ accessKeyId: pair.accessKeyId, secretAccessKey: pair.secretAccessKey });

/** A sealed key pair's text read back, or undefined where it is not one. */
export function parseKeyPair(text: string): S3KeyPair | undefined {
  try {
    const parsed = s3KeyPairSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The longest object key S3 takes, in bytes of UTF-8. */
export const KEY_MAX_BYTES = 1024;

/** An object key: 1 to 32 segments, each fixed text or a parameter's value, joined by `/`. */
export const objectKeySchema = z.array(httpPartSchema).min(1).max(32);
export type ObjectKey = z.infer<typeof objectKeySchema>;

/**
 * A key template's rules against the parameters declared: each parameter it names declared, required
 * and not a list, since a segment takes one value; each fixed segment one a segment can carry; and its
 * fixed text alone within S3's 1,024 bytes. Answers the names it uses.
 */
export function checkObjectKey(
  key: ObjectKey,
  parameters: readonly Parameter[],
  problem: (path: string, message: string) => void,
): Set<string> {
  const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const used = new Set<string>();
  let fixed = key.length - 1;
  for (const [at, part] of key.entries()) {
    const path = `fetch.key.${at}`;
    if ('fixed' in part) {
      fixed += utf8Bytes(part.fixed);
      const why = segmentProblem(part.fixed);
      if (why !== undefined) problem(path, why.replace('A path segment', 'A key segment'));
      continue;
    }
    const parameter = byName.get(part.parameter);
    if (parameter === undefined) {
      problem(path, `The key names ${part.parameter}, which is not a declared parameter`);
      continue;
    }
    used.add(parameter.name);
    if (parameter.list) problem(path, `${parameter.name} is a list, which a key segment cannot carry`);
    if (!parameter.required) problem(path, `${parameter.name} stands in the key, so it is required`);
  }
  if (fixed > KEY_MAX_BYTES) {
    problem('fetch.key', `A key is at most ${grouped(KEY_MAX_BYTES)} bytes`);
  }
  return used;
}

/** A canonical value's text, as it stands in a key. */
const valueText = (value: CanonicalValue) =>
  typeof value === 'boolean' ? String(value) : (value ?? '');

/** A value as a problem shows it: text as it is, a list as JSON. */
const shown = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/**
 * Each value a key's segment cannot carry (DAT-081): empty, `.` or `..`, a slash, a backslash or a
 * control character, a list, or a value that makes the key longer than S3 takes. Each names its
 * parameter, the rule `position` and the value. The values were checked against their declarations.
 */
export function objectKeyProblems(key: ObjectKey, values: ParameterValues): ParameterProblem[] {
  const problems: ParameterProblem[] = [];
  const named = new Set<string>();
  const segments: string[] = [];
  for (const part of key) {
    if ('fixed' in part) {
      segments.push(part.fixed);
      continue;
    }
    const name = part.parameter;
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined || value === null) {
      if (!named.has(name)) problems.push({ parameter: name, rule: 'required', value: '' });
      named.add(name);
      continue;
    }
    const text = Array.isArray(value) ? undefined : valueText(value as CanonicalValue);
    segments.push(text ?? '');
    if ((text === undefined || segmentProblem(text) !== undefined) && !named.has(name)) {
      problems.push({ parameter: name, rule: 'position', value: shown(value) });
      named.add(name);
    }
  }
  if (problems.length === 0 && utf8Bytes(segments.join('/')) > KEY_MAX_BYTES) {
    const first = key.find((part) => 'parameter' in part) as { parameter: string } | undefined;
    if (first !== undefined) {
      const value = values[first.parameter];
      problems.push({ parameter: first.parameter, rule: 'position', value: shown(value) });
    }
  }
  return problems;
}

/** Values a key's segments cannot carry, refused with each problem; nothing is sent. */
export class ObjectKeyRefused extends Error {
  constructor(readonly problems: readonly ParameterProblem[]) {
    super(`A value cannot be placed in the key: ${problems.map((each) => each.parameter).join(', ')}`);
  }
}

/** A key bound to its values: as S3 names the object, and as its path, each segment encoded. */
export interface BoundObjectKey {
  /** The key as the object is named: segments joined by `/`. What a run reports it read. */
  readonly key: string;
  /** `/` then each segment percent-encoded but for RFC 3986's unreserved characters. */
  readonly path: string;
}

/**
 * A key template bound to its values (DAT-081): each segment placed whole and percent-encoded on its
 * own, so a value never reads as a delimiter. Throws `ObjectKeyRefused` for a value a segment
 * cannot carry.
 */
export function bindObjectKey(key: ObjectKey, values: ParameterValues): BoundObjectKey {
  const problems = objectKeyProblems(key, values);
  if (problems.length > 0) throw new ObjectKeyRefused(problems);
  const segments = key.map((part) =>
    'fixed' in part ? part.fixed : valueText(values[part.parameter] as CanonicalValue),
  );
  return {
    key: segments.join('/'),
    path: segments.map((segment) => `/${percentEncode(segment)}`).join(''),
  };
}
