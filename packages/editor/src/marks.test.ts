import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { beforeEach, describe, expect, it } from 'vitest';

import { fromEditor, toEditor } from './mapping.js';
import {
  EDITOR_COMMANDS,
  markActive,
  markAt,
  markKeymap,
  removeMarkCommand,
  toggleMarkCommand,
} from './marks.js';
import { editorSchema } from './schema.js';
import { createEditorState } from './state.js';

/**
 * One sequence of identifiers across a test, so that two applications of one mark in the same test
 * are told apart by what they were given rather than by where they are.
 */
let minted = 0;
beforeEach(() => {
  minted = 0;
});
const counter = () => () => `id${(minted += 1)}`;

/** Block identifiers come from their own sequence, so they never consume a mark's. */
const blocks = () => {
  let next = 0;
  return () => `b${(next += 1)}`;
};

/** One paragraph, identified `b1`, holding `text` and nothing else. */
function stateWith(text: string): EditorState {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Install the printer',
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [{ type: 'text', value: text, marks: [] }],
      },
    ],
  });
  if (!opened.editable) throw new Error('expected an editable document');
  return createEditorState({ doc: opened.doc, newIdentifier: blocks() });
}

/** The same state, with the text between two positions selected. */
const select = (state: EditorState, from: number, to = from) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));

/** The state a command leads to, run over the text between two positions. */
function run(state: EditorState, from: number, to: number, command: Command): EditorState {
  const selected = select(state, from, to);
  let next = selected;
  command(selected, (tr) => {
    next = selected.apply(tr);
  });
  return next;
}

/** Every distinct identifier a mark of that type carries, in the document's own order. */
function idsIn(state: EditorState, mark: string): string[] {
  const found: string[] = [];
  state.doc.descendants((node) => {
    for (const carried of node.marks) {
      const id = carried.attrs.id as string;
      if (carried.type.name === mark && !found.includes(id)) found.push(id);
    }
  });
  return found;
}

/** The first paragraph's runs: what each one says, and which marks it carries. */
function textAndMarks(state: EditorState): { text: string; marks: string[] }[] {
  const runs: { text: string; marks: string[] }[] = [];
  state.doc.firstChild!.forEach((child) => {
    runs.push({ text: child.text!, marks: child.marks.map((mark) => mark.type.name) });
  });
  return runs;
}

describe('the command registry', () => {
  it('CNT-077 gives every command a shortcut and one label, with no shortcut used twice', () => {
    expect(EDITOR_COMMANDS).toHaveLength(9);
    for (const command of EDITOR_COMMANDS) {
      expect(command.label, command.mark).toMatch(/^[A-Z][a-z ]+$/);
      // No fancy dashes in anything an author reads; a plain hyphen would be allowed. Written by
      // code point rather than as a character, so the rule cannot be broken by the rule's own test.
      const fancy = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
      expect(command.label + command.shortcutSaid).not.toMatch(fancy);
      expect(editorSchema.marks[command.mark]).toBeDefined();
    }
    expect(new Set(EDITOR_COMMANDS.map((c) => c.shortcut)).size).toBe(9);
  });

  it('asks for a value only where a mark has one the author must supply', () => {
    const prompting = EDITOR_COMMANDS.filter((command) => command.prompts).map((c) => c.mark);
    expect(prompting).toEqual(['hyperlink', 'language']);
  });
});

