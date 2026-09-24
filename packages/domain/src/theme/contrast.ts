/**
 * Contrast, as WCAG 2 measures it (TH-G, STY-069): each colour's relative luminance from its sRGB
 * channels, and the ratio of the lighter's to the darker's, each offset by 0.05, from 1:1 to 21:1.
 * The reader refuses a theme whose text falls below the ratio its size asks, when the theme is saved,
 * because the same colours reach a PDF and a Word document where nothing can adjust them.
 *
 * The ratio is compared unrounded, as WCAG says: 4.49:1 is below 4.5:1 however it is printed.
 */

/** The ratio text needs; large text needs less (WCAG 2, 1.4.3). */
export const TEXT_CONTRAST = 4.5;
export const LARGE_TEXT_CONTRAST = 3;

/** One sRGB channel, 0 to 255, made linear. 0.04045 is the sRGB standard's own threshold. */
function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of `#rrggbb`: 0 for black, 1 for white. */
export function relativeLuminance(colour: string): number {
  const channel = (at: number) => linear(Number.parseInt(colour.slice(at, at + 2), 16));
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The contrast between two colours, whichever way round they are given. */
export function contrastRatio(one: string, other: string): number {
  const a = relativeLuminance(one);
  const b = relativeLuminance(other);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** What text of this size and weight needs: 3:1 at 18pt, or at 14pt bold, else 4.5:1. */
export function requiredContrast(size: number, bold: boolean): number {
  return size >= 18 || (bold && size >= 14) ? LARGE_TEXT_CONTRAST : TEXT_CONTRAST;
}
