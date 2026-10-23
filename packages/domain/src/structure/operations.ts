import { z } from 'zod';

import type { MetadataFailure } from '../metadata/failure.js';
import type { EffectiveField } from '../metadata/resolve.js';
import { checkWrittenValues, writtenValues } from '../metadata/write.js';
import { CONDITIONS_MAX, conditionsSchema } from '../content/model/marks.js';
import { storableEverywhere } from '../stored/storable.js';

import {
  parseOutlineDocument,
  referenceModeSchema,
  referenceNodeSchema,
  sectionNodeSchema,
  TITLE_LANGUAGES_MOST,
  translatedTitleSchema,
  walkOutline,
  type OutlineDocument,
  type OutlineNode,
} from './outline.js';
import { contentDocumentSchema } from '../content/model/document.js';
import { OVERRIDES_MAX, overrideSchema } from './overrides.js';

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
      /** Why, where it takes a section the template requires (TPL-029); kept on the document. */
      reason: z.string().max(2000).optional(),
    }),
    z.strictObject({
      operation: z.literal('retitle'),
      node: nodeIdentifier,
      title: sectionNodeSchema.shape.title,
    }),
    // A title in a further language, the document's (`node` null) or a section's, or null to clear
    // it (the TR plan, TR-L).
    z.strictObject({
      operation: z.literal('translateTitle'),
      node: nodeIdentifier.nullable(),
      language: contentDocumentSchema.shape.language,
      title: translatedTitleSchema.nullable(),
    }),
    z.strictObject({
      operation: z.literal('set'),
      node: nodeIdentifier,
      numbered: z.boolean().optional(),
      matter: sectionNodeSchema.shape.matter.optional(),
      pageBreak: sectionNodeSchema.shape.pageBreak.optional(),
      mode: referenceModeSchema.optional(),
      // A reference's local overrides, whole (REU-011; the R4 plan, R4-B): `[]` clears them.
      overrides: z
        .array(overrideSchema)
        .max(OVERRIDES_MAX)
        .refine(
          (each) => new Set(each.map((one) => one.block)).size === each.length,
          'A block is overridden once',
        )
        .optional(),
      // A node's conditions, whole (REU-021; the R11 plan, R11-A): `[]` clears them.
      conditions: z.array(conditionsSchema.element).max(CONDITIONS_MAX).optional(),
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
      operation.overrides !== undefined ||
      operation.conditions !== undefined ||
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
  /** The template's required starting sections, by key: each removed only with a reason (TPL-029). */
  readonly required?: readonly string[];
}

function refuse(reason: string): OutlineApplied {
  return { applied: false, reason };
}

/** TPL-015's refusals, in words an author can act on, as FRONT_FIRST's are. */
const NOT_ADDED = "This document's template does not allow sections to be added";
const NOT_REMOVED = "This document's template does not allow sections to be removed";
const NOT_REORDERED = "This document's template does not allow sections to be reordered";
const REASON_NEEDED = "A section this document's template requires is removed only with a reason";
const COMPONENT_REASON_NEEDED =
  "A component this document's template requires is removed only with a reason";
const VALUES_REFUSED = 'A value does not fit its field';
const REFERENCE_VALUES = "A component reference holds no values: a component's are its own";

/**
 * TPL-015, before anything else about the operation: an insert of a section, a removal of one or a
 * move of one that the template's `changes` forbids. A component reference is never held - placing,
 * moving and removing components is what writing a document is - except for a section it carries:
 * a removal or a move takes the whole subtree, so a section inside it is removed or moved too, and a
 * reference must not be a way round the rule for sections.
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
    const node = findNode(outline.nodes, operation.node);
    if (node === undefined) return undefined;
    let carriesSection = false;
    walkOutline([node], (member) => {
      if (member.type === 'section') carriesSection = true;
    });
    if (!carriesSection) return undefined;
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

/** Whether one language tag serves another: equal, or either a range of the other (TR-I). */
const serves = (a: string, b: string) => {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  return x === y || x.startsWith(`${y}-`) || y.startsWith(`${x}-`);
};

/** A title's words in a further language, set or cleared (TR-L): never in the outline's own. */
function translateTitle(
  outline: OutlineDocument,
  operation: Extract<OutlineOperation, { operation: 'translateTitle' }>,
): OutlineApplied {
  if (serves(outline.language, operation.language)) {
    return refuse(`The title is in ${outline.language} already: change it there`);
  }
  // One title a language, its tag matched whatever its case (the TR final review).
  const asked = operation.language.toLowerCase();
  const titled = <T extends { readonly titles?: Readonly<Record<string, string>> | undefined }>(
    holder: T,
  ): T | null => {
    const rest = Object.fromEntries(
      Object.entries(holder.titles ?? {}).filter(([tag]) => tag.toLowerCase() !== asked),
    );
    const titles =
      operation.title === null ? rest : { ...rest, [operation.language]: operation.title };
    if (Object.keys(titles).length > TITLE_LANGUAGES_MOST) return null;
    const { titles: dropped, ...bare } = holder;
    void dropped;
    return (Object.keys(titles).length === 0 ? bare : { ...bare, titles }) as T;
  };
  const tooMany = refuse(`A title is given in at most ${TITLE_LANGUAGES_MOST} further languages`);
  if (operation.node === null) {
    const outlined = titled(outline);
    return outlined === null ? tooMany : { applied: true, outline: outlined };
  }
  const node = findNode(outline.nodes, operation.node);
  if (!node) return refuse('The node is not in this outline');
  if (node.type !== 'section') return refuse('Only a section has a title to translate');
  const renamed = titled(node);
  if (renamed === null) return tooMany;
  const result = replaceNode(outline.nodes, operation.node, renamed);
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
  if (operation.overrides !== undefined && node.type !== 'reference') {
    return refuse('An override belongs to a component reference, not a section');
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
  // Overrides whole, as values are; none at all is no member (R4-B).
  let next = { ...node, ...patch } as OutlineNode;
  if (operation.overrides !== undefined && next.type === 'reference') {
    const { overrides: dropped, ...rest } = next;
    void dropped;
    next = operation.overrides.length === 0 ? rest : { ...rest, overrides: operation.overrides };
  }
  // Conditions whole too, none at all no member, so clearing them restores the digest (R11-A).
  if (operation.conditions !== undefined) {
    const { conditions: dropped, ...rest } = next;
    void dropped;
    next = (
      operation.conditions.length === 0 ? rest : { ...rest, conditions: operation.conditions }
    ) as OutlineNode;
  }
  const result = replaceNode(outline.nodes, operation.node, next);
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
  // TPL-029, TPL-044: a section or a component the template requires goes only with a reason,
  // whatever carries it.
  if (operation.operation === 'remove' && (rules.required?.length ?? 0) > 0) {
    const node = findNode(outline.nodes, operation.node);
    let required: 'section' | 'reference' | undefined;
    if (node !== undefined) {
      walkOutline([node], (member) => {
        if (member.origin !== undefined && rules.required!.includes(member.origin)) {
          required ??= member.type;
        }
      });
    }
    if (required !== undefined && (operation.reason ?? '').trim() === '') {
      return refuse(required === 'section' ? REASON_NEEDED : COMPONENT_REASON_NEEDED);
    }
  }
  switch (operation.operation) {
    case 'insert':
      return insert(outline, operation, newIdentifier);
    case 'move':
      return move(outline, operation);
    case 'remove':
      return remove(outline, operation);
    case 'retitle':
      return retitle(outline, operation);
    case 'translateTitle':
      return translateTitle(outline, operation);
    case 'set':
      return set(outline, operation, rules.sectionFields ?? []);
  }
}

type ReferenceMode = Extract<OutlineNode, { type: 'reference' }>['mode'];

/** A reference taking another version (CNT-182): its node, its component, its mode before and after. */
export interface Repoint {
  readonly node: string;
  readonly component: string;
  readonly from: ReferenceMode;
  readonly to: ReferenceMode;
}

const sameMode = (a: ReferenceMode, b: ReferenceMode) =>
  a.kind === b.kind && (a.kind !== 'pinned' || a.version === (b as typeof a).version);

/** Each node by its identifier, with its parent's, or null at the top. */
function placed(
  outline: OutlineDocument,
): Map<string, { node: OutlineNode; parent: string | null }> {
  const found = new Map<string, { node: OutlineNode; parent: string | null }>();
  const walk = (nodes: readonly OutlineNode[], parent: string | null) => {
    for (const node of nodes) {
      found.set(node.id, { node, parent });
      walk(node.children, node.id);
    }
  };
  walk(outline.nodes, null);
  return found;
}

/**
 * Each reference in both outlines whose mode differs (the RS plan, RS-G): what the outline's `set`
 * and a document's restore record as `reference.repointed`. A reference in only one of them, inserted
 * or removed, is not a re-point, nor is one moved.
 */
export function repointsBetween(before: OutlineDocument, after: OutlineDocument): Repoint[] {
  const was = placed(before);
  const repoints: Repoint[] = [];
  walkOutline(after.nodes, (node) => {
    const old = was.get(node.id)?.node;
    if (node.type !== 'reference' || old?.type !== 'reference') return;
    if (old.component !== node.component || sameMode(old.mode, node.mode)) return;
    repoints.push({ node: node.id, component: node.component, from: old.mode, to: node.mode });
  });
  return repoints;
}

/**
 * TPL-015 over a whole outline replacing another, as a restore does (the RS plan, RS-F): each change
 * to its sections the template's `changes` forbids, in `forbidden`'s words - a section only in the
 * restored outline is added, one only in the latest removed, and one in both under another parent or
 * in another order reordered. A component reference is never held.
 */
export function outlineChangesRefused(
  latest: OutlineDocument,
  restored: OutlineDocument,
  changes: NonNullable<OutlineRules['changes']>,
): string[] {
  const sections = (outline: OutlineDocument) =>
    [...placed(outline)].filter(([, { node }]) => node.type === 'section');
  const before = new Map(sections(latest));
  const after = new Map(sections(restored));
  const both = [...after.keys()].filter((key) => before.has(key));
  const reasons: string[] = [];
  if (!changes.add && [...after.keys()].some((key) => !before.has(key))) reasons.push(NOT_ADDED);
  if (!changes.remove && [...before.keys()].some((key) => !after.has(key))) {
    reasons.push(NOT_REMOVED);
  }
  const order = [...before.keys()].filter((key) => after.has(key));
  const reordered =
    order.some((key, index) => key !== both[index]) ||
    both.some((key) => before.get(key)!.parent !== after.get(key)!.parent);
  if (!changes.reorder && reordered) reasons.push(NOT_REORDERED);
  return reasons;
}
