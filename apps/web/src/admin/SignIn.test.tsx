import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { notYours } from './listing.js';
import { SignIn, type ShownSignIn } from './SignIn.js';

const PROVIDER = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER = '2a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const settings = (over: Partial<ShownSignIn> = {}): ShownSignIn => ({
  providers: [
    {
      id: PROVIDER,
      name: 'Staff',
      issuer: 'https://staff.example',
      clientId: 'alloy',
      groupsClaim: 'groups',
      closed: false,
    },
    {
      id: OTHER,
      name: 'Contractors',
      issuer: 'https://contractors.example',
      clientId: 'alloy',
      groupsClaim: 'groups',
      closed: false,
    },
  ],
  google: { available: true, open: false, domains: ['example.org'] },
  sessions: { idleMinutes: 60, absoluteHours: 12 },
  redirectUri: 'https://dev.example/v1/sign-in/organisation/callback',
  recentSignIn: true,
  signedInThrough: { route: 'organisation', provider: PROVIDER },
  ...over,
});

function service(answers: {
  read?: () => Response;
  change?: (path: string, body: unknown) => Response;
}) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/v1/sign-in-settings') {
      return answers.read?.() ?? json(200, settings());
    }
    const text = await request.text();
    const body = text === '' ? undefined : (JSON.parse(text) as unknown);
    sent.push({ method: request.method, path, body });
    return answers.change?.(path, body) ?? json(200, settings());
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://x', fetch: fetching }), sent };
}

describe("Administration's Sign-in", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for a sign-in as it opens, with nothing to change until then, and goes to the provider', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const { client, sent } = service({
      read: () => json(200, settings({ recentSignIn: false })),
      change: () => json(200, { url: 'https://staff.example/authorize' }),
    });
    render(<SignIn client={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in again' }));
    expect(sent[0]).toMatchObject({
      method: 'POST',
      path: '/v1/sessions/current/reauthentication',
      body: { to: 'admin/sign-in' },
    });
    expect(assign).toHaveBeenCalledWith('https://staff.example/authorize');
    expect(screen.getByRole('button', { name: 'Add provider' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save session lifetimes' })).toBeDisabled();
  });

  it('adds a provider, saying what a second does to connections, and closes it only after asking', async () => {
    const { client, sent } = service({});
    render(<SignIn client={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add provider' }));
    expect(screen.getByText(/naming people by subject refuses every act/)).toBeInTheDocument();
    expect(
      screen.getByText('https://dev.example/v1/sign-in/organisation/callback'),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Name'), 'Partners');
    await userEvent.type(screen.getByLabelText('Issuer'), 'https://partners.example');
    await userEvent.type(screen.getByLabelText('Client ID'), 'alloy');
    await userEvent.type(screen.getByLabelText('Client secret'), 'kept-sealed');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(sent.at(-1)).toMatchObject({
      method: 'POST',
      path: '/v1/sign-in-settings/providers',
      body: { name: 'Partners', clientSecret: 'kept-sealed' },
    });
    expect(await screen.findByText('Added Partners.')).toBeInTheDocument();
  });

  it('never offers to close the provider of its own session', async () => {
    const { client } = service({});
    render(<SignIn client={client} />);
    const row = (await screen.findByRole('cell', { name: 'Staff' })).closest('tr')!;
    expect(within(row).getByText('Your session')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: /more/i }));
    expect(screen.queryByRole('menuitem', { name: 'Close provider' })).not.toBeInTheDocument();
  });

  it('asks again where the ten minutes ran out while the page was open, keeping what was typed', async () => {
    const { client } = service({
      change: () =>
        json(403, { code: 'reauthentication_required', message: 'Sign in again, then try.' }),
    });
    render(<SignIn client={client} />);
    const idle = await screen.findByLabelText(/Minutes a session lasts unused/);
    await userEvent.clear(idle);
    await userEvent.type(idle, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save session lifetimes' }));
    expect(await screen.findByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Minutes a session lasts unused/)).toHaveValue(30);
  });

  it('says a refusal in the service words, such as the last way in', async () => {
    const { client } = service({
      change: () => json(409, { code: 'last_way_in', message: 'Nobody could then sign in.' }),
    });
    render(<SignIn client={client} />);
    const row = (await screen.findByRole('cell', { name: 'Contractors' })).closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: /more/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Close provider' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close provider' }));
    expect(await screen.findByText('Nobody could then sign in.')).toBeInTheDocument();
  });

  it('shows no Google settings where this service holds no Google client', async () => {
    const { client } = service({
      read: () => json(200, settings({ google: { available: false, open: false, domains: [] } })),
    });
    render(<SignIn client={client} />);
    await screen.findByRole('cell', { name: 'Staff' });
    expect(screen.queryByText('Let people sign in with Google')).not.toBeInTheDocument();
  });

  it('says so where the caller may not see it', async () => {
    const { client } = service({
      read: () => json(403, { code: 'forbidden', message: 'This needs administer.' }),
    });
    render(<SignIn client={client} />);
    expect(await screen.findByText(notYours())).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add provider' })).toBeNull();
  });
});
