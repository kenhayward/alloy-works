import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App.js';
import type { PlatformBridge } from '../platform/bridge.js';

/**
 * A page opened with nobody signed in meets a sign-in screen instead of the shell, and only then: the
 * service must have said 401 to `/v1/me`.
 */

const bridge: PlatformBridge = {
  getPlatformInfo: async () => ({ delivery: 'web', runtime: 'Chromium' }),
  opensServedPages: true,
  setSpellCheckLanguages: async () => {},
  setInterfaceLanguage: async () => {},
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const pathOf = (input: string | URL | Request) =>
  new URL(input instanceof Request ? input.url : String(input), 'http://app.test').pathname;

const NOBODY = () => json(401, { code: 'unauthenticated' });
const ONE_WAY = { name: 'Development', signIn: ['organisation'], providers: [] };

/** A service answering `/v1/me` and `/v1/tenant` as given, and every listing empty. */
function serviceThat(
  me: () => Promise<Response> | Response,
  tenant: () => Promise<Response> | Response,
) {
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const path = pathOf(input);
    if (path === '/v1/me') return me();
    if (path === '/v1/tenant') return tenant();
    return json(200, { items: [], next: null });
  });
  vi.stubGlobal('fetch', fetching);
  return fetching;
}

const open = () =>
  render(<App bridge={bridge} environment={null} workspace={<p>the workspace</p>} />);

const theScreen = () => screen.findByRole('heading', { level: 1, name: 'Sign in to Alloy Works' });

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

describe('the sign-in screen', () => {
  it('stands in place of the shell when the service says nobody is signed in', async () => {
    serviceThat(NOBODY, () => json(200, ONE_WAY));
    open();
    await theScreen();
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Modules' })).toBeNull();
    expect(screen.queryByText('the workspace')).toBeNull();
    expect(await screen.findByText('Development')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/v1/sign-in/organisation',
    );
  });

  it('ADM-028 says an environment is suspended, in place of the shell and of any way in', async () => {
    serviceThat(() => json(503, { code: 'environment_suspended', message: 'Suspended.' }));
    open();
    expect(
      await screen.findByRole('heading', { name: 'This environment is suspended' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nothing in it has been lost/)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Modules' })).toBeNull();
    expect(screen.queryByText('the workspace')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it("brings a person back to the page they asked for, a shared publication's link among them", async () => {
    const publication = '0193a3b0-7c1e-7000-8000-0123456789ab';
    window.location.hash = `#/publications/${publication}`;
    serviceThat(NOBODY, () => json(200, { ...ONE_WAY, signIn: ['organisation', 'google'] }));
    open();
    const back = `?to=publications%2F${publication}`;
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      `/v1/sign-in/organisation${back}`,
    );
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
      'href',
      `/v1/sign-in/google${back}`,
    );
  });

  it('follows the address it is shown at, so the way back is where the person now is', async () => {
    serviceThat(NOBODY, () => json(200, ONE_WAY));
    open();
    await screen.findByRole('link', { name: 'Sign in' });
    act(() => {
      window.location.hash = '#/documents';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/v1/sign-in/organisation?to=documents',
    );
  });

  it('IAM-011 names each open provider where there is more than one', async () => {
    serviceThat(NOBODY, () =>
      json(200, {
        name: 'Development',
        signIn: ['organisation'],
        providers: [
          { id: 'p-1', name: 'Contractors' },
          { id: 'p-2', name: 'Staff' },
        ],
      }),
    );
    open();
    expect(await screen.findByRole('link', { name: 'Sign in with Contractors' })).toHaveAttribute(
      'href',
      '/v1/sign-in/organisation?provider=p-1',
    );
    expect(screen.getByRole('link', { name: 'Sign in with Staff' })).toHaveAttribute(
      'href',
      '/v1/sign-in/organisation?provider=p-2',
    );
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });

  it('never goes to a provider by itself, however few ways in there are', async () => {
    serviceThat(NOBODY, () => json(200, ONE_WAY));
    const before = window.location.href;
    open();
    await screen.findByRole('link', { name: 'Sign in' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(window.location.href).toBe(before);
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('says so plainly when the environment offers no way in', async () => {
    serviceThat(NOBODY, () => json(200, { name: 'Development', signIn: [], providers: [] }));
    open();
    expect(
      await screen.findByText(
        'This environment offers no way to sign in yet. Ask whoever runs it to set one up.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says nothing of the ways in until they are read', async () => {
    let answer: (tenant: Response) => void = () => {};
    const asked = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    serviceThat(NOBODY, () => asked);
    open();
    await theScreen();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/no way to sign in/)).toBeNull();
    answer(json(200, ONE_WAY));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('does not take a tenant it could not read for one with no way in, and asks again', async () => {
    let tenant = () => json(500, { code: 'internal' });
    serviceThat(NOBODY, () => tenant());
    open();
    expect(await screen.findByText('The ways to sign in could not be read.')).toBeInTheDocument();
    expect(screen.queryByText(/no way to sign in/)).toBeNull();
    tenant = () => json(200, ONE_WAY);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('ADM-051 gives way to the Connect to screen, which the tray opens from any page', async () => {
    serviceThat(NOBODY, () => json(200, ONE_WAY));
    render(
      <App
        bridge={{ ...bridge, connectTo: async () => ({ kind: 'refused', reason: 'unreachable' }) }}
        environment={null}
        workspace={null}
      />,
    );
    await theScreen();
    act(() => {
      window.location.hash = '#/connect';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(screen.getByRole('textbox', { name: 'Environment address' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in to Alloy Works' })).toBeNull();
  });
});

describe('the gate before the shell', () => {
  it('shows neither the shell nor the screen while the service has not answered', async () => {
    const asked = serviceThat(
      () => new Promise<Response>(() => {}),
      () => json(200, ONE_WAY),
    );
    open();
    await waitFor(() => expect(asked).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('banner')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sign in to Alloy Works' })).toBeNull();
    expect(screen.queryByText('the workspace')).toBeNull();
  });

  it('opens the shell where no answer came, and the page says it could not ask', async () => {
    serviceThat(
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => json(200, ONE_WAY),
    );
    open();
    expect(await screen.findByRole('banner')).toBeInTheDocument();
    expect(screen.getByText('the workspace')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in to Alloy Works' })).toBeNull();
  });

  it('opens the shell on any answer but a 401', async () => {
    serviceThat(
      () => json(503, { code: 'unavailable' }),
      () => json(200, ONE_WAY),
    );
    open();
    expect(await screen.findByRole('banner')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in to Alloy Works' })).toBeNull();
  });

  it('never replaces a page already open, however the session has gone since', async () => {
    let me = () => json(200, { id: 'p1', displayName: 'Ada', email: null });
    serviceThat(
      () => me(),
      () => json(200, ONE_WAY),
    );
    render(
      <App
        bridge={bridge}
        environment={null}
        workspace={<input aria-label="Unsaved text" defaultValue="" />}
      />,
    );
    const typed = await screen.findByRole('textbox', { name: 'Unsaved text' });
    await userEvent.type(typed, 'kept');
    me = NOBODY;
    act(() => {
      window.location.hash = '#/documents';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('heading', { name: 'Sign in to Alloy Works' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Unsaved text' })).toBe(typed);
    expect(typed).toHaveValue('kept');
  });
});
