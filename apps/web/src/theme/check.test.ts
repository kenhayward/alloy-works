import { readTheme, type Theme } from '@alloy-works/domain';
import type { TextWhere } from '@alloy-works/editor';
import { describe, expect, it } from 'vitest';

import { notInLabel } from '../editor/SymbolPalette.js';
import { styleCheckFor, typefaceAt } from './check.js';
import { DEFAULT_PRESENTATION } from './presentation.fixture.js';

/** The default theme, whose serif falls back to the Naskh since its 0.11 (UF-H). */
const theme = (() => {
  const read = readTheme(
    DEFAULT_PRESENTATION.theme.content as Theme,
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
