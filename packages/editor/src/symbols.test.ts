import type { BlockNode, ContentDocument, InlineNode, Mark } from '@alloy-works/domain';
import { undo } from 'prosemirror-history';
import type { Node } from 'prosemirror-model';
import {
  EditorState,
  NodeSelection,
  TextSelection,
  type Command,
  type Transaction,
} from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { blockCommand } from './blocks.js';
import { fromEditor, toEditor } from './mapping.js';
import { commandKeymap, EDITOR_COMMANDS } from './marks.js';
import { createEditorState, footnotePluginsOf } from './state.js';
import { canInsertSymbol, insertSymbol } from './symbols.js';

const counter = () => {
  let next = 0;
  return () => `n${(next += 1)}`;
};
const text = (value: string, ...marks: Mark[]): InlineNode => ({ type: 'text', value, marks });
const paragraph = (id: string, ...content: InlineNode[]): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content,
});
const documentOf = (...content: BlockNode[]): ContentDocument => ({
  schemaVersion: 1,
  title: 'Site visits',
  language: 'en-GB',
  direction: 'ltr',
  content,
});
const NS = 'http://www.w3.org/1998/Math/MathML';
const squared: InlineNode = {
  type: 'equation',
  mathml: `<math xmlns="${NS}" alttext="x squared"><msup><mi>x</mi><mn>2</mn></msup></math>`,
  latex: 'x^2',
};

function stateOf(document: ContentDocument): EditorState {
  const opened = toEditor(document);
  if (!opened.editable) throw new Error(`not editable: ${opened.unsupported.join(', ')}`);
  return createEditorState({ doc: opened.doc, newIdentifier: counter() });
}

function startOf(doc: Node, id: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found === -1 && node.attrs.id === id) found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error(`no ${id}`);
  return found;
}

/** A selection from this many characters into the node starting at `start`, to that many. */
const within = (state: EditorState, start: number, from: number, to = from) =>
  state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, start + 1 + from, start + 1 + to)),
  );

/** Runs a command, counting what it dispatched. */
function run(state: EditorState, command: Command) {
  let next = state;
  let transactions = 0;
  const handled = command(state, (tr: Transaction) => {
    transactions += 1;
    next = next.apply(tr);
  });
  return { handled, next, transactions };
}

const stored = (state: EditorState) => fromEditor(state.doc).content;

const ALPHA = String.fromCodePoint(0x3b1);
const PLUS_MINUS = String.fromCodePoint(0xb1);

