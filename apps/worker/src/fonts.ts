import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codePoints } from './cmap.js';

/**
 * The faces every PDF is set in, pinned by hash as the Typst binary is (design decision I; issue #145):
 * Liberation Serif 2.1.5, under the SIL Open Font License 1.1 (ADR-0010), whose text ships beside them.
 * Typst is handed these files and nothing else - no system fonts and none of its own - so a page is
 * set in these files or not at all. The worker names them when it starts; the publication record,
 * which is to record the faces each publication used, does not exist yet.
 */
export const PINNED_FONT_FILES = [
  {
    file: 'LiberationSerif-Bold.ttf',
    sha256: 'd754ba427cfe0bca54ae052384baa8f842da5bd6550ad4da024ac441e7a7d5ce',
  },
  {
    file: 'LiberationSerif-BoldItalic.ttf',
    sha256: 'f17db8af71e24d2066b587546021d4f0b296be389512b658dec3c09affeb11a7',
  },
  {
    file: 'LiberationSerif-Italic.ttf',
    sha256: '0e3dea9f8d613e006ccfa62201f33e265d19167bd0907725c3e145368b04fc2e',
  },
  {
    file: 'LiberationSerif-Regular.ttf',
    sha256: '058ea80864aef09a23f45cbec2bb5400bc3dfbdea01c3f10538a21fcb497fb74',
  },
] as const;

export const FONT_DIRECTORY = fileURLToPath(new URL('../fonts/', import.meta.url));

export interface PinnedFonts {
  readonly directory: string;
  /** Whether every face can set this character: a heading's bold as well as a paragraph's regular. */
  covers(codePoint: number): boolean;
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
  const sets = (await readPinnedFaces(directory)).map((face) => codePoints(face.bytes));
  const [first = new Set<number>(), ...rest] = sets;
  const everywhere = new Set(
    [...first].filter((codePoint) => rest.every((set) => set.has(codePoint))),
  );
  return {
    directory,
    covers: (codePoint) => everywhere.has(codePoint),
  };
}
