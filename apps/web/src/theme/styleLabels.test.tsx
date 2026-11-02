import { createApiClient } from '@alloy-works/api-client';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Canvas } from './Canvas.js';
import { PresentationProvider, useZoom, type Zoom } from './presentation.js';
import { DEFAULT_PRESENTATION } from './presentation.fixture.js';
import { useStyleLabels } from './styleLabels.js';

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
let setLabels: (on: boolean) => void = () => undefined;

function Controls() {
  setZoom = useZoom()?.setZoom ?? setZoom;
  setLabels = useStyleLabels()[1];
  return null;
}

async function sheetOpen(sheet = true) {
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
}

afterEach(() => {
  act(() => {
    setLabels(true);
    setZoom(1);
  });
  window.localStorage.removeItem('alloy-works.style-labels');
});

describe('the labels in a sheet margin', () => {
  it('CNT-190 stand on a sheet at the printed size, and are absent below 75% and at no other', async () => {
    const paper = await sheetOpen();
    expect(paper()).toHaveClass('aw-labels');
    act(() => setZoom(0.75));
    expect(paper()).toHaveClass('aw-labels');
    act(() => setZoom(0.5));
    expect(paper()).not.toHaveClass('aw-labels');
    act(() => setZoom(1.25));
    expect(paper()).toHaveClass('aw-labels');
  });

  it('CNT-190 can be turned off, and stay so on this device', async () => {
    const paper = await sheetOpen();
    expect(paper()).toHaveClass('aw-labels');
    act(() => setLabels(false));
    expect(paper()).not.toHaveClass('aw-labels');
    expect(window.localStorage.getItem('alloy-works.style-labels')).toBe('off');
    act(() => setLabels(true));
    expect(paper()).toHaveClass('aw-labels');
  });

  it('stand on no canvas that is not a sheet', async () => {
    const paper = await sheetOpen(false);
    expect(paper()).not.toHaveClass('aw-labels');
  });
});
