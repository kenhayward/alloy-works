import { describe, expect, it } from 'vitest';
import {
  emptyGraph,
  expandInto,
  FOLD_PAST,
  layout,
  queryOf,
  ringOf,
  type GraphNeighbour,
} from './graph.js';

const CENTRE = 'aaaaaaaa-0000-4000-8000-000000000000';
const TYPE = 'bbbbbbbb-0000-4000-8000-000000000001';
const id = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;

const neighbour = (
  n: number,
  kind = 'document',
  direction: 'out' | 'in' = 'out',
): GraphNeighbour => ({
  relationship: {
    id: `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`,
    type: TYPE,
    from: { artifact: direction === 'out' ? CENTRE : id(n), kind: 'document', version: null },
    to: { artifact: direction === 'out' ? id(n) : CENTRE, kind, version: null },
    values: {},
    createdBy: CENTRE,
    createdAt: '2026-10-16T00:00:00.000Z',
    changedAt: '2026-10-16T00:00:00.000Z',
  },
  direction,
  other: { id: id(n), kind, title: `Node ${n}` },
});

describe('the relationship graph, as data (the R8 plan, R8-G)', () => {
  it('REL-028 names the query that answers each view, filters and all', () => {
    expect(queryOf(CENTRE, {})).toBe(`GET /v1/artifacts/${CENTRE}/relationships`);
    expect(
      queryOf(CENTRE, { type: TYPE, direction: 'in', field: TYPE, value: 'Revised now' }),
    ).toBe(
      `GET /v1/artifacts/${CENTRE}/relationships?type=${TYPE}&direction=in&field=${TYPE}&value=Revised+now`,
    );
  });

  it('REL-025 grows a ring at a time from the centre, each artifact once, at the ring it is first reached', () => {
    let graph = emptyGraph({ id: CENTRE, kind: 'document', title: 'Centre' });
    graph = expandInto(graph, CENTRE, [neighbour(1), neighbour(2, 'document', 'in')]);
    expect(ringOf(graph, 1).map((each) => each.id)).toEqual([id(1), id(2)]);
    // Expanding a neighbour adds the next ring; the centre, already drawn, is not drawn again.
    const back: GraphNeighbour = {
      ...neighbour(3),
      other: { id: CENTRE, kind: 'document', title: 'Centre' },
    };
    graph = expandInto(graph, id(1), [neighbour(4), back]);
    expect(ringOf(graph, 2).map((each) => each.id)).toEqual([id(4)]);
    expect(graph.nodes.size).toBe(4);
    expect(graph.edges.map((each) => [each.from, each.to])).toEqual([
      [CENTRE, id(1)],
      [CENTRE, id(2)],
      [id(1), id(4)],
      [id(1), CENTRE],
    ]);
    expect(graph.expanded).toEqual(new Set([CENTRE, id(1)]));
  });

  it('REL-027 folds an artifact’s neighbours of one kind into a count past twenty, keeping the rest drawn', () => {
    const many = Array.from({ length: FOLD_PAST + 1 }, (_, at) => neighbour(at + 1));
    const few = [neighbour(100, 'component'), neighbour(101, 'component')];
    const graph = expandInto(
      emptyGraph({ id: CENTRE, kind: 'document', title: 'Centre' }),
      CENTRE,
      [...many, ...few],
    );
    const drawn = layout(graph, 400);
    expect(drawn.counts).toEqual([
      expect.objectContaining({
        parent: CENTRE,
        kind: 'document',
        ids: many.map((each) => each.other.id),
      }),
    ]);
    expect(drawn.nodes.map((each) => each.id)).toEqual([CENTRE, id(100), id(101)]);
    // Each drawn artifact sits on its ring: the centre at the middle, the first ring further out.
    const [centre, first] = [drawn.nodes[0]!, drawn.nodes[1]!];
    expect([centre.x, centre.y]).toEqual([200, 200]);
    expect(Math.hypot(first.x - 200, first.y - 200)).toBeGreaterThan(50);
  });
});
