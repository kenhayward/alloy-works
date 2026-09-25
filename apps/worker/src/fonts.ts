import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResolvedTheme } from '@alloy-works/domain';
import { codePoints } from './cmap.js';
import { faceMetrics, type FaceMetrics } from './metrics.js';

/**
 * The faces every PDF is set in, pinned by hash as the Typst binary is (design decision I; issue #145):
 * Liberation Serif 2.1.5 for the body, Liberation Mono 2.1.5 for preformatted text and inline code,
 * and STIX Two Math 2.13 b171 for equations (equations 2, EQ-A: the file at the tag `v2.13b171` of
 * stipub/stixfonts, whose hash the equations spike measured), each under the SIL Open Font License
 * 1.1 (ADR-0010), whose text ships beside them - `LICENSE-Liberation.txt` and `LICENSE-STIX.txt`.
 * Typst is handed these files and nothing else - no system fonts and none of its own - so a page is
 * set in these files or not at all. The worker names them when it starts, and every publication's
 * record names them, each with its hash. Each file names its family as the file itself declares it,
 * and as a theme names it (themes 1, ruling R6): what `covers` is asked by.
 */
export const PINNED_FONT_FILES = [
  {
    file: 'LiberationSerif-Bold.ttf',
    family: 'Liberation Serif',
    sha256: 'd754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce',
  },
  {
    file: 'LiberationSerif-BoldItalic.ttf',
    family: 'Liberation Serif',
    sha256: 'f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7',
  },
  {
    file: 'LiberationSerif-Italic.ttf',
    family: 'Liberation Serif',
    sha256: '0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e',
  },
  {
    file: 'LiberationSerif-Regular.ttf',
    family: 'Liberation Serif',
    sha256: '058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74',
  },
  {
    file: 'LiberationMono-Bold.ttf',
    family: 'Liberation Mono',
    sha256: 'bd62a0672d0b9b6710b01df434c80ad54fa5f0835207eb7b17b7a761463067bb',
  },
  {
    file: 'LiberationMono-BoldItalic.ttf',
    family: 'Liberation Mono',
    sha256: '79451f3c09fe25116098853b7a2ca6e2436220ccc11af022979adbcf195be130',
  },
  {
    file: 'LiberationMono-Italic.ttf',
    family: 'Liberation Mono',
    sha256: '605c01c711b44480a7508d349dfbf3264e81fa43d69e61cfa7d10b86e764c4d1',
  },
  {
    file: 'LiberationMono-Regular.ttf',
    family: 'Liberation Mono',
    sha256: 'f2b83c763e8afd21709333370bed4774337fae82267937e2b5aea7e2fbd922c1',
  },
  {
    file: 'STIXTwoMath-Regular.otf',
    family: 'STIX Two Math',
    sha256: '3a5f3f26f40d5698b3c62dd085d48d6663696a3f80825aab8b553d5097518e8c',
  },
] as const satisfies readonly { file: string; family: string; sha256: string }[];

export const FONT_DIRECTORY = fileURLToPath(new URL('../fonts/', import.meta.url));

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
