import type { ContentDocument } from '@alloy-works/domain';
import { NodeSelection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import {
  addAlternative,
  canPlaceCondition,
  conditionedBlocks,
  conditionOnBlock,
  conditionsOver,
  removeCondition,
  setCondition,
} from './conditions.js';
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

describe("a numbered block's conditions in the editor (the R12 plan)", () => {
  const blocks: ContentDocument = {
    ...stored,
    content: [
      {
        type: 'paragraph',
        id: 'p1',
        style: 'body',
        content: [{ type: 'text', value: 'Before.', marks: [] }],
      },
      {
        type: 'equation',
        id: 'e1',
        mathml: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math>',
        numbered: true,
      },
      {
        type: 'table',
        id: 't1',
        style: 'table',
        caption: [{ type: 'text', value: 'Inspections', marks: [] }],
        headerRows: 0,
        headerColumns: 0,
        rows: [
          {
            cells: [
              {
                content: [
                  {
                    type: 'paragraph',
                    id: 'c1',
                    style: 'body',
                    content: [{ type: 'text', value: 'Twelve', marks: [] }],
                  },
                ],
                colspan: 1,
                rowspan: 1,
              },
            ],
          },
        ],
      },
    ],
  };
  const opened = () => {
    const doc = toEditor(blocks);
    if (!doc.editable) throw new Error('not editable');
    return createEditorState({ doc: doc.doc, newIdentifier: mint });
  };
  /** The position of the first node of this type. */
  const at = (state: EditorState, name: string) => {
    let found = -1;
    state.doc.descendants((node, pos) => {
      if (found < 0 && node.type.name === name) found = pos;
      return found < 0;
    });
    return found;
  };
  const regulator = { axis: 'audience', values: ['regulator'] };

  it('REU-021 sets the conditions of a selected equation, and of the table the cursor stands in, and takes one axis off', () => {
    const start = opened();
    const equation = start.apply(
      start.tr.setSelection(NodeSelection.create(start.doc, at(start, 'equationBlock'))),
    );
    expect(canPlaceCondition(equation)).toBe(true);
    expect(conditionOnBlock(equation)).toBe(true);
    let { after } = run(equation, setCondition(regulator, mint));
    expect(conditionsOver(after).map(({ axis, values }) => ({ axis, values }))).toEqual([
      regulator,
    ]);
    expect(fromEditor(after.doc).content[1]).toMatchObject({ conditions: [regulator] });

    // A cursor in the table's caption, nothing selected: the table's.
    const caption = at(after, 'tableCaption') + 2;
    const inTable = after.apply(after.tr.setSelection(TextSelection.create(after.doc, caption)));
    expect(conditionOnBlock(inTable)).toBe(true);
    ({ after } = run(inTable, setCondition({ axis: 'region', values: ['uk'] }, mint)));
    ({ after } = run(after, setCondition(regulator, mint)));
    expect(fromEditor(after.doc).content[2]).toMatchObject({
      conditions: [{ axis: 'region', values: ['uk'] }, regulator],
    });
    ({ after } = run(after, removeCondition('region')));
    ({ after } = run(after, removeCondition('audience')));
    expect(fromEditor(after.doc).content[2]).not.toHaveProperty('conditions');

    // Text selected in the caption is the text's, as it always was.
    const words = after.apply(
      after.tr.setSelection(TextSelection.create(after.doc, caption, caption + 4)),
    );
    expect(conditionOnBlock(words)).toBe(false);
  });

  it('REU-026 draws a block its conditions keep for some readers, saying what it depends on', () => {
    const start = opened();
    const equation = start.apply(
      start.tr.setSelection(NodeSelection.create(start.doc, at(start, 'equationBlock'))),
    );
    const { after } = run(equation, setCondition(regulator, mint));
    const drawn = conditionedBlocks(after).find();
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.from).toBe(at(after, 'equationBlock'));
    expect(
      (drawn[0] as unknown as { type: { attrs: Record<string, string> } }).type.attrs,
    ).toMatchObject({
      class: 'aw-conditional',
      title: 'Only where audience is regulator',
      // Said to assistive technology too, which a title alone is not reliably (the R12 final review).
      'aria-description': 'Only where audience is regulator',
    });
  });
});
