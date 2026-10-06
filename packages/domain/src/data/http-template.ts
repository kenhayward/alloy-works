import { z } from 'zod';

import type { CanonicalValue } from './canonical.js';
import { isFreeHeaderName } from './connection.js';
import type { Parameter } from './definition.js';
import type { ParameterProblem, ParameterValues } from './parameters.js';
import { CONTROL, characters, parameterName, storable } from './primitives.js';

/**
 * An HTTP request template (data.md, "The fetch"; DAT-104; the D6 plan, D6-E): a method, path
 * segments, query pairs and headers, each part fixed or a parameter, and for a POST a JSON body whose
 * leaves may be parameters. Every value is placed by a builder for its position (DAT-081): never text
 * with markers in it, so no value is ever spliced into a URL, a header or a body.
 */

/** The longest fixed text a template holds, in characters. */
const FIXED_MAX = 2000;

const fixedText = storable('Fixed text').refine((value) => characters(value) <= FIXED_MAX, {
  message: `Fixed text is at most ${FIXED_MAX.toLocaleString('en-GB')} characters`,
});

/** A part of a path, a query or a header: fixed text, or a declared parameter's value. */
export const httpPartSchema = z.union([
  z.strictObject({ fixed: fixedText }),
  z.strictObject({ parameter: parameterName }),
]);
export type HttpPart = z.infer<typeof httpPartSchema>;

/** A number as JSON writes it and the product's canonical form takes it: no `-0`, no trailing zero. */
const CANONICAL_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/;

/** A body node: a fixed leaf, a fixed number by its text, a parameter, an object or an array. */
export type HttpBodyNode =
  | { readonly fixed: string | boolean | null }
  | { readonly number: string }
  | { readonly parameter: string }
  | { readonly object: readonly { readonly name: string; readonly value: HttpBodyNode }[] }
  | { readonly array: readonly HttpBodyNode[] };

/** The deepest a body may nest, and the most nodes it may hold. */
export const BODY_MAX_DEPTH = 16;
export const BODY_MAX_NODES = 1000;

const bodyNode: z.ZodType<HttpBodyNode> = z.lazy(() =>
  z.union([
    z.strictObject({ fixed: z.union([fixedText, z.boolean(), z.null()]) }),
    z.strictObject({
      number: z
        .string()
        .max(100)
        .refine((value) => CANONICAL_NUMBER.test(value) && value !== '-0', {
          message: 'A number is written in canonical decimal: no exponent, no trailing zero',
        }),
    }),
    z.strictObject({ parameter: parameterName }),
    z.strictObject({
      object: z.array(z.strictObject({ name: fixedText, value: bodyNode })).max(200),
    }),
    z.strictObject({ array: z.array(bodyNode).max(200) }),
  ]),
);

/** A query pair's name: 1 to 200 characters, no control character. */
const queryName = storable('A query name').refine(
  (value) => characters(value) >= 1 && characters(value) <= 200 && !CONTROL.test(value),
  { message: 'A query name is 1 to 200 characters, no control character' },
);

const headerName = z.string().refine(isFreeHeaderName, {
  message:
    'A header is a lower-case header name, and not the host, a cookie or a header that frames the message',
});

export const httpTemplateSchema = z.strictObject({
  method: z.enum(['GET', 'POST']),
  path: z.array(httpPartSchema).max(32),
  query: z.array(z.strictObject({ name: queryName, value: httpPartSchema })).max(50),
  headers: z.array(z.strictObject({ name: headerName, value: httpPartSchema })).max(32),
  body: bodyNode.optional(),
});
export type HttpTemplate = z.infer<typeof httpTemplateSchema>;

/** Why a value cannot stand in a path segment, or undefined where it can (DAT-081). */
export function segmentProblem(text: string): string | undefined {
  if (text === '' || text === '.' || text === '..') return 'A path segment is not empty, . or ..';
  if (text.includes('/') || text.includes(String.fromCharCode(92))) {
    return 'A path segment holds no slash or backslash';
  }
  if (CONTROL.test(text)) return 'A path segment holds no control character';
  return undefined;
}

/**
 * Why a value cannot stand in a header, or undefined where it can (DAT-081): printable ASCII alone,
 * so no CR, LF or other control character, and no space before or after it, which a header's
 * parser drops.
 */
export function headerValueProblem(text: string): string | undefined {
  if (!/^[\x20-\x7e]*$/.test(text)) {
    return 'A header value is printable ASCII: no line break or other control character';
  }
  if (text !== text.trim()) return 'A header value has no space before or after it';
  return undefined;
}

/** A canonical value's text, as it stands in a path, a query or a header. */
function valueText(value: CanonicalValue): string {
  return typeof value === 'boolean' ? String(value) : (value ?? '');
}

/**
 * Text percent-encoded for a URL: every byte of its UTF-8 but RFC 3986's unreserved characters
 * escaped, so a value never reads as a delimiter.
 */
