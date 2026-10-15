import type { ContentDocument } from '@alloy-works/domain';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { fromEditor, toEditor } from './mapping.js';
import { createEditorState } from './state.js';
import { titleSchema } from './title.js';
import { insertVariable, variablePlaceable, variableSelected } from './variables.js';

const stored: ContentDocument = {
  schemaVersion: 1,
  title: 'Site visits',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'Review by ', marks: [] }],
    },
    { type: 'preformatted', id: 'pre1', text: 'code' },
  ],
};

function caretAt(offset: number): EditorState {
  const opened = toEditor(stored);
  if (!opened.editable) throw new Error('not editable');
  const state = createEditorState({ doc: opened.doc, newIdentifier: () => 'n1' });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, offset)));
}

describe('placing a variable (the R5 plan, R5b)', () => {
  it('REU-018 places the variable an author chose by its key, selected whole, and stores it', () => {
    let next = caretAt(11);
    expect(variablePlaceable(next)).toBe(true);
    expect(insertVariable('review_date')(next, (tr) => (next = next.apply(tr)))).toBe(true);
    expect(next.selection).toBeInstanceOf(NodeSelection);
    expect(variableSelected(next)).toBe('review_date');
    const [paragraph] = fromEditor(next.doc).content as unknown as [{ content: unknown[] }];
    expect(paragraph.content.at(-1)).toEqual({ type: 'variable', name: 'review_date' });
  });

  it('places none in preformatted text or a title', () => {
    const pre = caretAt(15);
    expect(pre.selection.$from.parent.type.name).toBe('preformatted');
    expect(variablePlaceable(pre)).toBe(false);
    expect(insertVariable('review_date')(pre)).toBe(false);
    const title = EditorState.create({
      doc: titleSchema.node('doc', null, [titleSchema.text('A')]),
    });
    expect(variablePlaceable(title)).toBe(false);
  });
});
