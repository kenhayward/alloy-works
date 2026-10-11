/**
 * **Column widths by content** (tables.md, "Widths"; TG-F, TAB-053): what a table style's `content`
 * widths make of each column's least and widest, computed once here and set alike by the editor, the
 * PDF and Word, so no renderer's own automatic layout - CSS, Typst and Word each have one, and they
 * disagree - decides a width.
 *
 * A column's **least** is its widest word, or a no-wrap cell's whole line; its **widest** its widest
 * unbroken line; each with its cells' padding. Measured by whoever holds the faces: `assemble` by their
 * advances, the editor by the browser's, both unkerned.
 */
export interface ColumnExtent {
  readonly least: number;
  readonly widest: number;
}

/**
 * Each column's share of `measure`, as fractions that sum to one, as an automatic table layout shares
 * it: where every widest fits, each its widest and what is left in proportion to it; where not, each
 * its least and what is left in proportion to what it still wants. Null where the leasts alone overflow
 * the measure: the table is too wide, and its table style's `wide` decides (TB3-H).
 */
export function columnWidths(
  columns: readonly ColumnExtent[],
  measure: number,
): readonly number[] | null {
  if (columns.length === 0) return [];
  const least = columns.reduce((total, each) => total + each.least, 0);
  const widest = columns.reduce((total, each) => total + Math.max(each.least, each.widest), 0);
  if (least > measure) return null;
  if (widest === 0) return columns.map(() => 1 / columns.length);
  const widths =
    widest <= measure
      ? columns.map((each) => Math.max(each.least, each.widest) * (measure / widest))
      : columns.map(
          (each) =>
            each.least +
            (Math.max(each.least, each.widest) - each.least) *
              ((measure - least) / (widest - least)),
        );
  return widths.map((each) => each / measure);
}

/** A run of a cell's text: its words, and whether it is bold and slanted. */
export interface MeasuredRun {
  readonly text: string;
  readonly strong: boolean;
  readonly slanted: boolean;
}

/** What one cell sets: its paragraphs' runs, by style. */
export interface MeasuredParagraph<S, R extends MeasuredRun = MeasuredRun> {
  readonly style: S;
  readonly runs: readonly R[];
  /** Whether it holds what no face measures - an equation, an image (TG-G). */
  readonly opaque: boolean;
}

/** A cell to measure: the column it starts in, the columns it spans and its paragraphs. */
export interface MeasuredCell<S, R extends MeasuredRun = MeasuredRun> {
  readonly column: number;
  readonly colspan: number;
  readonly paragraphs: readonly MeasuredParagraph<S, R>[];
}

/**
 * **Each column's least and widest** (TG3): over the cells starting in it and spanning it alone - a
 * cell spanning columns asks nothing of any one (TB3-H's rule) - its widest word, its widest line,
 * each with the padding either side; a no-wrap column's least its widest line. `width` measures a run of
 * text in its style, bold and slanted as marked, unkerned. A column holding what no face measures
 * takes an equal share of the measure as both (TG-G).
 */
export function columnExtents<S, R extends MeasuredRun = MeasuredRun>(
  columns: number,
  cells: readonly MeasuredCell<S, R>[],
  options: {
    readonly padding: number;
    readonly measure: number;
    readonly noWrap?: readonly boolean[];
    /** A part of a run, measured in its paragraph's style as the run is set. */
    readonly width: (text: string, style: S, run: R) => number;
  },
): ColumnExtent[] {
  const least = Array.from({ length: columns }, () => 0);
  const widest = Array.from({ length: columns }, () => 0);
  const opaque = Array.from({ length: columns }, () => false);
  for (const cell of cells) {
    if (cell.colspan !== 1) continue;
    for (const paragraph of cell.paragraphs) {
      if (paragraph.opaque) opaque[cell.column] = true;
      let line = 0;
      let word = 0;
      for (const run of paragraph.runs) {
        const parts = run.text.split(/([ \t\n]+)/u);
        for (const part of parts) {
          if (part === '') continue;
          const wide = options.width(part, paragraph.style, run);
          line += wide;
          if (/^[ \t\n]+$/u.test(part)) {
            least[cell.column] = Math.max(least[cell.column]!, word);
            word = 0;
          } else {
            word += wide;
          }
        }
      }
      least[cell.column] = Math.max(least[cell.column]!, word);
      widest[cell.column] = Math.max(widest[cell.column]!, line);
    }
  }
  const share = options.measure / columns;
  return least.map((each, column) => {
    if (opaque[column]) return { least: share, widest: share };
    const whole = options.noWrap?.[column] === true;
    const padded = (value: number) => value + 2 * options.padding;
    return {
      least: padded(whole ? widest[column]! : each),
      widest: padded(widest[column]!),
    };
  });
}
