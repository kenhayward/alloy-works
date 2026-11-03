import {
  tableActionUnavailable,
  tableCommand,
  type EditorView,
  type TableAction,
  type TableUnavailable,
} from '@alloy-works/editor';

import { words } from '../words/words.js';

/** The commands on both the toolbar and the Table tab, each named once (ADR-0079; CNT-188). */
export type GridAction = Exclude<TableAction, 'deleteTable' | 'addNote' | 'removeNote'>;

/** Its full name, the short word the tab sets under its icon, and its icon by name. */
export const GRID_ACTIONS: Readonly<
  Record<GridAction, { readonly label: () => string; readonly short: () => string }>
> = {
  rowAbove: {
    label: () => words('editor.row-above'),
    short: () => words('editor.table-short-above'),
  },
  rowBelow: {
    label: () => words('editor.row-below'),
    short: () => words('editor.table-short-below'),
  },
  columnBefore: {
    label: () => words('editor.column-before'),
    short: () => words('editor.table-short-before'),
  },
  columnAfter: {
    label: () => words('editor.column-after'),
    short: () => words('editor.table-short-after'),
  },
  deleteRow: {
    label: () => words('editor.delete-row'),
    short: () => words('editor.table-short-delete'),
  },
  deleteColumn: {
    label: () => words('editor.delete-column'),
    short: () => words('editor.table-short-delete'),
  },
  merge: { label: () => words('editor.merge-cells'), short: () => words('editor.merge-cells') },
  split: { label: () => words('editor.split-cell'), short: () => words('editor.split-cell') },
};

/** The icon each draws, by its name in `Icon`, never in the interface's words. */
export const GRID_ICONS: Readonly<Record<GridAction, string>> = {
  rowAbove: 'Row above',
  rowBelow: 'Row below',
  columnBefore: 'Column before',
  columnAfter: 'Column after',
  deleteRow: 'Delete row',
  deleteColumn: 'Delete column',
  merge: 'Merge cells',
  split: 'Split cell',
};

const REASONS: Readonly<Record<TableUnavailable, (name: string) => string>> = {
  cell: (name) => words('editor.table-why-cell', { name }),
  merge: (name) => words('editor.table-why-merge', { name }),
  split: (name) => words('editor.table-why-split', { name }),
  lastRow: (name) => words('editor.table-why-last-row', { name }),
  lastColumn: (name) => words('editor.table-why-last-column', { name }),
};

/**
 * **What a button says of a command here**, on the toolbar and the tab alike: whether it would do
 * nothing, asked of the command itself with no dispatch, and its tooltip, which after its name says
 * why (ADR-0079). Each stays reachable, `aria-disabled`, as the toolbar's buttons do.
 */
export function gridAction(
  view: EditorView,
  action: GridAction,
  enabled: boolean,
): { readonly unavailable: boolean; readonly tooltip: string; readonly press: () => void } {
  const name = GRID_ACTIONS[action].label();
  const reason = enabled ? tableActionUnavailable(action, view.state) : null;
  const unavailable = !enabled || !tableCommand(action)(view.state);
  return {
    unavailable,
    tooltip: reason === null ? name : REASONS[reason](name),
    press: () => {
      if (!unavailable) tableCommand(action)(view.state, view.dispatch);
    },
  };
}
