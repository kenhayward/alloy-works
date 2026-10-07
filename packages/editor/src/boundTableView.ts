import type { Node } from 'prosemirror-model';
import type { Decoration, NodeView } from 'prosemirror-view';

import { FAILED_CLASS, type BoundTableNoteShown, type BoundTableShown } from './bindings.js';
import { BOUND_TABLE } from './schema.js';

/** The rows a bound table has beyond those the page shows, in words, or null for none (TB2-D). */
export const moreRows = (count: number): string | null =>
  count <= 0 ? null : count === 1 ? 'and 1 more row' : `and ${count} more rows`;

/** What a body shows with nothing to tell it more: `toDOM`'s words. */
const NOTHING_SAID: BoundTableShown = {
  columns: [],
  rows: [],
  spanning: { text: BOUND_TABLE, failed: false },
  more: 0,
};

/**
 * **Fills a bound table's body** (the TB2 plan, TB2-D) with a real table: `aria-labelledby` its
 * caption, a header row of `th scope="col"` - each header with its unit - and its rows, the first
 * cell a `th scope="row"` where the table's first column heads its row; or one row spanning it with
 * words in place of rows, drawn apart where they say why it has none (DAT-047). Beneath it, outside
 * the table, how many rows more there are. The surface and a document's read text fill it alike.
 */
export function fillBoundTable(
  holder: HTMLElement,
  shown: BoundTableShown,
  captionId: string | null,
): void {
  const document = holder.ownerDocument;
  holder.classList.toggle(FAILED_CLASS, shown.spanning?.failed === true);
  const table = document.createElement('table');
  table.className = 'aw-bound-table-grid';
  if (captionId !== null) table.setAttribute('aria-labelledby', captionId);
  const dressed = (cell: HTMLElement, at: number) => {
    const column = shown.columns[at];
    if (column?.align) cell.dataset.align = column.align;
    if (column?.wrap === false) cell.classList.add('aw-bound-table-nowrap');
    return cell;
  };
  // A note's mark after the words it stands by, a superscript letter (TB3.3).
  const marked = (cell: HTMLElement, marks: readonly string[] | undefined) => {
    if (marks === undefined || marks.length === 0) return;
    const mark = document.createElement('sup');
    mark.className = 'aw-bound-table-mark';
    mark.textContent = marks.join(',');
    cell.append(mark);
  };
  if (shown.columns.length > 0) {
    const head = document.createElement('thead');
    const row = document.createElement('tr');
    shown.columns.forEach((column, at) => {
      const cell = dressed(document.createElement('th'), at);
      cell.setAttribute('scope', 'col');
      cell.textContent = column.text;
      marked(cell, column.marks);
      row.append(cell);
    });
    head.append(row);
    table.append(head);
  }
  const body = document.createElement('tbody');
  for (const cells of shown.rows) {
    const row = document.createElement('tr');
    cells.forEach((each, at) => {
      const cell = dressed(document.createElement(each.scope === 'row' ? 'th' : 'td'), at);
      if (each.scope === 'row') cell.setAttribute('scope', 'row');
      if (each.negative) cell.classList.add('aw-bound-table-negative');
      cell.textContent = each.text;
      marked(cell, each.marks);
      row.append(cell);
    });
    body.append(row);
  }
  if (shown.spanning !== null) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = Math.max(1, shown.columns.length);
    cell.className = 'aw-bound-table-spanning';
    cell.textContent = shown.spanning.text;
    row.append(cell);
    body.append(row);
  }
  table.append(body);
  const more = moreRows(shown.more);
  if (more === null) {
    holder.replaceChildren(table);
    return;
  }
  const said = document.createElement('p');
  said.className = 'aw-bound-table-more';
  said.textContent = more;
  holder.replaceChildren(table, said);
}

/**
 * **A bound table's note's label** (TB3.3): its letter, and where it fails or is being read, why -
 * drawn before its words, never content, by the surface's widget and the read text alike.
 */
export function noteLabel(document: Document, shown: BoundTableNoteShown): HTMLElement {
  const label = document.createElement('span');
  label.className = 'aw-bound-table-note-label';
  label.setAttribute('contenteditable', 'false');
  label.setAttribute('data-bound-table-note-label', '');
  if (shown.letter !== null) {
    const letter = document.createElement('span');
    letter.className = 'aw-bound-table-note-letter';
    letter.textContent = shown.letter;
    label.append(letter);
  }
  if (shown.said !== null) {
    const said = document.createElement('span');
    said.className = 'aw-bound-table-note-said';
    said.textContent = shown.said;
    label.append(said);
  }
  return label;
}

/**
 * A bound table's body on the surface (TB2-C, TB2-D): the schema's own holder, filled from what its
 * decoration carries - one object, memoised, so it is drawn again only when that object changes, never
 * for a keystroke in its caption. Everything in it is the view's own drawing, never content.
 */
export function boundTableBodyView(
  node: Node,
  document: Document,
  decorations: readonly Decoration[],
): NodeView {
  const dom = document.createElement('div');
  dom.className = 'aw-bound-table-body';
  dom.setAttribute('data-bound-table-body', '');
  dom.setAttribute('contenteditable', 'false');
  let drawn: BoundTableShown | undefined;
  let drawnCaption: string | null = null;
  const draw = (from: readonly Decoration[]) => {
    const carried = from.find((each) => each.spec.boundTable !== undefined);
    const shown = (carried?.spec.boundTable as BoundTableShown | undefined) ?? NOTHING_SAID;
    const caption = (carried?.spec.captionId as string | undefined) ?? null;
    if (shown === drawn && caption === drawnCaption) return;
    drawn = shown;
    drawnCaption = caption;
    fillBoundTable(dom, shown, caption);
  };
  draw(decorations);
  return {
    dom,
    update(next, nextDecorations) {
      if (next.type !== node.type) return false;
      draw(nextDecorations);
      return true;
    },
    ignoreMutation: () => true,
  };
}
