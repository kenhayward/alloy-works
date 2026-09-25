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
 * The second rule reaches every property a mark can state, not only weight and posture.
 */
const theme = resolved();
const body = theme.paragraphStyles.get('body')!;
const heading = theme.paragraphStyles.get('heading-1')!;
const serif = theme.typefaces.get('serif')!;
const mono = theme.typefaces.get('mono')!;

/** A run with nothing on it, in a paragraph style: that style's own rendering. */
const plain = {
  bold: false,
  italic: false,
  underline: false,
  colour: '#000000',
  typeface: serif,
  position: 'baseline',
  size: 11,
} as const;

describe('runFormat', () => {
  it('takes the paragraph style when a run has no marks', () => {
    expect(runFormat(theme, heading, [])).toEqual({ ...plain, bold: true, size: 16 });
    expect(runFormat(theme, body, [])).toEqual(plain);
  });

  it("lets a mark's character style override what it states", () => {
    expect(runFormat(theme, body, ['strong'])).toEqual({ ...plain, bold: true });
    expect(runFormat(theme, body, ['strong', 'emphasis'])).toEqual({
      ...plain,
      bold: true,
      italic: true,
    });
    expect(runFormat(theme, body, ['hyperlink', 'underline'])).toEqual({
      ...plain,
      underline: true,
    });
    expect(runFormat(theme, body, ['superscript'])).toEqual({ ...plain, position: 'superscript' });
  });

  it('sets a scaled mark at its scale of the text it stands in, and in its own face', () => {
    expect(runFormat(theme, body, ['inlineCode'])).toEqual({ ...plain, typeface: mono, size: 8.8 });
    expect(runFormat(theme, heading, ['inlineCode'])).toEqual({
      ...plain,
      bold: true,
      typeface: mono,
      size: 12.8,
    });
  });

  it('keeps bold on for a strong word inside a bold heading - the canonical answer', () => {
    expect(runFormat(theme, heading, ['strong'])).toMatchObject({ bold: true, italic: false });
  });

  it('lets the inner of two marks stating one property win, as the PDF sets it, and multiplies their scales', () => {
    const inputs = defaultInputs();
    inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) =>
      style.mark === 'emphasis'
        ? { ...style, properties: { italic: true, colour: '#1f4e79', scale: 1.5 } }
        : style.mark === 'strong'
          ? { ...style, properties: { bold: true, colour: '#7a1f1f', scale: 0.5 } }
          : style,
    );
    const coloured = resolved(inputs);
    // Published order is outermost first: strong stands inside emphasis.
    expect(
      runFormat(coloured, coloured.paragraphStyles.get('body')!, ['emphasis', 'strong']),
    ).toEqual({ ...plain, bold: true, italic: true, colour: '#7a1f1f', size: 8.25 });
  });

  it("reads each mark from the theme's own character catalogue", () => {
    const inputs = defaultInputs();
    inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) =>
      style.mark === 'strong' ? { ...style, properties: { underline: true } } : style,
    );
    const underlined = resolved(inputs);
    expect(runFormat(underlined, underlined.paragraphStyles.get('body')!, ['strong'])).toEqual({
      ...plain,
      underline: true,
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
    expect(wordRun(theme, body, ['underline'])).toEqual({ characterStyle: 'underline', pins: {} });
    expect(wordRun(theme, body, ['subscript'])).toEqual({ characterStyle: 'subscript', pins: {} });
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
    expect(wordRun(theme, body, ['underline', 'superscript'])).toEqual({
      characterStyle: 'underline',
      pins: { position: 'superscript' },
    });
    expect(wordRun(theme, body, ['strong', 'inlineCode'])).toEqual({
      characterStyle: 'strong',
      pins: { typeface: mono, size: 8.8 },
    });
  });

  it("pins a scaled mark's size, which its character style cannot know, against the paragraph it stands in", () => {
    expect(wordRun(theme, body, ['inlineCode'])).toEqual({
      characterStyle: 'inlineCode',
      pins: { size: 8.8 },
    });
    expect(wordRun(theme, heading, ['inlineCode'])).toEqual({
      characterStyle: 'inlineCode',
      pins: { size: 12.8 },
    });
  });

  it('names no style for a mark whose style states nothing - a language, a link, a quoted phrase in the default theme - and passes over one to the first that does', () => {
    for (const mark of ['language', 'hyperlink', 'quotedPhrase'] as const) {
      expect(wordRun(theme, body, [mark]), mark).toEqual({ pins: {} });
    }
    expect(wordRun(theme, body, ['language', 'hyperlink', 'quotedPhrase', 'strong'])).toEqual({
      characterStyle: 'strong',
      pins: {},
    });
  });

  it('names a link, or any mark, whose style does state an appearance, so a recipient restyles it in Word', () => {
    const inputs = defaultInputs();
    inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) =>
      style.mark === 'hyperlink'
        ? { ...style, properties: { colour: '#1f4e79', underline: true } }
        : style,
    );
    const linked = resolved(inputs);
    expect(wordRun(linked, linked.paragraphStyles.get('body')!, ['hyperlink', 'strong'])).toEqual({
      characterStyle: 'hyperlink',
      pins: { bold: true },
    });
  });

  it("pins every property the named style's reading loses: its colour, its face and its underline, under an inner mark's", () => {
    const inputs = defaultInputs();
    inputs.catalogues.character.styles = inputs.catalogues.character.styles.map((style) =>
      style.mark === 'emphasis'
        ? {
            ...style,
            properties: { italic: true, colour: '#1f4e79', typeface: 'mono', underline: true },
          }
        : style.mark === 'strong'
          ? {
              ...style,
              properties: { bold: true, colour: '#7a1f1f', typeface: 'serif', underline: false },
            }
          : style,
    );
    const coloured = resolved(inputs);
    expect(
      wordRun(coloured, coloured.paragraphStyles.get('body')!, ['emphasis', 'strong']),
    ).toEqual({
      characterStyle: 'emphasis',
      pins: { bold: true, colour: '#7a1f1f', typeface: serif, underline: false },
    });
  });
});
