import type { OutlineViewNode } from '@alloy-works/domain';

import type { Uses } from '../reuse/UsedIn.js';
import { placeOf } from './tree.js';

type SectionNode = Extract<OutlineViewNode, { type: 'section' }>;
type Title = SectionNode['title'];

/**
 * A number typed into a title: digits or a capital, then dotted parts, with at least one dot, then a
 * space and more words. The dot is what keeps "A study" and "3 dimensions" out.
 */
const TYPED = /^((?:\d+|[A-Z])(?:\.\d+)*\.?)\s+(?=\S)/u;

/** The number a title opens with as plain words, or null (the plan, R2). */
export function typedNumber(title: Title): string | null {
  const first = title[0];
  if (first?.type !== 'text') return null;
  const found = TYPED.exec(first.value)?.[1];
  return found?.includes('.') === true ? found : null;
}

/** The title with its typed number and the space after it taken off. */
export function withoutTypedNumber(title: Title): Title {
  const [first, ...rest] = title;
  if (first?.type !== 'text') return title;
  return [{ ...first, value: first.value.replace(TYPED, '') }, ...rest];
}

/** Whether a typed number is the number given, its closing dot aside. */
export function sameNumber(typed: string, number: string): boolean {
  const bare = (each: string) => each.replace(/\.$/u, '');
  return bare(typed) === bare(number);
}

/** The outline with a part and everything above it numbered: what its number would be, were it. */
export function numberedOn(
  nodes: readonly OutlineViewNode[],
  id: string,
): readonly OutlineViewNode[] {
  return nodes.map((node) => {
    if (node.id === id) return { ...node, numbered: true };
    const children = numberedOn(node.children, id);
    return children.some((child, at) => child !== node.children[at])
      ? { ...node, numbered: true, children: [...children] }
      : node;
  });
}

/** What holds a part, null at the top, and the matter of the top of its branch (STR-016). */
export function whereItSits(
  nodes: readonly OutlineViewNode[],
  id: string,
): { readonly parent: OutlineViewNode | null; readonly matter: OutlineViewNode['matter'] } {
  const place = placeOf(nodes, id);
  let top = place?.node;
  for (let at = place?.parent ?? null; at !== null; at = placeOf(nodes, at.id)?.parent ?? null) {
    top = at;
  }
  return { parent: place?.parent ?? null, matter: top?.matter ?? 'body' };
}

/** How many components a part places, itself or beneath, those the reader may not read among them. */
export function componentsBeneath(node: OutlineViewNode): number {
  return (
    (node.type === 'reference' ? 1 : 0) +
    node.children.reduce((sum, child) => sum + componentsBeneath(child), 0)
  );
}

/** What a used-in row says of the rest of the world. */
export type Elsewhere =
  | { readonly kind: 'only' }
  | { readonly kind: 'more'; readonly count: number }
  | { readonly kind: 'elsewhere' };

/**
 * Where else a component is used. A document the reader may not read is said to exist and never
 * counted (`ComponentUsesView`), so a count or "only here" would then be untrue (the plan, R3).
 */
export function usedElsewhere(uses: Uses, document: string): Elsewhere {
  if (uses.unreadableDocuments) return { kind: 'elsewhere' };
  const count = uses.documents.filter((each) => each.id !== document).length;
  return count === 0 ? { kind: 'only' } : { kind: 'more', count };
}
