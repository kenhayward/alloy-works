import { assemble, defaultLayout, writeDocx } from '@alloy-works/domain';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';

import { FONT_DIRECTORY, loadPinnedFonts, pinnedFacesByHash } from './fonts.js';
import {
  VALUES,
  valuesBindings,
  valuesOccurrences,
  valuesOutline,
  valuesTheme,
} from './testing/word-values.js';

/**
 * The Word check's fixture holding values (`testing/word-values.ts`), made as the Word check makes it
 * - `assemble` with the worker's own face files, then `writeDocx` - and held here, where CI runs, to
 * hold every value it is for, each where it stands, in the formats the check is for. Word alone can
 * say what Word shows of it; this says the document Word is handed holds what the check reads.
 */

/** Every text run of a part, each run's text alone. */
const runsOf = (xml: string) =>
  [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]!);

describe("the Word check's fixture holding values", () => {
  let parts: Record<string, Uint8Array>;
  let printed: readonly { binding: string; printed: string }[];

  beforeAll(async () => {
    const fonts = await loadPinnedFonts();
    const faces = await pinnedFacesByHash(FONT_DIRECTORY);
    const assembled = assemble({
      formats: ['pdf', 'docx'],
      outline: valuesOutline,
      occurrences: valuesOccurrences,
      refused: [],
      layout: defaultLayout,
      theme: valuesTheme,
      revision: '0.7',
      covers: fonts.covers,
      assets: new Map(),
      bindings: valuesBindings,
    });
    if (!assembled.ok) throw new Error(JSON.stringify(assembled.failures));
    printed = assembled.values.flatMap((each) =>
      'printed' in each ? [{ binding: each.binding, printed: each.printed }] : [],
    );
    const { bytes } = writeDocx({
      document: assembled.document,
      numbering: assembled.numbering,
      word: assembled.word!,
      formats: ['pdf', 'docx'],
      faces,
      images: new Map(),
    });
    parts = unzipSync(bytes);
  });

  it('prints every binding by formatValue in the formats the catalogue gives the document language, each unlike the default', () => {
    expect(printed).toEqual(
      VALUES.map(({ binding, printed: text }) => ({ binding, printed: text })),
    );
    for (const value of VALUES) expect(value.printed, value.binding).not.toBe(value.byDefault);
    expect(new Set(VALUES.map((value) => value.place))).toEqual(
      new Set(['paragraph', 'caption', 'cell', 'note', 'footnote']),
    );
  });

  it('hands Word each value as a run of its own, in the text where it stands and in the footnotes', () => {
    const body = runsOf(strFromU8(parts['word/document.xml']!));
    const notes = runsOf(strFromU8(parts['word/footnotes.xml']!));
    for (const value of VALUES) {
      const runs = value.place === 'footnote' ? notes : body;
      expect(runs, value.binding).toContain(value.printed);
      expect(runs, value.binding).not.toContain(value.byDefault);
    }
  });
});
