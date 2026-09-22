import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import type { PlatformBridge } from './platform/bridge.js';

const desktopBridge: PlatformBridge = {
  getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron 44.3.0' }),
};

/** These tests are about the page around them, so the parts that call the service stand aside. */
const noPanel = <p>the environment</p>;
const noWorkspace = <p>the workspace</p>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Nobody is signed in, as far as the header band asks. */
const signedOut = () => json(401, { code: 'unauthenticated' });

/** Ada is signed in, in Development, and every listing is empty. */
const signedIn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const path = new URL(request.url, 'http://app.test').pathname;
  if (path === '/v1/me') return json(200, { id: 'p1', displayName: 'Ada', email: null });
  if (path === '/v1/tenant') return json(200, { name: 'Development' });
  return json(200, { items: [], next: null });
});

/** Opens Administration's About from the account chip, where the scaffolding's panel now sits. */
async function openAbout() {
  await userEvent.click(await screen.findByRole('button', { name: /Ada/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Administration' }));
  await userEvent.click(screen.getByRole('button', { name: /^About/ }));
}

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
  it('shows the header band, and the workspace under it', async () => {
    render(<App bridge={desktopBridge} environment={noPanel} workspace={noWorkspace} />);

    const band = screen.getByRole('banner');
    expect(within(band).getByRole('link', { name: /Alloy Works/ })).toBeInTheDocument();
    // Home is no module, so the band names none.
    expect(within(band).queryByText('Components')).not.toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByText('the workspace')).toBeInTheDocument();
    expect(await within(band).findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('puts one status bar along the foot of every page, after the page', () => {
    render(<App bridge={desktopBridge} environment={noPanel} workspace={noWorkspace} />);
    const bar = screen.getByRole('contentinfo');
    expect(within(bar).getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('main').compareDocumentPosition(bar)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("keeps the environment panel off every page, for Administration's About", async () => {
    vi.stubGlobal('fetch', signedIn);
    render(<App bridge={desktopBridge} environment={noPanel} workspace={noWorkspace} />);
    expect(screen.queryByText('the environment')).not.toBeInTheDocument();

    act(() => {
      window.location.hash = '#/documents';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(within(screen.getByRole('banner')).getByText('Documents')).toBeInTheDocument();
    expect(screen.queryByText('the environment')).not.toBeInTheDocument();

    await openAbout();
    expect(
      within(screen.getByRole('dialog', { name: 'Administration' })).getByText('the environment'),
    ).toBeInTheDocument();
  });

  it('names the delivery it is running under, in About', async () => {
    vi.stubGlobal('fetch', signedIn);
    render(<App bridge={desktopBridge} environment={noPanel} workspace={noWorkspace} />);

    await openAbout();
    expect(await screen.findByText(/desktop/i)).toBeInTheDocument();
    expect(screen.getByText(/Electron 44\.3\.0/)).toBeInTheDocument();
  });

  it('shows the environment panel in About, asking the service where it stands', async () => {
    // The panel's own behaviour is Environment.test.tsx's business; what is proved here is that
    // the page renders it, which is the only reason a person sees it at all.
    vi.stubGlobal('fetch', signedIn);
    render(<App bridge={desktopBridge} workspace={noWorkspace} />);

    await openAbout();
    expect(await screen.findByRole('heading', { name: 'Environment' })).toBeInTheDocument();
    expect(signedIn).toHaveBeenCalled();
  });

  it('says so while the bridge has not answered yet', async () => {
    vi.stubGlobal('fetch', signedIn);
    const pending: PlatformBridge = { getPlatformInfo: () => new Promise(() => {}) };
    render(<App bridge={pending} environment={noPanel} workspace={noWorkspace} />);

    await openAbout();
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });
});
