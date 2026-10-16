import type { ContentDocument } from '@alloy-works/domain';
import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { addAlternative, conditionsOver, removeCondition, setCondition } from './conditions.js';
import { fromEditor, toEditor } from './mapping.js';
import { createEditorState } from './state.js';

const stored: ContentDocument = {
  schemaVersion: 1,
  title: 'Notice',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'Tell the regulator.', marks: [] }],
    },
  ],
};

/** The paragraph with "the regulator" selected. */
function selected(): EditorState {
  const opened = toEditor(stored);
  if (!opened.editable) throw new Error('not editable');
  let next = 0;
  const state = createEditorState({ doc: opened.doc, newIdentifier: () => `n${(next += 1)}` });
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, 6, 19)));
}

const run = (state: EditorState, command: Command) => {
  let after = state;
  const handled = command(state, (tr) => {
    after = state.apply(tr);
  });
  return { handled, after };
};

const runsOf = (state: EditorState) =>
  (
    fromEditor(state.doc).content[0] as Extract<
      ContentDocument['content'][number],
      { type: 'paragraph' }
    >
  ).content;

let ids = 0;
const mint = () => `c${(ids += 1)}`;

describe('conditions in the editor (the R6 plan, R6-H)', () => {
  it('REU-021 marks the selection with a condition, two axes over one run, and replaces one axis whole', () => {
    let { after } = run(
      selected(),
      setCondition({ axis: 'audience', values: ['regulator'] }, mint),
    );
    ({ after } = run(after, setCondition({ axis: 'region', values: ['uk'] }, mint)));
    expect(conditionsOver(after).map(({ axis, values }) => ({ axis, values }))).toEqual([
      { axis: 'audience', values: ['regulator'] },
      { axis: 'region', values: ['uk'] },
    ]);
    ({ after } = run(after, setCondition({ axis: 'audience', values: ['internal'] }, mint)));
    expect(conditionsOver(after).map(({ axis, values }) => ({ axis, values }))).toEqual([
      { axis: 'region', values: ['uk'] },
      { axis: 'audience', values: ['internal'] },
    ]);
    ({ after } = run(after, removeCondition('region')));
    expect(runsOf(after)[1]).toMatchObject({
      value: 'the regulator',
      marks: [{ type: 'condition', axis: 'audience', values: ['internal'] }],
    });
  });

  it('REU-047 adds an alternative beside the selection for the other values, so per-profile wording is one act', () => {
    let { after } = run(
      selected(),
      setCondition({ axis: 'audience', values: ['regulator'] }, mint),
    );
    const made = run(after, addAlternative({ axis: 'audience', values: ['internal'] }, mint));
    expect(made.handled).toBe(true);
    after = made.after;
    expect(
      runsOf(after).map((each) => [
        each.type === 'text' ? each.value : '',
        each.type === 'text'
          ? each.marks.map((mark) => (mark.type === 'condition' ? mark.values : []))
          : [],
      ]),
    ).toEqual([
      ['Tell ', []],
      ['the regulator', [['regulator']]],
      ['the regulator', [['internal']]],
      ['.', []],
    ]);
    // The alternative is selected, for the author to write it.
    const { from, to } = after.selection;
    expect(after.doc.textBetween(from, to)).toBe('the regulator');
    expect(from).toBe(19);
  });

  it('places nothing over a selection holding what carries no mark, which would be published to every reader', () => {
    const opened = toEditor({
      ...stored,
      content: [
        {
          type: 'paragraph',
          id: 'p1',
          style: 'body',
          content: [
            { type: 'text', value: 'Review by ', marks: [] },
            { type: 'variable', name: 'review_date' },
            { type: 'text', value: ' at the latest.', marks: [] },
          ],
        },
      ],
    });
    if (!opened.editable) throw new Error('not editable');
    const state = createEditorState({ doc: opened.doc, newIdentifier: mint });
    const across = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, 16)));
    expect(setCondition({ axis: 'audience', values: ['regulator'] }, mint)(across)).toBe(false);
  });

  it('places nothing over an empty selection', () => {
    const empty = selected();
    const caret = empty.apply(empty.tr.setSelection(TextSelection.create(empty.doc, 3)));
    expect(setCondition({ axis: 'audience', values: ['regulator'] }, mint)(caret)).toBe(false);
    expect(addAlternative({ axis: 'audience', values: ['internal'] }, mint)(caret)).toBe(false);
  });
});
