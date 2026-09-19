import type { InlineNode } from '../content/model/inline.js';

import type { Conditioned, NumberableNode, NumberingTable } from './numbering.js';

/**
 * One line of a table of contents (STR-040): a node, how deep it is, and its section number where it
 * has one. **Every node to the depth is a line**, numbered or not - a preface is in the contents with
 * no number, as it is in the outline - so the contents is walked from the outline and numbered from
 * the table, rather than read from the table's section entries, which hold only numbered nodes.
 */
export interface ContentsEntry {
  readonly node: string;
  readonly type: 'section' | 'reference';
  /** 1 for a top-level node. */
  readonly depth: number;
  readonly matter: 'body' | 'appendix';
  /** `null` for a node that takes no section number: unnumbered, or beneath one that is. */
  readonly number: string | null;
  /** A section's title; `null` for a reference, whose heading is its component's title. */
  readonly title: readonly InlineNode[] | null;
}

/** One line of a list of figures, of tables or of equations (STR-041). */
export interface ListEntry {
  readonly node: string;
  readonly block: string;
  /** `null` where the number is not known to whoever is listing (IAM-073), as the table says. */
  readonly number: string | null;
  readonly label: string | null;
  /** The caption the component holds, for a figure or a table; `null` for anything else. */
  readonly caption: string | null;
}

/**
 * A table of contents to a declared depth (STR-040): every node at that depth or above, in document
 * order, with the section number `number` gave it. **PUB** renders it, and PUB-037 declares the depth;
 * the structure comes from here. It reads the stage `number` read and the table it made, so it lists
 * what survives conditions (STR-042) once conditions exist.
 */
export function contents(
  conditioned: Conditioned,
  numbering: NumberingTable,
  depth: number,
): ContentsEntry[] {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new RangeError(`A table of contents is to a depth of at least 1, not ${depth}`);
  }
  const numbers = new Map(
    numbering.entries.flatMap((entry) =>
      entry.sequence === 'section' ? [[entry.node, entry.number] as const] : [],
    ),
  );
  const entries: ContentsEntry[] = [];
  const visit = (node: NumberableNode, at: number, matter: 'body' | 'appendix') => {
    if (at > depth) return;
    entries.push({
      node: node.id,
      type: node.type,
      depth: at,
      matter,
      number: numbers.get(node.id) ?? null,
      title: node.type === 'section' ? (node.title ?? []) : null,
    });
    for (const child of node.children) visit(child, at + 1, matter);
  };
  for (const node of conditioned.resolved.outline.nodes) visit(node, 1, node.matter);
  return entries;
}

/**
 * One sequence's entries, in document order, each with the caption its component holds (STR-041).
 * Figures, tables and equations are three calls; a sequence a layout adds is a fourth, with no new
 * function. An entry is a numbering table entry, so an unnumbered equation - which takes no number and
 * is no entry - is not listed, and a number the table withholds is withheld here too (IAM-073). A
 * caption is looked up by occurrence and block, because one component placed twice is listed twice.
 */
export function listOf(
  conditioned: Conditioned,
  numbering: NumberingTable,
  sequence: string,
): ListEntry[] {
  const captions = new Map<string, Map<string, string>>();
  for (const [node, list] of conditioned.resolved.contributions) {
    const held = new Map<string, string>();
    for (const each of list) if (each.caption !== undefined) held.set(each.block, each.caption);
    captions.set(node, held);
  }
  return numbering.entries.flatMap((entry) =>
    entry.sequence === sequence && entry.block !== null
      ? [
          {
            node: entry.node,
            block: entry.block,
            number: entry.number,
            label: entry.label,
            caption: captions.get(entry.node)?.get(entry.block) ?? null,
          },
        ]
      : [],
  );
}
