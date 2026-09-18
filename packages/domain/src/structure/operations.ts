import { z } from 'zod';

import { inlineNodeSchema } from '../content/model/inline.js';

import {
  parseOutlineDocument,
  referenceModeSchema,
  referenceNodeSchema,
  sectionNodeSchema,
  walkOutline,
  type OutlineDocument,
  type OutlineNode,
} from './outline.js';

// Reused rather than restated: every identifier and every switch an operation names is the same zod
// schema the node itself carries (`sectionNodeSchema` and `referenceNodeSchema` share `positional`),
// so a member added to the node schema does not also need a matching edit here to stay in step.
const nodeIdentifier = sectionNodeSchema.shape.id;
const parentIdentifier = nodeIdentifier.nullable();
const position = z.number().int().min(0);

const newSectionSchema = z.strictObject({
  type: z.literal('section'),
  title: z.array(inlineNodeSchema),
});

const newReferenceSchema = z.strictObject({
  type: z.literal('reference'),
  component: referenceNodeSchema.shape.component,
  mode: referenceModeSchema,
});

/**
 * One structural act over one outline, as a strict object of the wire body's shape - the route's body
 * is exactly this closed union (C7), never a second definition of it.
 */
export const outlineOperationSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('insert'),
    parent: parentIdentifier,
    position,
    node: z.discriminatedUnion('type', [newSectionSchema, newReferenceSchema]),
  }),
  z.strictObject({
    operation: z.literal('move'),
    node: nodeIdentifier,
    parent: parentIdentifier,
    position,
  }),
  z.strictObject({
    operation: z.literal('remove'),
    node: nodeIdentifier,
  }),
  z.strictObject({
    operation: z.literal('retitle'),
    node: nodeIdentifier,
    title: z.array(inlineNodeSchema),
  }),
  z.strictObject({
    operation: z.literal('set'),
    node: nodeIdentifier,
    numbered: z.boolean().optional(),
    matter: sectionNodeSchema.shape.matter.optional(),
    pageBreak: sectionNodeSchema.shape.pageBreak.optional(),
    mode: referenceModeSchema.optional(),
    values: sectionNodeSchema.shape.values.optional(),
  }),
]);

export type OutlineOperation = z.infer<typeof outlineOperationSchema>;

export type OutlineApplied =
  | { readonly applied: true; readonly outline: OutlineDocument }
  | { readonly applied: false; readonly reason: string };

function refuse(reason: string): OutlineApplied {
  return { applied: false, reason };
}

function applyNodes(outline: OutlineDocument, nodes: readonly OutlineNode[]): OutlineApplied {
  return { applied: true, outline: parseOutlineDocument({ ...outline, nodes }) };
}

/** Depth-first; the first match wins, and STR-003's uniqueness is what makes that unambiguous. */
function findNode(nodes: readonly OutlineNode[], id: string): OutlineNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return undefined;
}

/** Takes one node out of the tree, subtree and all, and hands both back. */
function extractNode(
  nodes: readonly OutlineNode[],
  id: string,
): { readonly nodes: readonly OutlineNode[]; readonly node: OutlineNode | null } {
  const next: OutlineNode[] = [];
  let extracted: OutlineNode | null = null;
  for (const node of nodes) {
    if (node.id === id) {
      extracted = node;
      continue;
    }
    const child = extractNode(node.children, id);
    if (child.node !== null) {
      extracted = child.node;
      next.push({ ...node, children: child.nodes });
      continue;
    }
    next.push(node);
  }
  return { nodes: next, node: extracted };
}

/** Splices one whole node in among `parent`'s children (or the root, when `parent` is `null`). */
function spliceIn(
  nodes: readonly OutlineNode[],
  parent: string | null,
  at: number,
  node: OutlineNode,
): { readonly nodes: readonly OutlineNode[]; readonly ok: boolean } {
  if (parent === null) {
    const next = [...nodes];
    next.splice(at, 0, node);
    return { nodes: next, ok: true };
  }
  let ok = false;
  const next = nodes.map((candidate): OutlineNode => {
    if (candidate.id === parent) {
      ok = true;
      const children = [...candidate.children];
      children.splice(at, 0, node);
      return { ...candidate, children };
    }
    const child = spliceIn(candidate.children, parent, at, node);
    if (!child.ok) return candidate;
    ok = true;
    return { ...candidate, children: child.nodes };
  });
  return { nodes: next, ok };
}

/** Replaces one node, by identifier, wherever it sits - its own subtree travels with it unchanged. */
function replaceNode(
  nodes: readonly OutlineNode[],
  id: string,
  replacement: OutlineNode,
): { readonly nodes: readonly OutlineNode[]; readonly found: boolean } {
  let found = false;
  const next = nodes.map((node): OutlineNode => {
    if (node.id === id) {
      found = true;
      return replacement;
    }
    const child = replaceNode(node.children, id, replacement);
    if (!child.found) return node;
    found = true;
    return { ...node, children: child.nodes };
  });
  return { nodes: next, found };
}

