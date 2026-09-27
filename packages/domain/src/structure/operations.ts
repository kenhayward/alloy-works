import { z } from 'zod';

import type { MetadataFailure } from '../metadata/failure.js';
import type { EffectiveField } from '../metadata/resolve.js';
import { checkWrittenValues, writtenValues } from '../metadata/write.js';
import { storableEverywhere } from '../stored/storable.js';

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
  title: sectionNodeSchema.shape.title,
});

const newReferenceSchema = z.strictObject({
  type: z.literal('reference'),
  component: referenceNodeSchema.shape.component,
  mode: referenceModeSchema,
});

/**
 * One structural act over one outline, as a strict object of the wire body's shape - the route's body
 * is exactly this closed union (C7), never a second definition of it.
 *
 * This is the one gate between an untrusted body and the tree: `applyOutlineOperation` does not
 * re-parse its `operation` argument, so whatever this schema lets through is what the tree sees.
 */
export const outlineOperationSchema = z
  .discriminatedUnion('operation', [
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
      title: sectionNodeSchema.shape.title,
    }),
    z.strictObject({
      operation: z.literal('set'),
      node: nodeIdentifier,
      numbered: z.boolean().optional(),
      matter: sectionNodeSchema.shape.matter.optional(),
      pageBreak: sectionNodeSchema.shape.pageBreak.optional(),
      mode: referenceModeSchema.optional(),
      // A section's field values, whole (STR-060): what they may hold is its document's template's,
      // which `applyOutlineOperation` is given as its rules and checks them against. Storable here,
      // as a title is, so a character Postgres cannot hold is the caller's mistake and not a 500.
      // An insert carries none at all.
      values: z
        .record(z.string(), z.unknown())
        .refine(storableEverywhere, 'A value holds a character that cannot be stored')
        .optional()
        .describe(
          "A section's field values, whole: each a field its document's template applies to sections",
        ),
    }),
  ])
  .refine(
    // A `set` naming no switch would still apply, changing nothing - and downstream that records a
    // new version whose digest equals its parent's, for a caller who asked for a change. Refused at
    // the wire body itself, rather than left for `applyOutlineOperation` to notice at the tree.
    (operation) =>
      operation.operation !== 'set' ||
      operation.numbered !== undefined ||
      operation.matter !== undefined ||
      operation.pageBreak !== undefined ||
      operation.mode !== undefined ||
      operation.values !== undefined,
    'A set operation must name at least one switch',
  );

export type OutlineOperation = z.infer<typeof outlineOperationSchema>;

export type OutlineApplied =
  | { readonly applied: true; readonly outline: OutlineDocument }
  | {
      readonly applied: false;
      readonly reason: string;
      /** Each value a `set` wrote that its field refuses, in MET-022's shape (STR-060). */
      readonly failures?: readonly MetadataFailure[];
    };

/**
 * What a document's template holds its outline to (templates.md, "What an author may change" and
 * "Values"): which changes to its sections it allows (TPL-015), and the fields a section's values
 * may hold (STR-060). A document with no template has neither: nothing is refused on its account,
 * and a section has no field to hold a value for.
 */
export interface OutlineRules {
  readonly changes?: { readonly add: boolean; readonly remove: boolean; readonly reorder: boolean };
  readonly sectionFields?: readonly EffectiveField[];
}

function refuse(reason: string): OutlineApplied {
  return { applied: false, reason };
}

/** TPL-015's refusals, in words an author can act on, as FRONT_FIRST's are. */
const NOT_ADDED = "This document's template does not allow sections to be added";
const NOT_REMOVED = "This document's template does not allow sections to be removed";
const NOT_REORDERED = "This document's template does not allow sections to be reordered";
const VALUES_REFUSED = 'A value does not fit its field';
const REFERENCE_VALUES = "A component reference holds no values: a component's are its own";

/**
 * TPL-015, before anything else about the operation: an insert of a section, a removal of one or a
 * move of one that the template's `changes` forbids. A component reference is never held - placing,
 * moving and removing components is what writing a document is.
 */
function forbidden(
  outline: OutlineDocument,
  operation: OutlineOperation,
  changes: OutlineRules['changes'],
): OutlineApplied | undefined {
  if (changes === undefined) return undefined;
  if (operation.operation === 'insert') {
    return operation.node.type === 'section' && !changes.add ? refuse(NOT_ADDED) : undefined;
  }
  if (operation.operation === 'remove' || operation.operation === 'move') {
    if (findNode(outline.nodes, operation.node)?.type !== 'section') return undefined;
    if (operation.operation === 'remove' && !changes.remove) return refuse(NOT_REMOVED);
    if (operation.operation === 'move' && !changes.reorder) return refuse(NOT_REORDERED);
  }
  return undefined;
}

/**
 * Every return goes back through `parseOutlineDocument`, so an operation cannot hand back an outline
 * the store would refuse - which is what lets the service apply one and record it without a second
 * validation nobody would keep in step. Total, not merely pure: nothing in this file should ever make
 * `parseOutlineDocument` throw, but a caller branching on `applied` must never be able to meet an
 * exception instead of a `false` - so a throw here becomes a refusal, not a 500 two layers up.
 *
 * The refusal is a constant, never the caught error's own message: `parseOutlineDocument` throws a
 * raw `ZodError` message, which can run to several lines and names internal shapes - preflight C6
 * routes a refusal's `reason` straight to the wire, so the exception text must never reach it.
 */
const UNSTORABLE_RESULT = 'This operation would produce an outline that cannot be stored';

