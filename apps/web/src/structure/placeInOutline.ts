import {
  conditions,
  number,
  resolve,
  sectionNumbers,
  walkOutline,
  type Contribution,
  type NumberingScheme,
  type OutlineView,
  type OutlineViewNode,
} from '@alloy-works/domain';

import { nodeName, type Names } from './tree.js';
import { words as say } from '../words/words.js';

const NOTHING_KNOWN: ReadonlyMap<string, readonly Contribution[]> = new Map();

/**
 * Where a node is, in words a failure can be read by: its section number, if it has one, and its
 * name - a section's title, or for a reference its component's, and **A component** wherever the
 * reader may not read it. Section numbers depend on the outline alone, so none is withheld; the node
 * is looked for in the outline the page holds, so nothing of a component the service withheld can be
 * named. A node the outline no longer holds is said to be gone.
 */
export function placeInOutline(
  outline: OutlineView,
  node: string,
  names: Names,
  scheme: NumberingScheme | null,
): string {
  // Collected rather than assigned from the callback, which TypeScript's narrowing cannot follow.
  const held: OutlineViewNode[] = [];
  walkOutline(outline.nodes, (each) => {
    if (each.id === node) held.push(each);
  });
  const [found] = held;
  if (found === undefined) return say('document.a-part-no-longer-in');
  if (scheme === null) return nodeName(found, names);
  const numbers = sectionNumbers(
    number(conditions(resolve(outline, NOTHING_KNOWN), outline.profile?.values ?? {}), scheme),
  );
  const numbered = numbers.get(node);
  return numbered === undefined ? nodeName(found, names) : `${numbered} ${nodeName(found, names)}`;
}
