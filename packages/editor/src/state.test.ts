import { joinBackward, splitBlock } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { Slice, type Node } from 'prosemirror-model';
import { Selection, type EditorState, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { newBlockIdentifier } from './identity.js';
import { fromEditor, toEditor } from './mapping.js';
import { editorSchema } from './schema.js';
import { createEditorState, enterWithoutEmpties } from './state.js';

const counter = () => {
  let next = 0;
  return () => `n${(next += 1)}`;
};

function stateOf(paragraphs: readonly [string, string][], newIdentifier = counter()): EditorState {
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
  return createEditorState({ doc: opened.doc, newIdentifier });
}

const ids = (doc: Node) => {
  const found: unknown[] = [];
  doc.forEach((node) => found.push(node.attrs.id));
  return found;
};

const texts = (doc: Node) => {
  const found: string[] = [];
  doc.forEach((node) => found.push(node.textContent));
  return found;
};

/** Runs a command against a state and returns the state it leads to. */
function run(
  state: EditorState,
  command: (s: EditorState, d: (tr: Transaction) => void) => boolean,
) {
  let next = state;
  command(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
}

const at = (state: EditorState, pos: number) =>
  state.apply(state.tr.setSelection(Selection.near(state.doc.resolve(pos))));

describe('block identity in the editor', () => {
  it('gives the second half of a split paragraph a new identifier and the first keeps its own', () => {
    // "Unbox the printer." - the cursor after "Unbox" (position 1 opens the paragraph).
    const split = run(at(stateOf([['b1', 'Unbox the printer.']]), 6), splitBlock);
    expect(texts(split.doc)).toEqual(['Unbox', ' the printer.']);
    expect(ids(split.doc)).toEqual(['b1', 'n1']);
    expect(() => fromEditor(split.doc)).not.toThrow();
  });

  it('keeps the identifier of the paragraph already there when one carrying the same arrives before it', () => {
    const state = stateOf([
      ['b1', 'First'],
      ['b2', 'Second'],
    ]);
    // An incoming paragraph carrying b2's identifier, inserted exactly at b2's position.
    const incoming = editorSchema.node('paragraph', { id: 'b2', style: 'body' }, [
      editorSchema.text('Arrived'),
    ]);
    const next = state.apply(state.tr.insert(7, incoming));
    expect(texts(next.doc)).toEqual(['First', 'Arrived', 'Second']);
    expect(ids(next.doc)).toEqual(['b1', 'n1', 'b2']);
  });

  it('keeps the first identifier when two paragraphs are joined', () => {
    const state = stateOf([
      ['b1', 'Unbox'],
      ['b2', ' the printer.'],
    ]);
    const joined = run(at(state, 8), joinBackward);
    expect(texts(joined.doc)).toEqual(['Unbox the printer.']);
    expect(ids(joined.doc)).toEqual(['b1']);
  });

  it('draws again when a new identifier is one the component already holds', () => {
    const draws = ['b1', 'b1', 'fresh'];
    const split = run(
      at(
        stateOf([['b1', 'Unbox the printer.']], () => draws.shift()!),
        6,
      ),
      splitBlock,
    );
    expect(ids(split.doc)).toEqual(['b1', 'fresh']);
  });

  it('allocates 128 random bits, spelled in lower-case base32', () => {
    const drawn = new Set(Array.from({ length: 1000 }, newBlockIdentifier));
    expect(drawn.size).toBe(1000);
    for (const id of drawn) expect(id).toMatch(/^[a-z2-7]{26}$/);
  });
});

describe('what the editor always holds', () => {
  it('leaves one empty, identified paragraph when everything is deleted', () => {
    const state = stateOf([
      ['b1', 'Unbox'],
      ['b2', 'the printer.'],
    ]);
    const cleared = state.apply(state.tr.replace(0, state.doc.content.size, Slice.empty));
    expect(cleared.doc.childCount).toBe(1);
    expect(cleared.doc.firstChild?.textContent).toBe('');
    expect(fromEditor(cleared.doc).content).toEqual([
      { type: 'paragraph', id: expect.any(String), style: 'body', content: [] },
    ]);
  });

  it('makes no second paragraph when Enter is pressed in an empty one', () => {
    const state = stateOf([
      ['b1', 'Unbox'],
      ['b2', ''],
    ]);
    const next = run(at(state, 8), enterWithoutEmpties);
    expect(texts(next.doc)).toEqual(['Unbox', '']);
  });

  it('removes the second of two adjacent empty paragraphs, however they arose', () => {
    const state = stateOf([
      ['b1', ''],
      ['b2', 'Keep'],
      ['b3', ''],
    ]);
    // Deleting "Keep" and nothing else leaves three empty paragraphs side by side.
    const next = state.apply(state.tr.delete(3, 7));
    expect(texts(next.doc)).toEqual(['']);
    expect(() => fromEditor(next.doc)).not.toThrow();
  });

  it('undoes and redoes a split into documents the stored model accepts', () => {
    const split = run(at(stateOf([['b1', 'Unbox the printer.']]), 6), splitBlock);
    const undone = run(split, undo);
    expect(texts(undone.doc)).toEqual(['Unbox the printer.']);
    expect(ids(undone.doc)).toEqual(['b1']);
    const redone = run(undone, redo);
    expect(texts(redone.doc)).toEqual(['Unbox', ' the printer.']);
    expect(() => fromEditor(redone.doc)).not.toThrow();
  });

  it('holds a storable document after any sequence of typing, splitting, joining, deleting and undoing', () => {
    // A seeded generator, so a failure names a sequence that can be replayed.
    let seed = 20260916;
    const random = (below: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % below;
    };
    let state = stateOf([['b1', 'Unbox the printer.']]);
    for (let step = 0; step < 2000; step += 1) {
      const size = state.doc.content.size;
      const pos = 1 + random(Math.max(1, size - 1));
      const placed = at(state, Math.min(pos, size - 1));
      const operation = random(6);
      if (operation === 0) state = placed.apply(placed.tr.insertText('ab'));
      if (operation === 1) state = run(placed, splitBlock);
      if (operation === 2) state = run(placed, joinBackward);
      if (operation === 3) state = run(placed, enterWithoutEmpties);
      if (operation === 4) {
        const from = Math.min(pos, size - 1);
        const to = Math.min(size - 1, from + random(8));
        state = placed.apply(placed.tr.delete(from, to));
      }
      if (operation === 5) state = run(placed, undo);
      expect(() => fromEditor(state.doc), `step ${step}`).not.toThrow();
    }
  });
});
