import { useEffect, type RefObject } from 'react';

/** Whether a change to the text added or removed a node's element, or anything holding one. */
function movesNodes(mutation: MutationRecord): boolean {
  const holdsNode = (each: Node) =>
    each instanceof Element &&
    (each.hasAttribute('data-node') || each.querySelector('[data-node]') !== null);
  return [...mutation.addedNodes, ...mutation.removedNodes].some(holdsNode);
}

/**
 * How long a link waits for the placed components' texts before it goes to its node anyway: the texts
 * set where the node falls, but a request that never answers must not leave the reader at the top.
 */
export const LINK_WAITS_MS = 5_000;

/** The input by which a reader scrolls the page themselves: a key among `SCROLLING_KEYS`, for a key. */
export const SCROLL_INPUTS = ['wheel', 'touchmove', 'keydown'] as const;

/** The keys the browser scrolls the page by. */
export const SCROLLING_KEYS: ReadonlySet<string> = new Set([
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
  ' ',
]);

/**
 * What the reader does that lets go of a linked node the page is holding in place: anything at all -
 * a scroll of their own, a key, a press of the pointer - since any of it may move the page, and the
 * hold would pull it back.
 */
export const HOLD_ENDS_ON = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;

/**
 * Holds a linked node where the page went to it (STR-045, issue #350), and answers how to let go.
 *
 * Going to the node once is not enough: what is above it keeps changing height after the texts arrive
 * - the theme, asked for beside the texts, may answer after them, and its faces are fetched only once
 * text set in them is drawn - and the browser's own scroll anchoring does not hold the node through
 * it, so it was left anywhere from a few pixels under the header to off the screen altogether. So
 * whenever the text's column changes size, which it does with every height inside it, the node is
 * scrolled into view again.
 *
 * It lets go at the reader's first act (`HOLD_ENDS_ON`), when the window is scrolled while the node
 * has not moved - the reader's own scroll by some other means, a scrollbar dragged - or when the node
 * leaves the text. A scroll heard while the node has moved is the layout's, the window pulled up by a
 * page grown shorter, and the node is gone to again.
 */
export function holdInPlace(find: () => Element | null, column: Element): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  /** Where the node stands in the document, and where the window was, as the hold last left them. */
  let nodeAt = 0;
  let windowAt = 0;
  const standing = (node: Element) => node.getBoundingClientRect().top + window.scrollY;
  const align = () => {
    const node = find();
    if (node === null) {
      release();
      return;
    }
    node.scrollIntoView?.({ block: 'start' });
    nodeAt = standing(node);
    windowAt = window.scrollY;
  };
  const scrolled = () => {
    const node = find();
    if (node === null) release();
    else if (Math.abs(standing(node) - nodeAt) >= 1) align();
    else if (Math.abs(window.scrollY - windowAt) >= 1) release();
  };
  const acted = () => release();
  const observer = new ResizeObserver(() => align());
  const options = { capture: true, passive: true } as const;
  function release() {
    observer.disconnect();
    window.removeEventListener('scroll', scrolled);
    for (const kind of HOLD_ENDS_ON) window.removeEventListener(kind, acted, options);
  }
  const node = find();
  if (node === null) return () => undefined;
  nodeAt = standing(node);
  windowAt = window.scrollY;
  observer.observe(column);
  window.addEventListener('scroll', scrolled, { passive: true });
  for (const kind of HOLD_ENDS_ON) window.addEventListener(kind, acted, options);
  return release;
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
