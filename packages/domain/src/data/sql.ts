import type { ValueType } from './columns.js';
import type { Parameter, QueryDefinition } from './definition.js';
import type { ParameterValues } from './parameters.js';

/**
 * PostgreSQL's SQL as a definition writes it (the D2 plan, D2-B and D2-C): text, with `{{name}}` where
 * a value is bound and `{{#name}}` where a variation's fragment is placed. The lexer reads the text as
 * PostgreSQL's own scanner would - strings, escape strings, dollar quotes, quoted names and nested
 * comments - so a marker is found only outside all of them.
 */
export type SqlPiece =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'value'; readonly name: string }
  | { readonly kind: 'variation'; readonly name: string };

/** Why SQL does not lex whole, and the line, counted from 1, where it shows. */
export interface LexProblem {
  readonly problem: string;
  readonly line: number;
}

const MARKER = /^\{\{(#?)([a-z][a-z0-9_]{0,62})\}\}/;
const MARKER_ANYWHERE = /\{\{#?[a-z][a-z0-9_]{0,62}\}\}/;
/** A dollar quote's opening: `$`, a tag that is empty or a name, and `$`. */
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;

/** A character that may stand inside a PostgreSQL name: a `$` after one is part of the name. */
const inName = (character: string | undefined) =>
  character !== undefined && /[A-Za-z0-9_$\u0080-￿]/.test(character);

const INSIDE =
  'A marker is written outside strings, quoted names and comments, where it would be read as text';

/**
 * The pieces of PostgreSQL SQL: text, and the markers outside every string, escape string (`E'...'`),
 * dollar quote, quoted name and comment - or the first problem, with its line: a marker inside one of
 * those, one of them left open, or a positional parameter (`$1`), which the binder writes itself.
 */
export function lexPostgres(text: string): SqlPiece[] | LexProblem {
  const pieces: SqlPiece[] = [];
  let pending = '';
  let at = 0;
  const lineAt = (index: number) => {
    let line = 1;
    for (
      let each = text.indexOf('\n');
      each >= 0 && each < index;
      each = text.indexOf('\n', each + 1)
    ) {
      line += 1;
    }
    return line;
  };
  const refuse = (problem: string, index: number): LexProblem => ({ problem, line: lineAt(index) });
  /** A quoted region or a comment, read as text unless a marker is inside it. */
  const region = (start: number, end: number): LexProblem | undefined => {
    const inner = text.slice(start, end);
    const marker = MARKER_ANYWHERE.exec(inner);
    if (marker) return refuse(INSIDE, start + marker.index);
    pending += inner;
    return undefined;
  };
  const flush = () => {
    if (pending !== '') pieces.push({ kind: 'text', text: pending });
    pending = '';
  };

  while (at < text.length) {
    const character = text[at]!;
    const before = at > 0 ? text[at - 1] : undefined;
    if (character === '{' && text[at + 1] === '{') {
      const marker = MARKER.exec(text.slice(at, at + 70));
      if (marker) {
        flush();
        pieces.push({ kind: marker[1] === '#' ? 'variation' : 'value', name: marker[2]! });
        at += marker[0].length;
        continue;
      }
    }
    if (character === "'") {
      // An escape string is `E'...'`, its E a token of its own: after a name's character it is a name.
      const escapes = (before === 'E' || before === 'e') && !inName(text[at - 2]);
      let end = at + 1;
      for (;;) {
        if (end >= text.length) return refuse('A string is not closed', at);
        const next = text[end];
        if (escapes && next === '\\') end += 2;
        else if (next === "'" && text[end + 1] === "'") end += 2;
        else if (next === "'") break;
        else end += 1;
      }
      const problem = region(at, end + 1);
      if (problem) return problem;
      at = end + 1;
      continue;
    }
    if (character === '"') {
      let end = at + 1;
      for (;;) {
        if (end >= text.length) return refuse('A quoted name is not closed', at);
        if (text[end] === '"' && text[end + 1] === '"') end += 2;
        else if (text[end] === '"') break;
        else end += 1;
      }
      const problem = region(at, end + 1);
      if (problem) return problem;
      at = end + 1;
      continue;
    }
    if (character === '-' && text[at + 1] === '-') {
      const newline = text.indexOf('\n', at);
      const end = newline < 0 ? text.length : newline;
      const problem = region(at, end);
      if (problem) return problem;
      at = end;
      continue;
    }
    if (character === '/' && text[at + 1] === '*') {
      let depth = 1;
      let end = at + 2;
      while (depth > 0) {
        if (end >= text.length) return refuse('A comment is not closed', at);
        if (text[end] === '/' && text[end + 1] === '*') {
          depth += 1;
          end += 2;
        } else if (text[end] === '*' && text[end + 1] === '/') {
          depth -= 1;
          end += 2;
        } else end += 1;
      }
      const problem = region(at, end);
      if (problem) return problem;
      at = end;
      continue;
    }
    if (character === '$' && !inName(before)) {
      if (/[0-9]/.test(text[at + 1] ?? '')) {
        return refuse('A value is written as a named marker, {{name}}, never as $1', at);
      }
      const tag = DOLLAR_TAG.exec(text.slice(at, at + 130));
      if (tag) {
        const close = text.indexOf(tag[0], at + tag[0].length);
        if (close < 0) return refuse('A dollar-quoted string is not closed', at);
        const problem = region(at, close + tag[0].length);
        if (problem) return problem;
        at = close + tag[0].length;
        continue;
      }
    }
    pending += character;
    at += 1;
  }
  flush();
  return pieces;
}

/** PostgreSQL's type for a value of each base (D2-C). */
const POSTGRES_TYPES = {
  text: 'text',
  integer: 'int8',
  decimal: 'numeric',
  date: 'date',
  time: 'time',
  localDateTime: 'timestamp',
  instant: 'timestamptz',
  boolean: 'boolean',
} as const satisfies Record<ValueType['base'], string>;

/**
 * The longest SQL a run reports it ran, in UTF-16 code units as a string's length counts them: its
 * text, with each marker written as its placeholder and each fragment placed. A definition that could
 * bind to more is refused when it is written (`longestBinding`), so no run is refused for it.
 */
export const RAN_MAX_CHARACTERS = 300_000;

/** The placeholder a value marker is written as: the driver's n-th parameter, cast to its type. */
function placeholder(number: number, parameter: Parameter): string {
  return `$${number}::${POSTGRES_TYPES[parameter.type.base]}${parameter.list ? '[]' : ''}`;
}

/**
 * The length of the longest SQL a definition can bind to, as `RAN_MAX_CHARACTERS` counts it: its text
 * with each variation marker replaced by its longest fragment and each value marker by its
 * placeholder, as `bindPostgres` writes them. Undefined where the SQL does not lex, or a marker names
 * no parameter of its kind, which the definition's checks refuse on their own.
 */
export function longestBinding(
  definition: Pick<QueryDefinition, 'parameters' | 'fetch'>,
): number | undefined {
  const pieces = lexPostgres(definition.fetch.text);
  if (!Array.isArray(pieces)) return undefined;
  const declared = new Map<string, Parameter>(
    definition.parameters.map((parameter) => [parameter.name, parameter]),
  );
  const numbers = new Map<string, number>();
  let length = 0;
  for (const piece of pieces) {
    if (piece.kind === 'text') {
      length += piece.text.length;
      continue;
    }
    const parameter = declared.get(piece.name);
    if (!parameter) return undefined;
    if (piece.kind === 'variation') {
      if (parameter.variation === undefined) return undefined;
      length += Math.max(...parameter.variation.map((each) => each.sql.length));
      continue;
    }
    let number = numbers.get(piece.name);
    if (number === undefined) {
      number = numbers.size + 1;
      numbers.set(piece.name, number);
    }
    length += placeholder(number, parameter).length;
  }
  return length;
}

/** A value as the driver is handed it: its canonical text, a list's as an array, or null. */
export type BoundValue = string | readonly string[] | null;

/** SQL that binds every value as the driver's parameter, and the values in their places. */
export interface BoundStatement {
  readonly text: string;
  readonly values: readonly BoundValue[];
}

const asText = (value: string | boolean) => (typeof value === 'boolean' ? String(value) : value);

/**
 * PostgreSQL's binder (D2-C; DAT-081, DAT-019): each value marker is written `$n::type`, by its
 * parameter's declaration, and its value handed to the driver as the n-th parameter - a list as one
 * array - so no value is ever in the text; a marker used twice binds once. Each variation marker is
 * replaced by the fragment its value keys, found by an own lookup in the declared list, so the key
 * never reaches the source and nothing it names but a declared fragment can. The values have already
 * passed `checkParameterValues`: anything they could not have is thrown, never guessed at.
 */
export function bindPostgres(
  definition: Pick<QueryDefinition, 'parameters' | 'fetch'>,
  values: ParameterValues,
): BoundStatement {
  const pieces = lexPostgres(definition.fetch.text);
  if (!Array.isArray(pieces)) throw new Error(`The SQL does not lex: ${pieces.problem}`);
  const declared = new Map<string, Parameter>(
    definition.parameters.map((parameter) => [parameter.name, parameter]),
  );
  const numbers = new Map<string, number>();
  const bound: BoundValue[] = [];
  let text = '';
  for (const piece of pieces) {
    if (piece.kind === 'text') {
      text += piece.text;
      continue;
    }
    const parameter = declared.get(piece.name);
    if (!parameter) throw new Error(`The marker ${piece.name} names no declared parameter`);
    const value = Object.hasOwn(values, piece.name) ? values[piece.name] : null;
    if (piece.kind === 'variation') {
      const fragment = parameter.variation?.find((each) => each.key === value);
      if (fragment === undefined) {
        throw new Error(`The variation ${piece.name} declares no fragment for the value given`);
      }
      text += fragment.sql;
      continue;
    }
    let number = numbers.get(piece.name);
    if (number === undefined) {
      bound.push(
        value === null || value === undefined
          ? null
          : Array.isArray(value)
            ? value.map((item) => asText(item as string | boolean))
            : asText(value as string | boolean),
      );
      number = bound.length;
      numbers.set(piece.name, number);
    }
    text += placeholder(number, parameter);
  }
  return { text, values: bound };
}
