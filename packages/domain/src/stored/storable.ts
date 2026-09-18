/**
 * A UTF-16 surrogate without its other half. With a NUL, the characters a JavaScript string can carry
 * and Postgres cannot store in a `jsonb` column: written to one, either fails the insert, which a
 * route would otherwise answer as a failure on our side rather than as the caller's mistake.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Whether Postgres can store this string in JSON: no NUL, and no half of a surrogate pair. */
export const storableText = (text: string): boolean =>
  !text.includes('\u0000') && !LONE_SURROGATE.test(text);

/**
 * Whether every string in a JSON value - every member name as well as every value - is storable.
 * Iterative, with a stack of its own, because it runs over a title before anything has bounded how
 * deep its footnotes nest: a recursive walk would throw on a deep enough value rather than answer.
 */
export function storableEverywhere(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next === 'string') {
      if (!storableText(next)) return false;
    } else if (Array.isArray(next)) {
      pending.push(...(next as unknown[]));
    } else if (typeof next === 'object' && next !== null) {
      for (const [name, member] of Object.entries(next)) {
        if (!storableText(name)) return false;
        pending.push(member);
      }
    }
  }
  return true;
}
