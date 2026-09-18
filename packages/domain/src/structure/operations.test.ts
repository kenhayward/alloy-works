import { describe, expect, it } from 'vitest';

import { applyOutlineOperation, type OutlineOperation } from './operations.js';
import { parseOutlineDocument, walkOutline, type OutlineDocument } from './outline.js';

const COMPONENT = '5e1d0c7a-0b1f-4c1e-9a52-3f6d7c2b9e01';
const OTHER_COMPONENT = '11111111-1111-4111-8111-111111111111';

const empty: OutlineDocument = parseOutlineDocument({
  schemaVersion: 1,
  title: 'The dosing report',
  language: 'en-GB',
  direction: 'ltr',
  nodes: [],
});

/** Deterministic identifiers, so a generated sequence of operations reproduces exactly. */
function identifiers() {
  let next = 0;
  const made: string[] = [];
  return {
    made,
    allocate: () => {
      next += 1;
      const unique = `${String(next).padStart(3, '0')}${'a'.repeat(23)}`.replace(
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

  it('keeps every invariant after any sequence of operations', () => {
    const { allocate } = identifiers();
    let outline = empty;
    for (let step = 0; step < 200; step += 1) {
      const ids: string[] = [];
      walkOutline(outline.nodes, (node) => ids.push(node.id));
      const target = ids[step % Math.max(ids.length, 1)];
      const operation: OutlineOperation =
        step % 4 === 0 || target === undefined
          ? addSection(step % 8 === 0 ? null : (ids[0] ?? null), 0, `Section ${step}`)
          : step % 4 === 1
            ? {
                operation: 'move',
                node: target,
                parent: ids[0] === target ? null : (ids[0] ?? null),
                position: 0,
              }
            : step % 4 === 2
              ? { operation: 'set', node: target, numbered: step % 8 === 2 }
              : {
                  operation: 'retitle',
                  node: target,
                  title: [{ type: 'text', value: `T${step}`, marks: [] }],
                };
      const answer = applyOutlineOperation(outline, operation, allocate);
      if (answer.applied) outline = answer.outline;

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
  });
});
