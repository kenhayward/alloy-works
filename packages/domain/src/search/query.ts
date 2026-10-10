/**
 * A query as a reader types it, read before anything is searched (search.md, "The query"; SCH-011,
 * SCH-012, SCH-039). Everything but a scoped term is Postgres's web search syntax, handed on as it was
 * written: words, a phrase in quotes, `-` excluding, `or`. A term written `name:word` or
 * `name:"a phrase"` - the name a word, or in quotes where it has a space - is lifted out, to be looked
 * for only in the place its name names: `title`, or a field by its name, which the store resolves.
 */

/** A term looked for in one place: `title`, or a field, by the name as written. */
export interface ScopedTerm {
  readonly name: string;
  /** The term in web search syntax: a word, or a phrase in quotes. */
  readonly words: string;
  /** Written with a `-`: the entry holds no match for it in that place. */
  readonly excluded: boolean;
}

/**
 * What a query is, before it is run. `empty` and `nothing_to_match` are answered by name and never run:
 * a query of nothing, and one with nothing to look for - only exclusions - which would otherwise answer
 * with everything the reader may see.
 */
export type ParsedQuery =
  | { readonly outcome: 'empty' }
  | { readonly outcome: 'nothing_to_match'; readonly excluded: readonly string[] }
  | {
      readonly outcome: 'query';
      /** Every term but the scoped ones, in web search syntax; empty where every term is scoped. */
      readonly words: string;
      /** Every term looked for, scoped or not, joined by `or`: what ranks a place and marks a passage. */
      readonly anyOf: string;
      readonly scoped: readonly ScopedTerm[];
      /**
       * The terms a part of a word may match, besides the words (UI6): every unscoped term wanted
       * found in the entry's text, in any case, and none excluded. Null beside an `or`, whose
       * meaning for a part of a word is not obvious, and where every term is scoped.
       */
      readonly contains: {
        readonly all: readonly string[];
        readonly none: readonly string[];
      } | null;
    };

interface Unit {
  readonly text: string;
  readonly phrase: boolean;
}

interface Term {
  readonly unit: Unit;
  readonly excluded: boolean;
  readonly scope?: string;
}

/** A name a scope may have unquoted: a letter, then letters, digits, `_` and `-`. */
const NAME = /^(\p{L}[\p{L}\p{N}_-]*):(.*)$/u;
const SPACE = /\s/u;

const written = (unit: Unit): string => (unit.phrase ? `"${unit.text}"` : unit.text);

function terms(query: string): Term[] {
  const out: Term[] = [];
  let at = 0;
  const phrase = (): Unit => {
    // Opened at `at`, closed by the next quote or, left open, by the end.
    const close = query.indexOf('"', at + 1);
    const end = close < 0 ? query.length : close;
    const text = query.slice(at + 1, end).trim();
    at = close < 0 ? query.length : close + 1;
    return { text, phrase: true };
  };
  const word = (): string => {
    const start = at;
    while (at < query.length && !SPACE.test(query[at]!) && query[at] !== '"') at += 1;
    return query.slice(start, at);
  };
  while (at < query.length) {
    if (SPACE.test(query[at]!)) {
      at += 1;
      continue;
    }
    const excluded = query[at] === '-' && at + 1 < query.length && !SPACE.test(query[at + 1]!);
    if (excluded) at += 1;
    if (query[at] === '"') {
      const unit = phrase();
      // A quoted name, where a scope's name has a space in it: `"Due date":2026`.
      if (query[at] === ':' && unit.text !== '') {
        at += 1;
        const value = query[at] === '"' ? phrase() : { text: word(), phrase: false };
        if (value.text !== '') {
          out.push({ unit: value, excluded, scope: unit.text });
          continue;
        }
        out.push({ unit: { text: `${unit.text}:`, phrase: true }, excluded });
        continue;
      }
      if (unit.text !== '') out.push({ unit, excluded });
      continue;
    }
    const read = word();
    const scoped = NAME.exec(read);
    if (scoped) {
      const name = scoped[1]!;
      const rest = scoped[2]!;
      if (rest !== '') {
        out.push({ unit: { text: rest, phrase: false }, excluded, scope: name });
        continue;
      }
      if (query[at] === '"') {
        const value = phrase();
        if (value.text !== '') {
          out.push({ unit: value, excluded, scope: name });
          continue;
        }
      }
    }
    if (read !== '') out.push({ unit: { text: read, phrase: false }, excluded });
  }
  return out;
}

const isOr = (term: Term) =>
  !term.excluded && !term.unit.phrase && term.scope === undefined && /^or$/iu.test(term.unit.text);

/** What a part of a word is matched by, from a query's terms: none beside an `or`. */
function containsOf(all: readonly Term[]): { all: string[]; none: string[] } | null {
  if (all.some(isOr)) return null;
  const unscoped = all.filter((term) => term.scope === undefined);
  const wanted = unscoped.filter((term) => !term.excluded).map((term) => term.unit.text);
  if (wanted.length === 0) return null;
  return {
    all: wanted,
    none: unscoped.filter((term) => term.excluded).map((term) => term.unit.text),
  };
}

/** Reads a query: composed first, then its scoped terms lifted out and its outcome named. */
export function parseQuery(query: string): ParsedQuery {
  const composed = query.normalize('NFC');
  if (composed.trim() === '') return { outcome: 'empty' };
  const all = terms(composed);
  const sought = all.filter((term) => !term.excluded && !isOr(term));
  if (sought.length === 0) {
    return {
      outcome: 'nothing_to_match',
      excluded: all.filter((term) => term.excluded).map((term) => term.unit.text),
    };
  }
  return {
    outcome: 'query',
    words: all
      .filter((term) => term.scope === undefined)
      .map((term) => `${term.excluded ? '-' : ''}${written(term.unit)}`)
      .join(' '),
    anyOf: sought.map((term) => written(term.unit)).join(' or '),
    scoped: all.flatMap((term) =>
      term.scope === undefined
        ? []
        : [{ name: term.scope, words: written(term.unit), excluded: term.excluded }],
    ),
    contains: containsOf(all),
  };
}
