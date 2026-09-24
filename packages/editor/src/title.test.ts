import type { InlineNode } from '@alloy-works/domain';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { changeEquation, equationAt, equationPlaceable, insertEquation } from './equations.js';
import { titleFromEditor, titleSchema, titleToEditor } from './title.js';

const NS = 'http://www.w3.org/1998/Math/MathML';
/** An equation in the one form the MathML reader writes, spoken as _x squared_. */
const SQUARED = `<math xmlns="${NS}" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>`;
/** Another, spoken as _y squared_. */
const Y_SQUARED = `<math xmlns="${NS}" alttext="y squared"><msup><mi>y</mi><mn>2</mn></msup></math>`;

const text = (value: string): InlineNode => ({ type: 'text', value, marks: [] });
const equation = (mathml = SQUARED, latex?: string): InlineNode => ({
  type: 'equation',
  mathml,
  ...(latex === undefined ? {} : { latex }),
});

/** A title's editor state, the caret at its end. */
function stateOf(title: readonly InlineNode[]): EditorState {
  const doc = titleToEditor(title)!;
  const state = EditorState.create({ doc });
  return state.apply(state.tr.setSelection(TextSelection.create(doc, doc.content.size)));
}

describe("a section title in the editor's terms (equations 3, ruling R1)", () => {
  it('holds one line of text and inline equations, with no marks and nothing else', () => {
    const doc = titleSchema.topNodeType;
    expect(doc.inlineContent).toBe(true);
    expect(Object.keys(titleSchema.nodes).sort()).toEqual(['doc', 'equation', 'text']);
    expect(Object.keys(titleSchema.marks)).toEqual([]);
    // The component editor's equation, spec for spec, so it is drawn and chosen the same way.
    expect(titleSchema.nodes.equation!.isAtom).toBe(true);
    expect(titleSchema.nodes.equation!.spec.selectable).toBe(true);
  });

  it('maps a title of text and equations in, and out again as the stored model spells it', () => {
    const title = [text('Growth as '), equation(SQUARED, 'x^2'), text(' rises')];
    const doc = titleToEditor(title)!;
    expect(doc.childCount).toBe(3);
    expect(doc.child(1).type.name).toBe('equation');
    expect(doc.child(1).attrs).toEqual({ mathml: SQUARED, latex: 'x^2' });
    expect(titleFromEditor(doc)).toEqual(title);
    // No LaTeX is absent, not null; an empty run is nothing; two runs side by side are one.
    expect(titleFromEditor(titleToEditor([text('A '), text(''), text('b'), equation()])!)).toEqual([
      text('A b'),
      equation(),
    ]);
    expect(titleFromEditor(titleToEditor([])!)).toEqual([]);
  });

  it('refuses a title holding what this editor cannot keep, and leaves the caller to say so', () => {
    expect(
      titleToEditor([{ type: 'text', value: 'Growth', marks: [{ type: 'strong', id: 'm1' }] }]),
    ).toBeNull();
    expect(
      titleToEditor([
        text('Results of '),
        {
          type: 'crossReference',
          id: 'r1',
          target: { kind: 'node', node: 'a'.repeat(26) },
          display: 'number',
        },
      ]),
    ).toBeNull();
    expect(titleToEditor([text('Dosing'), { type: 'variable', name: 'product' }])).toBeNull();
  });

  it('places, reads and changes an equation with the commands the component editor uses', () => {
    const before = stateOf([text('Growth as ')]);
    // Inline only: a title has nowhere for a block to stand.
    expect(equationPlaceable(before, 'inline')).toBe(true);
    expect(equationPlaceable(before, 'block')).toBe(false);

    let placed = before;
    const inserted = insertEquation({ display: 'inline', mathml: SQUARED, latex: 'x^2' })(
      before,
      (tr) => (placed = before.apply(tr)),
    );
    expect(inserted).toBe(true);
    expect(titleFromEditor(placed.doc)).toEqual([text('Growth as '), equation(SQUARED, 'x^2')]);
    expect(placed.selection).toBeInstanceOf(NodeSelection);
    expect(equationAt(placed)).toEqual({
      display: 'inline',
      pos: 10,
      mathml: SQUARED,
      latex: 'x^2',
    });
    expect(
      insertEquation({ display: 'block', mathml: SQUARED, latex: null, numbered: false })(before),
    ).toBe(false);

    let changed = placed;
    expect(
      changeEquation(10, { display: 'inline', mathml: Y_SQUARED, latex: 'y^2' })(
        placed,
        (tr) => (changed = placed.apply(tr)),
      ),
    ).toBe(true);
    expect(titleFromEditor(changed.doc)).toEqual([text('Growth as '), equation(Y_SQUARED, 'y^2')]);
  });
});
