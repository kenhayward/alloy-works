/** A stretch of the window, top to foot, in the window's own pixels. */
export interface Span {
  readonly top: number;
  readonly bottom: number;
}

/**
 * Where a pane scrolled to `scrollTop`, showing `view` of the window, must scroll to for `item` to be
 * shown as well: nowhere while it already is, just far enough otherwise - its foot to the pane's foot
 * from below, its top to the pane's top from above, or its top where it is taller than what the pane
 * shows - and never above the pane's own top.
 */
export function revealedAt(scrollTop: number, view: Span, item: Span): number {
  let to = scrollTop;
  if (item.bottom > view.bottom) to += item.bottom - view.bottom;
  const top = item.top - (to - scrollTop);
  if (top < view.top) to -= view.top - top;
  return Math.max(0, to);
}

/** The window's height, and how much of its top and foot the sticky header and status bar cover. */
export interface Viewport {
  readonly height: number;
  readonly paddingTop: number;
  readonly paddingBottom: number;
}

/**
 * What the reader can see of a pane drawn at `pane`: the part of it inside the window, below the
 * header and above the status bar, which the window's own `scroll-padding-top` and
 * `scroll-padding-bottom` measure.
 */
export function paneView(pane: Span, viewport: Viewport): Span {
  return {
    top: Math.max(pane.top, viewport.paddingTop),
    bottom: Math.min(pane.bottom, viewport.height - viewport.paddingBottom),
  };
}

/**
 * Brings `item` into view inside `pane` by scrolling the pane alone (issue #336). An element's own
 * `scrollIntoView` scrolls every scroller holding it, the window among them, and the window moving
 * the text is what changes the node in view: the loop that sprang the document back to its top.
 *
 * What the pane shows is `paneView`'s, so an item the header or the status bar covers is not taken
 * as shown.
 */
export function revealInPane(pane: HTMLElement, item: HTMLElement): void {
  const root = getComputedStyle(document.documentElement);
  const view = paneView(pane.getBoundingClientRect(), {
    height: window.innerHeight,
    paddingTop: parseFloat(root.scrollPaddingTop) || 0,
    paddingBottom: parseFloat(root.scrollPaddingBottom) || 0,
  });
  if (view.bottom <= view.top) return;
  const drawn = item.getBoundingClientRect();
  const to = revealedAt(pane.scrollTop, view, { top: drawn.top, bottom: drawn.bottom });
  if (to !== pane.scrollTop) pane.scrollTop = to;
}
