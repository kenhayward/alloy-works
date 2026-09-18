import { describe, expect, it } from 'vitest';

import {
  applyOutlineOperation,
  outlineOperationSchema,
  type OutlineOperation,
} from './operations.js';
import { parseOutlineDocument, walkOutline, type OutlineDocument } from './outline.js';

const NODE = 'a'.repeat(26);
const COMPONENT = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';
const OTHER_COMPONENT = '11111111-1111-4111-8111-111111111111';

const empty: OutlineDocument = parseOutlineDocument({
  schemaVersion: 1,
  title: 'The dosing report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [],
});

/**
 * Deterministic identifiers, so a generated sequence of operations reproduces exactly. Four digits,
 * not three: three overflows past 999 allocations into a 27-character id, which is exactly the kind
 * of mistake a schema this file trusts implicitly would not catch on its own.
 */
function identifiers() {
  let next = 0;
  const made: string[] = [];
  return {
    made,
    allocate: () => {
      next += 1;
      const unique = `${String(next).padStart(4, '0')}${'a'.repeat(22)}`.replace(
        /\d/g,
        (d) => 'abcdefghij'[Number(d)]!,
      );
      made.push(unique);
      return unique;
    },
  };
}

const run = (outline: OutlineDocument, operation: OutlineOperation, allocate: () => string) => {
  const answer = applyOutlineOperation(outline, operation, allocate);
  if (!answer.applied) throw new Error(answer.reason);
  return answer.outline;
};

const addSection = (
  parent: string | null,
  position = 0,
  title = 'Introduction',
): OutlineOperation => ({
  operation: 'insert',
  parent,
  position,
  node: { type: 'section', title: [{ type: 'text', value: title, marks: [] }] },
});

describe('outlineOperationSchema', () => {
  it('is the one gate between the wire body and the tree, and refuses what does not belong', () => {
    const validInsert = {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'section', title: [] },
    };
    expect(outlineOperationSchema.safeParse(validInsert).success).toBe(true);
    // A mode belongs to a reference's own insert body, never to a section's.
    expect(
      outlineOperationSchema.safeParse({
        ...validInsert,
        node: { type: 'section', title: [], mode: { kind: 'latest' } },
      }).success,
    ).toBe(false);
    // A position is a non-negative integer: never negative, never fractional.
    expect(outlineOperationSchema.safeParse({ ...validInsert, position: -1 }).success).toBe(false);
    expect(outlineOperationSchema.safeParse({ ...validInsert, position: 1.5 }).success).toBe(false);
    // The union is closed: an operation outside the five is refused, not passed through unknown.
    expect(outlineOperationSchema.safeParse({ operation: 'archive', node: NODE }).success).toBe(
      false,
    );
    // set's own switches are closed too - a wire body cannot smuggle an arbitrary field through it.
    expect(
      outlineOperationSchema.safeParse({ operation: 'set', node: NODE, colour: 'red' }).success,
    ).toBe(false);
    // A set naming none of its five switches would apply and change nothing - refused at the wire
    // body itself, rather than left for a downstream version whose digest equals its parent's.
    expect(outlineOperationSchema.safeParse({ operation: 'set', node: NODE }).success).toBe(false);
    // The component identifier is a lowercase uuid, the same rule the outline schema itself carries.
    expect(
      outlineOperationSchema.safeParse({
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'reference', component: COMPONENT.toUpperCase(), mode: { kind: 'latest' } },
      }).success,
    ).toBe(false);
    // values is a record, never an array - the same shape the node schema itself requires.
    expect(
      outlineOperationSchema.safeParse({ operation: 'set', node: NODE, values: [] }).success,
    ).toBe(false);
  });
});