export function percentEncode(text: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(text)) {
    const character = String.fromCharCode(byte);
    out += /[A-Za-z0-9._~-]/.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** A request bound to its values: the path and query encoded, the headers, and the body's JSON. */
export interface BoundHttpRequest {
  readonly method: 'GET' | 'POST';
  /** `''`, or segments each after a `/`, appended to the base URL's path. */
  readonly path: string;
  /** `''`, or pairs joined by `&`, without the `?`. */
  readonly query: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly body?: string;
}

/** Values a template's positions cannot carry, refused with each problem (DAT-081). */
export class HttpValueRefused extends Error {
  constructor(readonly problems: readonly ParameterProblem[]) {
    super(`A value cannot be placed: ${problems.map((each) => each.parameter).join(', ')}`);
  }
}

/** Where each parameter stands in a template, as `checkHttpTemplate` and the binder read it. */
function* places(
  template: HttpTemplate,
): Generator<{ readonly name: string; readonly position: 'path' | 'query' | 'header' | 'body' }> {
  for (const part of template.path) {
    if ('parameter' in part) yield { name: part.parameter, position: 'path' };
  }
  for (const pair of template.query) {
    if ('parameter' in pair.value) yield { name: pair.value.parameter, position: 'query' };
  }
  for (const pair of template.headers) {
    if ('parameter' in pair.value) yield { name: pair.value.parameter, position: 'header' };
  }
  const walk = function* (node: HttpBodyNode): Generator<{ name: string; position: 'body' }> {
    if ('parameter' in node) yield { name: node.parameter, position: 'body' };
    else if ('object' in node) for (const member of node.object) yield* walk(member.value);
    else if ('array' in node) for (const item of node.array) yield* walk(item);
  };
  if (template.body !== undefined) yield* walk(template.body);
}

/** A body's depth and its count of nodes. */
function bodySize(node: HttpBodyNode): { depth: number; nodes: number } {
  const children =
    'object' in node
      ? node.object.map((member) => member.value)
      : 'array' in node
        ? node.array
        : [];
  let depth = 0;
  let nodes = 1;
  for (const child of children) {
    const size = bodySize(child);
    depth = Math.max(depth, size.depth);
    nodes += size.nodes;
  }
  return { depth: depth + 1, nodes };
}

/**
 * A template's rules beyond its shape, against the parameters declared (the D6 plan, D6-E): each
 * parameter it names declared, and each declared parameter placed; a path segment's parameter
 * required and not a list, a header's not a list, since neither position takes one; every fixed path
 * segment and header value one its position can carry; a header named once; a body on a POST alone,
 * within 16 levels and 1,000 nodes.
 */
export function checkHttpTemplate(
  template: HttpTemplate,
  parameters: readonly Parameter[],
  problem: (path: string, message: string) => void,
): void {
  const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const used = new Set<string>();
  for (const { name, position } of places(template)) {
    const parameter = byName.get(name);
    if (parameter === undefined) {
      problem('fetch.request', `The template names ${name}, which is not a declared parameter`);
      continue;
    }
    used.add(name);
    if ((position === 'path' || position === 'header') && parameter.list) {
      problem(
        'fetch.request',
        `${name} is a list, which a ${position === 'path' ? 'path segment' : 'header'} cannot carry`,
      );
    }
    if (position === 'path' && !parameter.required) {
      problem('fetch.request', `${name} stands in the path, so it is required`);
    }
  }
  for (const [at, parameter] of parameters.entries()) {
    if (!used.has(parameter.name)) {
      problem(`parameters.${at}`, `The template does not use the parameter ${parameter.name}`);
    }
    if (parameter.variation !== undefined) {
      problem(
        `parameters.${at}.variation`,
        'A variation chooses SQL; an HTTP template places values alone',
      );
    }
  }
  for (const [at, part] of template.path.entries()) {
    if ('fixed' in part) {
      const why = segmentProblem(part.fixed);
      if (why !== undefined) problem(`fetch.request.path.${at}`, why);
    }
  }
  const headers = new Set<string>();
  for (const [at, pair] of template.headers.entries()) {
    if (headers.has(pair.name))
      problem(`fetch.request.headers.${at}.name`, 'A header is named once');
    headers.add(pair.name);
    if ('fixed' in pair.value) {
      const why = headerValueProblem(pair.value.fixed);
      if (why !== undefined) problem(`fetch.request.headers.${at}.value`, why);
    }
  }
  if (template.body !== undefined) {
    if (template.method !== 'POST')
      problem('fetch.request.body', 'A body is sent with a POST alone');
    const size = bodySize(template.body);
    if (size.depth > BODY_MAX_DEPTH) {
      problem('fetch.request.body', `A body nests at most ${BODY_MAX_DEPTH} levels`);
    }
    if (size.nodes > BODY_MAX_NODES) {
      problem(
        'fetch.request.body',
        `A body holds at most ${BODY_MAX_NODES.toLocaleString('en-GB')} parts`,
      );
    }
  }
}

/** A value as a problem shows it: text as it is, a list as JSON. */
const shown = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

/**
 * Each value a template's position cannot carry (DAT-081, the D6 plan, D6-E): a path segment's empty,
 * `.`, `..`, or holding a slash, a backslash or a control character; a header's holding a line
 * break, another control character or anything but printable ASCII, or a space before or after it;
 * and a list where a path segment or a header stands. Each problem names the parameter, the rule
 * `position` and the value. The values were checked against their declarations first.
 */
export function httpValueProblems(
  template: HttpTemplate,
  values: ParameterValues,
): ParameterProblem[] {
  const problems: ParameterProblem[] = [];
  const named = new Set<string>();
  for (const { name, position } of places(template)) {
    if (position !== 'path' && position !== 'header') continue;
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value === undefined || value === null) {
      if (position === 'path' && !named.has(name)) {
        problems.push({ parameter: name, rule: 'required', value: '' });
        named.add(name);
      }
      continue;
    }
    const why = Array.isArray(value)
      ? 'list'
      : position === 'path'
        ? segmentProblem(valueText(value as CanonicalValue))
        : headerValueProblem(valueText(value as CanonicalValue));
    if (why !== undefined && !named.has(name)) {
      problems.push({ parameter: name, rule: 'position', value: shown(value) });
      named.add(name);
    }
  }
  return problems;
}

