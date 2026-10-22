import { undo } from 'prosemirror-history';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';

import { fromEditor, toEditor } from './mapping.js';
import {
  applyMarkCommand,
  commandKeymap,
  EDITOR_COMMANDS,
  removeMarkCommand,
  somewhereToPutMark,
} from './marks.js';
import { createEditorState } from './state.js';
import {
  setTermIndex,
  setTermStandings,
  termDecorations,
  termIndexOf,
  termsIn,
  termStandingsOf,
  termSuggestionOf,
  type TermOffered,
} from './terms.js';

const WHO = '6a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c01';
const WHAT = '6a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c02';
const NEW = '6a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3c03';

const INDEX: TermOffered[] = [
  {
    id: WHO,
    label: 'World Health Organization',
    abbreviation: 'WHO',
    forms: ['World Health Organization', 'WHO', 'Organisation mondiale de la Santé'],
  },
  { id: WHAT, label: 'Wholesale', abbreviation: null, forms: ['Wholesale'] },
];

/** One paragraph, `b1`, holding `text`, the caret at its end, the index heard. */
function stateWith(text: string, index: readonly TermOffered[] | null = INDEX): EditorState {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Field notes',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: text === '' ? [] : [{ type: 'text', value: text, marks: [] }],
      },
    ],
  });
  if (!opened.editable) throw new Error('expected an editable document');
  let next = 0;
  const state = createEditorState({ doc: opened.doc, newIdentifier: () => `m${(next += 1)}` });
  const at = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, state.doc.firstChild!.nodeSize - 1)),
  );
  const view = fakeView(at);
  if (index !== null) setTermIndex(view, index);
  return view.state;
}

/** A view as a plugin's props see one: its state, a dispatch, and whether it is composing. */
function fakeView(state: EditorState, composing = false) {
  let current = state;
  return {
    get state() {
      return current;
    },
    composing,
    dispatch: (tr: Transaction) => {
      current = current.apply(tr);
    },
  };
}

/** Types `text` at the caret through the surface's own route, as a keystroke reaches it. */
function type(state: EditorState, text: string, composing = false): EditorState {
  const view = fakeView(state, composing);
  for (const character of text) {
    const { from, to } = view.state.selection;
    const deflt = () => view.state.tr.insertText(character, from, to);
    const taken = view.state.plugins.some((plugin) =>
      plugin.props.handleTextInput?.call(
        plugin,
        view as unknown as EditorView,
        from,
        to,
        character,
        deflt,
      ),
    );
    if (!taken) view.dispatch(deflt());
  }
  return view.state;
}

/** Presses a key through every plugin's key handler, as the view does. */
function press(state: EditorState, key: string) {
  const view = fakeView(state);
  const event = { key, keyCode: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  const handled = view.state.plugins.some((plugin) =>
    plugin.props.handleKeyDown?.call(plugin, view as unknown as EditorView, event as never),
  );
  return { handled, next: view.state };
}

/** The paragraph's runs as the stored model spells them. */
const runs = (state: EditorState) =>
  (fromEditor(state.doc).content as unknown as [{ content: unknown[] }])[0].content;

describe('the Term action (the TM plan, TMc)', () => {
  it('CNT-165 is a toolbar command and a shortcut that asks the renderer for the term', () => {
    const term = EDITOR_COMMANDS.find((each) => each.label === 'Term');
    expect(term).toMatchObject({
      kind: 'mark',
      mark: 'definedTerm',
      shortcut: 'Mod-Alt-g',
      prompts: true,
    });
    const asked: string[] = [];
    const keymap = commandKeymap(
      () => 'm1',
      (name) => {
        asked.push(name);
        return true;
      },
    );
    expect(keymap['Mod-Alt-g']!(stateWith('alpha'), () => undefined)).toBe(true);
    expect(asked).toEqual(['definedTerm']);
  });

  it('CNT-165 applies a term over the word at the caret, and the same command on it takes it off', () => {
    let state = stateWith('Ask the WHO today');
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 10)));
    // A caret in a word is somewhere to put a term: the whole word.
    expect(somewhereToPutMark(state, 'definedTerm')).toBe(true);
    applyMarkCommand('definedTerm', () => 'm9', { term: WHO })(state, (tr) => {
      state = state.apply(tr);
    });
    expect(runs(state)).toEqual([
      { type: 'text', value: 'Ask the ', marks: [] },
      { type: 'text', value: 'WHO', marks: [{ type: 'definedTerm', id: 'm9', term: WHO }] },
      { type: 'text', value: ' today', marks: [] },
    ]);
    // Typing at the end of a term makes ordinary text, as at the end of a link.
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 12)));
    state = state.apply(state.tr.insertText('s'));
    expect((runs(state)[1] as { value: string }).value).toBe('WHO');
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 10)));
    removeMarkCommand('definedTerm')(state, (tr) => {
      state = state.apply(tr);
    });
    expect(termsIn(state.doc)).toEqual([]);
  });

  it('has nowhere to put a term at a caret between words', () => {
    const state = stateWith('Ask  today');
    const between = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)));
    expect(somewhereToPutMark(between, 'definedTerm')).toBe(false);
  });
});

