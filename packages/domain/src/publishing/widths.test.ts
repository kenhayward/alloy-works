import { describe, expect, it } from 'vitest';

import { columnExtents, columnWidths, type ColumnExtent } from './widths.js';

/**
 * **Column widths by content** (tables.md, "Widths"; the TG plan, task 5): each column's least and
 * widest, shared out over the measure as an automatic table layout shares them, as fractions every
 * renderer sets alike.
 */

const sum = (each: readonly number[]) => each.reduce((a, b) => a + b, 0);
const extent = (least: number, widest: number): ColumnExtent => ({ least, widest });

describe('columnWidths', () => {
  it('TAB-053 gives each column its widest where every one fits, sharing what is left in proportion to it', () => {
    const widths = columnWidths([extent(20, 30), extent(40, 90)], 240)!;
    // 120 wanted of 240: each takes twice its widest.
    expect(widths.map((each) => each * 240)).toEqual([60, 180]);
    expect(sum(widths)).toBeCloseTo(1, 12);
  });

  it('TAB-053 gives each its least where not every widest fits, and the rest in proportion to what each still wants', () => {
    const widths = columnWidths([extent(20, 30), extent(40, 240)], 160)!;
    // 60 least, 100 left, wanted 10 and 200: 100 * 10 / 210 and 100 * 200 / 210.
    expect(widths[0]! * 160).toBeCloseTo(20 + 100 * (10 / 210), 9);
    expect(widths[1]! * 160).toBeCloseTo(40 + 100 * (200 / 210), 9);
  });

  it('TAB-053 makes a column of short codes narrower than one of sentences', () => {
    const [codes, sentences] = columnWidths([extent(24, 24), extent(60, 600)], 400)!;
    expect(codes!).toBeLessThan(sentences!);
  });

  it('answers null where the columns at their least are wider than the measure: the table is wide', () => {
    expect(columnWidths([extent(200, 300), extent(210, 400)], 400)).toBeNull();
  });

  it('shares the measure equally between columns that ask for nothing', () => {
    expect(columnWidths([extent(0, 0), extent(0, 0)], 100)).toEqual([0.5, 0.5]);
  });
});

describe('columnExtents', () => {
  // Every character half an em, in a 10pt style; bold a whole em.
  const width = (text: string, size: number, run: { strong: boolean }) =>
    [...text].length * size * (run.strong ? 1 : 0.5);
  const cell = (
    column: number,
    text: string,
    extra: Partial<{ strong: boolean; colspan: number }> = {},
  ) => ({
    column,
    colspan: extra.colspan ?? 1,
    paragraphs: [
      { style: 10, runs: [{ text, strong: extra.strong ?? false, slanted: false }], opaque: false },
    ],
  });

  it('TAB-053 measures each column by its widest word and its widest line, with its padding either side', () => {
    const extents = columnExtents(2, [cell(0, 'AB CDEF'), cell(1, 'XY'), cell(0, 'G')], {
      padding: 2,
      measure: 200,
      width,
    });
    // 'CDEF' 20pt, the line 35pt; 'XY' 10pt both.
    expect(extents).toEqual([
      { least: 24, widest: 39 },
      { least: 14, widest: 14 },
    ]);
  });

  it("TAB-052 makes a no-wrap column's least its widest line, and measures bold runs as bold", () => {
    const extents = columnExtents(1, [cell(0, 'AB CD', { strong: true })], {
      padding: 0,
      measure: 200,
      width,
      noWrap: [true],
    });
    expect(extents).toEqual([{ least: 50, widest: 50 }]);
  });

  it('asks nothing of a column for a cell spanning it and another, and an equal share for one holding an equation', () => {
    const opaque = {
      column: 1,
      colspan: 1,
      paragraphs: [{ style: 10, runs: [], opaque: true }],
    };
    const extents = columnExtents(2, [cell(0, 'WIDE WORDS', { colspan: 2 }), opaque], {
      padding: 0,
      measure: 200,
      width,
    });
    expect(extents).toEqual([
      { least: 0, widest: 0 },
      { least: 100, widest: 100 },
    ]);
  });
});
