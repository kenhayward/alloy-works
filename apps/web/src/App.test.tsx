import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import type { PlatformBridge } from './platform/bridge.js';

const desktopBridge: PlatformBridge = {
  getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron 44.3.0' }),
};

/** These tests are about the page around them, so the parts that call the service stand aside. */
const noPanel = <p>the environment</p>;
const noWorkspace = <p>the workspace</p>;

/** Nobody is signed in, as far as the header band asks. */
const signedOut = () =>
  new Response('{"code":"unauthenticated"}', {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => signedOut()),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('App', () => {
  it('shows the header band, and the workspace and the environment under it', async () => {
    render(<App bridge={desktopBridge} environment={noPanel} workspace={noWorkspace} />);

    const band = screen.getByRole('banner');
    expect(within(band).getByRole('button', { name: /Alloy Works/ })).toBeInTheDocument();
    // Home is no module, so the band names none.
    expect(within(band).queryByText('Components')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByText('the workspace')).toBeInTheDocument();
    expect(within(main).getByText('the environment')).toBeInTheDocument();
    expect(await within(band).findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the environment under Home only, not on a list or a document', async () => {
    render(<App bridge={desktopBridge} environment={noPanel} workspace={noWorkspace} />);
    expect(screen.getByText('the environment')).toBeInTheDocument();

    act(() => {
      window.location.hash = '#/documents';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(screen.queryByText('the environment')).not.toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Documents')).toBeInTheDocument();

    act(() => {
      window.location.hash = '#/components';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.queryByText('the environment')).not.toBeInTheDocument();
    expect(within(screen.getByRole('banner')).getByText('Components')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('names the delivery it is running under', async () => {
    render(<App bridge={desktopBridge} environment={noPanel} workspace={noWorkspace} />);

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
    render(<App bridge={desktopBridge} workspace={noWorkspace} />);

    expect(await screen.findByRole('heading', { name: 'Environment' })).toBeInTheDocument();
    expect(asked).toHaveBeenCalled();
  });

  it('says so while the bridge has not answered yet', () => {
    const pending: PlatformBridge = { getPlatformInfo: () => new Promise(() => {}) };
    render(<App bridge={pending} environment={noPanel} workspace={noWorkspace} />);

    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });
});