describe('a term suggested as it is typed (the TM plan, TM-L)', () => {
  it('LIB-019 offers the term whose abbreviation or label the word before the caret is, case aside', () => {
    const typed = type(stateWith('Ask the '), 'who');
    expect(termSuggestionOf(typed)).toMatchObject({
      from: 9,
      to: 12,
      offers: [{ term: { id: WHO }, from: 9 }],
      active: 0,
    });
    // After a space or punctuation too, over the word before it.
    expect(termSuggestionOf(type(stateWith('Ask the '), 'WHO,'))).toMatchObject({
      offers: [{ term: { id: WHO }, from: 9 }],
      to: 12,
    });
    // A label of several words, and one in another language.
    expect(
      termSuggestionOf(type(stateWith('Ask the World Health '), 'Organization')),
    ).toMatchObject({ offers: [{ term: { id: WHO }, from: 9 }] });
    expect(
      termSuggestionOf(type(stateWith('Voir '), 'Organisation mondiale de la santé')),
    ).toMatchObject({ offers: [{ term: { id: WHO } }] });
    // Part of a word is no match, nor a word that only begins with one.
    expect(termSuggestionOf(type(stateWith('Ask the '), 'WH'))).toBeNull();
    expect(termSuggestionOf(type(stateWith('Ask the '), 'WHOM'))).toBeNull();
  });

  it('offers at most five terms', () => {
    const many: TermOffered[] = Array.from({ length: 7 }, (_, at) => ({
      id: `6a1c2b3d-4e5f-4a6b-8c7d-9e0f1a2b3d0${at}`,
      label: `Assay ${at}`,
      abbreviation: 'AS',
      forms: [`Assay ${at}`, 'AS'],
    }));
    expect(termSuggestionOf(type(stateWith('', many), 'as'))?.offers).toHaveLength(5);
  });

  it('LIB-019 applies the term on Tab over the word as one undo step', () => {
    const typed = type(stateWith('Ask the '), 'WHO');
    const { handled, next } = press(typed, 'Tab');
    expect(handled).toBe(true);
    expect(runs(next)).toEqual([
      { type: 'text', value: 'Ask the ', marks: [] },
      { type: 'text', value: 'WHO', marks: [{ type: 'definedTerm', id: 'm1', term: WHO }] },
    ]);
    expect(termSuggestionOf(next)).toBeNull();
    // Undo takes the term off and leaves what was typed.
    let undone = next;
    undo(next, (tr) => {
      undone = next.apply(tr);
    });
    expect(runs(undone)).toEqual([{ type: 'text', value: 'Ask the WHO', marks: [] }]);
  });

  it('LIB-019 applies the term on Enter only once an arrow has moved the choice, else Enter is its own', () => {
    // Unmoved, Enter goes on to the surface, and the offer closes.
    const entered = press(type(stateWith('Ask the '), 'who '), 'Enter');
    expect(entered.next.doc.childCount).toBe(2);
    expect(termSuggestionOf(entered.next)).toBeNull();
    expect(termsIn(entered.next.doc)).toEqual([]);
    // Moved, Enter applies the term chosen.
    const two: TermOffered[] = [
      { id: WHO, label: 'Assay', abbreviation: 'AS', forms: ['Assay', 'AS'] },
      { id: WHAT, label: 'Assize', abbreviation: 'AS', forms: ['Assize', 'AS'] },
    ];
    const moved = press(type(stateWith('', two), 'AS'), 'ArrowDown');
    expect(moved.handled).toBe(true);
    const chosen = press(moved.next, 'Enter');
    expect(chosen.handled).toBe(true);
    expect(termsIn(chosen.next.doc)).toEqual([WHAT]);
  });

  it('LIB-019 leaves Tab to the surface where nothing is offered', () => {
    expect(press(stateWith('Ask the '), 'Tab').handled).toBe(false);
  });

  it('LIB-019 dismisses the offer on Escape, and offers it for that word no more', () => {
    const typed = type(stateWith('Ask the '), 'WHO');
    const { handled, next } = press(typed, 'Escape');
    expect(handled).toBe(true);
    expect(termSuggestionOf(next)).toBeNull();
    // Tab goes on to whatever else takes it: no term is applied.
    expect(termsIn(press(next, 'Tab').next.doc)).toEqual([]);
    // Typing a space after the word dismissed offers it again nowhere.
    expect(termSuggestionOf(type(next, ' '))).toBeNull();
    // Another word is offered as before.
    expect(termSuggestionOf(type(next, ' and the WHO'))).not.toBeNull();
  });

  it('LIB-019 offers nothing while an input method is composing', () => {
    expect(termSuggestionOf(type(stateWith('Ask the '), 'WHO', true))).toBeNull();
  });

  it('LIB-019 acts only on what the author typed here, never on a change made elsewhere', () => {
    const state = stateWith('Ask the ');
    // The same text arriving by any other transaction - a collaborator's, a replay - offers nothing.
    const arrived = state.apply(state.tr.insertText('WHO'));
    expect(termSuggestionOf(arrived)).toBeNull();
    expect(press(arrived, 'Tab').handled).toBe(false);
    // And moving the caret away takes an offer away.
    const typed = type(stateWith('Ask the '), 'WHO');
    const moved = typed.apply(typed.tr.setSelection(TextSelection.create(typed.doc, 2)));
    expect(termSuggestionOf(moved)).toBeNull();
  });

  it('offers nothing over words a term already covers, and nothing without an index', () => {
    const marked = press(type(stateWith('Ask the '), 'WHO'), 'Tab').next;
    expect(termSuggestionOf(type(marked, ' '))).toBeNull();
    expect(termSuggestionOf(type(stateWith('Ask the ', null), 'WHO'))).toBeNull();
    expect(termIndexOf(stateWith('', INDEX))).toBe(INDEX);
  });
});

