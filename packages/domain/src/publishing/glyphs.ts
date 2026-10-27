/**
 * Characters the pinned Typst sets without a glyph of their own, as inclusive ranges: the tab, line,
 * vertical tab, form feed, carriage return, U+0085 and the line and paragraph separators, which it lays
 * out as space, as it does the medium mathematical and ideographic spaces; the soft hyphen, the Arabic
 * letter mark, the zero-width, joining, invisible-operator and bidi isolate controls, the Hangul
 * fillers, the Khmer inherent vowels, the Mongolian and other variation selectors, the shorthand and
 * musical format controls and the tag characters, which it shapes away; U+FFF0 to U+FFF8, which are
 * unassigned; and the non-breaking hyphen, which it sets with the face's hyphen. Each was measured
 * against Typst 0.15.1 under PDF/UA-1 with only Liberation Serif available; the regression case that
 * holds the measurement to the engine arrives with the publication template (the plan's task 7).
 */
const SET_WITHOUT_A_GLYPH: readonly (readonly [number, number])[] = [
  [0x09, 0x0d],
  [0x85, 0x85],
  [0xad, 0xad],
  [0x61c, 0x61c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200d],
  [0x2011, 0x2011],
  [0x2028, 0x2029],
  [0x205f, 0x2069],
  [0x3000, 0x3000],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfff8],
  [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe0fff],
];

/** Whether the engine sets this character without drawing a glyph of its own. */
export const setWithoutAGlyph = (codePoint: number) =>
  SET_WITHOUT_A_GLYPH.some(([first, last]) => codePoint >= first && codePoint <= last);

/**
 * Characters PDF/UA-1 forbids in text whatever the face holds. The pinned Typst refuses a byte-order
 * mark between some letters and not others, depending on how it shapes the cluster, so it is refused
 * everywhere here rather than wherever the engine happens to notice (measured while planning:
 * docs/plans/2026-09-19-publishing-01-a-document-to-pdf.md, "Where publishing.md and the built code
 * are wrong", its third point).
 */
const DISALLOWED = new Set([0xfeff, 0xfffe, 0xffff]);

/** Whether PDF/UA-1, and so the engine, refuses this character whatever the face holds. */
export const disallowed = (codePoint: number) => DISALLOWED.has(codePoint);

export type CharacterProblem = 'glyph_missing' | 'character_disallowed';

/**
 * Of the characters the engine sets without a glyph, the ones an equation's text keeps: a space, which
 * it lays out as space and copies as one, and the non-breaking hyphen, which it sets with the face's
 * hyphen. Every other takes the letter before it out of the PDF's text, as it does in code (measured
 * in an equation's tokens against the pinned engine in the final review of equations 2, M2).
 */
const keptInMaths = (codePoint: number) =>
  codePoint === 0x2011 || /^\p{White_Space}$/u.test(String.fromCodePoint(codePoint));

/**
 * How the engine sets a piece of text, which decides what it does with a character that has no glyph
 * of its own: as body text, as code - preformatted text and an inline code run, set in `raw` - or in
 * an equation (equations 2, ruling R1: the engine's fallback is off for maths, so a character the maths
 * face lacks is never borrowed from another). Which family sets it is a separate question, the theme's
 * since themes 1: body text may be set in a monospace family, and code in a serif one.
 */
export type Setting = 'body' | 'code' | 'math';

/**
 * Whether every face of one family - by the family name the theme and the font files both declare -
 * can set this character (themes 1, ruling R6). The question is always asked of the family that sets
 * the text, never of a union: each family covers different characters, and a union would pass a
 * character the one that sets it cannot. A family nobody holds covers nothing.
 */
export type Covers = (codePoint: number, family: string) => boolean;

/** `U+0627`, the spelling a failure's detail uses: never the character itself. */
export const codePointName = (codePoint: number) =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * The faces a style sets text in, by family, in the order the theme's `fallback` gives them (the UI
 * plan, UF-B): the first that covers a character sets it. One family where a face has no fallback.
 */
export type Chain = readonly string[];

/** A character of the Common or Inherited script: a space, punctuation, a digit, a joiner, a mark. */
const SHARED = /^[\p{Script=Common}\p{Script=Inherited}]$/u;

/**
 * Which family of `chain` sets each character of `text`, one entry for each code point (UF-D): the
 * first that covers it, but a Common or Inherited character stays in the face of the character before
 * it where that face covers it, so a space or a harakah inside Arabic is the Naskh's. Null where no
 * face covers it; a character the engine sets without a glyph takes the face before it, or the first.
 *
 * Measured against the pinned engine (`fallback.test.ts`): it keeps a joiner and a harakah in the face
 * of the letter they join, as here, but sets a space or a full stop the first face covers in the
 * first face even between two Arabic words. Whose face a shared character is set in moves no glyph
 * check, since one is refused only where no face covers it.
 */
export function settingFaces(text: string, covers: Covers, chain: Chain): (string | null)[] {
  const faces: (string | null)[] = [];
  let before: string | null = null;
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    const face: string | null =
      before !== null && SHARED.test(character) && covers(codePoint, before)
        ? before
        : (chain.find((family) => covers(codePoint, family)) ??
          (setWithoutAGlyph(codePoint) ? (before ?? chain[0] ?? null) : null));
    faces.push(face);
    if (face !== null) before = face;
  }
  return faces;
}

/**
 * Each character of `text` the engine would refuse, once each, in the order they first appear:
 * disallowed anywhere, or missing from every family of the chain that sets it (`covers`), as the engine
 * treats a character with no glyph in that `setting`. Code and an equation ask the chain's first family
 * alone (UF-C): the template sets code in it, and an equation in the maths face, with no fallback.
 */
export function characterProblems(
  text: string,
  covers: Covers,
  chain: Chain,
  setting: Setting,
): { readonly problem: CharacterProblem; readonly codePoint: number }[] {
  const family = chain[0] ?? '';
  const covered = (codePoint: number) =>
    setting === 'body' ? chain.some((each) => covers(codePoint, each)) : covers(codePoint, family);
  const seen = new Set<number>();
  const found: { problem: CharacterProblem; codePoint: number }[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (seen.has(codePoint)) continue;
    seen.add(codePoint);
    if (disallowed(codePoint)) found.push({ problem: 'character_disallowed', codePoint });
    // **No exemption in code.** Inside `raw` the pinned engine drops the character BEFORE an
    // invisible format character - `ab` then U+200B then `cd` prints `acd` - so what body text sets
    // without a glyph loses a letter in code, silently. Refused there instead, with the code the
    // author meets for any character the family setting the code cannot set (final review, finding 1).
    // **Nor in an equation, but for a space.** The engine does the same in an equation's tokens: a
    // joiner, a variation selector or an isolate takes the letter before it out of the PDF's text.
    // A space it lays out as one, and copies as one, so those are set. The marks that only say where a
    // line may break never arrive here: the converter drops them (`BREAK_HINTS`, `maths.ts`; measured
    // against the pinned engine in the final review of equations 2, M2).
    else if (
      setting === 'code'
        ? setWithoutAGlyph(codePoint) || !covered(codePoint)
        : setting === 'math'
          ? setWithoutAGlyph(codePoint)
            ? !keptInMaths(codePoint)
            : !covered(codePoint)
          : !setWithoutAGlyph(codePoint) && !covered(codePoint)
    ) {
      found.push({ problem: 'glyph_missing', codePoint });
    }
  }
  return found;
}
