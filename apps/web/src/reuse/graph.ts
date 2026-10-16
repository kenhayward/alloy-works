import type { paths } from '@alloy-works/api-client';

/** One relationship of an artifact, read from its end, as the service answers it. */
export type GraphNeighbour =
  paths['/v1/artifacts/{id}/relationships']['get']['responses']['200']['content']['application/json']['relationships'][number];

/** An artifact the graph names. */
export interface GraphArtifact {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
}

/** An artifact drawn: the ring it was first reached on, and the artifact it was reached from. */
export interface GraphNode extends GraphArtifact {
  readonly ring: number;
  readonly parent: string | null;
}

export interface GraphEdge {
  readonly relationship: GraphNeighbour['relationship'];
  /** The expanded artifact it was read from, and the artifact at its other end. */
  readonly from: string;
  readonly to: string;
}

/** The graph as read so far, centred on one artifact (REL-025; the R8 plan, R8-G). */
export interface Graph {
  readonly centre: string;
  /** In the order they were reached. */
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly edges: readonly GraphEdge[];
  readonly expanded: ReadonlySet<string>;
}

/** Past this many neighbours of one kind from one artifact, they are drawn as a count (REL-027). */
export const FOLD_PAST = 20;

export function emptyGraph(centre: GraphArtifact): Graph {
  return {
    centre: centre.id,
    nodes: new Map([[centre.id, { ...centre, ring: 0, parent: null }]]),
    edges: [],
    expanded: new Set(),
  };
}

/** The graph with one artifact's relationships read into it: each new artifact on the next ring. */
export function expandInto(graph: Graph, at: string, read: readonly GraphNeighbour[]): Graph {
  const from = graph.nodes.get(at);
  if (!from) return graph;
  const nodes = new Map(graph.nodes);
  const known = new Set(graph.edges.map((each) => each.relationship.id));
  const edges = [...graph.edges];
  for (const each of read) {
    if (!nodes.has(each.other.id)) {
      nodes.set(each.other.id, { ...each.other, ring: from.ring + 1, parent: at });
    }
    if (!known.has(each.relationship.id)) {
      known.add(each.relationship.id);
      edges.push({ relationship: each.relationship, from: at, to: each.other.id });
    }
  }
  return { ...graph, nodes, edges, expanded: new Set([...graph.expanded, at]) };
}

/** The artifacts first reached on one ring, in the order they were reached. */
export function ringOf(graph: Graph, ring: number): GraphNode[] {
  return [...graph.nodes.values()].filter((each) => each.ring === ring);
}

/** Those of an artifact's neighbours that are many of one kind, drawn as one count (REL-027). */
export interface FoldedCount {
  readonly key: string;
  readonly parent: string;
  readonly kind: string;
  readonly ids: readonly string[];
}

export interface Drawn {
  readonly nodes: readonly (GraphNode & { readonly x: number; readonly y: number })[];
  readonly counts: readonly (FoldedCount & { readonly x: number; readonly y: number })[];
  readonly lines: readonly {
    readonly key: string;
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  }[];
}

/** Which artifacts are folded into counts: per parent, per kind, past FOLD_PAST. */
export function foldsOf(graph: Graph): FoldedCount[] {
  const groups = new Map<string, FoldedCount & { ids: string[] }>();
  for (const node of graph.nodes.values()) {
    if (node.parent === null) continue;
    const key = `${node.parent}:${node.kind}`;
    const group = groups.get(key) ?? { key, parent: node.parent, kind: node.kind, ids: [] };
    group.ids.push(node.id);
    groups.set(key, group);
  }
  return [...groups.values()].filter((each) => each.ids.length > FOLD_PAST);
}

/**
 * Where each is drawn, in a square `size` across: the centre in the middle, each ring further out,
 * spread evenly round it, a ring's artifacts in the order of the artifacts they were reached from.
 */
export function layout(graph: Graph, size: number): Drawn {
  const folds = foldsOf(graph);
  const folded = new Map<string, string>();
  for (const fold of folds) for (const id of fold.ids) folded.set(id, fold.key);
  const middle = size / 2;
  const rings = Math.max(1, ...[...graph.nodes.values()].map((each) => each.ring));
  const step = (middle - 40) / rings;
  const at = new Map<string, { x: number; y: number; angle: number }>();
  at.set(graph.centre, { x: middle, y: middle, angle: 0 });
  // Each ring's places: its drawn artifacts and its counts, ordered by the angle of their parent.
  for (let ring = 1; ring <= rings; ring += 1) {
    const places: { key: string; parent: string }[] = [];
    for (const node of ringOf(graph, ring)) {
      if (!folded.has(node.id)) places.push({ key: node.id, parent: node.parent! });
    }
    for (const fold of folds) {
      if (graph.nodes.get(fold.ids[0]!)!.ring === ring)
        places.push({ key: fold.key, parent: fold.parent });
    }
    const order = places
      .map((place, index) => ({ ...place, index, angle: at.get(place.parent)?.angle ?? 0 }))
      .sort((a, b) => a.angle - b.angle || a.index - b.index);
    order.forEach((place, index) => {
      const angle = (2 * Math.PI * index) / order.length - Math.PI / 2;
      at.set(place.key, {
        x: middle + step * ring * Math.cos(angle),
        y: middle + step * ring * Math.sin(angle),
        angle,
      });
    });
  }
  const placeOf = (id: string) => at.get(folded.get(id) ?? id)!;
  const lines = new Map<string, Drawn['lines'][number]>();
  for (const edge of graph.edges) {
    const [a, b] = [placeOf(edge.from), placeOf(edge.to)];
    const key = [folded.get(edge.from) ?? edge.from, folded.get(edge.to) ?? edge.to]
      .sort()
      .join('|');
    if (!lines.has(key)) lines.set(key, { key, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return {
    nodes: [...graph.nodes.values()]
      .filter((each) => !folded.has(each.id))
      .map((each) => ({ ...each, x: at.get(each.id)!.x, y: at.get(each.id)!.y })),
    counts: folds.map((each) => ({ ...each, x: at.get(each.key)!.x, y: at.get(each.key)!.y })),
    lines: [...lines.values()],
  };
}

/** What the graph is filtered by: a type, a direction, and one field's value (REL-026, REL-051). */
export interface GraphFilter {
  readonly type?: string | undefined;
  readonly direction?: 'out' | 'in' | undefined;
  readonly field?: string | undefined;
  readonly value?: string | undefined;
}

/** The query string the service is asked with, for one artifact's relationships. */
export function searchOf(filter: GraphFilter): string {
  const query = new URLSearchParams();
  if (filter.type) query.set('type', filter.type);
  if (filter.direction) query.set('direction', filter.direction);
  if (filter.field && filter.value !== undefined && filter.value !== '') {
    query.set('field', filter.field);
    query.set('value', filter.value);
  }
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

/** The query that answers a view of one artifact's relationships, as an integrator would ask it (REL-028). */
export function queryOf(id: string, filter: GraphFilter): string {
  return `GET /v1/artifacts/${id}/relationships${searchOf(filter)}`;
}
