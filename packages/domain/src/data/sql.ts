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
/** The same, read where the scan stands and to whatever length the tag runs: no window. */
const DOLLAR_TAG_HERE = new RegExp(DOLLAR_TAG.source.slice(1), 'y');
/** A positional parameter's digits, read where the scan stands. */
const DIGITS_HERE = /[0-9]+/y;

/** A character that may stand inside a PostgreSQL name: a `$` after one is part of the name. */
const inName = (character: string | undefined) =>
  character !== undefined && /[A-Za-z0-9_$\u0080-￿]/.test(character);
/** A character that begins a name, rather than a number: a letter, an underscore, or beyond ASCII. */
const startsName = (character: string | undefined) =>
  inName(character) && !/[0-9$]/.test(character!);

/** Built rather than typed, as the characters they are. */
const BACKSLASH = String.fromCharCode(92);
const LINE_FEED = String.fromCharCode(10);
/** A line break, and PostgreSQL's space within a line: space, tab, form feed and vertical tab. */
const LINE_BREAKS = new Set([10, 13]);
const HORIZONTAL_SPACE = new Set([32, 9, 12, 11]);

const INSIDE =
  'A marker is written outside strings, quoted names and comments, where it would be read as text';
const POSITIONAL = 'A value is written as a named marker, {{name}}, never as $1';

/**
 * Where a string closed just before `at` goes on: PostgreSQL reads a quote after white space that
 * holds a line break - with `--` comments in it, each before a line break - as the same literal
 * continuing, of the kind it began as (its scanner's `quotecontinue`). The index of that quote, or
 * undefined where the string ended.
 */
function continuation(text: string, at: number): number | undefined {
  let i = at;
  const comment = () => {
    while (i < text.length && !LINE_BREAKS.has(text.charCodeAt(i))) i += 1;
  };
  // Space and comments within the line, then a line break.
  for (;;) {
    if (HORIZONTAL_SPACE.has(text.charCodeAt(i))) i += 1;
    else if (text.startsWith('--', i)) comment();
    else break;
  }
  if (!LINE_BREAKS.has(text.charCodeAt(i))) return undefined;
  // Then any space and line breaks, and comments each ended by a line break.
  for (;;) {
    const code = text.charCodeAt(i);
    if (HORIZONTAL_SPACE.has(code) || LINE_BREAKS.has(code)) i += 1;
    else if (text.startsWith('--', i)) {
      comment();
      if (!LINE_BREAKS.has(text.charCodeAt(i))) return undefined;
    } else break;
  }
  return text[i] === "'" ? i : undefined;
}

/** A positional parameter, as the binder's own placeholders are read back from what it wrote. */
interface Positional {
  readonly kind: 'positional';
  readonly number: number;
}

/**
 * PostgreSQL's scanner, as far as a marker or a placeholder is concerned. With `markers`, it finds the
 * markers and refuses a positional parameter; with `placeholders`, it reads markers as text and finds
 * the positional parameters, so a binding can be read back.
 */