/**
 * STR-064's refusal, in words a person can act on, because an author meets this one in the ordinary
 * course of editing - inserting a section above a preface, or moving the preface down - where the
 * generic constant above would say nothing useful. Checked over the resulting top level before the
 * parse, which holds the same rule and would otherwise answer first with its own (unshown) message:
 * one check, so insert, move and set are refused alike.
 */
const FRONT_FIRST = 'Front matter comes before the rest of the outline';

function applyNodes(outline: OutlineDocument, nodes: readonly OutlineNode[]): OutlineApplied {
  const firstNotFront = nodes.findIndex((node) => node.matter !== 'front');
  if (firstNotFront >= 0 && nodes.slice(firstNotFront).some((node) => node.matter === 'front')) {
    return refuse(FRONT_FIRST);
  }
  try {
    return { applied: true, outline: parseOutlineDocument({ ...outline, nodes }) };
  } catch {
    return refuse(UNSTORABLE_RESULT);
  }
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

/** The children `parent` would receive a spliced-in node into - the root's own, when `parent` is `null`. */
function childrenOf(
  nodes: readonly OutlineNode[],
  parent: string | null,
): readonly OutlineNode[] | undefined {
  if (parent === null) return nodes;
  return findNode(nodes, parent)?.children;
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

/**
 * Splices one whole node in among `parent`'s children (or the root, when `parent` is `null`), at
 * `at`. The caller has already checked `parent` exists and `at` is within bounds (`childrenOf`); this
 * only performs the splice, recursing into every branch rather than stopping at the first match,
 * because node identifiers are unique (STR-003) so at most one branch ever actually changes.
 */
function spliceIn(
  nodes: readonly OutlineNode[],
  parent: string | null,
  at: number,
  node: OutlineNode,
): readonly OutlineNode[] {
  if (parent === null) {
    const next = [...nodes];
    next.splice(at, 0, node);
    return next;
  }
  return nodes.map((candidate): OutlineNode => {
    if (candidate.id === parent) {
      const children = [...candidate.children];
      children.splice(at, 0, node);
      return { ...candidate, children };
    }
    return { ...candidate, children: spliceIn(candidate.children, parent, at, node) };
  });
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
  const children = childrenOf(outline.nodes, operation.parent);
  if (children === undefined) return refuse('The parent is not in this outline');
  if (operation.position > children.length) {
    return refuse('The position is past the end of these children');
  }
  // Allocated only once the operation is known to apply, so a refused insert burns no identifier.
  const base = {
    id: newIdentifier(),
    numbered: true,
    matter: 'body' as const,
    pageBreak: 'none' as const,
    values: {},
    children: [],
  };
  // `base` spread first: a member added to it later overrides nothing an arm below sets on purpose,
  // rather than silently shadowing it (task 2 review, finding 12).
  const node: OutlineNode =
    operation.node.type === 'section'
      ? { ...base, type: 'section', title: operation.node.title }
      : {
          ...base,
          type: 'reference',
          component: operation.node.component,
          mode: operation.node.mode,
        };
  return applyNodes(outline, spliceIn(outline.nodes, operation.parent, operation.position, node));
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
  const children = childrenOf(extracted.nodes, operation.parent);
  if (children === undefined) return refuse('The parent is not in this outline');
  if (operation.position > children.length) {
    return refuse('The position is past the end of these children');
  }
  // `position` counts `parent`'s children once `node` has already left them (`extracted.nodes`, the
  // outline with `node` already taken out) - a post-removal index, not a pre-removal one. Moving the
  // first of three siblings to position 2 therefore lands it last, not second: the two it is counted
  // among are the two that are left, not the three that were there before it moved. Pinned by
  // `operations.test.ts`'s reorder test, because task 5's drag-and-drop could read the other
  // convention with no test here failing otherwise.
  return applyNodes(
    outline,
    spliceIn(extracted.nodes, operation.parent, operation.position, extracted.node),
  );
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
  sectionFields: readonly EffectiveField[],
): OutlineApplied {
  const node = findNode(outline.nodes, operation.node);
  if (!node) return refuse('The node is not in this outline');
  if (operation.mode !== undefined && node.type !== 'reference') {
    return refuse('A mode belongs to a component reference, not a section');
  }
  if (operation.values !== undefined) {
    if (node.type !== 'section') return refuse(REFERENCE_VALUES);
    const failures = checkWrittenValues(sectionFields, operation.values);
    if (failures.length > 0) return { applied: false, reason: VALUES_REFUSED, failures };
  }
  // Only the switches this operation actually names, so one call can set one field without
  // disturbing the rest - built from entries, never a member assigned by a key spelled out by hand.
  // `outlineOperationSchema`'s own refine already refuses a `set` naming none of them.
  const patch: Record<string, unknown> = Object.fromEntries(
    (['numbered', 'matter', 'pageBreak', 'mode'] as const)
      .filter((key) => operation[key] !== undefined)
      .map((key) => [key, operation[key]]),
  );
  // Written whole, with the default of each field the author left without a member (STR-060).
  if (operation.values !== undefined) {
    patch.values = writtenValues(sectionFields, operation.values);
  }
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
 * `blockIdentifierFrom`, and a test passes a counter. `rules` are the document's template's, read by
 * the caller at the template version the document recorded; a document with no template passes none.
 */
export function applyOutlineOperation(
  outline: OutlineDocument,
  operation: OutlineOperation,
  newIdentifier: () => string,
  rules: OutlineRules = {},
): OutlineApplied {
  const refused = forbidden(outline, operation, rules.changes);
  if (refused) return refused;
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
      return set(outline, operation, rules.sectionFields ?? []);
  }
}
