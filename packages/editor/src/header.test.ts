import { undo } from 'prosemirror-history';
import type { EditorState, Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { newBlockIdentifier } from './identity.js';
import { fromEditor, toEditor } from './mapping.js';
import { headerOf, setDirection, setLanguage, setTitle } from './header.js';
import { createEditorState } from './state.js';

const stored = {
  schemaVersion: 1 as const,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr' as const,
  content: [
    {
      type: 'paragraph' as const,
      id: 'p1',
      style: 'body',
      content: [{ type: 'text' as const, value: 'Unbox it.', marks: [] }],
    },
  ],
};

const opened = () => {
  const open = toEditor(stored);
  if (!open.editable) throw new Error('the fixture must be editable');
  return createEditorState({ doc: open.doc, newIdentifier: newBlockIdentifier });
};

/** Runs a command against a state, returning whether it ran and the state after it. */
function run(state: EditorState, command: ReturnType<typeof setTitle>) {
  let next = state;
  const ran = command(state, (transaction: Transaction) => {
    next = state.apply(transaction);
  });
  return { ran, state: next };
}

describe('the component header', () => {
  it('changes the title, the language and the direction, and the mapping carries each', () => {
    let state = opened();
    for (const [command, expected] of [
      [setTitle('Replace the toner'), { title: 'Replace the toner' }],
      [setLanguage('fr-CA'), { language: 'fr-CA' }],
      [setDirection('rtl'), { direction: 'rtl' }],
    ] as const) {
      const answer = run(state, command);
      expect(answer.ran).toBe(true);
      state = answer.state;
      expect(fromEditor(state.doc)).toMatchObject(expected);
    }
    expect(headerOf(state.doc)).toEqual({
      title: 'Replace the toner',
      language: 'fr-CA',
      direction: 'rtl',
    });
    expect(fromEditor(state.doc).content).toHaveLength(1);
  });

  it('refuses a title the model would refuse, without dispatching anything', () => {
    const state = opened();
    for (const title of ['', '   ', '\n']) {
      const answer = run(state, setTitle(title));
      expect(answer.ran).toBe(false);
      expect(answer.state).toBe(state);
    }
    expect(fromEditor(state.doc).title).toBe('Install the printer');
  });

  it('stores the title trimmed, the same agreement createComponent holds at creation', () => {
    const state = opened();
    const answer = run(state, setTitle('  Replace the toner  '));
    expect(answer.ran).toBe(true);
    expect(fromEditor(answer.state.doc).title).toBe('Replace the toner');
  });

  it('refuses a language that is not a BCP 47 tag, without dispatching anything', () => {
    const state = opened();
    for (const tag of ['english', 'EN', 'en_GB', 'en-gb', '']) {
      expect(run(state, setLanguage(tag)).ran).toBe(false);
    }
    expect(run(state, setLanguage('pt-BR')).ran).toBe(true);
    expect(run(state, setLanguage('zh-Hans')).ran).toBe(true);
  });

  it('is undone by the same history the content is, so a change is one step back', () => {
    const changed = run(opened(), setTitle('Replace the toner'));
    expect(fromEditor(changed.state.doc).title).toBe('Replace the toner');
    let back = changed.state;
    expect(
      undo(changed.state, (transaction) => {
        back = changed.state.apply(transaction);
      }),
    ).toBe(true);
    expect(fromEditor(back.doc).title).toBe('Install the printer');
  });

  it('makes the document changed, so the session sends it like any other edit', () => {
    const state = opened();
    let seen = false;
    setTitle('Replace the toner')(state, (transaction) => {
      seen = transaction.docChanged;
    });
    expect(seen).toBe(true);
  });
});
