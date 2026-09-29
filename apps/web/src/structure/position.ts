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

/**
 * What the reader does that is theirs to do with the page: anything at all - a scroll of their own, a
 * key other than a modifier alone, a press of the pointer - since any of it may move the page. A link
 * waiting to go to its node does not go, and one holding its node lets go (STR-045).
 */
export const HOLD_ENDS_ON = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;

/**
 * The keys that, pressed alone, do nothing with the page: a screen reader's user presses Ctrl to
 * silence speech as a page opens, and that is not taking the page from a link (issue #350).
 */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  'Control',
  'Shift',
  'Alt',
  'AltGraph',
  'Meta',
  'CapsLock',
  'Fn',
  'OS',
]);

/** How long the text's column must keep its size, once the page has settled, for a hold to let go. */
export const HOLD_QUIET_MS = 1_500;

/** The longest a linked node is held, however the page's loading goes. */
export const HOLD_LONGEST_MS = 10_000;

/** What moved the window, as `watchReader` reads a scroll. */
type ScrollCause = 'none' | 'anchoring' | 'clamp' | 'reader';

/**
 * Why the window scrolled, from where it and the node stood before and stand now: not at all; with the
 * node, which stays where it was on the screen, as the browser anchors the text; up to its furthest,
 * as a page grown shorter pulls it; or otherwise, which only the reader does - by a find, a scrollbar
 * dragged, or in the same frame as the text above the node grew (issue #350).
 */
function scrollCause(
  before: { readonly window: number; readonly screen: number },
  now: { readonly window: number; readonly screen: number; readonly furthest: number },
): ScrollCause {
  if (Math.abs(now.window - before.window) < 1) return 'none';
  if (Math.abs(now.screen - before.screen) < 1) return 'anchoring';
  if (now.window < before.window && now.window >= now.furthest - 1) return 'clamp';
  return 'reader';
}

/**
 * Watches for the reader taking the page themselves while a link has it (STR-045): any of
 * `HOLD_ENDS_ON`, or a scroll `scrollCause` reads as theirs, calls `reader`; a scroll that pulled the
 * window up to its furthest calls `clamp`, where given. `seen` says where the node and the window
 * stand now, after the page itself has moved them.
 */
export function watchReader(
  find: () => Element | null,
  on: { readonly reader: () => void; readonly clamp?: () => void },
): { readonly seen: () => void; readonly stop: () => void } {
  const screenOf = (node: Element | null) => node?.getBoundingClientRect().top ?? Number.NaN;
  let windowAt = window.scrollY;
  let screenAt = screenOf(find());
  const seen = () => {
    windowAt = window.scrollY;
    screenAt = screenOf(find());
  };
  const scrolled = () => {
    const cause = scrollCause(
      { window: windowAt, screen: screenAt },
      {
        window: window.scrollY,
        screen: screenOf(find()),
        furthest: document.documentElement.scrollHeight - window.innerHeight,
      },
    );
    if (cause === 'reader') on.reader();
    else if (cause === 'clamp' && on.clamp) on.clamp();
    else seen();
  };
  const acted = (event: Event) => {
    if (event instanceof KeyboardEvent && MODIFIER_KEYS.has(event.key)) return;
    on.reader();
  };
  const options = { capture: true, passive: true } as const;
  window.addEventListener('scroll', scrolled, { passive: true });
  for (const kind of HOLD_ENDS_ON) window.addEventListener(kind, acted, options);
  return {
    seen,
    stop: () => {
      window.removeEventListener('scroll', scrolled);
      for (const kind of HOLD_ENDS_ON) window.removeEventListener(kind, acted, options);
    },
  };
}

/**
 * Holds a linked node where the page went to it (STR-045, issue #350), and answers how to let go.
 *
 * Going to the node once is not enough: what is above it keeps changing height after the texts arrive
 * - the theme, asked for beside the texts, may answer after them, and its faces are fetched only once
 * text set in them is drawn - and the browser's own scroll anchoring does not hold the node through
 * it, so it was left anywhere from a few pixels under the header to off the screen altogether. So
 * whenever the text's column changes size, which it does with every height inside it, or the article
 * holding it does, which it does with whatever the page shows above the text, the node is scrolled
 * into view again; and the browser's anchoring is off meanwhile, so the two never fight.
 *
 * It lets go at the reader's first act or scroll of their own (`watchReader`), when the node leaves
 * the text, and once the page has settled: `settled` answered - the texts, the theme and its faces in
 * - and the column's size kept for `HOLD_QUIET_MS`; and in any case after `HOLD_LONGEST_MS`. A
 * scroll that pulled the window up to its furthest, as a page grown shorter does, is gone to again.
 */
export function holdInPlace(
  find: () => Element | null,
  column: Element,
  { settled }: { readonly settled?: Promise<unknown> } = {},
): () => void {
  if (typeof ResizeObserver === 'undefined' || find() === null) return () => undefined;
  const root = document.documentElement.style;
  const anchoring = root.overflowAnchor;
  root.overflowAnchor = 'none';
  let held = true;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let hasSettled = false;
  const hushed = () => {
    if (!held || !hasSettled) return;
    clearTimeout(quiet);
    quiet = setTimeout(release, HOLD_QUIET_MS);
  };
  const align = () => {
    const node = find();
    if (node === null) {
      release();
      return;
    }
    node.scrollIntoView?.({ block: 'start' });
    reader.seen();
    hushed();
  };
  const reader = watchReader(find, { reader: () => release(), clamp: align });
  const observer = new ResizeObserver(() => align());
  const longest = setTimeout(release, HOLD_LONGEST_MS);
  function release() {
    if (!held) return;
    held = false;
    observer.disconnect();
    reader.stop();
    clearTimeout(quiet);
    clearTimeout(longest);
    root.overflowAnchor = anchoring;
  }
  // The column, and the article holding it: what the page shows above the text - a notice of faces
  // not held, the zoom - moves the node as surely as the text above it does, and changes the
  // article's size and not the column's.
  observer.observe(column);
  observer.observe(column.closest('article') ?? document.body);
  void settled?.then(() => {
    hasSettled = true;
    hushed();
  });
  return release;
}

/**
 * Answers once the page has settled around a linked node: `ready` answered - the texts read and the
 * theme's presentation in, or refused - and then, a frame later, when the text set in its faces has
 * asked for them, the faces loaded.
 */
export async function pageSettled(ready: Promise<unknown>): Promise<void> {
  await ready;
  if (typeof requestAnimationFrame === 'function') {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  await (document as Partial<Document>).fonts?.ready;
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
