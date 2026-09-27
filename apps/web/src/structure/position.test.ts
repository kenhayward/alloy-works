import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useReadingPosition } from './position.js';

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
