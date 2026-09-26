/**
 * **Panels kept apart** (Word 2, ruling R5; the final review of Word 1, M4). A theme's background is a
 * panel: the fill, borders of its colour spaced by the padding, and indents that keep it in the column
 * (`projectStylesXml`). Word draws one panel around consecutive paragraphs whose borders and indents
 * are the same, which is what makes a preformatted block's lines, one paragraph each, one panel as the
 * PDF's is - and what joins two blocks one after another into one, where the PDF sets two, and a panel
 * into a paragraph of another style that happens to have the same.
 *
 * Measured in Word 16 on two consecutive preformatted blocks of the default theme, the second's lines
 * given in turn: borders of a colour one step from the fill's, borders spaced a point less, borders
 * half as wide, indents a twentieth of a point more on each side, and an empty paragraph of no
 * borders between. Each made two panels. The colour and the indents made them exactly as the first
 * block's, 34.68pt tall and 5.52pt apart, and the second block's first line 28.56pt below the first's
 * last where the PDF has 27.70 (joined, 15.60); the spacing and the width moved the second's edges,
 * and the empty paragraph put a point more between them and a paragraph a reader meets. So the
 * writer stands such a panel **a twip further in on each side** than the one before: invisible, and
 * the one Word reads as another panel. A third after it stands where the first does, and so on.
 */

/** A paragraph as this reads it. */
export interface PanelParagraph {
  /** What its panel looks like - its fill and padding - or null where it has none. */
  readonly look: string | null;
  /** Its indents, in twips, as Word reads them: its own, or its style's. */
  readonly left: number;
  readonly right: number;
  /** The panel it belongs to: one preformatted block's lines are one; every other paragraph its own. */
  readonly panel: unknown;
}

/** Which paragraphs, in order, to stand a twip further in, so that each panel is its own in Word. */
export function panelsApart(paragraphs: readonly PanelParagraph[]): boolean[] {
  let previous: {
    look: string;
    left: number;
    right: number;
    panel: unknown;
    moved: boolean;
  } | null = null;
  return paragraphs.map((paragraph) => {
    const { look, left, right, panel } = paragraph;
    if (look === null) {
      previous = null;
      return false;
    }
    let moved = false;
    if (previous !== null && previous.panel === panel) {
      moved = previous.moved;
    } else if (
      previous !== null &&
      previous.look === look &&
      previous.left === left &&
      previous.right === right
    ) {
      moved = !previous.moved;
    }
    previous = { look, left, right, panel, moved };
    return moved;
  });
}
