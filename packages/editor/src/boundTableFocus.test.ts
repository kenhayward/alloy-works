import { parseContentDocument, type BlockNode, type BoundTableNode } from '@alloy-works/domain';
import { undoDepth } from 'prosemirror-history';
import { TextSelection, type EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import {
  boundTableFocusDecorations,
  boundTableFocusedColumn,
  CURRENT_TABLE_CLASS,
  focusBoundTableColumn,
  holdBoundTableColumn,
} from './boundTableFocus.js';
import { toEditor } from './mapping.js';
import { createEditorState } from './state.js';

/**
 * What the Bound table panel is about, shown in the text (ADR-0051, decision 6): the table the cursor
 * stands in outlined, and the column whose row has the focus told to the table's body.
 */

const text = (value: string) => ({ type: 'text' as const, value, marks: [] });

const table: BoundTableNode = {
  type: 'boundTable',
  id: 't1',
  style: 'table',
  binding: {
    type: 'binding',
    id: 'k1',
    query: '00000000-0000-4000-8000-00000000d001',
    parameters: {},
    mode: 'checked',
  },
  caption: [text('Readings')],
  columns: [
    { column: 'site', header: 'Site' },
    { column: 'depth', header: 'Depth' },
  ],
  headerColumn: false,
};

function opened(): EditorState {
  const editor = toEditor(
    parseContentDocument({
      schemaVersion: 1,
      title: 'Sites',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        { type: 'paragraph', id: 'p1', style: 'body', content: [text('Before.')] } as BlockNode,
        table,
      ],
    }),
  );
  if (!editor.editable) throw new Error(editor.unsupported.join(', '));
  let next = 0;
  return createEditorState({ doc: editor.doc, newIdentifier: () => `n${(next += 1)}` });
}

/** The state with the cursor at the first place inside the node named. */
function into(state: EditorState, name: string): EditorState {
  let at = -1;
  state.doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === name) at = pos + 1;
  });
  return state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(at))));
}

const run = (state: EditorState, column: number | null) => {
  let next = state;
  focusBoundTableColumn(column)(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
};

describe('the bound table the Bound table panel is about, shown in the text', () => {
  it('outlines the bound table the cursor stands in, and no other', () => {
    const outside = into(opened(), 'paragraph');
    expect(boundTableFocusDecorations(outside).find()).toEqual([]);

    const inside = into(outside, 'tableCaption');
    const [outline] = boundTableFocusDecorations(inside).find();
    expect(inside.doc.nodeAt(outline!.from)?.type.name).toBe('boundTable');
    expect((outline as unknown as { type: { attrs: { class: string } } }).type.attrs.class).toBe(
      CURRENT_TABLE_CLASS,
    );
  });

  it("tells the table's body the column focused in the panel, never as a change to undo", () => {
    const inside = into(opened(), 'tableCaption');
    const focused = run(inside, 1);
    const body = boundTableFocusDecorations(focused)
      .find()
      .find((each) => each.spec.focusColumn !== undefined);
    expect(focused.doc.nodeAt(body!.from)?.type.name).toBe('boundTableBody');
    expect(body!.spec.focusColumn).toBe(1);
    expect(focused.doc.eq(inside.doc)).toBe(true);
    expect(undoDepth(focused)).toBe(undoDepth(inside));

    const left = run(focused, null);
    expect(
      boundTableFocusDecorations(left)
        .find()
        .some((each) => each.spec.focusColumn !== undefined),
    ).toBe(false);
  });

  it('holds a column of a table the cursor is not in yet, as a click on its cell does, moving the cursor into the table (ADR-0052)', () => {
    const outside = into(opened(), 'paragraph');
    let tablePos = -1;
    outside.doc.descendants((node, pos) => {
      if (tablePos < 0 && node.type.name === 'boundTable') tablePos = pos;
    });
    let held = outside;
    holdBoundTableColumn(tablePos, 1)(outside, (tr) => {
      held = outside.apply(tr);
    });
    expect(boundTableFocusedColumn(held)).toBe(1);
    expect(held.selection.$from.parent.type.name).toBe('tableCaption');
    expect(held.doc.eq(outside.doc)).toBe(true);
    expect(undoDepth(held)).toBe(undoDepth(outside));
  });
});
