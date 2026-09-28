import { splitBlock } from 'prosemirror-commands';
import { redo, redoDepth, undo, undoDepth } from 'prosemirror-history';
import type { Node } from 'prosemirror-model';
import { Selection, type EditorState, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { setTitle } from './header.js';
import { toEditor } from './mapping.js';
import { recordChange, replayChanges, type RecordedChange } from './replay.js';
import { createEditorState } from './state.js';

const counter = (prefix = 'n') => {
  let next = 0;
  return () => `${prefix}${(next += 1)}`;
};

/** Nothing may be drawn: a replay puts back the identifiers the session drew, and draws none. */
const drawsNothing = () => {
  throw new Error('A replay drew an identifier');
};

function docOf(paragraphs: readonly [string, string][]): Node {
  const opened = toEditor({
    schemaVersion: 1,
    title: 'Install the printer',
    language: 'en-GB',
    direction: 'ltr',
    content: paragraphs.map(([id, text]) => ({
      type: 'paragraph',
      id,
      style: 'body',
      content: text === '' ? [] : [{ type: 'text', value: text, marks: [] }],
    })),
  });
  if (!opened.editable) throw new Error('expected an editable document');
  return opened.doc;
}

const texts = (doc: Node) => {
  const found: string[] = [];
  doc.forEach((node) => found.push(node.textContent));
  return found;
};

const ids = (doc: Node) => {
  const found: unknown[] = [];
  doc.forEach((node) => found.push(node.attrs.id));
  return found;
};

/**
 * A surface as the component editor runs one: every transaction applied with whatever the plugins
 * append to it, and each change recorded - through JSON, as session storage holds it.
 */
function surface(doc: Node, newIdentifier = counter()) {
  let state = createEditorState({ doc, newIdentifier });
  const records: RecordedChange[] = [];
  const apply = (tr: Transaction) => {
    const before = state;
    const { state: after, transactions } = state.applyTransaction(tr);
    state = after;
    const recorded = recordChange(before, transactions, after);
    if (recorded !== null) records.push(JSON.parse(JSON.stringify(recorded)) as RecordedChange);
  };
  const run = (command: (s: EditorState, d: (tr: Transaction) => void) => boolean) =>
    command(state, apply);
  return {
    get state() {
      return state;
    },
    records,
    apply,
    run,
    /** Types at `pos`, at `time`: a second between two changes makes them two events. */
    type: (text: string, pos: number, time: number) =>
      apply(state.tr.insertText(text, pos).setTime(time)),
    caret: (pos: number) => apply(state.tr.setSelection(Selection.near(state.doc.resolve(pos)))),
  };
}

/** Replays onto the document the session opened from, in a state of its own, as a reload does. */
const replayed = (doc: Node, records: readonly RecordedChange[]) =>
  replayChanges(createEditorState({ doc, newIdentifier: drawsNothing }), records);

/** Undoes until nothing is left, answering each document on the way. */
function undoAll(state: EditorState): string[][] {
  const seen: string[][] = [];
  let now = state;
  while (undo(now, (tr) => (now = now.apply(tr)))) seen.push(texts(now.doc));
  return seen;
}

describe('replaying a session after a reload (component-editor.md, "Undo across a reload")', () => {
  it('rebuilds the document and a history of as many undo events, each undoing what it did', () => {
    const opened = docOf([['b1', 'Unbox the printer.']]);
    const live = surface(opened);
    live.type(' Mind', 19, 1_000);
    live.type(' the', 24, 1_100);
    live.type(' cable.', 28, 3_000);
    live.type('Then', 1, 5_000);
    expect(undoDepth(live.state)).toBe(3);

    const again = replayed(opened, live.records);
    expect(again.doc.eq(live.state.doc)).toBe(true);
    expect(undoDepth(again)).toBe(3);
    expect(undoAll(again)).toEqual(undoAll(live.state));
    expect(undoAll(again).at(-1)).toEqual(['Unbox the printer.']);
  });

  it('keeps the grouping it was recorded with, whatever time the replay runs at', () => {
    const opened = docOf([['b1', 'Unbox the printer.']]);
    const live = surface(opened);
    // Two changes far apart in the text but within the history's delay: two events, since they are
    // not adjacent. Then two adjacent a long while apart: two more.
    live.type('Now ', 1, 1_000);
    live.type(' Go.', 23, 1_050);
    live.type(' On.', 27, 9_000);
    live.type(' Up.', 31, 20_000);
    expect(undoDepth(live.state)).toBe(4);
    const again = replayed(opened, live.records);
    expect(undoDepth(again)).toBe(4);
    expect(undoAll(again)).toEqual(undoAll(live.state));
  });

  it("keeps an input method's composition one event, though its changes are not side by side", () => {
    const opened = docOf([['b1', 'Unbox the printer.']]);
    const live = surface(opened);
    live.type(' Mind', 19, 1_000);
    // What prosemirror-view marks every transaction of one composition with.
    live.apply(live.state.tr.insertText('Now ', 1).setTime(1_010).setMeta('composition', 7));
    live.apply(live.state.tr.insertText(' Go.', 28).setTime(1_020).setMeta('composition', 7));
    expect(undoDepth(live.state)).toBe(2);
    const again = replayed(opened, live.records);
    expect(undoDepth(again)).toBe(2);
    expect(undoAll(again)).toEqual(undoAll(live.state));
  });

  it('puts back the identifiers the session drew, drawing none of its own', () => {
    const opened = docOf([['b1', 'Unbox the printer.']]);
    const live = surface(opened);
    live.caret(6);
    live.run(splitBlock);
    live.caret(live.state.doc.content.size - 1);
    live.run(splitBlock);
    live.type('Plug it in.', live.state.doc.content.size - 1, 4_000);
    expect(ids(live.state.doc)).toEqual(['b1', 'n1', 'n2']);

    const again = replayed(opened, live.records);
    expect(ids(again.doc)).toEqual(['b1', 'n1', 'n2']);
    expect(again.doc.eq(live.state.doc)).toBe(true);
    expect(undoAll(again)).toEqual(undoAll(live.state));
  });

  it('replays an undo and a redo, so undo and redo both reach as far as they did', () => {
    const opened = docOf([['b1', 'Unbox the printer.']]);
    const live = surface(opened);
    live.type(' Mind the cable.', 19, 1_000);
    live.type(' Keep the box.', 35, 3_000);
    live.type(' Then wait.', 49, 5_000);
    live.run(undo);
    live.run(undo);
    live.run(redo);
    expect(texts(live.state.doc)).toEqual(['Unbox the printer. Mind the cable. Keep the box.']);

    const again = replayed(opened, live.records);
    expect(again.doc.eq(live.state.doc)).toBe(true);
    expect(undoDepth(again)).toBe(undoDepth(live.state));
    expect(redoDepth(again)).toBe(1);
    let redone = again;
    redo(again, (tr) => (redone = again.apply(tr)));
    expect(texts(redone.doc)).toEqual([
      'Unbox the printer. Mind the cable. Keep the box. Then wait.',
    ]);
    expect(undoAll(again)).toEqual(undoAll(live.state));
  });

  it('replays a change to the title, which undo takes back as it did', () => {
    const opened = docOf([['b1', 'Unbox the printer.']]);
    const live = surface(opened);
    live.run(setTitle('Install the scanner'));
    live.type(' Mind the cable.', 19, 4_000);
    const again = replayed(opened, live.records);
    expect(again.doc.attrs.title).toBe('Install the scanner');
    let now = again;
    undo(now, (tr) => (now = now.apply(tr)));
    undo(now, (tr) => (now = now.apply(tr)));
    expect(now.doc.attrs.title).toBe('Install the printer');
    expect(now.doc.eq(opened)).toBe(true);
  });

  it('leaves the history closed, so the next change after a reload is an event of its own', () => {
    const opened = docOf([['b1', 'Unbox the printer.']]);
    const live = surface(opened);
    live.type(' Mind', 19, Date.now());
    const again = replayed(opened, live.records);
    const next = again.apply(again.tr.insertText(' the', 24));
    expect(undoDepth(next)).toBe(2);
  });

  it('records nothing for a change that moved only the selection', () => {
    const state = createEditorState({ doc: docOf([['b1', 'Unbox']]), newIdentifier: counter() });
    const { state: after, transactions } = state.applyTransaction(
      state.tr.setSelection(Selection.atEnd(state.doc)),
    );
    expect(recordChange(state, transactions, after)).toBeNull();
  });

  it('refuses a record that does not replay onto the document it is given', () => {
    const live = surface(docOf([['b1', 'Unbox the printer.']]));
    live.type(' Mind the cable.', 19, 1_000);
    expect(() => replayed(docOf([['b1', 'Unbox']]), live.records)).toThrow();
  });

  it('refuses a record whose grouping the replay does not reproduce', () => {
    const opened = docOf([['b1', 'Unbox the printer.']]);
    const live = surface(opened);
    live.type(' Mind', 19, 1_000);
    live.type(' the', 24, 1_100);
    const [first, second] = live.records;
    expect(second?.history).toBe('join');
    expect(() => replayed(opened, [first!, { ...second!, history: 'undo' }])).toThrow();
  });
});
