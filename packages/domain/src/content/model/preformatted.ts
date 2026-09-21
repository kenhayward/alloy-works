/**
 * What a preformatted block may hold beyond the stored shape (CNT-018; editor 5, decision G). Held
 * by the walk in `document.ts`, which is where every producer's content passes, and asked by the
 * editor's panel too, so the rule has one spelling.
 */

/** A language label is a token: `sql`, `c++`, `c#`, `objective-c`, `shell-session`. */
export const LANGUAGE_LABEL = /^[A-Za-z0-9][A-Za-z0-9+#._-]{0,31}$/;

export function isLanguageLabel(value: string): boolean {
  return LANGUAGE_LABEL.test(value);
}

/**
 * Whether preformatted text may not hold this code point: every C0 and C1 control but the tab and
 * the line feed, and the line and paragraph separators. Each refused one is either invisible or a
 * second spelling of a line break (U+000D, U+000B, U+000C, U+0085 and U+2028 each break a line in
 * the engine), and two spellings of one text are two digests of it.
 */
export function forbiddenInPreformatted(codePoint: number): boolean {
  if (codePoint === 0x9 || codePoint === 0xa) return false;
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

/** `U+000D`: how a refusal names a character, never by the character itself. */
export const codePointSpelling = (codePoint: number) =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
