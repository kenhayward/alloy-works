import type { EditorState, Command } from 'prosemirror-state';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { boundTableAt } from './tables.js';

/** The class the bound table the cursor stands in carries: outlined (ADR-0051, decision 6). */
export const CURRENT_TABLE_CLASS = 'aw-bound-table-current';

/** The class each cell of the column the Bound table panel has the focus on carries. */
export const FOCUSED_COLUMN_CLASS = 'aw-bound-table-focused';

/** The column, from 0, whose row in the Bound table panel holds the focus; null for none. */
const focusKey = new PluginKey<number | null>('boundTableFocus');

/**
 * Holds which of the current bound table's columns the panel has the focus on, set by
 * `focusBoundTableColumn`, never in the history and never a change to the document.
 */
export function boundTableFocusPlugin(): Plugin<number | null> {
  return new Plugin<number | null>({
    key: focusKey,
    state: {
      init: () => null,
      apply: (tr, held) => {
        const said = tr.getMeta(focusKey) as number | null | undefined;
        return said === undefined ? held : said;
      },
    },
  });
}

/** Tells the surface which column's row has the focus, or null as it leaves the rows. */
export function focusBoundTableColumn(column: number | null): Command {
  return (state, dispatch) => {
    if (focusKey.getState(state) === undefined) return false;
    if (focusKey.getState(state) === column) return true;
    dispatch?.(state.tr.setMeta(focusKey, column).setMeta('addToHistory', false));
    return true;
  };
}

/** The column of the current bound table held in the Table tab, or null (ADR-0052). */
export function boundTableFocusedColumn(state: EditorState): number | null {
  return focusKey.getState(state) ?? null;
}

/**
 * Holds a column of the bound table at `tablePos`, as a click on one of its cells does (ADR-0052):
 * the cursor goes into the table, at its caption, where it is not in it already, and the column is
 * the one in hand. Never a change to undo.
 */
export function holdBoundTableColumn(tablePos: number, column: number): Command {
  return (state, dispatch) => {
    if (focusKey.getState(state) === undefined) return false;
    const node = state.doc.nodeAt(tablePos);
    if (node === null || node.type.name !== 'boundTable') return false;
    const inside = boundTableAt(state)?.pos === tablePos;
    const tr = state.tr.setMeta(focusKey, column).setMeta('addToHistory', false);
    if (!inside) tr.setSelection(TextSelection.near(state.doc.resolve(tablePos + 1)));
    dispatch?.(tr);
    return true;
  };
}

/**
 * The bound table the cursor stands in, outlined, and its body told the column focused in the panel,
 * which it marks on that column's cells: what the panel is about, shown in the text (ADR-0051).
 */
export function boundTableFocusDecorations(state: EditorState): DecorationSet {
  const table = boundTableAt(state);
  if (table === null) return DecorationSet.empty;
  const node = state.doc.nodeAt(table.pos)!;
  const decorations = [
    Decoration.node(table.pos, table.pos + node.nodeSize, { class: CURRENT_TABLE_CLASS }),
  ];
  const column = focusKey.getState(state) ?? null;
  if (column !== null) {
    node.forEach((child, offset) => {
      if (child.type.name !== 'boundTableBody') return;
      const at = table.pos + 1 + offset;
      decorations.push(Decoration.node(at, at + child.nodeSize, {}, { focusColumn: column }));
    });
  }
  return DecorationSet.create(state.doc, decorations);
}
