import { describe, expect, it } from 'vitest';

import { runFormat, wordRun } from './runs.js';
import { defaultInputs, resolved } from './theme.fixture.js';

/**
 * How a run of text renders, and what Word needs to be told to render it the same way.
 *
 * Two Word rules make this necessary, and both are invisible until a document is opened. Bold and
 * italic are toggles between style types: set in a paragraph style and again in a character style,
 * they cancel, so a `strong` word in a bold heading comes out NOT bold (ECMA-376 17.7.3). And a run
 * can name only one character style, so a word that is both strong and emphasised cannot be said
 * with styles alone. Direct run formatting is absolute in Word, so where Word's own reading of the
 * styles would differ from the canonical rendering, the run pins the canonical value directly -
 * and only there, so a recipient restyling `Strong` still restyles every run that is not pinned.
 */
const theme = resolved();
const body = theme.paragraphStyles.get('body')!;
const heading = theme.paragraphStyles.get('heading-1')!;

describe('runFormat', () => {
  it('takes the paragraph style when a run has no marks', () => {
    expect(runFormat(theme, heading, [])).toEqual({ bold: true, italic: false });
  });

  it("lets a mark's character style override what it states", () => {
    expect(runFormat(theme, body, ['strong'])).toEqual({ bold: true, italic: false });
    expect(runFormat(theme, body, ['strong', 'emphasis'])).toEqual({ bold: true, italic: true });
    expect(runFormat(theme, body, ['underline', 'hyperlink'])).toEqual({
      bold: false,
      italic: false,
    });
  });

  it('keeps bold on for a strong word inside a bold heading - the canonical answer', () => {
    expect(runFormat(theme, heading, ['strong'])).toEqual({ bold: true, italic: false });
  });

  it("reads each mark from the theme's own character catalogue", () => {
    const inputs = defaultInputs();
    inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) =>
      style.mark === 'strong' ? { ...style, properties: { underline: true } } : style,
    );
    const plain = resolved(inputs);
    expect(runFormat(plain, plain.paragraphStyles.get('body')!, ['strong'])).toEqual({
      bold: false,
      italic: false,
    });
  });
});

describe('wordRun', () => {
  it('needs nothing for plain text', () => {
    expect(wordRun(theme, body, [])).toEqual({ pins: {} });
  });

  it('names the character style and pins nothing where Word would agree', () => {
    expect(wordRun(theme, body, ['strong'])).toEqual({ characterStyle: 'strong', pins: {} });
    expect(wordRun(theme, heading, ['emphasis'])).toEqual({ characterStyle: 'emphasis', pins: {} });
  });

  it('pins bold where the toggle would turn it off: strong inside a bold heading', () => {
    expect(wordRun(theme, heading, ['strong'])).toEqual({
      characterStyle: 'strong',
      pins: { bold: true },
    });
  });

  it('pins the second mark, because a run can name only one character style', () => {
    expect(wordRun(theme, body, ['strong', 'emphasis'])).toEqual({
      characterStyle: 'strong',
      pins: { italic: true },
    });
  });
});
