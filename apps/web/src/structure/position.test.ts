import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdInPlace, useReadingPosition } from './position.js';

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
 * A page laid out by hand, as jsdom lays out nothing: the linked node stands `nodeTop` pixels down the
 * document, the window is scrolled to `scrollY`, and scrolling the node into view puts it just below
 * a 44-pixel header, as the root's `scroll-padding-top` does. The column's `ResizeObserver` is the
 * test's to fire, as the browser fires it after a layout that changed the column's size.
 */
function laidOut() {
  const page = { nodeTop: 1500, scrollY: 0, aligned: 0 };
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
    page.scrollY = page.nodeTop - 44;
  };
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => page.scrollY });
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
    resized?.();
  };
  const find = () => column.querySelector('[data-node="n"]');
  // Gone to, as the page goes to a linked node before it holds it there.
  node.scrollIntoView();
  page.aligned = 0;
  return { page, grow, find, column, node, remove: () => column.remove() };
}

describe('a linked node held where the link put it (STR-045, issue #350)', () => {
  const original = window.ResizeObserver;
  afterEach(() => {
    window.ResizeObserver = original;
    Reflect.deleteProperty(window, 'scrollY');
  });

  it('STR-045 goes to a linked node again whenever the text above it changes size, until let go', () => {
    const { page, grow, find, column, remove } = laidOut();
    const release = holdInPlace(find, column);
    // The theme arrives, and its faces: everything above the node is set again, twice.
    grow(-214);
    expect(page.scrollY).toBe(page.nodeTop - 44);
    grow(-3);
    expect(page.scrollY).toBe(page.nodeTop - 44);
    expect(page.aligned).toBe(2);
    release();
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

  it('STR-045 keeps a linked node when the window moves because the layout did, as a shorter page pulls it up', () => {
    const { page, grow, find, column, remove } = laidOut();
    holdInPlace(find, column);
    // The text above shrinks and the window, which can no longer scroll as far, is pulled up with it:
    // the scroll is heard before the column's new size is.
    page.nodeTop -= 400;
    page.scrollY -= 150;
    fireEvent.scroll(window);
    expect(page.scrollY).toBe(page.nodeTop - 44);
    grow(120);
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
});
