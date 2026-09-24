import { describe, expect, it } from 'vitest';

import type { ListNode } from '../content/model/blocks.js';
import { defaultInputs, resolved } from '../theme/theme.fixture.js';

import { defaultLayout } from './layout.js';
import { captionHeight, columnsAt, columnsOf, expandTabs, listIndent } from './measure.js';
import { publishedPdf } from './assemble.js';

const pdf = publishedPdf(defaultLayout.formats.pdf);
const theme = resolved();
const preformatted = theme.paragraphStyles.get(theme.roles.preformatted)!;
/** What a quotation insets its body by: its style's start and end indents, 11pt each by default. */
const quoted = theme.paragraphStyles.get(theme.places.quotation)!.properties;
/** A list item's size, the default's body at 11pt, which a list's indent is counted in ems of. */
const itemSize = theme.paragraphStyles.get(theme.places.listItem)!.properties.size;

const list = (over: Partial<ListNode>, items = 1): ListNode => ({
  type: 'list',
  id: 'L1',
  kind: 'ordered',
  items: Array.from({ length: items }, () => ({ content: [] })),
  ...over,
});

describe('the measure a preformatted line is held to', () => {
  it('expands a tab to the next stop of eight columns, counting code points', () => {
    expect(expandTabs('\u{9}a')).toBe(`${' '.repeat(8)}a`);
    expect(expandTabs('abc\u{9}b').indexOf('b', 3)).toBe(8);
    expect(expandTabs('a\u{9}\u{9}b').indexOf('b')).toBe(16);
    expect(expandTabs('\u{1F600}\u{9}x')).toBe(`\u{1F600}${' '.repeat(7)}x`);
    // A letter and the accent over it are one column, as a reader sees them.
    expect(expandTabs('q\u{307}\u{9}b')).toBe(`q\u{307}${' '.repeat(7)}b`);
    expect(columnsOf('q\u{307}b')).toBe(2);
  });

  it('sets 83 columns on the default page and 79 inside a quotation, which is indented on both sides', () => {
    // The default theme's preformatted style is template 11's: 8.8pt of Liberation Mono, whose every
    // glyph advances 1229/2048 of an em, in a panel padded 6pt each side - so the answer is the one
    // `CODE_SIZE` and `CODE_ADVANCE` gave before themes 1.
    expect(columnsAt(pdf, 0, preformatted)).toBe(83);
    expect(columnsAt(pdf, quoted.startIndent + quoted.endIndent, preformatted)).toBe(79);
  });

  it("measures by the preformatted role's size, its face's advance, its indents and its padding (themes 1, ruling R6)", () => {
    const at = (change: (style: Record<string, unknown>) => void) => {
      const inputs = defaultInputs();
      for (const style of inputs.catalogues.paragraph.styles) {
        if (style.id === 'preformatted') change(style.properties as Record<string, unknown>);
      }
      const theme = resolved(inputs);
      return columnsAt(pdf, 0, theme.paragraphStyles.get(theme.roles.preformatted)!);
    };
    // 451.28pt of measure less 12 of padding, over a column of 10 x 1229/2048 points.
    expect(at((style) => (style.size = 10))).toBe(73);
    // Indented 20pt at each end: 40 more gone.
    expect(at((style) => ((style.startIndent = 20), (style.endIndent = 20)))).toBe(75);
    // With no fill there is no panel, so its padding takes nothing.
    expect(at((style) => (style.background = 'none'))).toBe(85);
    expect(at((style) => (style.padding = 12))).toBe(80);
  });

  it('indents a list by its widest marker, at or above what the engine was measured to take', () => {
    expect(listIndent(list({ start: 888, format: 'roman' }), itemSize)).toBe(11 * 13 + 5.5);
    expect(listIndent(list({ kind: 'unordered' }), itemSize)).toBe(16.5);
    expect(listIndent(list({ kind: 'definition' }), itemSize)).toBe(22);
    // Spike 2's measured indents: `xxxviii.` 39.4, `zz.` 18.0, `99999.` 35.8.
    expect(listIndent(list({ start: 38, format: 'roman' }), itemSize)).toBeGreaterThanOrEqual(39.4);
    expect(listIndent(list({ start: 702, format: 'alphabetic' }), itemSize)).toBeGreaterThanOrEqual(
      18,
    );
    expect(listIndent(list({ start: 99999 }), itemSize)).toBeGreaterThanOrEqual(35.8);
    // The widest marker the list prints, not its first: nine items from 1 end at `10.`.
    expect(listIndent(list({}, 10), itemSize)).toBe(11 * 3 + 5.5);
  });

  it("counts a list's indent in ems of its item's size, and a caption's height in its own size (themes 1)", () => {
    // Template 11's ems - two for a definition, the widest marker and half an em after it - at 10pt.
    expect(listIndent(list({ kind: 'definition' }), 10)).toBe(20);
    expect(listIndent(list({ kind: 'unordered' }), 10)).toBe(15);
    expect(listIndent(list({}, 10), 10)).toBe(35);
    // Ten graphemes in a 100pt measure: one line of words and one more, each 1.5 em, and an em above.
    expect(captionHeight(10, 100, 11)).toBe(2 * 16.5 + 11);
    expect(captionHeight(10, 100, 10)).toBe(2 * 15 + 10);
    // Twenty graphemes at 0.6 em of 10pt are 120pt: two lines of words, and one more.
    expect(captionHeight(20, 100, 10)).toBe(3 * 15 + 10);
  });
});
