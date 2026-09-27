import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResolvedTheme } from '@alloy-works/domain';
import { PINNED_FONT_FILES } from '@alloy-works/fonts';
import { codePoints, FONT_DIRECTORY } from '@alloy-works/fonts/node';
import { faceMetrics, type FaceMetrics } from './metrics.js';

/**
 * The pinned faces and where they are, which are `packages/fonts`'s since the editor came to need the
 * same files (themes.md, "The theme in the editor", ET-C): named here still for the worker's callers.
 */
export { FONT_DIRECTORY, PINNED_FONT_FILES };

export interface PinnedFonts {
  readonly directory: string;
  /**
   * Whether every face of one family, by its name, can set this character: a heading's bold as well
   * as a paragraph's regular. Mono is a strict subset of Serif, so the question is always asked of the
   * family the character will be set in, which the theme says (themes 1, ruling R6). A family the
   * worker holds no file of covers nothing.
   */
  covers(codePoint: number, family: string): boolean;
  /**
   * Each pinned file's own metrics, by its hash, read from its tables as the worker's test reads them:
   * what a theme's recorded ascent, descent and advance, and its maths face, are held to
   * (`typefacesNotHeld`).
   */
  readonly metrics: ReadonlyMap<string, FaceMetrics>;
}

/** One pinned face's bytes, checked against its hash. */
export interface PinnedFace {
  readonly file: string;
  readonly bytes: Buffer;
}

/** The fonts are missing, or are not the files pinned. The worker does not start, or the job waits. */
export class FontsUnavailable extends Error {
  readonly code = 'fonts_unavailable';
}

/**
 * Every pinned face, read from this directory and checked against its hash - at start-up, and again
 * before each compile, so a face removed or altered while the worker runs stops the compile rather
 * than going unnoticed (with no fonts at all Typst 0.15.1 compiles, exits 0 and warns about nothing).
 */
export async function readPinnedFaces(directory: string): Promise<PinnedFace[]> {
  const faces: PinnedFace[] = [];
  for (const pinned of PINNED_FONT_FILES) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(directory, pinned.file));
    } catch (error) {
      throw new FontsUnavailable(`The pinned face ${pinned.file} is not in ${directory}.`, {
        cause: error,
      });
    }
    if (createHash('sha256').update(bytes).digest('hex') !== pinned.sha256) {
      throw new FontsUnavailable(`${pinned.file} is not the pinned file.`);
    }
    faces.push({ file: pinned.file, bytes });
  }
  return faces;
}

/**
 * Every pinned face's bytes by its hash, which is how a theme names each of its files: what the Word
 * writer embeds from (Word 1, ruling R10). Read and checked as each compile reads them, so a face
 * removed or altered under a running worker stops the Word document as it stops the PDF.
 */
export async function pinnedFacesByHash(directory: string): Promise<Map<string, Uint8Array>> {
  const faces = await readPinnedFaces(directory);
  return new Map(faces.map((face, index) => [PINNED_FONT_FILES[index]!.sha256, face.bytes]));
}

/**
 * The pinned faces, each checked against its hash, and the characters all of them can set. With no
 * fonts at all Typst 0.15.1 compiles, exits 0 and warns about nothing (issue #145), so an empty or
 * altered directory is refused here, before any compile, rather than noticed in a PDF with no text.
 */
export async function loadPinnedFonts(directory: string = FONT_DIRECTORY): Promise<PinnedFonts> {
  const faces = await readPinnedFaces(directory);
  const everyFace = (family: string) => {
    const [first = new Set<number>(), ...rest] = faces
      .filter((_, index) => PINNED_FONT_FILES[index]!.family === family)
      .map((each) => codePoints(each.bytes));
    return new Set([...first].filter((codePoint) => rest.every((set) => set.has(codePoint))));
  };
  // The maths family is its one face, which the template sets every equation in with the engine's
  // fallback off, so a character it lacks would be set as nothing: `assemble` asks it first.
  const byFamily = new Map<string, ReadonlySet<number>>(
    [...new Set(PINNED_FONT_FILES.map((each) => each.family))].map((family) => [
      family,
      everyFace(family),
    ]),
  );
  return {
    directory,
    covers: (codePoint, family) => byFamily.get(family)?.has(codePoint) ?? false,
    metrics: new Map(
      faces.map((face, index) => [PINNED_FONT_FILES[index]!.sha256, faceMetrics(face.bytes)]),
    ),
  };
}

/**
 * Why the worker does not hold a typeface, from a fixed list, never a value - no hash and no number
 * reaches a failure (the final review of themes 1, M1):
 *
 * - `files`: the files it records are not exactly its family's pinned files - one not pinned, one
 *   pinned under another family, or one of the family's left out, which the engine would be handed
 *   anyway and the publication's record would never name (TH-B binds a face by its files' hashes).
 * - `metrics`: an ascent, a descent or an advance it records is not its files' own. The template puts
 *   a baseline by them and `assemble` counts a line's columns by the advance, so a wrong one set lines
 *   where the theme did not mean and passed a line the page could not hold.
 * - `maths`: it is the theme's maths face and has no OpenType `MATH` table, so the engine could set no
 *   equation in it.
 */
export type TypefaceNotHeld = 'files' | 'metrics' | 'maths';

/**
 * The typefaces of a theme the worker does not hold, and why (themes 1, ruling R5, and the final
 * review's M1): a typeface is held only where it records **exactly** its family's pinned files - every
 * one, each by its hash, and no other - where the ascent, descent and advance it records are each of
 * those files' own, read as `faceMetrics` reads them and compared exactly, since the theme writes them
 * as the fractions of the files' units they are, and, for the theme's maths face, where every file
 * carries a `MATH` table. The theme names its faces; the worker sets text in no face it was not given,
 * so a typeface it does not hold would set nothing, set it somewhere the theme did not mean, or refuse
 * the compile unnamed. The job asks this first, and fails the publish `typeface_unavailable` for each
 * one named here. In the theme's order, each family once, with the first reason it fails for.
 */
export function typefacesNotHeld(
  theme: ResolvedTheme,
  fonts: Pick<PinnedFonts, 'metrics'>,
): { family: string; detail: TypefaceNotHeld }[] {
  const why = (typeface: ResolvedTheme['maths']): TypefaceNotHeld | null => {
    const pinned = PINNED_FONT_FILES.filter((each) => each.family === typeface.family).map(
      (each) => each.sha256,
    );
    const recorded = typeface.files.map((file) => file.sha256);
    const exactly =
      pinned.length > 0 &&
      recorded.length === pinned.length &&
      pinned.every((sha256) => recorded.includes(sha256));
    if (!exactly) return 'files';
    const own = pinned.map((sha256) => fonts.metrics.get(sha256)!);
    const metricsHeld = own.every(
      (metrics) =>
        typeface.ascent === metrics.ascender / metrics.unitsPerEm &&
        typeface.descent === -metrics.descender / metrics.unitsPerEm &&
        (typeface.advance === undefined ||
          (metrics.advances.size === 1 &&
            typeface.advance === [...metrics.advances][0]! / metrics.unitsPerEm)),
    );
    if (!metricsHeld) return 'metrics';
    if (typeface === theme.maths && !own.every((metrics) => metrics.mathematical)) return 'maths';
    return null;
  };
  const notHeld = new Map<string, TypefaceNotHeld>();
  for (const typeface of theme.typefaces.values()) {
    const detail = why(typeface);
    if (detail !== null && !notHeld.has(typeface.family)) notHeld.set(typeface.family, detail);
  }
  return [...notHeld].map(([family, detail]) => ({ family, detail }));
}
