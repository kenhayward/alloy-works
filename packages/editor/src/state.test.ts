import { parseContentDocument } from '@alloy-works/domain';
import { joinBackward, splitBlock } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { Schema, Slice, type Node } from 'prosemirror-model';
import { EditorState, Selection, TextSelection, type Transaction } from 'prosemirror-state';
import { DecorationSet, type Decoration } from 'prosemirror-view';
import { describe, expect, it } from 'vitest';

import { setLanguage } from './header.js';
import { newBlockIdentifier } from './identity.js';
import { fromEditor, toEditor } from './mapping.js';
import { removeMarkCommand, toggleMarkCommand } from './marks.js';
import { editorSchema } from './schema.js';
import {
  createEditorState,
  enterWithoutEmpties,
  noAdjacentEmptyParagraphs,
  spellcheckDecorations,
} from './state.js';

/**
 * A minute, as blocks.test.ts's seeded run and structure's randomised tests have (issue #140): the two
 * sequence runs below took under four seconds on CI for weeks, and one took 5.26 on a busy runner and
 * failed the build on Vitest's five-second default without failing a single assertion (issue #210).
 */
const RANDOMISED_TEST_TIMEOUT_MS = 60_000;

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

describe('the state a fresh history starts from', () => {
  it('carries the given selection over, rather than always starting at the beginning (fix round 1, minor)', () => {
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
          content: [{ type: 'text', value: 'Unbox the printer.', marks: [] }],
        },
      ],
    });
    if (!opened.editable) throw new Error('expected an editable document');
    const selection = Selection.near(opened.doc.resolve(6));
    const state = createEditorState({ doc: opened.doc, newIdentifier: counter(), selection });
    expect(state.selection.from).toBe(selection.from);
  });

  it("starts at the document's own default selection when none is given", () => {
    const state = stateOf([['b1', 'Unbox the printer.']]);
    expect(state.selection.from).toBe(Selection.atStart(state.doc).from);
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

  /**
   * Two thousand edits from one seed, each one followed by a save, so a document the store would
   * refuse is caught at the step that made it rather than by an author weeks later.
   */
  const storableAfterAnySequence = (start: EditorState, firstSeed: number) => {
    // A seeded generator, so a failure names a sequence that can be replayed.
    //
    // **The high bits, not the low ones.** This generator's low bit alternates deterministically,
    // each step draws exactly twice, and 6 is even - so a plain `seed % 6` returned one parity for
    // every step of a run, and `insertText` and `joinBackward` never ran at all. The test's own
    // title names typing and joining; for two thousand steps it did neither. Shifting first spreads
    // the six roughly evenly, and the shift is what makes the title true.
    let seed = firstSeed;
    const random = (below: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 13) % below;
    };
    let state = start;
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
        const deleteFrom = Math.min(pos, size - 1);
        const to = Math.min(size - 1, deleteFrom + random(8));
        state = placed.apply(placed.tr.delete(deleteFrom, to));
      }
      if (operation === 5) state = run(placed, undo);
      expect(() => fromEditor(state.doc), `step ${step}`).not.toThrow();
    }
  };

  it(
    'holds a storable document after any sequence of typing, splitting, joining, deleting and undoing',
    () => {
      storableAfterAnySequence(stateOf([['b1', 'Unbox the printer.']]), 20260916);
    },
    RANDOMISED_TEST_TIMEOUT_MS,
  );

  it(
    'holds one after any such sequence inside a list and a definition list too',
    () => {
      // The sequence above never leaves the top level, where every position is a paragraph's. Seeded
      // with a document that nests, the same two thousand edits land inside list items, inside a
      // definition item's body and inside its term - which is where identity, adjacency and the
      // mapping all had to learn to descend, and where a position they disagree about first shows up.
      const opened = toEditor({
        schemaVersion: 1,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        content: [
          { type: 'paragraph', id: 'b1', style: 'body', content: [] },
          {
            type: 'list',
            id: 'L1',
            kind: 'unordered',
            items: [
              { content: [{ type: 'paragraph', id: 'b2', style: 'body', content: [] }] },
              {
                content: [
                  { type: 'paragraph', id: 'b3', style: 'body', content: [] },
                  {
                    type: 'list',
                    id: 'L2',
                    kind: 'ordered',
                    items: [
                      { content: [{ type: 'paragraph', id: 'b4', style: 'body', content: [] }] },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'list',
            id: 'D1',
            kind: 'definition',
            items: [
              {
                term: [{ type: 'text', value: 'Tensile strength', marks: [] }],
                content: [{ type: 'paragraph', id: 'b5', style: 'body', content: [] }],
              },
            ],
          },
        ],
      });
      if (!opened.editable) throw new Error('expected an editable document');
      storableAfterAnySequence(
        createEditorState({ doc: opened.doc, newIdentifier: counter() }),
        20260921,
      );
    },
    RANDOMISED_TEST_TIMEOUT_MS,
  );
});

/**
 * The stored model holds CNT-023 in **every** sequence of blocks it has - the top level, a list
 * item, a blockquote, a table cell and a footnote - so the editor holds it wherever it can make a
 * pair, and a rule the two write paths disagree on is a rule one of them breaks.
 *
 * Three of those homes are reachable from this schema today: the top level, a list item, and a
 * definition item's body beneath its term. A blockquote, a table cell and a footnote arrive with the
 * families that make them editable, and the walk meets them without being told, because it asks the
 * schema which nodes are blocks rather than naming the nodes that hold them.
 */
describe('two adjacent empty paragraphs, at any depth', () => {
  const emptyParagraph = () => editorSchema.node('paragraph', { id: null, style: 'body' });

  const textParagraph = (text: string) =>
    editorSchema.node('paragraph', { id: null, style: 'body' }, [editorSchema.text(text)]);

  const listOf = (...blocks: Node[]) =>
    editorSchema.node('list', { kind: 'unordered' }, [editorSchema.node('listItem', null, blocks)]);

  /** One definition list of one item: the term it defines, then the blocks that define it. */
  const definitionOf = (term: string, blocks: readonly Node[]) =>
    editorSchema.node('definitionList', null, [
      editorSchema.node('definitionItem', null, [
        editorSchema.node('term', null, term === '' ? [] : [editorSchema.text(term)]),
        ...blocks,
      ]),
    ]);

  const componentOf = (blocks: readonly Node[]) =>
    createEditorState({
      doc: editorSchema.node(
        'doc',
        { title: 'Install the printer', language: 'en-GB', direction: 'ltr' },
        blocks,
      ),
      newIdentifier: counter(),
    });

  /** The first node of a type, with the position ProseMirror addresses it at. */
  const find = (doc: Node, type: string): { node: Node; pos: number } => {
    let found: { node: Node; pos: number } | undefined;
    doc.descendants((node, pos) => {
      if (found === undefined && node.type.name === type) found = { node, pos };
    });
    if (found === undefined) throw new Error(`the document holds no ${type}`);
    return found;
  };

  /** The paragraphs of one item, addressed by the list holding it and the item's index. */
  const paragraphsIn = (doc: Node, [list, index]: readonly [string, number]) => {
    const found: Node[] = [];
    find(doc, list)
      .node.child(index)
      .forEach((child) => {
        if (child.type.name === 'paragraph') found.push(child);
      });
    return found;
  };

  /** A keystroke in the opening paragraph: a transaction touching nothing these tests assert about. */
  const typed = (state: EditorState) => state.apply(state.tr.insertText('X', 1, 1));

  it('CNT-023 leaves no two adjacent empty paragraphs anywhere the editor can make a pair', () => {
    const state = componentOf([
      textParagraph('Unbox'),
      emptyParagraph(),
      emptyParagraph(),
      listOf(emptyParagraph(), emptyParagraph()),
      definitionOf('Cable', [emptyParagraph(), emptyParagraph()]),
    ]);
    const after = typed(state);
    // The top level: one of the two is left, and the blocks after it are untouched.
    expect(after.doc.childCount).toBe(4);
    expect(after.doc.child(1).textContent).toBe('');
    expect(after.doc.child(2).type.name).toBe('list');
    // A list item, and a definition item's body beneath its term.
    expect(paragraphsIn(after.doc, ['list', 0])).toHaveLength(1);
    expect(paragraphsIn(after.doc, ['definitionList', 0])).toHaveLength(1);
  });

  it('deletes a pair after a deeper pair without moving the position of either', () => {
    // The ordering case, and it is the whole of it: a pair **inside** a list, and a second pair
    // **after** that list at the top level. The walk collects a node's own removal and then descends
    // into that node, so the deeper position is collected before the later one and reversing the
    // list deletes back to front. Collect a sequence before descending into it - the obvious
    // rearrangement, and one the rest of this block cannot catch, because every other fixture here
    // puts its top-level pair first - and the two removals come back out of order: the shallow
    // deletion runs first, moves everything after it, and the deeper one then addresses a position
    // that no longer exists. That is a `RangeError` thrown out of `appendTransaction`, which in a
    // browser is an uncaught exception on a keystroke rather than a wrong document.
    const state = componentOf([
      listOf(emptyParagraph(), emptyParagraph()),
      textParagraph('keep me'),
      emptyParagraph(),
      emptyParagraph(),
    ]);
    // Any transaction will do; this one renames the list's kind, which no assertion below reads.
    const after = state.apply(state.tr.setNodeAttribute(0, 'kind', 'ordered'));
    expect(paragraphsIn(after.doc, ['list', 0])).toHaveLength(1);
    expect(texts(after.doc)).toEqual(['', 'keep me', '']);
  });

  it('removes the second of two adjacent empty paragraphs inside one list item', () => {
    const state = componentOf([textParagraph('Unbox'), listOf(emptyParagraph())]);
    // A second empty paragraph arriving beside the one already in the item, by a transaction:
    // an item's content begins one position inside the item itself.
    const item = find(state.doc, 'listItem');
    const after = state.apply(state.tr.insert(item.pos + 1, emptyParagraph()));
    expect(paragraphsIn(after.doc, ['list', 0])).toHaveLength(1);
  });

  it('does the same inside a definition item, beneath its term', () => {
    const state = componentOf([textParagraph('Unbox'), definitionOf('Cable', [emptyParagraph()])]);
    // The item's blocks begin where its term ends, so this is a pair in the body and not a term
    // standing beside a paragraph.
    const term = find(state.doc, 'term');
    const after = state.apply(state.tr.insert(term.pos + term.node.nodeSize, emptyParagraph()));
    expect(paragraphsIn(after.doc, ['definitionList', 0])).toHaveLength(1);
    expect(find(after.doc, 'term').node.textContent).toBe('Cable');
  });

  it('does not remove an empty paragraph that is the only one in its item', () => {
    // CNT-124's empty paragraph is where a cursor stands, at depth exactly as at the top level.
    const state = componentOf([textParagraph('Unbox'), listOf(emptyParagraph())]);
    const after = typed(state);
    expect(paragraphsIn(after.doc, ['list', 0])).toHaveLength(1);
  });

  it('never reads a term as the paragraph beside it, because a term is not a block', () => {
    // An author who writes the definition before the word leaves an empty term above an empty
    // paragraph. The stored model never sees those two in one sequence - a term belongs to the item
    // and its blocks are a sequence of their own - so neither may the editor. The two cannot be
    // reordered by any gesture, `definitionItem` being `term block+`, so this pins the reading
    // rather than catching a case a command produces: the walk asks the schema which children are
    // blocks, and a term is not one.
    const state = componentOf([textParagraph('Unbox'), definitionOf('', [emptyParagraph()])]);
    const after = typed(state);
    expect(paragraphsIn(after.doc, ['definitionList', 0])).toHaveLength(1);
    expect(find(after.doc, 'term').node.textContent).toBe('');
  });

  it('takes a child that is not a block out of the sequence, rather than reading it as a member', () => {
    // The group filter itself. **No document the editor's own schema can make reaches it**: the one
    // non-block child it has is a `definitionItem`'s term, `definitionItem` is `term block+`, so a
    // term can only stand first and never between two paragraphs - and the emptiness test keys on
    // the type name `paragraph`, so a term pairs with nothing whatever group it is in. So this
    // builds a schema of its own to put a node that is not a block **between** two empty paragraphs,
    // which is the case the filter decides and the case the next family that nests may bring.
    //
    // The answer it pins: a child outside the group is not a member of the sequence, so it neither
    // pairs with a paragraph nor separates two. That is how the stored model composes a sequence -
    // from block content alone, an item's term being a field beside it rather than a member of it -
    // and agreeing with that is the whole reason the walk asks the schema instead of naming types.
    const schema = new Schema({
      nodes: {
        doc: { content: 'holder+' },
        holder: { content: '(block | aside)+' },
        paragraph: { group: 'block', content: 'text*' },
        aside: {},
        text: {},
      },
    });
    const doc = schema.node('doc', null, [
      schema.node('holder', null, [schema.node('paragraph'), schema.node('aside')]),
    ]);
    const state = EditorState.create({ doc, plugins: [noAdjacentEmptyParagraphs()] });
    // An empty paragraph arriving at the end of the holder, with an `aside` between it and the
    // empty paragraph already there. It is still the second of a pair.
    const after = state.apply(state.tr.insert(4, schema.node('paragraph')));
    const holder = after.doc.firstChild!;
    expect(holder.childCount).toBe(2);
    expect([holder.child(0).type.name, holder.child(1).type.name]).toEqual(['paragraph', 'aside']);
  });

  it('never leaves inside an item what the stored model refuses in one', () => {
    const state = componentOf([textParagraph('Unbox'), listOf(emptyParagraph())]);
    const item = find(state.doc, 'listItem');
    const after = state.apply(state.tr.insert(item.pos + 1, emptyParagraph()));
    // The invariant stated as the seam it is: whatever the plugin leaves, the stored model accepts.
    // `fromEditor` cannot read a list yet - the mapping descends in its own task - so the item's
    // blocks go to the door `fromEditor` goes through, `parseContentDocument`, spelled as the model
    // spells them. They are the plugin's own output, identifiers and all, so a pair left at depth is
    // refused here exactly as a pair at the top level is.
    const list = find(after.doc, 'list');
    const storable = {
      schemaVersion: 1,
      title: 'Install the printer',
      language: 'en-GB',
      direction: 'ltr',
      content: [
        {
          type: 'list',
          id: list.node.attrs.id,
          kind: 'unordered',
          items: [
            {
              content: paragraphsIn(after.doc, ['list', 0]).map((paragraph) => ({
                type: 'paragraph',
                id: paragraph.attrs.id,
                style: paragraph.attrs.style,
                content: [],
              })),
            },
          ],
        },
      ],
    };
    expect(() => parseContentDocument(storable)).not.toThrow();
  });
});

/**
 * One annotation is one region of the text, whatever split it - a command, a keystroke, or a
 * transaction nothing in this package wrote. The content model refuses a document where one mark
 * identifier covers two separate ranges, and a component that reaches that refusal through
 * `fromEditor` is a 500 out of the snapshot path rather than a refusal an author can read.
 */
describe('an annotation left in two pieces', () => {
  const over = (state: EditorState, from: number, to: number) =>
    state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));

  /** The identifier each run carrying that mark holds, one per run, in document order. */
  const runIds = (doc: Node, mark: string) => {
    const found: string[] = [];
    doc.descendants((node) => {
      if (!node.isText) return;
      const carried = node.marks.find((one) => one.type.name === mark);
      if (carried !== undefined) found.push(carried.attrs.id as string);
    });
    return found;
  };

  it('repairs one that typing split, although typing runs no command', () => {
    const ids = counter();
    let state = stateOf(
      [
        ['b1', 'the report'],
        ['b2', ' now'],
      ],
      ids,
    );
    // One gesture across the paragraph break: one annotation, which the stored model accepts.
    state = run(over(state, 5, 17), toggleMarkCommand('language', ids, { tag: 'fr-FR' }));
    expect(runIds(state.doc, 'language')).toEqual(['n1', 'n1']);
    expect(() => fromEditor(state.doc)).not.toThrow();
    // A character typed at the end of the first paragraph. `language` is not inclusive, so the
    // typed run carries no mark and stands between the two pieces of the annotation.
    const typed = state.apply(state.tr.insertText('X', 11, 11));
    expect(texts(typed.doc)).toEqual(['the reportX', ' now']);
    expect(() => fromEditor(typed.doc)).not.toThrow();
    expect(runIds(typed.doc, 'language')).toEqual(['n1', 'n2']);
  });

  it('repairs one a removal in the middle of it split, which the command could not see', () => {
    const ids = counter();
    let state = stateOf(
      [
        ['b1', 'alpha'],
        ['b2', 'beta'],
        ['b3', 'gamma'],
      ],
      ids,
    );
    state = run(over(state, 1, 19), toggleMarkCommand('emphasis', ids));
    expect(runIds(state.doc, 'emphasis')).toEqual(['n1', 'n1', 'n1']);
    // Taking the mark off from a cursor in the middle paragraph is block-local, so the first
    // paragraph's piece ends before that range begins and the third's begins after it ends.
    const removed = run(at(state, 10), removeMarkCommand('emphasis'));
    expect(() => fromEditor(removed.doc)).not.toThrow();
    expect(runIds(removed.doc, 'emphasis')).toEqual(['n1', 'n2']);
  });

  it('repairs one a transaction no command wrote split', () => {
    const ids = counter();
    let state = stateOf([['b1', 'alpha beta gamma']], ids);
    state = run(over(state, 1, 17), toggleMarkCommand('emphasis', ids));
    // Unmarked text dropped into the middle of the annotation by a raw transaction: no command ran,
    // and the two pieces either side answer to one name until the invariant is restored.
    const split = state.apply(state.tr.replaceWith(7, 7, editorSchema.text('XX')));
    expect(() => fromEditor(split.doc)).not.toThrow();
    expect(runIds(split.doc, 'emphasis')).toEqual(['n1', 'n2']);
  });

  it('leaves an annotation that is in one piece exactly as it found it', () => {
    const ids = counter();
    let state = stateOf(
      [
        ['b1', 'alpha'],
        ['b2', 'beta gamma'],
      ],
      ids,
    );
    state = run(over(state, 8, 12), toggleMarkCommand('emphasis', ids));
    state = state.apply(state.tr.insertText('XX', 1, 1));
    // An identifier is what accepting or rejecting an annotation acts on (CNT-005), so renaming one
    // nothing split is the harm this plugin exists to prevent, inside out.
    expect(runIds(state.doc, 'emphasis')).toEqual(['n1']);
  });

  it('draws again when a fresh identifier is one a mark in the component already carries', () => {
    const draws = ['m1', 'm1', 'fresh'];
    const ids = () => draws.shift()!;
    let state = stateOf([['b1', 'alpha beta gamma']], ids);
    state = run(over(state, 1, 17), toggleMarkCommand('emphasis', ids));
    const split = state.apply(state.tr.replaceWith(7, 7, editorSchema.text('XX')));
    expect(runIds(split.doc, 'emphasis')).toEqual(['m1', 'fresh']);
  });
});

/**
 * Whether a run is spell checked depends on the component's base language, which a mark cannot see,
 * so the rule is a decoration recomputed from the document rather than an attribute rendered once.
 */
describe('spelling, over a run in another language', () => {
  /** One paragraph of runs, each either plain or carrying a language mark. */
  const componentIn = (base: string, runs: readonly (readonly [string, string | null])[]) =>
    editorSchema.node('doc', { title: 'Install the printer', language: base, direction: 'ltr' }, [
      editorSchema.node(
        'paragraph',
        { id: 'p1', style: 'body' },
        runs.map(([text, tag], index) =>
          editorSchema.text(
            text,
            tag === null ? [] : [editorSchema.mark('language', { id: `m${index}`, tag })],
          ),
        ),
      ),
    ]);

  const runs = [
    ['Unbox it. ', null],
    ['Deballez-le. ', 'fr-CA'],
    ['Check the colour.', 'en-GB'],
  ] as const;

  /** The text of every run the decorations turn the checker off over. */
  const unchecked = (doc: Node, set = spellcheckDecorations(doc)) =>
    set.find().map((decoration) => doc.textBetween(decoration.from, decoration.to));

  it("CNT-147 does not check a run whose language differs from the component's base language", () => {
    const doc = componentIn('en-GB', runs);
    // The French run is left alone; the English one is checked like the unmarked text around it.
    expect(unchecked(doc)).toEqual(['Deballez-le. ']);
    // The attribute the decoration carries has no public accessor, and asserting the range alone
    // would pass with any attribute at all - including one that turns the checker *on*. This reads
    // the same field `Decoration.inline` writes, in the test only.
    const attributesOf = (decoration: Decoration) =>
      (decoration as unknown as { type: { attrs: Record<string, string> } }).type.attrs;
    expect(spellcheckDecorations(doc).find().map(attributesOf)).toEqual([{ spellcheck: 'false' }]);
  });

  it('recomputes the rule for every run when the base language changes', () => {
    let state = createEditorState({ doc: componentIn('en-GB', runs), newIdentifier: counter() });
    const throughThePlugin = (of: EditorState) => {
      const sets = of.plugins
        .map((plugin) => plugin.props.decorations?.call(plugin, of))
        .filter((set): set is DecorationSet => set instanceof DecorationSet);
      expect(sets).toHaveLength(1);
      return unchecked(of.doc, sets[0]!);
    };
    expect(throughThePlugin(state)).toEqual(['Deballez-le. ']);
    state = run(state, setLanguage('fr-CA'));
    expect(throughThePlugin(state)).toEqual(['Check the colour.']);
  });
});

describe('the plugins inside a quotation and around preformatted text (editor 5)', () => {
  const empty = () => editorSchema.node('paragraph', { id: null, style: 'body' });
  const pre = (text: string) =>
    editorSchema.node('preformatted', { id: null }, text === '' ? [] : [editorSchema.text(text)]);
  const component = (blocks: readonly Node[]) =>
    createEditorState({
      doc: editorSchema.node(
        'doc',
        { title: 'Install the printer', language: 'en-GB', direction: 'ltr' },
        blocks,
      ),
      newIdentifier: counter(),
    });
  const typed = (state: EditorState) => state.apply(state.tr.insertText('X', 1, 1));
  const names = (doc: Node) => {
    const found: string[] = [];
    doc.descendants((node) => {
      if (node.isBlock) found.push(node.type.name);
    });
    return found;
  };

  it('removes the second of two adjacent empty paragraphs inside a quotation', () => {
    const state = component([
      editorSchema.node('paragraph', { id: null, style: 'body' }, [editorSchema.text('Unbox')]),
      editorSchema.node('blockquote', { id: null }, [empty(), editorSchema.node('attribution')]),
    ]);
    let quoted = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'blockquote') quoted = pos;
    });
    const after = state.apply(state.tr.insert(quoted + 1, empty()));
    expect(names(after.doc)).toEqual(['paragraph', 'blockquote', 'paragraph', 'attribution']);
    expect(() => fromEditor(after.doc)).not.toThrow();
  });

  it('takes a preformatted block for what separates two empty paragraphs', () => {
    const after = typed(
      component([
        editorSchema.node('paragraph', { id: null, style: 'body' }, [editorSchema.text('Unbox')]),
        empty(),
        pre(''),
        empty(),
      ]),
    );
    expect(names(after.doc)).toEqual(['paragraph', 'paragraph', 'preformatted', 'paragraph']);
  });

  it('renames the second piece of an annotation that preformatted text now stands inside, and not across an empty one', () => {
    const emphasis = editorSchema.marks.emphasis!.create({ id: 'm1' });
    const piece = (text: string) =>
      editorSchema.node('paragraph', { id: null, style: 'body' }, [
        editorSchema.text(text, [emphasis]),
      ]);
    const state = typed(component([piece('one'), pre(''), piece('two')]));
    const carried = (doc: Node) => {
      const found: string[] = [];
      doc.descendants((node) => {
        const mark = node.isText ? node.marks.find((one) => one.type.name === 'emphasis') : null;
        if (mark) found.push(mark.attrs.id as string);
      });
      return found;
    };
    // Across an empty preformatted block the annotation is one piece, as the model reads it.
    expect(carried(state.doc)).toEqual(['m1', 'm1']);
    expect(() => fromEditor(state.doc)).not.toThrow();
    let inside = -1;
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'preformatted') inside = pos + 1;
    });
    const written = state.apply(state.tr.insertText('x', inside, inside));
    const [first, second] = carried(written.doc);
    expect(first).toBe('m1');
    expect(second).not.toBe('m1');
    expect(() => fromEditor(written.doc)).not.toThrow();
  });
});
