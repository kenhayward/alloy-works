/**
 * Characters the pinned Typst sets without a glyph of their own: line and paragraph breaks and a tab,
 * which it lays out as space; the zero-width and joining controls, the soft hyphen and the variation
 * selectors, which it shapes away; and the non-breaking hyphen, which it sets with the face's hyphen.
 * Each was measured against Typst 0.15.1 under PDF/UA-1 with only Liberation Serif available; the
 * regression case that holds the measurement to the engine arrives with the publication template (the
 * plan's task 7).
 */
const SET_WITHOUT_A_GLYPH = new Set([
  0x09, 0x0a, 0x0d, 0x85, 0xad, 0x200b, 0x200c, 0x200d, 0x2011, 0x2028, 0x2029, 0x2060, 0xfe00,
  0xfe01, 0xfe02, 0xfe03, 0xfe04, 0xfe05, 0xfe06, 0xfe07, 0xfe08, 0xfe09, 0xfe0a, 0xfe0b, 0xfe0c,
  0xfe0d, 0xfe0e, 0xfe0f,
]);

/**
 * Characters PDF/UA-1 forbids in text whatever the face holds. The pinned Typst refuses a byte-order
 * mark between some letters and not others, depending on how it shapes the cluster, so it is refused
 * everywhere here rather than wherever the engine happens to notice (finding 3).
 */
const DISALLOWED = new Set([0xfeff, 0xfffe, 0xffff]);

export type CharacterProblem = 'glyph_missing' | 'character_disallowed';

/** `U+0627`, the spelling a failure's detail uses: never the character itself. */
export const codePointName = (codePoint: number) =>
  `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * Each character of `text` the engine would refuse, once each, in the order they first appear:
 * disallowed anywhere, or missing from every face the template sets it in (`covers`).
 */
export function characterProblems(
  text: string,
  covers: (codePoint: number) => boolean,
): { readonly problem: CharacterProblem; readonly codePoint: number }[] {
  const seen = new Set<number>();
  const found: { problem: CharacterProblem; codePoint: number }[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (seen.has(codePoint)) continue;
    seen.add(codePoint);
    if (DISALLOWED.has(codePoint)) found.push({ problem: 'character_disallowed', codePoint });
    else if (!SET_WITHOUT_A_GLYPH.has(codePoint) && !covers(codePoint)) {
      found.push({ problem: 'glyph_missing', codePoint });
    }
  }
  return found;
}