describe('inserting a symbol (W14.7)', () => {
  it('puts the character at the caret, in one transaction that one undo takes back', () => {
    const state = within(stateOf(documentOf(paragraph('p1', text('Angle  is small.')))), 0, 6);
    const { handled, next, transactions } = run(state, insertSymbol(ALPHA));
    expect(handled).toBe(true);
    expect(transactions).toBe(1);
    expect(stored(next)).toEqual([paragraph('p1', text(`Angle ${ALPHA} is small.`))]);
    // The caret stands after it, where typing it would have left it.
    expect(next.selection.from).toBe(state.selection.from + 1);
    const undone = run(next, undo).next;
    expect(stored(undone)).toEqual(stored(state));
  });

  it('replaces the text selected, as typing does, and takes the marks of the text it stands in', () => {
    const strong: Mark = { type: 'strong', id: 'm1' };
    const state = within(stateOf(documentOf(paragraph('p1', text('Error +- 2', strong)))), 0, 6, 8);
    const { next, transactions } = run(state, insertSymbol(PLUS_MINUS));
    expect(stored(next)).toEqual([paragraph('p1', text(`Error ${PLUS_MINUS} 2`, strong))]);
    // Over a range too, one transaction - not a delete and then an insert - so one undo puts the
    // text that was selected back.
    expect(transactions).toBe(1);
    expect(stored(run(next, undo).next)).toEqual(stored(state));
  });

  it('stands wherever text is typed: preformatted text, a caption and a footnote among them', () => {
    const state = stateOf(
      documentOf(
        { type: 'preformatted', id: 'pre1', text: 'x = 1' },
        {
          type: 'table',
          id: 't1',
          style: 'table',
          caption: [text('Readings')],
          headerRows: 0,
          headerColumns: 0,
          rows: [
            { cells: [{ content: [paragraph('c1', text('North'))], colspan: 1, rowspan: 1 }] },
          ],
        } as BlockNode,
        paragraph('p1', text('Visited'), {
          type: 'footnote',
          id: 'f1',
          anchor: { kind: 'span' },
          content: [paragraph('fp1', text('Once'))],
        } as InlineNode),
      ),
    );
    expect(canInsertSymbol(within(state, startOf(state.doc, 'pre1'), 2))).toBe(true);
    expect(canInsertSymbol(within(state, startOf(state.doc, 't1') + 1, 0))).toBe(true);
    expect(canInsertSymbol(within(state, startOf(state.doc, 'c1'), 0))).toBe(true);
    // A footnote's own text, as its nested editor holds it: its node is the document there.
    const node = state.doc.nodeAt(startOf(state.doc, 'f1'))!;
    const footnote = EditorState.create({
      doc: node,
      plugins: footnotePluginsOf(state)(() => 'en-GB'),
    });
    const inside = footnote.apply(footnote.tr.setSelection(TextSelection.create(footnote.doc, 1)));
    const { handled, next } = run(inside, insertSymbol(ALPHA));
    expect(handled).toBe(true);
    expect(next.doc.textContent).toBe(`${ALPHA}Once`);
  });

  it('does nothing over something selected whole, an equation among them', () => {
    const state = stateOf(documentOf(paragraph('p1', text('Where'), squared)));
    let at = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'equation') at = pos;
    });
    const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, at)));
    expect(canInsertSymbol(selected)).toBe(false);
    const { handled, transactions } = run(selected, insertSymbol(ALPHA));
    expect(handled).toBe(false);
    expect(transactions).toBe(0);
  });

  it('refuses anything but one visible character: no line break, format, private-use or lone surrogate', () => {
    const state = within(stateOf(documentOf(paragraph('p1', text('Where')))), 0, 0);
    for (const refused of [
      '',
      'ab',
      '\n',
      String.fromCodePoint(0x3b1, 0x3b2),
      // The line and paragraph separators, which break a line as surely as a newline does.
      String.fromCharCode(0x2028),
      String.fromCharCode(0x2029),
      // Half of a pair of UTF-16 units, which is no character at all.
      String.fromCharCode(0xd835),
      String.fromCharCode(0xdc9c),
      // A format character, invisible - a zero-width space, a right-to-left mark.
      String.fromCharCode(0x200b),
      String.fromCharCode(0x200f),
      // And private use, which means nothing outside the face that happens to draw it.
      String.fromCharCode(0xe000),
      String.fromCodePoint(0xf0000),
    ]) {
      expect(run(state, insertSymbol(refused)).handled, JSON.stringify(refused)).toBe(false);
    }
    // One character is one code point, however many UTF-16 units spell it.
    const script = String.fromCodePoint(0x1d49c);
    expect(run(state, insertSymbol(script)).handled).toBe(true);
  });
});

describe('Symbols in the registry (W14.7)', () => {
  it('is a registry command on Ctrl or Cmd, Shift and M, which asks the renderer', () => {
    expect(EDITOR_COMMANDS.find((command) => command.label === 'Symbols')).toEqual({
      kind: 'block',
      action: 'symbol',
      label: 'Symbols',
      shortcut: 'Mod-Shift-m',
      shortcutSaid: 'Ctrl or Cmd, Shift and M',
      prompts: true,
    });
    const state = stateOf(documentOf(paragraph('p1', text('Where'), squared)));
    const inText = within(state, startOf(state.doc, 'p1'), 1);
    let at = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'equation') at = pos;
    });
    const onEquation = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, at)));
    // As a block command it answers where a symbol could go, and places nothing: which symbol is a
    // value only the palette can ask for.
    const symbol = blockCommand('symbol', counter());
    expect(symbol(inText)).toBe(true);
    expect(symbol(onEquation)).toBe(false);
    expect(run(inText, symbol).next.doc.eq(inText.doc)).toBe(true);
    const asked: string[] = [];
    const listening = commandKeymap(counter(), (name) => {
      asked.push(name);
      return true;
    });
    expect(listening['Mod-Shift-m']!(inText, () => undefined)).toBe(true);
    expect(listening['Mod-Shift-m']!(onEquation, () => undefined)).toBe(false);
    expect(asked).toEqual(['symbol']);
  });
});
