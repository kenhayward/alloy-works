import { describe, expect, it } from 'vitest';

import type { ListNode } from '../content/model/blocks.js';

import { defaultLayout } from './layout.js';
import { columnsAt, expandTabs, listIndent, QUOTATION_INDENT } from './measure.js';
import { publishedPdf } from './assemble.js';

const pdf = publishedPdf(defaultLayout.formats.pdf);

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
  });

  it('sets 83 columns on the default page and 81 inside a quotation, as measured', () => {
    expect(columnsAt(pdf, 0)).toBe(83);
    expect(columnsAt(pdf, QUOTATION_INDENT)).toBe(81);
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