describe('applying a mark', () => {
  it('gives each application of a mark its own identifier', () => {
    const state = stateWith('alpha beta gamma');
    const first = run(state, 2, 7, toggleMarkCommand('emphasis', counter()));
    const second = run(first, 8, 12, toggleMarkCommand('emphasis', counter()));
    expect(idsIn(second, 'emphasis')).toEqual(['id1', 'id2']);
  });

  it('mints an identifier each time one command is used, not once when it is made', () => {
    // The keymap builds each command once and runs it for every keystroke, so an identifier drawn
    // where the command is made would make every application of that mark one annotation.
    const command = toggleMarkCommand('emphasis', counter());
    let state = run(stateWith('alpha beta gamma'), 2, 7, command);
    state = run(state, 8, 12, command);
    expect(idsIn(state, 'emphasis')).toEqual(['id1', 'id2']);
  });

  it('CNT-004 keeps one identifier when an edit splits a marked run', () => {
    let state = run(stateWith('alpha beta'), 1, 11, toggleMarkCommand('emphasis', counter()));
    // A second mark over part of the first breaks one text node into three, and text with no mark
    // of its own breaks it again. The emphasis is one annotation across every one of them.
    state = run(state, 7, 10, toggleMarkCommand('strong', counter()));
    state = state.apply(state.tr.replaceWith(6, 6, editorSchema.text('XX')));
    expect(textAndMarks(state)).toEqual([
      { text: 'alpha', marks: ['emphasis'] },
      { text: 'XX', marks: [] },
      { text: ' ', marks: ['emphasis'] },
      { text: 'bet', marks: ['emphasis', 'strong'] },
      { text: 'a', marks: ['emphasis'] },
    ]);
    expect(idsIn(state, 'emphasis')).toEqual(['id1']);
    expect(state.doc.firstChild!.textContent).toBe('alphaXX beta');
  });

  it('marks the whole of a selection where only part of it was marked', () => {
    let state = run(stateWith('alpha beta gamma'), 8, 12, toggleMarkCommand('emphasis', counter()));
    state = run(state, 2, 16, toggleMarkCommand('emphasis', counter()));
    expect(textAndMarks(state)).toEqual([
      { text: 'a', marks: [] },
      { text: 'lpha beta gamm', marks: ['emphasis'] },
      { text: 'a', marks: [] },
    ]);
  });

  it('takes a mark off a selection that carries it throughout', () => {
    let state = run(stateWith('alpha'), 1, 6, toggleMarkCommand('emphasis', counter()));
    state = run(state, 1, 6, toggleMarkCommand('emphasis', counter()));
    expect(textAndMarks(state)).toEqual([{ text: 'alpha', marks: [] }]);
  });

  it('refuses a mark this editor has no counterpart for, rather than making one', () => {
    const state = stateWith('alpha');
    const applied = run(state, 1, 6, toggleMarkCommand('comment', counter(), { threadId: 't1' }));
    expect(textAndMarks(applied)).toEqual([{ text: 'alpha', marks: [] }]);
  });

  it('refuses a language tag the stored model would not accept', () => {
    const state = stateWith('alpha');
    expect(
      toggleMarkCommand('language', counter(), { tag: 'portuguese' })(state, () => undefined),
    ).toBe(false);
    expect(toggleMarkCommand('language', counter(), { tag: 'fr-CA' })(state, () => undefined)).toBe(
      true,
    );
  });
});

describe('a link target, refused before it is applied', () => {
  it('CNT-127 refuses a link target whose scheme is not allowed, before it is applied', () => {
    const state = stateWith('alpha');
    const applied = toggleMarkCommand('hyperlink', counter(), {
      href: 'javascript:alert(1)',
    })(state, () => undefined);
    expect(applied).toBe(false);
  });

  it('refuses a target that is not absolute, and one that is not there at all', () => {
    const state = stateWith('the report');
    const refuses = (href: string) =>
      toggleMarkCommand('hyperlink', counter(), { href })(state, () => undefined);
    expect(refuses('/report')).toBe(false);
    expect(refuses('report.html')).toBe(false);
    expect(refuses('')).toBe(false);
    expect(refuses('https://example.test/report')).toBe(true);
  });

  it('gives a link no title at all where the author left the title empty', () => {
    const state = run(
      stateWith('the report'),
      1,
      11,
      toggleMarkCommand('hyperlink', counter(), {
        href: 'https://example.test/report',
        title: '',
      }),
    );
    // The stored model spells "no title" as absence and refuses the empty string, so an empty box
    // has to become absence here rather than a ZodError when the version is saved.
    expect(markAt(state, 'hyperlink')).toEqual({
      id: 'id1',
      href: 'https://example.test/report',
      title: null,
    });
    expect(fromEditor(state.doc).content).toEqual([
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [
          {
            type: 'text',
            value: 'the report',
            marks: [{ type: 'hyperlink', id: 'id1', href: 'https://example.test/report' }],
          },
        ],
      },
    ]);
  });
});

