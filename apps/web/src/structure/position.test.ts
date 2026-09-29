import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOLD_LONGEST_MS, HOLD_QUIET_MS, holdInPlace, useReadingPosition } from './position.js';

describe('where the reader is in the text', () => {
  const original = window.IntersectionObserver;
  afterEach(() => {
    window.IntersectionObserver = original;
  });

  it("watches the text's nodes again when one comes or goes, and not when an editor's text changes inside one", async () => {
    let observed = 0;
    window.IntersectionObserver = class {
      observe() {
        observed += 1;
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = '';
      thresholds = [];
    } as unknown as typeof IntersectionObserver;
    const root = document.createElement('div');
    const node = document.createElement('div');
    node.setAttribute('data-node', 'a');
    node.append(document.createElement('p'));
    root.append(node);
    document.body.append(root);
    const changed = vi.fn();
    renderHook(() => useReadingPosition({ current: root }, changed, 'document'));
    expect(observed).toBe(1);
    const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

    // Typing in an editor open in place: its text changes inside the node, and nothing is watched again.
    root.querySelector('p')!.append(document.createElement('span'));
    await settled();
    expect(observed).toBe(1);

    // A node added to the text: every node is watched, the new one among them.
    const added = document.createElement('div');
    added.setAttribute('data-node', 'b');
    root.append(added);
    await settled();
    expect(observed).toBe(3);
    root.remove();
  });
});

/**
 * A page laid out by hand, as jsdom lays out nothing: the linked node stands `nodeTop` pixels down a
 * document `height` pixels tall, the window is scrolled to `scrollY` - never past its furthest, the
 * height less the window's - and scrolling the node into view puts it just below a 44-pixel header,
 * as the root's `scroll-padding-top` does, or as near as the window can scroll. The column's
 * `ResizeObserver` is the test's to fire, as the browser fires it after a layout that changed the
 * column's size.
 */
function laidOut({ nodeTop = 1500, height = 3000 } = {}) {
  const page = { nodeTop, height, scrollY: 0, aligned: 0 };
  const furthest = () => page.height - window.innerHeight;
  let resized: (() => void) | null = null;
  const column = document.createElement('div');
  const node = document.createElement('div');
  node.setAttribute('data-node', 'n');
  column.append(node);
  document.body.append(column);
  node.getBoundingClientRect = () =>
    ({ top: page.nodeTop - page.scrollY, bottom: page.nodeTop - page.scrollY + 40 }) as DOMRect;
  node.scrollIntoView = () => {
    page.aligned += 1;
    page.scrollY = Math.max(0, Math.min(page.nodeTop - 44, furthest()));
  };
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => page.scrollY });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => page.height,
  });
  window.ResizeObserver = class {
    constructor(callback: () => void) {
      resized = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {
      resized = null;
    }
  } as unknown as typeof ResizeObserver;
  /** The layout changes: everything above the node takes `by` pixels more, and the browser says so. */
  const grow = (by: number) => {
    page.nodeTop += by;
    page.height += by;
    page.scrollY = Math.min(page.scrollY, Math.max(0, furthest()));
    resized?.();
  };
  const find = () => column.querySelector('[data-node="n"]');
  // Gone to, as the page goes to a linked node before it holds it there.
  node.scrollIntoView();
  page.aligned = 0;
  return { page, furthest, grow, find, column, node, remove: () => column.remove() };
}

