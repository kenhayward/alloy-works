import { COVERAGE } from './coverage.js';
import { PINNED_FONT_FILES } from './pinned.js';

/** Characters as ranges, each first to last inclusive, in order and not touching. */
export type Ranges = readonly (readonly [number, number])[];

/**
 * Whether every face of one pinned family, by its name, can set this character: the answer the worker's
 * `covers` gives from the files, from the data generated from them, so the editor asks the glyph check
 * the publish asks without parsing a font (themes.md, "The theme in the editor", ET-D). A family nobody
 * pinned covers nothing.
 */
export function covers(codePoint: number, family: string): boolean {
  const ranges = Object.hasOwn(COVERAGE, family) ? COVERAGE[family]! : [];
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [first, last] = ranges[middle]!;
    if (codePoint < first) high = middle - 1;
    else if (codePoint > last) low = middle + 1;
    else return true;
  }
  return false;
}

/** The family a pinned file is, by the hash a theme names it by; undefined for a file nobody pinned. */
export function familyOfFile(sha256: string): string | undefined {
  return PINNED_FONT_FILES.find((each) => each.sha256 === sha256)?.family;
}

/**
 * A pinned file's cap height, as a fraction of its em, by the hash a theme names it by; undefined for
 * a file nobody pinned.
 */
export function capHeightOfFile(sha256: string): number | undefined {
  return PINNED_FONT_FILES.find((each) => each.sha256 === sha256)?.capHeight;
}