describe('a deprecated term flagged where it is used (the TM plan, TMc)', () => {
  it('LIB-018 flags a deprecated term, naming its replacement, and one the reader cannot read', () => {
    let state = stateWith('WHO and NEW');
    state = state.apply(
      state.tr
        .addMark(1, 4, state.schema.marks.definedTerm!.create({ id: 'x1', term: WHO }))
        .addMark(9, 12, state.schema.marks.definedTerm!.create({ id: 'x2', term: NEW })),
    );
    expect(termsIn(state.doc)).toEqual([WHO, NEW]);
    const view = fakeView(state);
    setTermStandings(
      view,
      new Map([
        [
          WHO,
          {
            standing: 'deprecated',
            label: 'World Health Organization',
            replacedBy: { id: WHAT, label: 'Wholesale' },
          },
        ],
        [NEW, { standing: 'unavailable', label: null, replacedBy: null }],
      ]),
    );
    const found = termDecorations(view.state.doc, termStandingsOf(view.state)).find();
    const said = found.flatMap((each) =>
      typeof each.spec.termFlag === 'string' ? [each.spec.termFlag as string] : [],
    );
    expect(said).toEqual(['Deprecated: use Wholesale', 'Term unavailable']);
    // Nothing is flagged before the service has answered.
    expect(termDecorations(state.doc, termStandingsOf(state)).find()).toEqual([]);
  });
});
