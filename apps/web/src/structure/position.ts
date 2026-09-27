import { useEffect, type RefObject } from 'react';

/** Whether a change to the text added or removed a node's element, or anything holding one. */
function movesNodes(mutation: MutationRecord): boolean {
  const holdsNode = (each: Node) =>
    each instanceof Element &&
    (each.hasAttribute('data-node') || each.querySelector('[data-node]') !== null);
  return [...mutation.addedNodes, ...mutation.removedNodes].some(holdsNode);
}

/** How far down the window the line is that a node's heading must have reached to be where the reader is. */
const READING_LINE = 0.25;

/**
 * The node whose text is at the top of the column (document-view.md, "Navigation"; DV-H): of every
 * node in the text, in reading order, the last whose top has reached the reading line - the deepest
 * one begun - or the first where none has. Null where the text holds no node.
 */
export function nodeAtTop(root: ParentNode, line: number): string | null {
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-node]')];
  let found: string | null = nodes[0]?.getAttribute('data-node') ?? null;
  for (const element of nodes) {
    if (element.getBoundingClientRect().top <= line) found = element.getAttribute('data-node');
  }
  return found;
}

/**
 * Tells `onChange` the node the reader is at as they scroll (STR-035): asked again whenever a node's
 * text crosses the band at the top of the window, by an `IntersectionObserver` over every node in the
 * text - watched again as the text changes - or on every scroll where the browser has none.
 * `key` is what the text is of, so the observer starts again when a new document's text arrives.
 */
export function useReadingPosition(
  ref: RefObject<HTMLElement | null>,
  onChange: (node: string | null) => void,
  key: unknown,
): void {
  useEffect(() => {
    const root = ref.current;
    if (root === null) return undefined;
    const update = () => onChange(nodeAtTop(root, window.innerHeight * READING_LINE));
    update();
    if (typeof IntersectionObserver === 'undefined') {
      window.addEventListener('scroll', update, { passive: true });
      return () => window.removeEventListener('scroll', update);
    }
    const crossing = new IntersectionObserver(update, {
      rootMargin: `0px 0px -${(1 - READING_LINE) * 100}% 0px`,
    });
    const watch = () => {
      crossing.disconnect();
      for (const element of root.querySelectorAll('[data-node]')) crossing.observe(element);
    };
    watch();
    // Watched again only when a node's element comes or goes: an editor open in place changes the DOM
    // inside its node on every keystroke, and none of that moves where any node begins.
    const changed = new MutationObserver((mutations) => {
      if (!mutations.some(movesNodes)) return;
      watch();
      update();
    });
    changed.observe(root, { childList: true, subtree: true });
    return () => {
      crossing.disconnect();
      changed.disconnect();
    };
  }, [ref, onChange, key]);
}