describe('what the selection already carries', () => {
  it('reads back the mark under the cursor, so a prompt can be filled with what is there', () => {
    const state = run(
      stateWith('the report'),
      1,
      11,
      toggleMarkCommand('hyperlink', counter(), {
        href: 'https://example.test/report',
        title: 'The quarterly report',
      }),
    );
    expect(markAt(state, 'hyperlink')).toEqual({
      id: 'id1',
      href: 'https://example.test/report',
      title: 'The quarterly report',
    });
    expect(markAt(state, 'language')).toBeNull();
  });

  it('says a mark is carried only where the whole selection carries it', () => {
    const marked = run(stateWith('alpha beta'), 1, 6, toggleMarkCommand('emphasis', counter()));
    const over = (from: number, to: number) => markActive(select(marked, from, to), 'emphasis');
    expect(over(1, 6)).toBe(true);
    expect(over(2, 5)).toBe(true);
    // Half of this selection is unmarked, and pressing the button over it marks the rest rather
    // than clearing it, so saying it is already pressed would be a lie to a screen reader.
    expect(over(1, 11)).toBe(false);
    expect(over(7, 11)).toBe(false);
  });

  it('says a mark is carried at a cursor inside it', () => {
    const marked = run(stateWith('alpha beta'), 1, 6, toggleMarkCommand('emphasis', counter()));
    const at = (pos: number) => markActive(select(marked, pos), 'emphasis');
    expect(at(3)).toBe(true);
    expect(at(9)).toBe(false);
  });
});

describe('taking a mark off', () => {
  it('takes the mark off the selected text', () => {
    let state = run(stateWith('alpha beta'), 1, 11, toggleMarkCommand('emphasis', counter()));
    state = run(state, 1, 6, removeMarkCommand('emphasis'));
    expect(textAndMarks(state)).toEqual([
      { text: 'alpha', marks: [] },
      { text: ' beta', marks: ['emphasis'] },
    ]);
  });

  it('takes the whole annotation off from a cursor inside it, and does nothing outside one', () => {
    const linked = run(
      stateWith('the report'),
      1,
      11,
      toggleMarkCommand('hyperlink', counter(), { href: 'https://example.test/report' }),
    );
    expect(removeMarkCommand('language')(select(linked, 4), () => undefined)).toBe(false);
    expect(textAndMarks(run(linked, 4, 4, removeMarkCommand('hyperlink')))).toEqual([
      { text: 'the report', marks: [] },
    ]);
  });
});

describe('the keymap', () => {
  it('binds every command in the registry into the state keymap', () => {
    const bound = markKeymap(counter());
    expect(Object.keys(bound)).toHaveLength(9);
    for (const command of EDITOR_COMMANDS) {
      expect(Object.keys(bound), command.mark).toContain(command.shortcut);
    }
  });

  it('hands a shortcut that prompts to the renderer, and does nothing when none is listening', () => {
    const asked: string[] = [];
    const listening = markKeymap(counter(), (mark) => {
      asked.push(mark);
      return true;
    });
    const state = stateWith('alpha');
    expect(listening['Mod-k']!(state, () => undefined)).toBe(true);
    expect(listening['Mod-Shift-l']!(state, () => undefined)).toBe(true);
    expect(asked).toEqual(['hyperlink', 'language']);
    expect(markKeymap(counter())['Mod-k']!(state, () => undefined)).toBe(false);
  });

  it('applies a mark from the keyboard alone, through the state the view is built with', () => {
    // `prosemirror-keymap` normalises `Mod-` to `Meta-` on macOS and `Ctrl-` everywhere else, from
    // `navigator.platform`, so a fabricated event has to carry the modifier it normalised to.
    const platform =
      (globalThis as { navigator?: { platform?: string } }).navigator?.platform ?? '';
    const mac = /Mac|iP(hone|[oa]d)/.test(platform);
    const event = {
      key: 'b',
      keyCode: 66,
      ctrlKey: !mac,
      metaKey: mac,
      altKey: false,
      shiftKey: false,
    };
    const state = select(stateWith('alpha'), 1, 6);
    let next = state;
    const view = {
      state,
      dispatch: (tr: Transaction) => {
        next = state.apply(tr);
      },
    };
    const handled = state.plugins.some((plugin) =>
      Boolean(
        plugin.props.handleKeyDown?.call(plugin, view as unknown as EditorView, event as never),
      ),
    );
    expect(handled).toBe(true);
    expect(textAndMarks(next)).toEqual([{ text: 'alpha', marks: ['strong'] }]);
    expect(idsIn(next, 'strong')).toEqual(['b1']);
  });
});
