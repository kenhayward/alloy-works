import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import type { PlatformBridge } from './platform/bridge.js';

const desktopBridge: PlatformBridge = {
  getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron 44.3.0' }),
};

/** These tests are about the page around it, so the panel that calls the service stands aside. */
const noPanel = <p>the environment</p>;

afterEach(() => vi.restoreAllMocks());

describe('App', () => {
  it('renders a component from the domain package', async () => {
    render(<App bridge={desktopBridge} environment={noPanel} />);

    expect(await screen.findByRole('heading', { name: 'Alloy Works' })).toBeInTheDocument();
    expect(screen.getByText('Install the printer')).toBeInTheDocument();
    expect(screen.getByText(/version 1/i)).toBeInTheDocument();
  });

  it('names the delivery it is running under', async () => {
    render(<App bridge={desktopBridge} environment={noPanel} />);

    expect(await screen.findByText(/desktop/i)).toBeInTheDocument();
    expect(screen.getByText(/Electron 44\.3\.0/)).toBeInTheDocument();
  });

  it('shows the environment beside it, asking the service where it stands', async () => {
    // The panel's own behaviour is Environment.test.tsx's business; what is proved here is that
    // the page renders it, which is the only reason a person sees it at all.
    const asked = vi.fn(
      async () =>
        new Response('{"code":"unauthenticated"}', {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', asked);
    render(<App bridge={desktopBridge} />);

    expect(await screen.findByRole('heading', { name: 'Environment' })).toBeInTheDocument();
    expect(asked).toHaveBeenCalled();
  });

  it('says so while the bridge has not answered yet', () => {
    const pending: PlatformBridge = { getPlatformInfo: () => new Promise(() => {}) };
    render(<App bridge={pending} environment={noPanel} />);

    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });
});
