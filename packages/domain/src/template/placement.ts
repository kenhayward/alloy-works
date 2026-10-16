import type { OutlineMatter } from '../structure/outline.js';

/** Something placed at the outline's top level: in the block its matter names, at its start or end. */
export interface TopPlacement<T> {
  readonly matter: OutlineMatter;
  readonly at: 'start' | 'end';
  readonly node: T;
}

/**
 * The top level with these placed in it (TPL-049; the R9 plan, R9-A, and #660): front matter's block
 * is the leading front nodes, the appendices' the trailing appendix nodes, and the body everything
 * between, since the body and appendices may interleave (STR-016). Each is placed at its block's start
 * or end, those at one place in the order given. Shared by making a document and moving one, so a
 * component lands in the same place either way.
 */
export function placeAtTop<T extends { readonly matter: OutlineMatter }>(
  nodes: readonly T[],
  placed: readonly TopPlacement<T>[],
): T[] {
  const front = nodes.findIndex((node) => node.matter !== 'front');
  const opening = front < 0 ? nodes.length : front;
  let closing = nodes.length;
  while (closing > opening && nodes[closing - 1]!.matter === 'appendix') closing -= 1;
  const at = (matter: OutlineMatter, where: 'start' | 'end') =>
    placed.filter((each) => each.matter === matter && each.at === where).map((each) => each.node);
  return [
    ...at('front', 'start'),
    ...nodes.slice(0, opening),
    ...at('front', 'end'),
    ...at('body', 'start'),
    ...nodes.slice(opening, closing),
    ...at('body', 'end'),
    ...at('appendix', 'start'),
    ...nodes.slice(closing),
    ...at('appendix', 'end'),
  ];
}