/** A canonical value as a JSON body writes it: by its parameter's type, a number from its text. */
function bodyValue(value: CanonicalValue, parameter: Parameter): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  const { base } = parameter.type;
  return base === 'integer' || base === 'decimal' ? value : JSON.stringify(value);
}

/** A body node as JSON, its members in the template's order. */
function writeBody(
  node: HttpBodyNode,
  byName: ReadonlyMap<string, Parameter>,
  values: ParameterValues,
): string {
  if ('fixed' in node) return JSON.stringify(node.fixed);
  if ('number' in node) return node.number;
  if ('object' in node) {
    const members = node.object.map(
      (member) => `${JSON.stringify(member.name)}:${writeBody(member.value, byName, values)}`,
    );
    return `{${members.join(',')}}`;
  }
  if ('array' in node)
    return `[${node.array.map((item) => writeBody(item, byName, values)).join(',')}]`;
  const parameter = byName.get(node.parameter)!;
  const value = Object.hasOwn(values, node.parameter) ? values[node.parameter] : undefined;
  if (Array.isArray(value)) {
    return `[${(value as CanonicalValue[]).map((item) => bodyValue(item, parameter)).join(',')}]`;
  }
  return bodyValue((value ?? null) as CanonicalValue, parameter);
}

/**
 * A template bound to its values (DAT-081, DAT-104): each path segment and query part
 * percent-encoded but for RFC 3986's unreserved characters; a list in the query as its name repeated,
 * a query pair or a header whose value is null left out; a header's value as it is, once the position
 * has taken it; a body written by JSON serialisation, a number from its canonical text, a list as an
 * array. Throws `HttpValueRefused` for a value its position cannot carry, and sends nothing.
 */
export function bindHttp(
  template: HttpTemplate,
  parameters: readonly Parameter[],
  values: ParameterValues,
): BoundHttpRequest {
  const problems = httpValueProblems(template, values);
  if (problems.length > 0) throw new HttpValueRefused(problems);
  const byName = new Map(parameters.map((parameter) => [parameter.name, parameter]));
  const valueOf = (name: string) => (Object.hasOwn(values, name) ? values[name] : undefined);
  const path = template.path
    .map((part) =>
      'fixed' in part ? part.fixed : valueText(valueOf(part.parameter) as CanonicalValue),
    )
    .map((segment) => `/${percentEncode(segment)}`)
    .join('');
  const pairs: string[] = [];
  for (const pair of template.query) {
    const name = percentEncode(pair.name);
    if ('fixed' in pair.value) {
      pairs.push(`${name}=${percentEncode(pair.value.fixed)}`);
      continue;
    }
    const value = valueOf(pair.value.parameter);
    const items = Array.isArray(value) ? (value as CanonicalValue[]) : [value as CanonicalValue];
    for (const item of items) {
      if (item === null || item === undefined) continue;
      pairs.push(`${name}=${percentEncode(valueText(item))}`);
    }
  }
  const headers: (readonly [string, string])[] = [];
  for (const pair of template.headers) {
    if ('fixed' in pair.value) {
      headers.push([pair.name, pair.value.fixed]);
      continue;
    }
    const value = valueOf(pair.value.parameter);
    if (value === null || value === undefined) continue;
    headers.push([pair.name, valueText(value as CanonicalValue)]);
  }
  return {
    method: template.method,
    path,
    query: pairs.join('&'),
    headers,
    ...(template.body === undefined ? {} : { body: writeBody(template.body, byName, values) }),
  };
}