describe('a linked node held where the link put it (STR-045, issue #350)', () => {
  const windowScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')!;
  const original = window.ResizeObserver;
  afterEach(() => {
    window.ResizeObserver = original;
    Object.defineProperty(window, 'scrollY', windowScrollY);
    Reflect.deleteProperty(document.documentElement, 'scrollHeight');
    document.documentElement.style.overflowAnchor = '';
    vi.useRealTimers();
  });

  it('STR-045 goes to a linked node again whenever the text above it changes size, until let go', () => {
    const { page, grow, find, column, remove } = laidOut();
    const release = holdInPlace(find, column);
    // The browser's own anchoring is off while the page holds the node: the two would fight.
    expect(document.documentElement.style.overflowAnchor).toBe('none');
    // The theme arrives, and its faces: everything above the node is set again, twice.
    grow(-214);
    expect(page.scrollY).toBe(page.nodeTop - 44);
    grow(-3);
    expect(page.scrollY).toBe(page.nodeTop - 44);
    expect(page.aligned).toBe(2);
    release();
    expect(document.documentElement.style.overflowAnchor).toBe('');
    grow(100);
    expect(page.aligned).toBe(2);
    remove();
  });

  it('STR-045 lets a linked node go at anything the reader does, and leaves them where they took the page', () => {
    const inputs: [string, (target: Element) => void][] = [
      ['the wheel', (target) => fireEvent.wheel(target, { deltaY: 100 })],
      ['a touch', (target) => fireEvent.touchMove(target)],
      ['a key', (target) => fireEvent.keyDown(target, { key: 'a' })],
      ['a press of the pointer', (target) => fireEvent.pointerDown(target)],
    ];
    for (const [input, act] of inputs) {
      const { page, grow, find, column, node, remove } = laidOut();
      holdInPlace(find, column);
      act(node);
      grow(250);
      expect(page.aligned, input).toBe(0);
      remove();
    }
  });

  it('STR-045 lets a linked node go when the window is scrolled other than by the hold, as by dragging its scrollbar', () => {
    const { page, grow, find, column, remove } = laidOut();
    holdInPlace(find, column);
    page.scrollY += 300;
    fireEvent.scroll(window);
    grow(250);
    expect(page.aligned).toBe(0);
    remove();
  });

  it("STR-045 takes a scroll in the frame the text above the node grew for the reader's, and lets it go", () => {
    const { page, grow, find, column, remove } = laidOut();
    holdInPlace(find, column);
    // In one task the text above grows by 60 and a find scrolls the window 400: the scroll is heard
    // first, with the node moved as well as the window.
    page.nodeTop += 60;
    page.height += 60;
    page.scrollY += 400;
    fireEvent.scroll(window);
    grow(0);
    expect(page.aligned).toBe(0);
    expect(page.scrollY).toBe(1500 - 44 + 400);
    remove();
  });

  it('STR-045 keeps a linked node when the window moves because the layout did, as a shorter page pulls it up', () => {
    // A node near the foot, the window near its furthest.
    const { page, furthest, find, column, remove } = laidOut({ nodeTop: 2000 });
    holdInPlace(find, column);
    // The text above shrinks and the window, which can no longer scroll as far, is pulled up to its
    // new furthest: the scroll is heard before the column's new size is.
    page.nodeTop -= 400;
    page.height -= 400;
    page.scrollY = Math.min(page.scrollY, furthest());
    fireEvent.scroll(window);
    expect(page.aligned).toBe(1);
    expect(page.scrollY).toBe(page.nodeTop - 44);
    remove();
  });

  it('STR-045 keeps a linked node when the window moves with it, as the browser anchors the text', () => {
    const { page, grow, find, column, remove } = laidOut();
    holdInPlace(find, column);
    page.nodeTop += 200;
    page.height += 200;
    page.scrollY += 200;
    fireEvent.scroll(window);
    grow(-30);
    expect(page.aligned).toBe(1);
    expect(page.scrollY).toBe(page.nodeTop - 44);
    remove();
  });

  it('STR-045 lets a linked node go when it leaves the text', () => {
    const { page, grow, find, column, node, remove } = laidOut();
    holdInPlace(find, column);
    node.remove();
    grow(100);
    fireEvent.scroll(window);
    expect(page.aligned).toBe(0);
    remove();
  });

  it('STR-045 lets a linked node go once the page has settled and nothing has changed size for a moment', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { page, grow, find, column, remove } = laidOut();
    holdInPlace(find, column, { settled: Promise.resolve() });
    await vi.advanceTimersByTimeAsync(HOLD_QUIET_MS - 100);
    // A size change inside the quiet moment: held, and the moment begins again.
    grow(-20);
    expect(page.aligned).toBe(1);
    await vi.advanceTimersByTimeAsync(HOLD_QUIET_MS - 100);
    grow(-20);
    expect(page.aligned).toBe(2);
    // Quiet for the whole moment: let go, and what grows after moves nothing.
    await vi.advanceTimersByTimeAsync(HOLD_QUIET_MS);
    grow(300);
    expect(page.aligned).toBe(2);
    expect(document.documentElement.style.overflowAnchor).toBe('');
    remove();
  });

  it('STR-045 holds a linked node while the page has not settled, for no longer than its limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { page, grow, find, column, remove } = laidOut();
    // The theme or the faces never arrive.
    holdInPlace(find, column, { settled: new Promise(() => undefined) });
    await vi.advanceTimersByTimeAsync(HOLD_LONGEST_MS - 100);
    grow(-20);
    expect(page.aligned).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    grow(-20);
    expect(page.aligned).toBe(1);
    remove();
  });
});
