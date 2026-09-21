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
 * Which pinned family a character is set in: the body text's serif, or the monospace that
 * preformatted text and inline code are set in. The two cover different characters, so the question
 * is always asked of one of them - a union would pass a character one of them cannot set.
 */
export type Face = 'body' | 'code';

/** Whether every face of one family can set this character. */
export type Covers = (codePoint: number, face: Face) => boolean;

/** `U+0627`, the spelling a failure's detail uses: never the character itself. */
export const codePointName = (codePoint: number) =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Each character of `text` the engine would refuse, once each, in the order they first appear:
 * disallowed anywhere, or missing from the family the template sets it in (`covers`, asked of `face`).
 */
export function characterProblems(
  text: string,
  covers: Covers,
  face: Face,
): { readonly problem: CharacterProblem; readonly codePoint: number }[] {
  const seen = new Set<number>();
  const found: { problem: CharacterProblem; codePoint: number }[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (seen.has(codePoint)) continue;
    seen.add(codePoint);
    if (disallowed(codePoint)) found.push({ problem: 'character_disallowed', codePoint });
    // **No exemption in the code face.** Inside `raw` the pinned engine drops the character BEFORE
    // an invisible format character - `ab` then U+200B then `cd` prints `acd` - so what the body
    // face sets without a glyph loses a letter in code, silently. Refused there instead, with the
    // code the author meets for any character the monospace face cannot set (final review, finding 1).
    else if (
      face === 'code'
        ? setWithoutAGlyph(codePoint) || !covers(codePoint, face)
        : !setWithoutAGlyph(codePoint) && !covers(codePoint, face)
    ) {
      found.push({ problem: 'glyph_missing', codePoint });
    }
  }
  return found;
}
