import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { useAbout } from './shell/about.js';
import type { PlatformBridge } from './platform/bridge.js';

const desktopBridge: PlatformBridge = {
  getPlatformInfo: async () => ({ delivery: 'desktop', runtime: 'Electron 44.3.0' }),
  setSpellCheckLanguages: async () => {},
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

/**
 * A workspace that shows what the shell gives Administration's About, as the page does at
 * : the scaffolding's panel and the delivery line, which only About holds.
 */
function ShowsAbout() {
  return <section aria-label="About">{useAbout()}</section>;
}
const aboutWorkspace = <ShowsAbout />;
const about = () => screen.getByRole('region', { name: 'About' });

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
    // The band names no module: the rail beside the page marks the one it is in.
    expect(within(band).queryByText('Components')).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Modules' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByText('the workspace')).toBeInTheDocument();
    expect(await within(band).findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('moves between the header band, the module rail and the page with F6, and back with Shift-F6', async () => {
    render(
      <App
        bridge={desktopBridge}
        environment={noPanel}
        workspace={<button type="button">In the page</button>}
      />,
    );
    const rail = screen.getByRole('navigation', { name: 'Modules' });

    await userEvent.keyboard('{F6}');
    expect(screen.getByRole('link', { name: /Alloy Works/ })).toHaveFocus();
    await userEvent.keyboard('{F6}');
    expect(within(rail).getByRole('link', { name: 'Home' })).toHaveFocus();
    await userEvent.keyboard('{F6}');
    expect(screen.getByRole('button', { name: 'In the page' })).toHaveFocus();
    await userEvent.keyboard('{F6}');
    expect(screen.getByRole('link', { name: /Alloy Works/ })).toHaveFocus();
    await userEvent.keyboard('{Shift>}{F6}{/Shift}');
    expect(screen.getByRole('button', { name: 'In the page' })).toHaveFocus();
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
    expect(
      within(screen.getByRole('navigation', { name: 'Modules' })).getByRole('link', {
        name: 'Documents',
      }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('the environment')).not.toBeInTheDocument();

    // Given to Administration's About alone.
    render(<App bridge={desktopBridge} environment={noPanel} workspace={aboutWorkspace} />);
    expect(within(about()).getByText('the environment')).toBeInTheDocument();
  });

  it('names the delivery it is running under, in About', async () => {
    vi.stubGlobal('fetch', signedIn);
    render(<App bridge={desktopBridge} environment={noPanel} workspace={aboutWorkspace} />);

    expect(await within(about()).findByText(/desktop/i)).toBeInTheDocument();
    expect(screen.getByText(/Electron 44\.3\.0/)).toBeInTheDocument();
  });

  it('shows the environment panel in About, asking the service where it stands', async () => {
    // The panel's own behaviour is Environment.test.tsx's business; what is proved here is that
    // the page renders it, which is the only reason a person sees it at all.
    vi.stubGlobal('fetch', signedIn);
    render(<App bridge={desktopBridge} workspace={aboutWorkspace} />);

    expect(await screen.findByRole('heading', { name: 'Environment' })).toBeInTheDocument();
    expect(signedIn).toHaveBeenCalled();
  });

  it('says so while the bridge has not answered yet', async () => {
    vi.stubGlobal('fetch', signedIn);
    const pending: PlatformBridge = {
      getPlatformInfo: () => new Promise(() => {}),
      setSpellCheckLanguages: async () => {},
    };
    render(<App bridge={pending} environment={noPanel} workspace={aboutWorkspace} />);

    expect(within(about()).getByText(/checking/i)).toBeInTheDocument();
  });
});
