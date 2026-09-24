import { describe, expect, it } from 'vitest';

import type { ListNode } from '../content/model/blocks.js';
import { defaultInputs, resolved } from '../theme/theme.fixture.js';

import { defaultLayout } from './layout.js';
import { columnsAt, columnsOf, expandTabs, listIndent, QUOTATION_INDENT } from './measure.js';
import { publishedPdf } from './assemble.js';

const pdf = publishedPdf(defaultLayout.formats.pdf);
const theme = resolved();
const preformatted = theme.paragraphStyles.get(theme.roles.preformatted)!;

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
    expect(columnsAt(pdf, 2 * QUOTATION_INDENT, preformatted)).toBe(79);
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
    expect(listIndent(list({ start: 888, format: 'roman' }))).toBe(11 * 13 + 5.5);
    expect(listIndent(list({ kind: 'unordered' }))).toBe(16.5);
    expect(listIndent(list({ kind: 'definition' }))).toBe(22);
    // Spike 2's measured indents: `xxxviii.` 39.4, `zz.` 18.0, `99999.` 35.8.
    expect(listIndent(list({ start: 38, format: 'roman' }))).toBeGreaterThanOrEqual(39.4);
    expect(listIndent(list({ start: 702, format: 'alphabetic' }))).toBeGreaterThanOrEqual(18);
    expect(listIndent(list({ start: 99999 }))).toBeGreaterThanOrEqual(35.8);
    // The widest marker the list prints, not its first: nine items from 1 end at `10.`.
    expect(listIndent(list({}, 10))).toBe(11 * 3 + 5.5);
  });
});
