import { parseContentDocument } from '@alloy-works/domain';
import {
  createEditorState,
  fromEditor,
  mountEditor,
  Selection,
  setTermIndex,
  toEditor,
  type EditorView,
} from '@alloy-works/editor';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { shimRangeMeasurement } from '../test/range.js';

shimRangeMeasurement();

const WHO = '22222222-2222-4222-8222-222222222221';

let place: HTMLDivElement | null = null;
let view: EditorView | null = null;

afterEach(() => {
  view?.destroy();
  view = null;
  place?.remove();
  place = null;
});

/** A surface holding `Ask the `, the caret at its end and the space's index heard. */
function mount(): EditorView {
  const opened = toEditor(
    parseContentDocument({
      schemaVersion: 1,
      title: 'Field notes',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'paragraph',
          id: 'b1',
          style: 'body',
          content: [{ type: 'text', value: 'Ask the ', marks: [] }],
        },
      ],
    }),
  );
  if (!opened.editable) throw new Error('the fixture must open for editing');
  let blocks = 0;
  place = document.createElement('div');
  document.body.append(place);
  view = mountEditor(place, {
    state: createEditorState({
      doc: opened.doc,
      newIdentifier: () => `m${(blocks += 1)}`,
      selection: Selection.atEnd(opened.doc),
    }),
    label: 'Content of Field notes',
    editable: () => true,
    dispatch: (transaction, target) => target.updateState(target.state.apply(transaction)),
    pasted: () => undefined,
    refused: () => undefined,
  });
  setTermIndex(view, [
    {
      id: WHO,
      label: 'World Health Organization',
      abbreviation: 'WHO',
      forms: ['World Health Organization', 'WHO'],
    },
  ]);
  return view;
}

/** Types as a keystroke reaches the surface: through its text-input handlers. */
function type(target: EditorView, text: string) {
  for (const character of text) {
    const { from, to } = target.state.selection;
    const deflt = () => target.state.tr.insertText(character, from, to);
    if (!target.someProp('handleTextInput', (f) => f(target, from, to, character, deflt))) {
      target.dispatch(deflt());
    }
  }
}

describe('a term offered as it is typed (the TM plan, TM-L)', () => {
  it('LIB-019 offers the term as a listbox the surface names, announced, and applies it on Tab', () => {
    const surface = mount();
    expect(screen.queryByRole('listbox')).toBeNull();
    type(surface, 'WHO');
    const list = screen.getByRole('listbox', { name: 'Suggested terms' });
    const [option] = within(list).getAllByRole('option');
    expect(option).toHaveTextContent('World Health Organization (WHO)');
    expect(option).toHaveAttribute('aria-selected', 'true');
    // The caret stays in the surface, which names the list and its active option.
    expect(surface.dom).toHaveAttribute('role', 'textbox');
    expect(surface.dom).toHaveAttribute('aria-autocomplete', 'list');
    expect(surface.dom).toHaveAttribute('aria-controls', list.id);
    expect(surface.dom).toHaveAttribute('aria-activedescendant', option!.id);
    expect(document.querySelector('[aria-live="polite"].aw-visually-hidden')).toHaveTextContent(
      'Term offered: World Health Organization (WHO). Tab to apply, Escape to dismiss.',
    );

    fireEvent.keyDown(surface.dom, { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(surface.dom).not.toHaveAttribute('aria-activedescendant');
    const [block] = fromEditor(surface.state.doc).content;
    expect(block).toMatchObject({
      content: [
        { value: 'Ask the ' },
        { value: 'WHO', marks: [{ type: 'definedTerm', term: WHO }] },
      ],
    });
  });

  it('LIB-019 takes the offer away on Escape', () => {
    const surface = mount();
    type(surface, 'who');
    fireEvent.keyDown(surface.dom, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    type(surface, ' ');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
