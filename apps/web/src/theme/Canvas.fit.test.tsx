import { createApiClient } from '@alloy-works/api-client';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Canvas } from './Canvas.js';
import { PresentationProvider, useZoom, type Zoom } from './presentation.js';
import { DEFAULT_PRESENTATION } from './presentation.fixture.js';

const client = createApiClient({
  baseUrl: 'http://dev.acme.test',
  fetch: vi.fn(
    async () =>
      new Response(JSON.stringify(DEFAULT_PRESENTATION), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch,
});

let setZoom: (zoom: Zoom) => void = () => undefined;
function Controls() {
  setZoom = useZoom()?.setZoom ?? setZoom;
  return null;
}

/** A hand-written observer, told by the test what changed. */
const observers: { callback: ResizeObserverCallback; watched: Element[] }[] = [];
class FakeObserver {
  watched: Element[] = [];
  constructor(public callback: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(element: Element) {
    this.watched.push(element);
  }
  unobserve() {}
  disconnect() {
    observers.splice(observers.indexOf(this), 1);
  }
}

let wide = 1000;
const resized = (width: number, height: number, room = width) =>
  act(() => {
    wide = room;
    for (const each of [...observers]) {
      each.callback(
        each.watched.map(
          (target) => ({ target, contentRect: { width, height } }) as ResizeObserverEntry,
        ),
        each as unknown as ResizeObserver,
      );
    }
  });

const open = async (sheet: boolean) => {
  render(
    <PresentationProvider client={client}>
      <Controls />
      <Canvas sheet={sheet}>
        <p>The text</p>
      </Canvas>
    </PresentationProvider>,
  );
  await waitFor(() => expect(screen.getByText('The text').parentElement).toHaveClass('aw-canvas'));
  return () => screen.getByText('The text').parentElement!;
};

const zoomOf = (element: HTMLElement) => element.style.getPropertyValue('--aw-zoom');

beforeEach(() => {
  wide = 1000;
  vi.stubGlobal('ResizeObserver', FakeObserver);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => wide);
});

afterEach(() => {
  act(() => setZoom(1));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the zoom at Fit (the in-place-steadiness handoff)', () => {
  it('CNT-075 in place, takes the sheet zoom and measure, and fits none of its own', async () => {
    const paper = await open(false);
    observers.length = 0;
    act(() => setZoom('fit'));
    expect(paper()).toHaveClass('aw-canvas');
    expect(paper()).not.toHaveClass('aw-sheet');
    expect(zoomOf(paper())).toBe('');
    expect(paper().style.getPropertyValue('--aw-measure')).toBe('');
    // Nothing watches its size, so nothing a press changes can refit it.
    expect(observers.filter((each) => each.watched.includes(paper()))).toEqual([]);
  });

  it('CNT-115 on its own sheet, refits as the desk changes width, and not as it changes height', async () => {
    const paper = await open(true);
    act(() => setZoom('fit'));
    const fitted = zoomOf(paper());
    expect(fitted).not.toBe('');
    resized(1000, 600);
    expect(zoomOf(paper())).toBe(fitted);
    // A height alone: were it to refit, the room measured now would show.
    resized(1000, 900, 700);
    expect(zoomOf(paper())).toBe(fitted);
    resized(500, 900);
    expect(Number(zoomOf(paper()))).toBeLessThan(Number(fitted));
  });
});
