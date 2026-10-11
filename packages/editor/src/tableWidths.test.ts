import { parseContentDocument, type ContentDocument } from '@alloy-works/domain';
import { describe, expect, it } from 'vitest';

import { toEditor } from './mapping.js';
import { sharesOf, widthDecorations } from './tableWidths.js';

/**
 * A table's widths on the page (the TG plan, TG3): set on its first row's cells, each as wide as the
 * columns it spans, which the fixed layout reads its columns from.
 */

const text = (value: string) => ({ type: 'text', value, marks: [] });
const cell = (name: string, colspan = 1) => ({
  content: [{ type: 'paragraph', id: name, style: 'body', content: [text(name)] }],
  colspan,
  rowspan: 1,
});
const doc = (rows: unknown[]) => {
  const editor = toEditor(
    parseContentDocument({
      schemaVersion: 1,
      title: 'Widths',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [text('Readings')],
          headerRows: 0,
          headerColumns: 0,
          rows,
        },
      ],
    }) as ContentDocument,
  );
  if (!editor.editable) throw new Error(editor.unsupported.join(', '));
  return editor.doc;
};
const tableAt = (node: ReturnType<typeof doc>) => {
  let at = -1;
  node.descendants((each, pos) => {
    if (each.type.name === 'table') at = pos;
    return at < 0;
  });
  return at;
};
const carried = (node: ReturnType<typeof doc>, shares: readonly number[]) =>
  widthDecorations(node, new Map([[tableAt(node), shares]]))
    .find()
    .map((each) => sharesOf([each]));

describe("a table's widths on the page (TG3)", () => {
  it("TAB-053 carries each table its columns' shares, which its view sets as a column group", () => {
    const node = doc([{ cells: [cell('a'), cell('b')] }, { cells: [cell('c'), cell('d')] }]);
    expect(carried(node, [0.25, 0.75])).toEqual([[0.25, 0.75]]);
  });

  it("carries every column's own share where a first-row cell spans columns, never their sum split evenly (the TG3 final review)", () => {
    const node = doc([
      { cells: [cell('a', 2), cell('b')] },
      { cells: [cell('c'), cell('d'), cell('e')] },
    ]);
    expect(carried(node, [0.2, 0.3, 0.5])).toEqual([[0.2, 0.3, 0.5]]);
  });

  it('carries nothing for widths of another number of columns than the table has', () => {
    const node = doc([{ cells: [cell('a'), cell('b')] }]);
    expect(carried(node, [1])).toEqual([]);
  });
});
