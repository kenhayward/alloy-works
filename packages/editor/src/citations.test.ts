import type { ContentDocument } from '@alloy-works/domain';
import { EditorState, NodeSelection, TextSelection, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import {
  CITATION_UNAVAILABLE,
  changeCitation,
  citationAt,
  citationDecorations,
  citationFlagsOf,
  citationFormsOf,
  citationKey,
  citationPlaceable,
  citationsIn,
  insertCitation,
  setCitationFlags,
  setCitationForms,
} from './citations.js';
import { fromEditor, toEditor } from './mapping.js';
import { EDITOR_COMMANDS } from './marks.js';
import { createEditorState } from './state.js';
import { titleSchema } from './title.js';

const MARLOW = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c01';
const PENHALLOW = '0b0e2c4b-3f1d-4e8a-9b2c-5d6e7f8a9c02';

const stored: ContentDocument = {
  schemaVersion: 1,
  title: 'Sources',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'Sediment ', marks: [] }],
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

/** The paragraph's stored runs. */
const runs = (state: EditorState) =>
  (fromEditor(state.doc).content as unknown as [{ content: unknown[] }])[0].content;

describe('citing an entry (the CI plan, CId)', () => {
  it('places the entry an author chose, with a locator where one was typed, selected whole, and stores it', () => {
    let next = caretAt(10);
    expect(citationPlaceable(next)).toBe(true);
    const run = (command: ReturnType<typeof insertCitation>) =>
      command(next, (tr) => (next = next.apply(tr)));
    expect(run(insertCitation({ entry: MARLOW, locator: 'p. 12' }))).toBe(true);
    expect(next.selection).toBeInstanceOf(NodeSelection);
    expect(citationAt(next)).toEqual({ pos: 10, entry: MARLOW, locator: 'p. 12' });
    expect(runs(next).at(-1)).toEqual({ type: 'citation', entry: MARLOW, locator: 'p. 12' });
  });

  it('changes the entry and the locator of the citation selected, and removes a locator emptied', () => {
    let next = caretAt(10);
    insertCitation({ entry: MARLOW, locator: 'p. 12' })(next, (tr) => (next = next.apply(tr)));
    expect(
      changeCitation(10, { entry: PENHALLOW, locator: null })(
        next,
        (tr) => (next = next.apply(tr)),
      ),
    ).toBe(true);
    expect(citationAt(next)).toEqual({ pos: 10, entry: PENHALLOW, locator: null });
    expect(runs(next).at(-1)).toEqual({ type: 'citation', entry: PENHALLOW });
    // Removed as any atom selected whole is.
    next = next.apply(next.tr.deleteSelection());
    expect(citationsIn(next.doc)).toEqual([]);
  });

  it('places none in preformatted text or a title', () => {
    const pre = caretAt(15);
    expect(pre.selection.$from.parent.type.name).toBe('preformatted');
    expect(citationPlaceable(pre)).toBe(false);
    expect(insertCitation({ entry: MARLOW, locator: null })(pre)).toBe(false);
    const title = EditorState.create({
      doc: titleSchema.node('doc', null, [titleSchema.text('A')]),
    });
    expect(citationPlaceable(title)).toBe(false);
  });

  it('lists every citation and every cross-reference to an entry in reading order, which the service renders', () => {
    let next = caretAt(10);
    insertCitation({ entry: MARLOW, locator: 'p. 12' })(next, (tr) => (next = next.apply(tr)));
    next = next.apply(
      next.tr.insert(
        11,
        next.schema.nodes.crossReference!.create({
          target: { kind: 'entry', entry: PENHALLOW },
          display: 'number',
        }),
      ),
    );
    expect(citationsIn(next.doc)).toEqual([
      { entry: MARLOW, locator: 'p. 12' },
      { entry: PENHALLOW, locator: null },
    ]);
  });

  it("draws each citation as the service rendered it, and one whose entry the reader cannot read as 'Citation unavailable'", () => {
    let next = caretAt(10);
    insertCitation({ entry: MARLOW, locator: null })(next, (tr) => (next = next.apply(tr)));
    insertCitation({ entry: PENHALLOW, locator: null })(next, (tr) => (next = next.apply(tr)));
    const view = {
      state: next,
      dispatch: (tr: Transaction) => {
        view.state = view.state.apply(tr);
      },
    };
    setCitationForms(
      view,
      new Map([
        [citationKey(MARLOW, null), '(Marlow 2020)'],
        [citationKey(PENHALLOW, null), null],
      ]),
    );
    expect(citationFormsOf(view.state)?.get(citationKey(MARLOW, null))).toBe('(Marlow 2020)');
    const drawn = citationDecorations(view.state.doc, citationFormsOf(view.state))
      .find()
      .map((each) => [
        each.spec.citationText,
        (each as unknown as { type: { attrs: object } }).type.attrs,
      ]);
    expect(drawn).toEqual([
      ['(Marlow 2020)', {}],
      [CITATION_UNAVAILABLE(), { class: 'aw-citation-unavailable' }],
    ]);
    // A form arriving is no change to the document, and the history never holds it.
    expect(fromEditor(view.state.doc)).toEqual(fromEditor(next.doc));
  });

  it('LIB-036 flags a citation whose source is retracted or corrected, read or not, in its text and its class', () => {
    let next = caretAt(10);
    insertCitation({ entry: MARLOW, locator: null })(next, (tr) => (next = next.apply(tr)));
    insertCitation({ entry: PENHALLOW, locator: null })(next, (tr) => (next = next.apply(tr)));
    const view = {
      state: next,
      dispatch: (tr: Transaction) => {
        view.state = view.state.apply(tr);
      },
    };
    setCitationForms(
      view,
      new Map([
        [citationKey(MARLOW, null), '(Marlow 2020)'],
        [citationKey(PENHALLOW, null), null],
      ]),
    );
    setCitationFlags(
      view,
      new Map([
        [MARLOW, 'retracted'],
        [PENHALLOW, 'corrected'],
      ]),
    );
    expect(citationFlagsOf(view.state)?.get(MARLOW)).toBe('retracted');
    const drawn = citationDecorations(
      view.state.doc,
      citationFormsOf(view.state),
      citationFlagsOf(view.state),
    )
      .find()
      .map((each) => [
        each.spec.citationText,
        (each as unknown as { type: { attrs: object } }).type.attrs,
      ]);
    expect(drawn).toEqual([
      [
        '(Marlow 2020) (retracted)',
        {
          class: 'aw-citation-flagged',
          'data-flag': 'retracted',
          title: 'Its source says it is retracted',
        },
      ],
      [
        `${CITATION_UNAVAILABLE()} (corrected)`,
        {
          class: 'aw-citation-unavailable aw-citation-flagged',
          'data-flag': 'corrected',
          title: 'Its source says it is corrected',
        },
      ],
    ]);
    expect(fromEditor(view.state.doc)).toEqual(fromEditor(next.doc));
  });

  it('is offered as Cite, beside Reference, prompting for the entry and on its own shortcut', () => {
    const cite = EDITOR_COMMANDS.find((each) => each.kind === 'block' && each.action === 'cite');
    expect(cite).toMatchObject({ label: 'Cite', shortcut: 'Mod-Shift-2', prompts: true });
    const shortcuts = EDITOR_COMMANDS.map((each) => each.shortcut);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });
});
