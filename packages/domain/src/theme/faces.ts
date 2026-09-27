import type { ResolvedTheme } from './read.js';

/**
 * The family a typeface is declared under in the editor (themes.md, "The theme in the editor", ET-C):
 * the theme's own identifier for it, never the family's real name, so a face of that name installed on
 * the reader's machine is never used in the pinned file's place - as Typst is given no system fonts.
 */
export const faceFamily = (typefaceId: string) => `aw-face-${typefaceId}`;

// What a bundler writes for an asset: a path or an address, with nothing that could end a string.
const SAFE_URL = /^[^"'\\()\s]+$/;

/**
 * The `@font-face` rules for a theme's typefaces, one to a file, each from the URL the renderer holds
 * that file at by its hash (STY-039). A typeface is declared only where **every** one of its files is
 * held, as the worker holds a typeface only where it holds exactly its files; the family of any other is
 * named in `unheld`, which the editor shows rather than setting its text in a face nobody chose
 * (STY-070). `font-display: block` keeps a face that is still loading from being painted over by a
 * fallback. Identifiers are class-safe by the schema, and a URL that could end its own declaration is
 * refused rather than written (STY-N03).
 */
export function projectFontFaces(
  theme: ResolvedTheme,
  urlOf: (sha256: string) => string | undefined,
): { readonly css: string; readonly unheld: readonly string[] } {
  const rules: string[] = [];
  const unheld: string[] = [];
  for (const typeface of theme.typefaces.values()) {
    const urls = typeface.files.map((file) => urlOf(file.sha256));
    if (urls.some((url) => url === undefined)) {
      unheld.push(typeface.family);
      continue;
    }
    typeface.files.forEach((file, index) => {
      const url = urls[index]!;
      if (!SAFE_URL.test(url)) throw new Error(`${JSON.stringify(url)} is not a URL a face is at`);
      rules.push(
        `@font-face { font-family: "${faceFamily(typeface.id)}"; src: url("${url}"); ` +
          `font-weight: ${file.weight === 'bold' ? 700 : 400}; ` +
          `font-style: ${file.posture}; font-display: block; }`,
      );
    });
  }
  return { css: rules.length === 0 ? '' : rules.join('\n') + '\n', unheld };
}