describe('the five operations over an outline', () => {
  it('STR-003 gives every node an identifier at insertion, and never reissues one', () => {
    const { allocate, made } = identifiers();
    let outline = run(empty, addSection(null), allocate);
    outline = run(outline, addSection(null, 1, 'Method'), allocate);
    const first = outline.nodes[0]!.id;
    outline = run(outline, addSection(first, 0, 'Scope'), allocate);

    const seen: string[] = [];
    walkOutline(outline.nodes, (node) => seen.push(node.id));
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    // The production allocator (`blockIdentifierFrom`) emits `2`-`7` as well as `a`-`z`: the schema's
    // spelling, not the narrower range this counter happens to produce.
    expect(seen.every((id) => /^[a-z2-7]{26}$/.test(id))).toBe(true);

    // Removing a node and inserting another never hands back the identifier that went.
    outline = run(outline, { operation: 'remove', node: first }, allocate);
    outline = run(outline, addSection(null, 0, 'Results'), allocate);
    const after: string[] = [];
    walkOutline(outline.nodes, (node) => after.push(node.id));
    expect(after).not.toContain(first);
    expect(new Set(made).size).toBe(made.length);
  });

  it('refuses an insert before allocating, so a refused insert burns no identifier', () => {
    const { allocate, made } = identifiers();
    const refused = applyOutlineOperation(empty, addSection('z'.repeat(26)), allocate);
    expect(refused.applied).toBe(false);
    expect(made).toHaveLength(0);
  });

  it('STR-007 nests to nine levels, with no maximum the schema declares', () => {
    const { allocate } = identifiers();
    let outline = empty;
    let parent: string | null = null;
    for (let depth = 1; depth <= 9; depth += 1) {
      outline = run(outline, addSection(parent, 0, `Level ${depth}`), allocate);
      let node = outline.nodes[0]!;
      for (let step = 1; step < depth; step += 1) node = node.children[0]!;
      parent = node.id;
    }
    let deepest = 0;
    walkOutline(outline.nodes, (_node, depth) => {
      deepest = Math.max(deepest, depth);
    });
    expect(deepest).toBe(9);
    // And it round-trips through the store's shape unchanged.
    expect(parseOutlineDocument(JSON.parse(JSON.stringify(outline)))).toEqual(outline);
  });

  it('STR-010 lets one component be referenced twice, each occurrence a node with its own identity', () => {
    const { allocate } = identifiers();
    const reference = (position: number, component: string): OutlineOperation => ({
      operation: 'insert',
      parent: null,
      position,
      node: { type: 'reference', component, mode: { kind: 'latest' } },
    });
    let outline = run(empty, reference(0, COMPONENT), allocate);
    outline = run(outline, reference(1, COMPONENT), allocate);
    outline = run(outline, reference(2, OTHER_COMPONENT), allocate);
    const nodes = outline.nodes.map((node) => (node.type === 'reference' ? node : undefined));
    expect(nodes[0]?.component).toBe(COMPONENT);
    expect(nodes[1]?.component).toBe(COMPONENT);
    expect(nodes[0]?.id).not.toBe(nodes[1]?.id);
    // Each occurrence carries its own switches, so one can be an appendix and the other not.
    outline = run(outline, { operation: 'set', node: nodes[1]!.id, matter: 'appendix' }, allocate);
    expect(outline.nodes[0]).toMatchObject({ matter: 'body' });
    expect(outline.nodes[1]).toMatchObject({ matter: 'appendix' });
  });

  it('moves a node with its whole subtree, and refuses a parent inside it', () => {
    const { allocate } = identifiers();
    let outline = run(empty, addSection(null, 0, 'Introduction'), allocate);
    const first = outline.nodes[0]!.id;
    outline = run(outline, addSection(first, 0, 'Scope'), allocate);
    outline = run(outline, addSection(null, 1, 'Method'), allocate);
    const second = outline.nodes[1]!.id;

    outline = run(
      outline,
      { operation: 'move', node: first, parent: second, position: 0 },
      allocate,
    );
    expect(outline.nodes).toHaveLength(1);
    expect(outline.nodes[0]!.children[0]!.id).toBe(first);
    expect(outline.nodes[0]!.children[0]!.children).toHaveLength(1);

    const inside = outline.nodes[0]!.children[0]!.children[0]!.id;
    expect(
      applyOutlineOperation(
        outline,
        { operation: 'move', node: first, parent: inside, position: 0 },
        allocate,
      ),
    ).toEqual({ applied: false, reason: 'A node cannot be moved inside its own subtree' });
  });

  it('reorders within one parent by the position its children hold once the node has already left', () => {
    const { allocate } = identifiers();
    let outline = run(empty, addSection(null, 0, 'A'), allocate);
    outline = run(outline, addSection(null, 1, 'B'), allocate);
    outline = run(outline, addSection(null, 2, 'C'), allocate);
    const [a, b, c] = outline.nodes.map((node) => node.id);
    // Moving the first of three siblings to position 2: the two it is counted among are the two left
    // once it is gone, not the three that were there before it moved - so it lands last, not second.
    // Defensible, but nothing pinned it before this test - task 5's drag-and-drop could read the
    // other convention (positions counted before the removal) with nothing here to catch it.
    outline = run(outline, { operation: 'move', node: a!, parent: null, position: 2 }, allocate);
    expect(outline.nodes.map((node) => node.id)).toEqual([b, c, a]);
  });

  it('refuses a position past the end of the children it would join, but not the append point itself', () => {
    const { allocate } = identifiers();
    let outline = run(empty, addSection(null, 0, 'A'), allocate);
    outline = run(outline, addSection(null, 1, 'B'), allocate);
    const first = outline.nodes[0]!.id;
    const insertAt = (candidatePosition: number) =>
      applyOutlineOperation(
        outline,
        {
          operation: 'insert',
          parent: null,
          position: candidatePosition,
          node: { type: 'section', title: [] },
        },
        allocate,
      ).applied;
    // Two children at the root: 0, 1 and 2 (the append point) all fit; 3 is past the end.
    expect(insertAt(2)).toBe(true);
    expect(insertAt(3)).toBe(false);
    expect(
      applyOutlineOperation(
        outline,
        { operation: 'move', node: first, parent: null, position: 3 },
        allocate,
      ).applied,
    ).toBe(false);
  });

  it('refuses to retitle a reference, and refuses a move whose parent is not in the outline', () => {
    const { allocate } = identifiers();
    let outline = run(
      empty,
      {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'reference', component: COMPONENT, mode: { kind: 'latest' } },
      },
      allocate,
    );
    const reference = outline.nodes[0]!.id;
    expect(
      applyOutlineOperation(outline, { operation: 'retitle', node: reference, title: [] }, allocate)
        .applied,
    ).toBe(false);

    outline = run(outline, addSection(null, 1, 'A'), allocate);
    const section = outline.nodes[1]!.id;
    expect(
      applyOutlineOperation(
        outline,
        { operation: 'move', node: section, parent: 'z'.repeat(26), position: 0 },
        allocate,
      ).applied,
    ).toBe(false);
  });

  it('retitles, sets a switch, removes a subtree, and refuses what does not apply', () => {
    const { allocate } = identifiers();
    let outline = run(empty, addSection(null), allocate);
    const node = outline.nodes[0]!.id;
    outline = run(
      outline,
      { operation: 'retitle', node, title: [{ type: 'text', value: 'Results', marks: [] }] },
      allocate,
    );
    expect(outline.nodes[0]).toMatchObject({
      title: [{ type: 'text', value: 'Results', marks: [] }],
    });
    outline = run(
      outline,
      { operation: 'set', node, numbered: false, pageBreak: 'recto' },
      allocate,
    );
    expect(outline.nodes[0]).toMatchObject({ numbered: false, pageBreak: 'recto' });

    const absent = 'z'.repeat(26);
    for (const operation of [
      { operation: 'remove', node: absent },
      { operation: 'move', node: absent, parent: null, position: 0 },
      { operation: 'retitle', node: absent, title: [] },
      { operation: 'set', node: absent, numbered: true },
      addSection(absent),
      // A mode belongs to a component reference, not to a section.
      { operation: 'set', node, mode: { kind: 'latest' } },
    ] as OutlineOperation[]) {
      expect(applyOutlineOperation(outline, operation, allocate).applied).toBe(false);
    }

    outline = run(outline, addSection(node, 0, 'Scope'), allocate);
    outline = run(outline, { operation: 'remove', node }, allocate);
    expect(outline.nodes).toEqual([]);
  });

  it('keeps every invariant after any sequence of operations, applying most of them', () => {
    const { allocate } = identifiers();
    let outline = empty;
    let appliedCount = 0;
    const STEPS = 300;
    for (let step = 0; step < STEPS; step += 1) {
      const ids: string[] = [];
      walkOutline(outline.nodes, (node) => ids.push(node.id));
      const target = ids.length > 0 ? ids[step % ids.length] : undefined;
      // The parent (for insert and move) and the position both come from the full id list and the
      // full id count, not fixed to the root or to index 0 - so this exercises every depth the tree
      // currently has, and both sides of the new position-bounds refusal.
      const parentCandidate = ids.length > 0 ? (ids[(step * 7) % ids.length] ?? null) : null;
      const candidatePosition = ids.length > 0 ? step % (ids.length + 1) : 0;
      const operation: OutlineOperation =
        step % 5 === 0 || target === undefined
          ? addSection(
              step % 3 === 0 ? parentCandidate : null,
              candidatePosition,
              `Section ${step}`,
            )
          : step % 5 === 1
            ? {
                operation: 'move',
                node: target,
                parent: parentCandidate === target ? null : parentCandidate,
                position: candidatePosition,
              }
            : step % 5 === 2
              ? { operation: 'set', node: target, numbered: step % 8 === 2 }
              : step % 5 === 3
                ? {
                    operation: 'retitle',
                    node: target,
                    title: [{ type: 'text', value: `T${step}`, marks: [] }],
                  }
                : { operation: 'remove', node: target };
      const answer = applyOutlineOperation(outline, operation, allocate);
      if (answer.applied) {
        outline = answer.outline;
        appliedCount += 1;
      }

      const seen = new Set<string>();
      walkOutline(outline.nodes, (node) => {
        expect(node.id).toMatch(/^[a-z2-7]{26}$/);
        expect(seen.has(node.id)).toBe(false);
        seen.add(node.id);
      });
      // Every outline an operation returns is one the parse accepts, which is what makes a store
      // that records them able to record anything the panel can produce.
      expect(parseOutlineDocument(outline)).toEqual(outline);
    }
    // Every step above holds vacuously if nothing ever applied - a broken guard that refuses
    // everything would still pass every invariant, having left nothing to check. This sequence is
    // deterministic (the allocator is a counter, not randomness), so the true count never moves; the
    // floor is set well under it, to catch a regression rather than to track the exact figure.
    expect(appliedCount).toBeGreaterThan(STEPS / 4);
  });
});
