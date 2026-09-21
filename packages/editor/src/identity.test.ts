import type { Node } from 'prosemirror-model';
import { sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { Selection, type EditorState, type Transaction } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';

import { editorSchema } from './schema.js';
import { createEditorState, enterWithoutEmpties } from './state.js';

const counter = () => {
  let next = 0;
  return () => `n${(next += 1)}`;
};

const paragraph = (id: string | null, text: string) =>
  editorSchema.node(
    'paragraph',
    { id, style: 'body' },
    text === '' ? [] : [editorSchema.text(text)],
  );

const item = (...blocks: Node[]) => editorSchema.node('listItem', null, blocks);

const list = (id: string, ...items: Node[]) => editorSchema.node('list', { id }, items);

const definitionItem = (term: string, ...blocks: Node[]) =>
  editorSchema.node('definitionItem', null, [
    editorSchema.node('term', null, term === '' ? [] : [editorSchema.text(term)]),
    ...blocks,
  ]);

const definitionList = (id: string, ...items: Node[]) =>
  editorSchema.node('definitionList', { id }, items);

const documentOf = (...blocks: Node[]) =>
  editorSchema.node(
    'doc',
    { title: 'Install the printer', language: 'en-GB', direction: 'ltr' },
    blocks,
  );

const stateOf = (doc: Node, newIdentifier: () => string = counter()) =>
  createEditorState({ doc, newIdentifier });

/**
 * Every node the schema gives an `id` attribute, in document order, with the identifier it carries.
 * An item and a term are absent by construction rather than by being filtered out here, which is
 * the same test the plugin itself applies.
 */
const identifiersIn = (doc: Node): unknown[] => {
  const found: unknown[] = [];
  doc.descendants((node) => {
    if (node.type.spec.attrs?.id !== undefined) found.push(node.attrs.id);
  });
  return found;
};

/** Every paragraph's text and the identifier it carries, in document order. */
const paragraphsIn = (doc: Node): [string, unknown][] => {
  const found: [string, unknown][] = [];
  doc.descendants((node) => {
    if (node.type.name === 'paragraph') found.push([node.textContent, node.attrs.id]);
  });
  return found;
};

/** The `index`th node of that type, in document order. */
const nodeOfType = (doc: Node, type: string, index = 0): Node => {
  const found: Node[] = [];
  doc.descendants((node) => {
    if (node.type.name === type) found.push(node);
  });
  const node = found[index];
  if (node === undefined)
    throw new Error(`no ${type} at ${index}: the document holds ${found.length}`);
  return node;
};

/**
 * The position just after the given text, wherever it stands. Positions at depth are tedious to
 * count and a miscounted one fails as a wrong answer rather than as a broken fixture, so every
 * cursor in this file is placed by the text it stands after.
 */
const after = (doc: Node, text: string): number => {
  let found = -1;
  doc.descendants((node, pos) => {
    if (node.isText && node.text === text) found = pos + node.nodeSize;
  });
  if (found === -1) throw new Error(`no text node reading ${JSON.stringify(text)}`);
  return found;
};

/** The position after the first `count` characters of the given text. */
const within = (doc: Node, text: string, count: number) => after(doc, text) - (text.length - count);

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

const splitItem = splitListItem(editorSchema.nodes.listItem!);
const sinkItem = sinkListItem(editorSchema.nodes.listItem!);
const sinkDefinition = sinkListItem(editorSchema.nodes.definitionItem!);

/**
 * ADR-0023's rule reaches every block, not the top level. A list item holds blocks, so ordinary
 * gestures - splitting an item, sinking one, pressing Enter inside a nested item - make blocks the
 * plugin never used to see, and a block with no identifier is what `fromEditor` throws on: a 500 out
 * of the save path rather than anything an author can read.
 *
 * The documents here are built from `editorSchema` directly rather than through `toEditor`, which
 * still refuses a stored list by name until the mapping carries one.
 */
describe('block identity at depth', () => {
  it('gives a block made inside a list item an identifier of its own', () => {
    const state = stateOf(documentOf(list('L1', item(paragraph('b1', 'alpha')))));
    const next = run(at(state, after(state.doc, 'alpha')), splitItem);
    const ids = identifiersIn(next.doc);
    // The list and one paragraph in each of the two items the split left.
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });

  it('gives a list made by sinking an item an identifier of its own', () => {
    const state = stateOf(
      documentOf(list('L1', item(paragraph('b1', 'alpha')), item(paragraph('b2', 'beta')))),
    );
    const next = run(at(state, after(state.doc, 'beta')), sinkItem);
    // The sink makes a `list` node the author never typed, from the schema's defaults.
    expect(nodeOfType(next.doc, 'list', 1).attrs.id).toEqual(expect.any(String));
  });

  it('gives a block made at the end of a nested item an identifier of its own', () => {
    const state = stateOf(
      documentOf(list('L1', item(paragraph('b1', 'alpha')), item(paragraph('b2', 'beta')))),
    );
    const sunk = run(at(state, after(state.doc, 'beta')), sinkItem);
    const next = run(at(sunk, after(sunk.doc, 'beta')), enterWithoutEmpties);
    expect(paragraphsIn(next.doc)).toEqual([
      ['alpha', 'b1'],
      ['beta', 'b2'],
      ['', expect.any(String)],
    ]);
  });

  it('gives a definition list made by sinking a definition item one too', () => {
    const state = stateOf(
      documentOf(
        definitionList(
          'D1',
          definitionItem('Ada', paragraph('b1', 'alpha')),
          definitionItem('Grace', paragraph('b2', 'beta')),
        ),
      ),
    );
    const next = run(at(state, after(state.doc, 'beta')), sinkDefinition);
    expect(nodeOfType(next.doc, 'definitionList', 1).attrs.id).toEqual(expect.any(String));
  });

  it('names both of two blocks made at depth in one transaction, each at its own position', () => {
    const state = stateOf(
      documentOf(list('L1', item(paragraph('b1', 'alpha')), item(paragraph('b2', 'beta')))),
    );
    // One transaction, two insertions, written back to front so the second position is still the
    // position it was read at. `tr.setNodeAttribute` produces an `AttrStep`, which maps every
    // position to itself, so one pass over positions read from the new document stays right for
    // both renewals - and the text under each identifier is what says a position was not read late.
    const tr = state.tr;
    tr.insert(after(state.doc, 'beta') + 1, paragraph(null, 'delta'));
    tr.insert(after(state.doc, 'alpha') + 1, paragraph(null, 'gamma'));
    const next = state.apply(tr);
    expect(paragraphsIn(next.doc)).toEqual([
      ['alpha', 'b1'],
      ['gamma', 'n1'],
      ['beta', 'b2'],
      ['delta', 'n2'],
    ]);
  });

  it('leaves an item and a term unnamed, because the stored model gives neither an identifier', () => {
    const state = stateOf(
      documentOf(
        list('L1', item(paragraph('b1', 'alpha'))),
        definitionList('D1', definitionItem('Ada', paragraph('b2', 'beta'))),
      ),
    );
    const next = state.apply(state.tr.insertText('X', after(state.doc, 'alpha')));
    expect(nodeOfType(next.doc, 'listItem').attrs).toEqual({});
    expect(nodeOfType(next.doc, 'definitionItem').attrs).toEqual({});
    expect(nodeOfType(next.doc, 'term').attrs).toEqual({});
    // The walk descended through all three and named none of them: nothing new was allocated.
    expect(identifiersIn(next.doc)).toEqual(['L1', 'b1', 'D1', 'b2']);
  });

  it('keeps the descent rule: the block at its identifier mapped forward keeps it', () => {
    const state = stateOf(documentOf(list('L1', item(paragraph('b1', 'Unbox the printer.')))));
    const next = run(at(state, within(state.doc, 'Unbox the printer.', 5)), splitItem);
    // The first half descends from the block that held the identifier and keeps it. Not the reverse.
    expect(paragraphsIn(next.doc)).toEqual([
      ['Unbox', 'b1'],
      [' the printer.', 'n1'],
    ]);
  });

  it('draws again rather than allocating an identifier the component already carries', () => {
    const draws = ['b1', 'b1', 'fresh'];
    const state = stateOf(documentOf(list('L1', item(paragraph('b1', 'alpha')))), () =>
      draws.shift()!,
    );
    const next = run(at(state, after(state.doc, 'alpha')), splitItem);
    expect(paragraphsIn(next.doc)).toEqual([
      ['alpha', 'b1'],
      ['', 'fresh'],
    ]);
  });

  /**
   * One citation for CNT-002, on the one body that shows all three of its clauses at depth:
   * allocated when the block is created (a split, a sink and an Enter inside the item the sink
   * made), unique within the component (no identifier appears twice), and never reused (an
   * identifier the component already carries is refused and drawn again). The other tests above
   * show one clause each and are deliberately uncited.
   */
  it('CNT-002 allocates a unique identifier for every block made at depth, never one already taken', () => {
    const draws = ['b1', 'n1', 'n2', 'n3'];
    const drawn: string[] = [];
    const newIdentifier = () => {
      const id = draws.shift()!;
      drawn.push(id);
      return id;
    };
    let state = stateOf(
      documentOf(list('L1', item(paragraph('b1', 'alpha')), item(paragraph('b2', 'beta')))),
      newIdentifier,
    );
    // A block made by splitting an item...
    state = run(at(state, after(state.doc, 'alpha')), splitItem);
    // ...a list made by sinking one, which the author never typed...
    state = run(at(state, after(state.doc, 'beta')), sinkItem);
    // ...and a block made by Enter inside the nested item that sink made.
    state = run(at(state, after(state.doc, 'beta')), enterWithoutEmpties);

    const ids = identifiersIn(state.doc);
    expect(ids).toEqual(['L1', 'b1', 'n1', 'n2', 'b2', 'n3']);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // `b1` was offered first and refused, because the component carries it already.
    expect(drawn).toEqual(['b1', 'n1', 'n2', 'n3']);
  });
});
