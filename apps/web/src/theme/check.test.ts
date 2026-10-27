import { readTheme, type Theme, type Typeface as ThemeTypeface } from '@alloy-works/domain';
import type { TextWhere } from '@alloy-works/editor';
import { describe, expect, it } from 'vitest';

import { notInLabel } from '../editor/SymbolPalette.js';
import { styleCheckFor, typefaceAt } from './check.js';
import { DEFAULT_PRESENTATION } from './presentation.fixture.js';

/** Noto Naskh Arabic as a theme declares it, by its pinned files (the UI plan, UF-A). */
const NASKH: ThemeTypeface = {
  id: 'naskh',
  family: 'Noto Naskh Arabic',
  files: [
    {
      sha256: 'c34fdbd98af4dbc45ca192a23d2eeb77032add83086f5fe32957d23b3f36b221',
      weight: 'regular',
      posture: 'normal',
    },
    {
      sha256: '380ac34b249d336e1a43c21053df440594e1e3db8f75fabd4d85b649ca1ea4c6',
      weight: 'bold',
      posture: 'normal',
    },
  ],
  licence: 'OFL-1.1',
  embedding: { pdf: true, word: true },
  ascent: 1.069,
  descent: 0.634,
};

/** The default theme with the serif falling back to the Naskh. */
const theme = (() => {
  const content = DEFAULT_PRESENTATION.theme.content as Theme;
  const read = readTheme(
    {
      ...content,
      typefaces: [
        ...content.typefaces.map((face) =>
          face.id === 'serif' ? { ...face, fallback: ['naskh'] } : face,
        ),
        NASKH,
      ],
    },
    new Map(DEFAULT_PRESENTATION.theme.catalogues.map((each) => [each.versionId, each.content])),
  );
  if (!read.ok) throw new Error('the theme does not read');
  return read.theme;
})();

const running: TextWhere = {
  paragraph: { style: 'body', place: 'text' },
  role: null,
  code: false,
  inlineCode: false,
};
const ARABIC = '\u{0633}\u{0644}\u{0627}\u{0645}';

describe("the editor's glyph check, asked of a face's chain (the UI plan, UF-F)", () => {
  it('asks running text of the chain, so Arabic in the fallback is not marked and a character no face holds is', () => {
    const at = typefaceAt(theme, [], running)!;
    expect(at.families).toEqual(['Liberation Serif', 'Noto Naskh Arabic']);
    expect(at.lacks('\u{0627}')).toBe(false);
    expect(at.lacks('\u{2200}')).toBe(true);
    const check = styleCheckFor(theme, []);
    expect([...check.uncovered(`Ada ${ARABIC} \u{2200}`, running)]).toEqual([0x2200]);
  });

  it('asks code of its first face alone, and names that face alone', () => {
    const code = { ...running, code: true, inlineCode: true };
    expect(typefaceAt(theme, [], code)!.families).toEqual(['Liberation Mono']);
    expect([...styleCheckFor(theme, []).uncovered(ARABIC, code)]).toEqual([
      0x633, 0x644, 0x627, 0x645,
    ]);
  });

  it('names the chain as a list where it has more than one face', () => {
    expect(notInLabel('For all', ['Liberation Serif'])).toBe(
      'For all, not in Liberation Serif; use an equation',
    );
    expect(notInLabel('For all', ['Liberation Serif', 'Noto Naskh Arabic'])).toBe(
      'For all, not in Liberation Serif or Noto Naskh Arabic; use an equation',
    );
  });
});
