import { splitBlock } from 'prosemirror-commands';
import { TextSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { beforeEach, describe, expect, it } from 'vitest';

import { fromEditor, toEditor } from './mapping.js';
import {
  applyMarkCommand,
  commandKeymap,
  EDITOR_COMMANDS,
  markAt,
  markThroughout,
  removeMarkCommand,
  somewhereToPutMark,
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

/**
 * Block identifiers come from their own sequence, so they never consume a mark's. The state is
 * built with it, so it is also what `annotationsInOnePiece` names a repaired piece from - one
 * source serves a block and a mark alike, here as in the application (`createEditorState`).
 */
const blockIds = () => {
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
  return createEditorState({ doc: opened.doc, newIdentifier: blockIds() });
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

/** What each paragraph says, in order. */
function paragraphTexts(state: EditorState): string[] {
  const found: string[] = [];
  state.doc.forEach((node) => found.push(node.textContent));
  return found;
}

/** What every run carrying that mark says, in document order, however the blocks fall. */
function markedText(state: EditorState, mark: string): string[] {
  const said: string[] = [];
  state.doc.descendants((node) => {
    if (node.isText && node.marks.some((carried) => carried.type.name === mark))
      said.push(node.text!);
  });
  return said;
}

/** The identifier each of those runs carries, one per run and never merged. */
function runIds(state: EditorState, mark: string): string[] {
  const found: string[] = [];
  state.doc.descendants((node) => {
    if (!node.isText) return;
    const carried = node.marks.find((one) => one.type.name === mark);
    if (carried !== undefined) found.push(carried.attrs.id as string);
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
  // Uncited on purpose. CNT-077 asks that every editing action is reachable from the keyboard
  // alone, and this body asserts strings and presses no key: it shows the registry is well formed,
  // which is a precondition and not the requirement. That holds for a block action exactly as it
  // holds for a mark - a row naming `bulletedList` with no shortcut is the same failure - so the
  // citation still lives where a key is pressed: `the keymap` below, which presses one of these
  // rows through the real chain, `EditorToolbar.test.tsx` for the toolbar's own row, and
  // `ComponentEditor.test.tsx` for F6 and Shift-F6 between the regions of the view.
  it('gives every command a shortcut and one label, with no shortcut used twice', () => {
    expect(EDITOR_COMMANDS).toHaveLength(19);
    for (const command of EDITOR_COMMANDS) {
      expect(command.label, command.label).toMatch(/^[A-Z][a-z ]+$/);
      // No fancy dashes in anything an author reads; a plain hyphen would be allowed. Written by
      // code point rather than as a character, so the rule cannot be broken by the rule's own test.
      const fancy = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
      expect(command.label + command.shortcutSaid).not.toMatch(fancy);
      if (command.kind === 'mark') expect(editorSchema.marks[command.mark]).toBeDefined();
    }
    expect(new Set(EDITOR_COMMANDS.map((c) => c.shortcut)).size).toBe(19);
  });

  it('names every block action once, in the order the toolbar shows them', () => {
    expect(EDITOR_COMMANDS.filter((c) => c.kind === 'block').map((c) => c.action)).toEqual([
      'bulletedList',
      'numberedList',
      'definitionList',
      'nestItem',
      'liftItem',
      'quotation',
      'preformatted',
      'table',
      'footnote',
      'reference',
    ]);
  });

  it('asks for a value only where the author must supply one: two marks, and a reference', () => {
    const prompting = EDITOR_COMMANDS.filter(
      (command) => command.kind === 'mark' && command.prompts,
    ).map((c) => (c.kind === 'mark' ? c.mark : c.action));
    expect(prompting).toEqual(['hyperlink', 'language']);
    // One block action prompts, for its target and form (cross-references 1, ruling R9). Nothing
    // about making a list is a value only the author can give; a list's start and its numbering are
    // set in the list panel, over a list that exists.
    expect(
      EDITOR_COMMANDS.filter((command) => command.kind === 'block' && command.prompts).map((c) =>
        c.kind === 'block' ? c.action : c.mark,
      ),
    ).toEqual(['reference']);
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

  it('CNT-004 keeps one identifier when an edit splits a marked run, across blocks as well', () => {
    // Marked in one gesture over a selection that crosses a paragraph break: two runs in two
    // blocks, and one annotation, because nothing but the break separates them.
    let state = run(stateWith('the report now'), 11, 11, splitBlock);
    state = run(state, 5, 17, toggleMarkCommand('emphasis', counter()));
    expect(paragraphTexts(state)).toEqual(['the report', ' now']);
    expect(markedText(state, 'emphasis')).toEqual(['report', ' now']);
    expect(runIds(state, 'emphasis')).toEqual(['id1', 'id1']);
    // And pressing Enter inside it splits the run again without splitting the annotation.
    state = run(state, 6, 6, splitBlock);
    expect(paragraphTexts(state)).toEqual(['the r', 'eport', ' now']);
    expect(markedText(state, 'emphasis')).toEqual(['r', 'eport', ' now']);
    expect(idsIn(state, 'emphasis')).toEqual(['id1']);
  });

  it('keeps one identifier where a second mark breaks a marked run into three', () => {
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
    // The far piece is one annotation of its own, over both of the runs it spans, and it is named
    // from the state's own source rather than the command's: the repair is a plugin that runs after
    // every transaction, and no command tells it what was pressed.
    expect(idsIn(state, 'emphasis')).toEqual(['id1', 'b1']);
  });

  it('leaves an annotation in another block alone', () => {
    let state = run(stateWith('alpha beta gamma'), 6, 6, splitBlock);
    state = run(state, 8, 19, toggleMarkCommand('emphasis', counter()));
    // An annotation in one piece, in a paragraph this gesture never reaches, comes out under the
    // identifier it went in with: that identifier is what accepting or rejecting the annotation
    // acts on (CNT-005), so renaming one nothing split would change somebody else's decision.
    state = run(state, 1, 6, toggleMarkCommand('emphasis', counter()));
    expect(markedText(state, 'emphasis')).toEqual(['alpha', 'beta gamma']);
    expect(runIds(state, 'emphasis')).toEqual(['id2', 'id1']);
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
    // `id2` is the new target's own annotation; the piece beyond it is named by the plugin, from
    // the state's identifier source.
    expect(idsIn(state, 'hyperlink')).toEqual(['id1', 'id2', 'b1']);
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

describe('whether there is anywhere to put a mark', () => {
  /** `alpha` linked, ` beta` not. */
  const linked = () =>
    run(
      stateWith('alpha beta'),
      1,
      6,
      toggleMarkCommand('hyperlink', counter(), { href: 'https://example.test/alpha' }),
    );

  it('answers for a selection, for a cursor inside an annotation, and for neither', () => {
    const state = linked();
    // Something selected is somewhere to put one, marked or not.
    expect(somewhereToPutMark(select(state, 7, 11), 'hyperlink')).toBe(true);
    // A cursor inside a link: the whole of that link is where a new target would go.
    expect(somewhereToPutMark(select(state, 3), 'hyperlink')).toBe(true);
    // A cursor in text carrying no link: there is nothing to put a target on.
    expect(somewhereToPutMark(select(state, 8), 'hyperlink')).toBe(false);
    // A cursor inside a link is nowhere to put a language, which is a different annotation.
    expect(somewhereToPutMark(select(state, 3), 'language')).toBe(false);
    // A mark this editor has no counterpart for is nowhere at all.
    expect(somewhereToPutMark(select(state, 7, 11), 'footnote')).toBe(false);
  });

  it('answers exactly as the command it is asked on behalf of would', () => {
    // One copy of the range rule, not two. A toolbar that asked a rule of its own would open a
    // dialog for a press the command then dropped, or refuse to open one for a press it would have
    // honoured - and the second of those is silence, which is what this slice keeps closing.
    const state = linked();
    const target = { href: 'https://example.test/beta' };
    for (const at of [
      [1, 6],
      [7, 11],
      [3, 3],
      [8, 8],
      [11, 11],
    ] as const) {
      const selected = select(state, at[0], at[1]);
      expect([at, somewhereToPutMark(selected, 'hyperlink')]).toEqual([
        at,
        applyMarkCommand('hyperlink', counter(), target)(selected),
      ]);
    }
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

  it('gives the far piece its own identifier when the middle is taken off', () => {
    let state = run(stateWith('the report now'), 1, 15, toggleMarkCommand('emphasis', counter()));
    state = run(state, 5, 11, removeMarkCommand('emphasis'));
    expect(textAndMarks(state)).toEqual([
      { text: 'the ', marks: ['emphasis'] },
      { text: 'report', marks: [] },
      { text: ' now', marks: ['emphasis'] },
    ]);
    expect(idsIn(state, 'emphasis')).toEqual(['id1', 'b1']);
  });

  it('gives the far piece one identifier of its own where it spans a block boundary', () => {
    let state = run(stateWith('the report now'), 1, 15, toggleMarkCommand('emphasis', counter()));
    state = run(state, 11, 11, splitBlock);
    // The annotation now runs legitimately across two paragraphs. Taking a word out of it in the
    // first leaves the rest one piece, not one piece per block: what is left in the paragraph
    // below was never selected, and giving it a name of its own would be a second annotation
    // where the author made one.
    state = run(state, 5, 11, removeMarkCommand('emphasis'));
    expect(paragraphTexts(state)).toEqual(['the report', ' now']);
    expect(markedText(state, 'emphasis')).toEqual(['the ', ' now']);
    // `b1` is the identifier the paragraph already there holds, so the split's second half took
    // `b2`, and the repair draws `b3`.
    expect(runIds(state, 'emphasis')).toEqual(['id1', 'b3']);
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

/**
 * A chord, driven through **the real keymap chain** - every `handleKeyDown` the state's own plugins
 * carry, in the order `createEditorState` put them in, which is the order `EditorView` consults.
 *
 * `prosemirror-keymap` normalises `Mod-` to `Meta-` on macOS and `Ctrl-` everywhere else, from
 * `navigator.platform`, so a fabricated event has to carry the modifier it normalised to. It also
 * finds a shifted binding by **key code** rather than by name: a browser reports `Shift` and the `8`
 * key as `*`, and `Mod-Shift-8` is reached only because `56` says which key that was. So the event
 * carries what a browser would really report, not the name the registry spells.
 */
function pressChord(state: EditorState, key: string, keyCode: number, shift = false) {
  const platform = (globalThis as { navigator?: { platform?: string } }).navigator?.platform ?? '';
  const mac = /Mac|iP(hone|[oa]d)/.test(platform);
  const event = { key, keyCode, ctrlKey: !mac, metaKey: mac, altKey: false, shiftKey: shift };
  let next = state;
  const view = {
    get state() {
      return next;
    },
    dispatch: (tr: Transaction) => {
      next = next.apply(tr);
    },
  };
  for (const plugin of state.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (handler === undefined) continue;
    if (handler.call(plugin, view as unknown as EditorView, event as never)) {
      return { handled: true, next };
    }
  }
  return { handled: false, next };
}

/** Just inside the nth paragraph of the document, wherever the nesting has put it. */
function inParagraph(state: EditorState, nth: number): number {
  const found: number[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === 'paragraph') found.push(pos + 1);
  });
  return found[nth]!;
}

describe('the keymap', () => {
  it('CNT-077 binds every command in the registry, and makes and nests a list from the keyboard alone', () => {
    const bound = commandKeymap(counter());
    expect(Object.keys(bound)).toHaveLength(19);
    for (const command of EDITOR_COMMANDS) {
      expect(Object.keys(bound), command.label).toContain(command.shortcut);
    }

    // Reachable is not the whole of it. Two paragraphs, selected across, become a bulleted list on
    // `Mod-Shift-8`; the second item nests under the first on `Mod-]` and comes back out on
    // `Mod-[`. Nothing here touches a toolbar, and every answer is taken from what the store would
    // be sent. The three block shortcuts were declared by the registry and bound by nobody until
    // this keymap read them, which is the whole reason `EDITOR_COMMANDS` is one list.
    const two = run(stateWith('alpha beta'), 6, 6, splitBlock);
    const made = pressChord(select(two, 2, 9), '*', 56, true);
    expect(made.handled).toBe(true);
    expect(fromEditor(made.next.doc).content[0]).toMatchObject({
      type: 'list',
      kind: 'unordered',
      items: [{ content: [{ type: 'paragraph' }] }, { content: [{ type: 'paragraph' }] }],
    });

    const nested = pressChord(select(made.next, inParagraph(made.next, 1)), ']', 221);
    expect(nested.handled).toBe(true);
    expect(fromEditor(nested.next.doc).content[0]).toMatchObject({
      type: 'list',
      items: [{ content: [{ type: 'paragraph' }, { type: 'list', kind: 'unordered' }] }],
    });

    const lifted = pressChord(select(nested.next, inParagraph(nested.next, 1)), '[', 219);
    expect(lifted.handled).toBe(true);
    expect(fromEditor(lifted.next.doc).content[0]).toMatchObject({
      type: 'list',
      items: [{ content: [{ type: 'paragraph' }] }, { content: [{ type: 'paragraph' }] }],
    });
  });

  it('hands a shortcut that prompts to the renderer, and does nothing when none is listening', () => {
    const asked: string[] = [];
    const listening = commandKeymap(counter(), (mark) => {
      asked.push(mark);
      return true;
    });
    const state = stateWith('alpha');
    expect(listening['Mod-k']!(state, () => undefined)).toBe(true);
    expect(listening['Mod-Shift-l']!(state, () => undefined)).toBe(true);
    expect(asked).toEqual(['hyperlink', 'language']);
    expect(commandKeymap(counter())['Mod-k']!(state, () => undefined)).toBe(false);
  });

  it('applies a mark from the keyboard alone, through the state the view is built with', () => {
    const { handled, next } = pressChord(select(stateWith('alpha'), 1, 6), 'b', 66);
    expect(handled).toBe(true);
    expect(textAndMarks(next)).toEqual([{ text: 'alpha', marks: ['strong'] }]);
    expect(idsIn(next, 'strong')).toEqual(['b1']);
  });
});
