import { describe, expect, it } from 'vitest';

import {
  applyOutlineOperation,
  planOutline,
  proposedPosition,
  type OutlineOperation,
} from './operations.js';
import {
  OUTLINE_SCHEMA_VERSION,
  parseOutlineDocument,
  walkOutline,
  type OutlineDocument,
  type OutlineNode,
} from './outline.js';

const [A, B, C, D] = ['a', 'b', 'c', 'd'].map((letter) => letter.repeat(26)) as [
  string,
  string,
  string,
  string,
];
const PART = '11111111-2222-4333-8444-555555555555';
const HIDDEN = '99999999-2222-4333-8444-555555555555';

const title = (value: string) => [{ type: 'text', value, marks: [] }];

/** Sections A, B and C at the top, a hidden part D in C. */
function built(): OutlineDocument {
  let outline = parseOutlineDocument({
    schemaVersion: OUTLINE_SCHEMA_VERSION,
    title: 'Weirs',
    language: 'en-GB',
    direction: 'ltr',
    nodes: [],
  });
  const add = (operation: OutlineOperation, id: string) => {
    const applied = applyOutlineOperation(outline, operation, () => id);
    if (!applied.applied) throw new Error(applied.reason);
    outline = applied.outline;
  };
  add(
    {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'section', title: title('Alpha') },
    } as OutlineOperation,
    A,
  );
  add(
    {
      operation: 'insert',
      parent: null,
      position: 1,
      node: { type: 'section', title: title('Beta') },
    } as OutlineOperation,
    B,
  );
  add(
    {
      operation: 'insert',
      parent: null,
      position: 2,
      node: { type: 'section', title: title('Gamma') },
    } as OutlineOperation,
    C,
  );
  add(
    {
      operation: 'insert',
      parent: C,
      position: 0,
      node: { type: 'reference', component: HIDDEN, mode: { kind: 'latest' } },
    } as OutlineOperation,
    D,
  );
  return outline;
}

const names = {
  node: (node: OutlineNode) =>
    node.type === 'section' ? (node.title[0] as { value: string }).value : undefined,
  component: (component: string) => (component === PART ? 'Sites' : undefined),
};

const topTitles = (outline: OutlineDocument, operations: readonly OutlineOperation[]) => {
  let next = outline;
  let made = 0;
  for (const operation of operations) {
    const applied = applyOutlineOperation(next, operation, () => `${'e'.repeat(25)}${'abcdefgh'[made++]!}`);
    if (!applied.applied) throw new Error(applied.reason);
    next = applied.outline;
  }
  return next.nodes.map((node) =>
    node.type === 'section' ? (node.title[0] as { value: string }).value : node.type,
  );
};

describe('planning outline steps', () => {
  it('names a place by the sibling it follows, counted in the stored outline', () => {
    const plan = planOutline(built(), [{ do: 'move', node: A, after: B }], names);
    expect(plan).toMatchObject({
      ok: true,
      operations: [{ operation: 'move', node: A, parent: null, position: 1 }],
      says: [{ do: 'move', what: 'Alpha', after: 'Beta', under: null }],
    });
    expect(topTitles(built(), plan.ok ? plan.operations : [])).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('goes last where it names no sibling, and first where it says start', () => {
    const last = planOutline(built(), [{ do: 'section', title: 'New' }], names);
    expect(topTitles(built(), last.ok ? last.operations : [])).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
      'New',
    ]);
    const first = planOutline(built(), [{ do: 'section', title: 'New', after: 'start' }], names);
    expect(topTitles(built(), first.ok ? first.operations : [])).toEqual([
      'New',
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('counts a position past a part the person cannot see', () => {
    const plan = planOutline(built(), [{ do: 'place', component: PART, under: C }], names);
    expect(plan).toMatchObject({
      ok: true,
      operations: [
        {
          operation: 'insert',
          parent: C,
          position: 1,
          node: { type: 'reference', component: PART, mode: { kind: 'latest' } },
        },
      ],
      says: [{ do: 'place', what: 'Sites', under: 'Gamma', after: null }],
    });
  });

  it('plans each step on what the one before it left', () => {
    const plan = planOutline(
      built(),
      [
        { do: 'remove', node: A },
        { do: 'move', node: B, after: C },
      ],
      names,
    );
    expect(topTitles(built(), plan.ok ? plan.operations : [])).toEqual(['Gamma', 'Beta']);
  });

  it('refuses what the person cannot see: naming it, a section holding it, or a part they cannot read', () => {
    for (const step of [
      { do: 'remove', node: D },
      { do: 'move', node: A, after: D, under: C },
      { do: 'remove', node: C },
      { do: 'place', component: HIDDEN },
    ] as const) {
      expect(planOutline(built(), [step], names).ok, JSON.stringify(step)).toBe(false);
    }
    const moved = planOutline(built(), [{ do: 'retitle', node: A, title: 'Renamed' }], names);
    expect(moved.ok).toBe(true);
  });

  it('refuses a place not among those children, and a plan that changes nothing', () => {
    expect(planOutline(built(), [{ do: 'move', node: A, after: D }], names)).toMatchObject({
      ok: false,
    });
    expect(planOutline(built(), [{ do: 'move', node: A, after: 'start' }], names)).toMatchObject({
      ok: false,
      problem: 'That changes nothing.',
    });
  });

  it('gives where a new part would stand', () => {
    expect(proposedPosition(built(), { under: C })).toEqual({ parent: C, position: 1 });
    expect(proposedPosition(built(), { after: A })).toEqual({ parent: null, position: 1 });
    expect(typeof proposedPosition(built(), { after: D })).toBe('string');
    let nodes = 0;
    walkOutline(built().nodes, () => {
      nodes += 1;
    });
    expect(nodes).toBe(4);
  });
});
