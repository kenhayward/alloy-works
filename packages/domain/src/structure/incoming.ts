import type { BlockNode } from '../content/model/blocks.js';
import type { CrossReferenceTarget, InlineNode } from '../content/model/inline.js';

/**
 * One reference in a document, bound to what it points at (STR-074): `from` the node it stands in -
 * the occurrence whose text holds it, or the section whose title does - `reference` its own
 * identifier, and `node` and `block` its target, `block` null for a node itself.
 */
export interface IncomingReference {
  readonly from: string;
  readonly reference: string;
  readonly node: string;
  readonly block: string | null;
}

/** The outline as the reader is shown it, or as stored: a withheld occurrence names no component. */
interface IncomingNode {
  readonly id: string;
  readonly type: 'section' | 'reference';
  readonly title?: readonly InlineNode[];
  readonly component?: string | null;
  readonly children: readonly IncomingNode[];
}

export interface IncomingInput {
  readonly outline: { readonly nodes: readonly IncomingNode[] };
  /** Each occurrence's content the reader may read, by its node. Absent: never read, so never counted. */
  readonly occurrences: ReadonlyMap<string, readonly BlockNode[]>;
}

/**
 * **What in its own document references a node** (STR-074; structure.md, the reference index read
 * backwards): every reference in a section title or a readable occurrence's text is bound once, as
 * `referenceResolver` binds it, and the function returned answers, for a node, each reference to it or
 * to anything in it - a block of an occurrence, a node beneath a section - **from outside it**, in
 * document order. A reference inside the node goes with it, so it is not counted: that is what
 * removing the node would break, and nothing else.
 *
 * A reference that binds to nothing is not counted: a block not there, a node not in the outline, a
 * component placed twice or nowhere (STR-062). Text not given - an occurrence the reader may not read -
 * is never read, and a withheld occurrence names no component a reference could bind to (SCH-032).
 * One walk of the text, then each answer in the number of references.
 */
export function incomingReferences(
  input: IncomingInput,
): (node: string) => readonly IncomingReference[] {
  const parent = new Map<string, string | null>();
  const placements = new Map<string, string[]>();
  const order: IncomingNode[] = [];
  const byId = new Map<string, IncomingNode>();
  const mark = (nodes: readonly IncomingNode[], above: string | null) => {
    for (const node of nodes) {
      parent.set(node.id, above);
      order.push(node);
      byId.set(node.id, node);
      if (node.type === 'reference' && typeof node.component === 'string') {
        placements.set(node.component, [...(placements.get(node.component) ?? []), node.id]);
      }
      mark(node.children, node.id);
    }
  };
  mark(input.outline.nodes, null);

  const blocksOf = new Map<string, Set<string>>();
  const found: { from: string; reference: string; target: CrossReferenceTarget }[] = [];
  for (const node of order) {
    if (node.type === 'section') {
      references(node.title ?? [], (reference, target) =>
        found.push({ from: node.id, reference, target }),
      );
      continue;
    }
    const content = input.occurrences.get(node.id);
    if (content === undefined) continue;
    const ids = new Set<string>();
    for (const block of content) {
      walk(block, ids, (reference, target) => found.push({ from: node.id, reference, target }));
    }
    blocksOf.set(node.id, ids);
  }

  const bound: IncomingReference[] = [];
  const inOccurrence = (from: string, reference: string, node: string, block: string) => {
    if (blocksOf.get(node)?.has(block)) bound.push({ from, reference, node, block });
  };
  for (const { from, reference, target } of found) {
    switch (target.kind) {
      case 'block':
        inOccurrence(from, reference, from, target.block);
        break;
      case 'component': {
        const reader = byId.get(from);
        if (reader?.type === 'reference' && reader.component === target.component) {
          inOccurrence(from, reference, from, target.block);
          break;
        }
        const placed = placements.get(target.component) ?? [];
        if (placed.length === 1) inOccurrence(from, reference, placed[0]!, target.block);
        break;
      }
      case 'node':
        if (parent.has(target.node))
          bound.push({ from, reference, node: target.node, block: null });
        break;
    }
  }

  const within = (node: string, root: string): boolean => {
    for (let at: string | null | undefined = node; at != null; at = parent.get(at)) {
      if (at === root) return true;
    }
    return false;
  };
  return (node) => bound.filter((each) => within(each.node, node) && !within(each.from, node));
}

type Found = (reference: string, target: CrossReferenceTarget) => void;

/** Every reference in some inline content, a footnote's paragraphs included. */
function references(inlines: readonly InlineNode[], found: Found, ids?: Set<string>): void {
  for (const inline of inlines) {
    if (inline.type === 'crossReference') found(inline.id, inline.target);
    if (inline.type !== 'footnote') continue;
    ids?.add(inline.id);
    for (const paragraph of inline.content as readonly BlockNode[]) walk(paragraph, ids, found);
  }
}

/**
 * A block, everything it holds and every inline home it has, as `findIn` in references.ts walks one:
 * its identifiers into `ids`, its references to `found`. A `default:` that refuses what it cannot name,
 * so a new kind of block fails to compile here rather than its references going unfound.
 */
function walk(block: BlockNode, ids: Set<string> | undefined, found: Found): void {
  ids?.add(block.id);
  switch (block.type) {
    case 'paragraph':
      references(block.content, found, ids);
      return;
    case 'list':
      for (const item of block.items) {
        references(item.term ?? [], found, ids);
        for (const each of item.content) walk(each, ids, found);
      }
      return;
    case 'blockquote':
      for (const each of block.content) walk(each, ids, found);
      references(block.attribution ?? [], found, ids);
      return;
    case 'preformatted':
    case 'equation':
      return;
    case 'table':
      references(block.caption, found, ids);
      for (const row of block.rows) {
        for (const cell of row.cells) for (const each of cell.content) walk(each, ids, found);
      }
      references(block.note ?? [], found, ids);
      return;
    case 'boundTable':
      references(block.caption, found, ids);
      references(block.note ?? [], found, ids);
      references(block.source ?? [], found, ids);
      return;
    case 'figure':
      references(block.caption, found, ids);
      return;
    default: {
      const unreachable: never = block;
      throw new Error(`No walk for a block of kind ${(unreachable as BlockNode).type}`);
    }
  }
}
