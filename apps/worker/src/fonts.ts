import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResolvedTheme } from '@alloy-works/domain';
import { codePoints } from './cmap.js';

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
  };
}

/**
 * The families of a theme's typefaces the worker does not hold (themes 1, ruling R5): a typeface is
 * held only where every file it records - each by its hash - is one of the pinned files, and a pinned
 * file of that family. The theme names its faces; the worker sets text in no face it was not given, so
 * a typeface it does not hold would set nothing, and `assemble` would refuse every character in it
 * without once naming the face. The job asks this first, and fails the publish `typeface_unavailable`
 * for each family named here. In the theme's order, each once.
 */
export function typefacesNotHeld(theme: ResolvedTheme): string[] {
  const held = (family: string, sha256: string) =>
    PINNED_FONT_FILES.some((pinned) => pinned.family === family && pinned.sha256 === sha256);
  return [
    ...new Set(
      [...theme.typefaces.values()]
        .filter((typeface) => !typeface.files.every((file) => held(typeface.family, file.sha256)))
        .map((typeface) => typeface.family),
    ),
  ];
}