function scan(text: string, mode: 'markers'): SqlPiece[] | LexProblem;
function scan(text: string, mode: 'placeholders'): (SqlPiece | Positional)[] | LexProblem;
function scan(
  text: string,
  mode: 'markers' | 'placeholders',
): (SqlPiece | Positional)[] | LexProblem {
  const pieces: (SqlPiece | Positional)[] = [];
  let pending = '';
  let at = 0;
  /**
   * The run of name characters just read outside every quote and comment: a name if it began with a
   * letter, an underscore or a character beyond ASCII, and otherwise a number (or nothing).
   */
  let run = '';
  const lineAt = (index: number) => {
    let line = 1;
    for (
      let each = text.indexOf(LINE_FEED);
      each >= 0 && each < index;
      each = text.indexOf(LINE_FEED, each + 1)
    ) {
      line += 1;
    }
    return line;
  };
  const refuse = (problem: string, index: number): LexProblem => ({ problem, line: lineAt(index) });
  /** A quoted region or a comment, read as text unless a marker is inside it. */
  const region = (start: number, end: number): LexProblem | undefined => {
    const inner = text.slice(start, end);
    const marker = mode === 'markers' ? MARKER_ANYWHERE.exec(inner) : null;
    if (marker) return refuse(INSIDE, start + marker.index);
    pending += inner;
    run = '';
    return undefined;
  };
  const flush = () => {
    if (pending !== '') pieces.push({ kind: 'text', text: pending });
    pending = '';
  };

  while (at < text.length) {
    const character = text[at]!;
    if (mode === 'markers' && character === '{' && text[at + 1] === '{') {
      const marker = MARKER.exec(text.slice(at, at + 70));
      if (marker) {
        flush();
        pieces.push({ kind: marker[1] === '#' ? 'variation' : 'value', name: marker[2]! });
        at += marker[0].length;
        run = '';
        continue;
      }
    }
    if (character === "'") {
      // An escape string is `E'...'`, its E a token of its own - or, on PostgreSQL 14, after a number,
      // which that version reads apart from it. After a name's letters it is a standard string.
      const escapes = /^[0-9]*[Ee]$/.test(run);
      let end = at + 1;
      for (;;) {
        if (end >= text.length) return refuse('A string is not closed', at);
        const next = text[end];
        if (escapes && next === BACKSLASH) end += 2;
        else if (next === "'" && text[end + 1] === "'") end += 2;
        else if (next === "'") {
          // Continued across a line break, the same literal goes on, escapes and all.
          const more = continuation(text, end + 1);
          if (more === undefined) break;
          end = more + 1;
        } else end += 1;
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
      let end = at;
      while (end < text.length && !LINE_BREAKS.has(text.charCodeAt(end))) end += 1;
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
    // A `$` inside a name is part of it; anywhere else - after a number too - it is PostgreSQL's
    // positional parameter before a digit, and otherwise may open a dollar quote.
    if (character === '$' && !startsName(run[0])) {
      DIGITS_HERE.lastIndex = at + 1;
      const digits = DIGITS_HERE.exec(text);
      if (digits) {
        if (mode === 'markers') return refuse(POSITIONAL, at);
        flush();
        pieces.push({ kind: 'positional', number: Number(digits[0]) });
        at += 1 + digits[0].length;
        run = '';
        continue;
      }
      DOLLAR_TAG_HERE.lastIndex = at;
      const tag = DOLLAR_TAG_HERE.exec(text);
      if (tag) {
        const close = text.indexOf(tag[0], at + tag[0].length);
        if (close < 0) return refuse('A dollar-quoted string is not closed', at);
        const problem = region(at, close + tag[0].length);
        if (problem) return problem;
        at = close + tag[0].length;
        continue;
      }
    }
    run = inName(character) ? run + character : '';
    pending += character;
    at += 1;
  }
  flush();
  return pieces;
}

/**
 * The pieces of PostgreSQL SQL: text, and the markers outside every string, escape string (`E'...'`),
 * dollar quote, quoted name and comment - or the first problem, with its line: a marker inside one of
 * those, one of them left open, or a positional parameter (`$1`), which the binder writes itself. It
 * reads as PostgreSQL's scanner does where that decides what is inside a literal: a string continued
 * across a line break, a dollar quote's tag of any length, and a `$` after a number, which is not in a
 * name. Standard strings are read as `standard_conforming_strings` has them on, as every connection
 * the connector opens sets it.
 */
export function lexPostgres(text: string): SqlPiece[] | LexProblem {
  return scan(text, 'markers');
}

/** The positional parameters of bound SQL, in order, outside every literal and comment. */
function placeholdersIn(text: string): number[] | undefined {
  const pieces = scan(text, 'placeholders');
  if (!Array.isArray(pieces)) return undefined;
  return pieces.flatMap((piece) => (piece.kind === 'positional' ? [piece.number] : []));
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
  // A space either side, so it never fuses with what the author wrote beside it: a name before it
  // (`a$1`), a `$` that would open a dollar quote, or a placeholder after it (`text$2`).
  return ` $${number}::${POSTGRES_TYPES[parameter.type.base]}${parameter.list ? '[]' : ''} `;
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

/**
 * A binding refused because its text, read back, does not hold exactly the placeholders written: a
 * fragment ran into the SQL around it. The definition's checks refuse it before it is saved; one
 * reaching a run is answered `definition_unbindable`, never sent.
 */
export class BindingRefused extends Error {}

/** A value as the driver is handed it: its canonical text, a list's as an array, or null. */
export type BoundValue = string | readonly string[] | null;

/** SQL that binds every value as the driver's parameter, and the values in their places. */
export interface BoundStatement {
  readonly text: string;
  readonly values: readonly BoundValue[];
}

const asText = (value: string | boolean) => (typeof value === 'boolean' ? String(value) : value);

/**
 * PostgreSQL's binder (D2-C; DAT-081, DAT-019): each value marker is written ` $n::type `, a space
 * either side, by its parameter's declaration, and its value handed to the driver as the n-th
 * parameter - a list as one array - so no value is ever in the text; a marker used twice binds once. Each variation marker is
 * replaced by the fragment its value keys, found by an own lookup in the declared list, so the key
 * never reaches the source and nothing it names but a declared fragment can. The values have already
 * passed `checkParameterValues`: anything they could not have is thrown, never guessed at; and so is
 * a rewritten text whose placeholders, read again, are not exactly those written.
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
  const written: number[] = [];
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
    written.push(number);
  }
  // Read back as the source will read it: a fragment beside the text around it could make a comment
  // or a literal of a placeholder, which would then bind nothing, or its text a placeholder of its own.
  // Nothing is sent unless the placeholders outside every literal are exactly those written.
  const found = placeholdersIn(text);
  if (found === undefined || found.join(',') !== written.join(',')) {
    throw new BindingRefused(
      'The bound SQL does not hold exactly the placeholders the binder wrote',
    );
  }
  return { text, values: bound };
}
