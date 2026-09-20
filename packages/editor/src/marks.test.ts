import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { beforeEach, describe, expect, it } from 'vitest';

import { fromEditor, toEditor } from './mapping.js';
import {
  applyMarkCommand,
  EDITOR_COMMANDS,
  markAt,
  markKeymap,
  markThroughout,
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
    // A second mark over part of the first breaks one text node into three. The emphasis runs
    // straight through all three without a gap, so it is still one annotation under one identifier.
    state = run(state, 7, 10, toggleMarkCommand('strong', counter()));
    expect(textAndMarks(state)).toEqual([
      { text: 'alpha ', marks: ['emphasis'] },
      { text: 'bet', marks: ['emphasis', 'strong'] },
      { text: 'a', marks: ['emphasis'] },
    ]);
    expect(idsIn(state, 'emphasis')).toEqual(['id1']);
    expect(idsIn(state, 'strong')).toEqual(['id2']);
    expect(state.doc.firstChild!.textContent).toBe('alpha beta');
  });

  it('leaves no annotation in two pieces with unmarked text between them', () => {
    let state = run(stateWith('the report now'), 1, 15, toggleMarkCommand('emphasis', counter()));
    state = run(state, 12, 15, toggleMarkCommand('strong', counter()));
    // Pressing the button over a word in the middle takes the mark off there, which would leave
    // the text either side one annotation in two separated pieces: accepting or rejecting it is
    // one operation over every fragment, so two regions would change in two places at once.
    state = run(state, 5, 11, toggleMarkCommand('emphasis', counter()));
    expect(textAndMarks(state)).toEqual([
      { text: 'the ', marks: ['emphasis'] },
      { text: 'report', marks: [] },
      { text: ' ', marks: ['emphasis'] },
      { text: 'now', marks: ['emphasis', 'strong'] },
    ]);
    // The far piece is one annotation of its own, over both of the runs it spans. `id3` was drawn
    // by the call that did the removing, before it knew it would not be applying anything.
    expect(idsIn(state, 'emphasis')).toEqual(['id1', 'id4']);
  });

  it('ignores an identifier, or a type, handed in with the attributes', () => {
    const state = run(
      stateWith('the report'),
      1,
      11,
      toggleMarkCommand('hyperlink', counter(), {
        id: 'reused',
        href: 'https://example.test/report',
      }),
    );
    // A caller cannot name the annotation: the identifier is the editor's to mint (CNT-004), and
    // the content model refuses a document where one identifier names two annotations.
    expect(idsIn(state, 'hyperlink')).toEqual(['id1']);
    expect(markAt(state, 'hyperlink')).toEqual({
      href: 'https://example.test/report',
      title: null,
    });
    // Nor which mark it is. Left to overwrite the type, this validates as a strong mark and then
    // throws out of a keystroke handler for want of an href.
    expect(
      toggleMarkCommand('hyperlink', counter(), { type: 'strong' })(state, () => undefined),
    ).toBe(false);
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
    // The stored model spells "no title" as absence and refuses the empty string, so an empty box
    // has to become absence here rather than a ZodError when the version is saved. A box holding
    // nothing but spaces is the same box.
    const linked = (title: string) =>
      run(
        stateWith('the report'),
        1,
        11,
        toggleMarkCommand('hyperlink', counter(), { href: 'https://example.test/report', title }),
      );
    const state = linked('');
    expect(markAt(state, 'hyperlink')).toEqual({
      href: 'https://example.test/report',
      title: null,
    });
    expect(markAt(linked('   '), 'hyperlink')).toEqual({
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

describe('changing what a mark says', () => {
  it('will not change a link target by toggling it, which is why there is a second command', () => {
    let state = run(
      stateWith('the report'),
      1,
      11,
      toggleMarkCommand('hyperlink', counter(), { href: 'https://example.test/report' }),
    );
    // `toggleMark` decides by whether the range carries the mark at all and never looks at what it
    // says, so this takes the link off rather than repointing it.
    state = run(
      state,
      1,
      5,
      toggleMarkCommand('hyperlink', counter(), { href: 'https://example.test/summary' }),
    );
    expect(markAt(select(state, 1, 5), 'hyperlink')).toBeNull();
  });

  it('repoints a link over the selection, under an identifier of its own', () => {
    let state = run(
      stateWith('the report'),
      1,
      11,
      toggleMarkCommand('hyperlink', counter(), { href: 'https://example.test/report' }),
    );
    state = run(
      state,
      1,
      5,
      applyMarkCommand('hyperlink', counter(), { href: 'https://example.test/summary' }),
    );
    expect(markAt(select(state, 1, 5), 'hyperlink')).toEqual({
      href: 'https://example.test/summary',
      title: null,
    });
    expect(markAt(select(state, 5, 11), 'hyperlink')).toEqual({
      href: 'https://example.test/report',
      title: null,
    });
    // What it changed is a new annotation, not the old one wearing a new target.
    expect(idsIn(state, 'hyperlink')).toEqual(['id2', 'id1']);
  });

  it('repoints the whole link a cursor sits inside, and refuses where there is none', () => {
    const linked = run(
      stateWith('the report'),
      1,
      11,
      toggleMarkCommand('hyperlink', counter(), { href: 'https://example.test/report' }),
    );
    const repoint = applyMarkCommand('hyperlink', counter(), {
      href: 'https://example.test/summary',
      title: 'The quarterly summary',
    });
    const state = run(linked, 4, 4, repoint);
    expect(textAndMarks(state)).toEqual([{ text: 'the report', marks: ['hyperlink'] }]);
    expect(markAt(state, 'hyperlink')).toEqual({
      href: 'https://example.test/summary',
      title: 'The quarterly summary',
    });
    expect(repoint(select(stateWith('the report'), 4), () => undefined)).toBe(false);
  });

  it('leaves no annotation in two pieces when a change is made in the middle of one', () => {
    let state = run(
      stateWith('the report now'),
      1,
      15,
      toggleMarkCommand('hyperlink', counter(), { href: 'https://example.test/report' }),
    );
    state = run(
      state,
      5,
      11,
      applyMarkCommand('hyperlink', counter(), { href: 'https://example.test/summary' }),
    );
    expect(idsIn(state, 'hyperlink')).toEqual(['id1', 'id2', 'id3']);
    expect(textAndMarks(state)).toEqual([
      { text: 'the ', marks: ['hyperlink'] },
      { text: 'report', marks: ['hyperlink'] },
      { text: ' now', marks: ['hyperlink'] },
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
    // No identifier comes back. Nothing in this slice needs one, and handing it to a prompt is
    // what would make reusing it the natural thing for the prompt to do (CNT-004).
    expect(markAt(state, 'hyperlink')).toEqual({
      href: 'https://example.test/report',
      title: 'The quarterly report',
    });
    expect(markAt(state, 'language')).toBeNull();
  });

  it('says a mark is carried only where the whole selection carries it', () => {
    const marked = run(stateWith('alpha beta'), 1, 6, toggleMarkCommand('emphasis', counter()));
    const over = (from: number, to: number) => markThroughout(select(marked, from, to), 'emphasis');
    expect(over(1, 6)).toBe(true);
    expect(over(2, 5)).toBe(true);
    // Half of this selection is unmarked, and pressing the button over it marks the rest rather
    // than clearing it, so saying it is already pressed would be a lie to a screen reader.
    expect(over(1, 11)).toBe(false);
    expect(over(7, 11)).toBe(false);
  });

  it('says a mark is carried at a cursor inside it', () => {
    const marked = run(stateWith('alpha beta'), 1, 6, toggleMarkCommand('emphasis', counter()));
    const at = (pos: number) => markThroughout(select(marked, pos), 'emphasis');
    expect(at(3)).toBe(true);
    expect(at(9)).toBe(false);
  });
});

describe('taking a mark off', () => {
  it('takes the mark off the selected text', () => {
    let state = run(stateWith('alpha beta'), 1, 11, toggleMarkCommand('emphasis', counter()));
    state = run(state, 1, 6, removeMarkCommand('emphasis', counter()));
    expect(textAndMarks(state)).toEqual([
      { text: 'alpha', marks: [] },
      { text: ' beta', marks: ['emphasis'] },
    ]);
  });

  it('gives the far piece its own identifier when the middle is taken off', () => {
    let state = run(stateWith('the report now'), 1, 15, toggleMarkCommand('emphasis', counter()));
    state = run(state, 5, 11, removeMarkCommand('emphasis', counter()));
    expect(textAndMarks(state)).toEqual([
      { text: 'the ', marks: ['emphasis'] },
      { text: 'report', marks: [] },
      { text: ' now', marks: ['emphasis'] },
    ]);
    expect(idsIn(state, 'emphasis')).toEqual(['id1', 'id2']);
  });

  it('takes the whole annotation off from a cursor inside it, and does nothing outside one', () => {
    const linked = run(
      stateWith('the report'),
      1,
      11,
      toggleMarkCommand('hyperlink', counter(), { href: 'https://example.test/report' }),
    );
    expect(removeMarkCommand('language', counter())(select(linked, 4), () => undefined)).toBe(
      false,
    );
    expect(textAndMarks(run(linked, 4, 4, removeMarkCommand('hyperlink', counter())))).toEqual([
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