/** A node's own identifier and every descendant's - what "inside its own subtree" means for move. */
function subtreeIds(node: OutlineNode): ReadonlySet<string> {
  const ids = new Set<string>();
  walkOutline([node], (member) => ids.add(member.id));
  return ids;
}

function insert(
  outline: OutlineDocument,
  operation: Extract<OutlineOperation, { operation: 'insert' }>,
  newIdentifier: () => string,
): OutlineApplied {
  const base = {
    id: newIdentifier(),
    numbered: true,
    matter: 'body' as const,
    pageBreak: 'none' as const,
    values: {},
    children: [],
  };
  const node: OutlineNode =
    operation.node.type === 'section'
      ? { type: 'section', title: operation.node.title, ...base }
      : {
          type: 'reference',
          component: operation.node.component,
          mode: operation.node.mode,
          ...base,
        };
  const result = spliceIn(outline.nodes, operation.parent, operation.position, node);
  if (!result.ok) return refuse('The parent is not in this outline');
  return applyNodes(outline, result.nodes);
}

function move(
  outline: OutlineDocument,
  operation: Extract<OutlineOperation, { operation: 'move' }>,
): OutlineApplied {
  const extracted = extractNode(outline.nodes, operation.node);
  if (extracted.node === null) return refuse('The node is not in this outline');
  // The subtree travels because it is the subtree: refuse before the node is spliced back in
  // anywhere within the part of the tree that is leaving with it - including itself.
  if (operation.parent !== null && subtreeIds(extracted.node).has(operation.parent)) {
    return refuse('A node cannot be moved inside its own subtree');
  }
  const result = spliceIn(extracted.nodes, operation.parent, operation.position, extracted.node);
  if (!result.ok) return refuse('The parent is not in this outline');
  return applyNodes(outline, result.nodes);
}

function remove(
  outline: OutlineDocument,
  operation: Extract<OutlineOperation, { operation: 'remove' }>,
): OutlineApplied {
  const extracted = extractNode(outline.nodes, operation.node);
  if (extracted.node === null) return refuse('The node is not in this outline');
  return applyNodes(outline, extracted.nodes);
}

function retitle(
  outline: OutlineDocument,
  operation: Extract<OutlineOperation, { operation: 'retitle' }>,
): OutlineApplied {
  const node = findNode(outline.nodes, operation.node);
  if (!node) return refuse('The node is not in this outline');
  if (node.type !== 'section') return refuse('Only a section can be retitled');
  const result = replaceNode(outline.nodes, operation.node, { ...node, title: operation.title });
  return applyNodes(outline, result.nodes);
}

function set(
  outline: OutlineDocument,
  operation: Extract<OutlineOperation, { operation: 'set' }>,
): OutlineApplied {
  const node = findNode(outline.nodes, operation.node);
  if (!node) return refuse('The node is not in this outline');
  if (operation.mode !== undefined && node.type !== 'reference') {
    return refuse('A mode belongs to a component reference, not a section');
  }
  // Only the switches this operation actually names, so one call can set one field without
  // disturbing the rest - built from entries, never a member assigned by a key spelled out by hand.
  const patch = Object.fromEntries(
    (['numbered', 'matter', 'pageBreak', 'mode', 'values'] as const)
      .filter((key) => operation[key] !== undefined)
      .map((key) => [key, operation[key]]),
  );
  const result = replaceNode(outline.nodes, operation.node, {
    ...node,
    ...patch,
  } as OutlineNode);
  return applyNodes(outline, result.nodes);
}

/**
 * One structural act over one outline, as a pure function (STR-018's determinism is a property of a
 * pure function, and this is where a tree operation can be property-tested without a database).
 *
 * `newIdentifier` is the caller's, because where randomness comes from is the caller's platform and
 * this package has none: `packages/db` passes `node:crypto`'s `randomBytes` through
 * `blockIdentifierFrom`, and a test passes a counter.
 *
 * Every return goes back through `parseOutlineDocument`, so an operation cannot produce an outline
 * the store would refuse - which is what lets the service apply one and record it without a second
 * validation nobody would keep in step.
 */
export function applyOutlineOperation(
  outline: OutlineDocument,
  operation: OutlineOperation,
  newIdentifier: () => string,
): OutlineApplied {
  switch (operation.operation) {
    case 'insert':
      return insert(outline, operation, newIdentifier);
    case 'move':
      return move(outline, operation);
    case 'remove':
      return remove(outline, operation);
    case 'retitle':
      return retitle(outline, operation);
    case 'set':
      return set(outline, operation);
  }
}
