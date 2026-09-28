import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiTokens } from './ApiTokens.js';

const SECRET = `awt_${'Q'.repeat(43)}`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const nightly = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Nightly import',
  scopes: ['edit', 'publish'],
  createdAt: '2026-09-01T09:00:00.000Z',
  expiresAt: '2026-12-01T09:00:00.000Z',
  lastUsedAt: '2026-09-27T09:00:00.000Z',
};
const unused = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Reader',
  scopes: [],
  createdAt: '2026-09-02T09:00:00.000Z',
  expiresAt: '2026-11-01T09:00:00.000Z',
  lastUsedAt: null,
};

interface Asked {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** The service as far as the tokens are concerned: what was asked, and an answer for each. */
function service(
  answers: {
    list?: () => Response;
    create?: () => Response;
    revoke?: () => Response;
  } = {},
) {
  const asked: Asked[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = await request.text();
    asked.push({
      method: request.method,
      path: url.pathname,
      body: text === '' ? undefined : (JSON.parse(text) as unknown),
    });
    if (request.method === 'GET' && url.pathname === '/v1/tokens') {
      return answers.list?.() ?? json(200, { items: [nightly, unused], next: null });
    }
    if (request.method === 'POST' && url.pathname === '/v1/tokens') {
      const body = JSON.parse(text) as { name: string; scopes: string[]; expiresAt: string };
      return (
        answers.create?.() ??
        json(200, {
          id: '33333333-3333-4333-8333-333333333333',
          name: body.name,
          scopes: body.scopes,
          createdAt: new Date().toISOString(),
          expiresAt: body.expiresAt,
          lastUsedAt: null,
          secret: SECRET,
        })
      );
    }
    if (request.method === 'DELETE' && url.pathname.startsWith('/v1/tokens/')) {
      return answers.revoke?.() ?? new Response(null, { status: 204 });
    }
    return json(404, { code: 'not_found', message: 'There is nothing at this address.' });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://tokens.test', fetch: fetching }), asked };
}

/** A date as a date field holds it, in the reader's own time zone. */
const dateField = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
const daysFromToday = (days: number) => {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
};

afterEach(() => vi.restoreAllMocks());

describe('API tokens, from the account chip', () => {
  it("lists the person's tokens: what each may do besides reading, when it expires, and when it was last used", async () => {
    const { client } = service();
    render(<ApiTokens client={client} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'API tokens' });
    const table = await within(dialog).findByRole('table', { name: 'Your tokens' });
    const [, first, second] = within(table).getAllByRole('row');
    expect(within(first!).getByRole('cell', { name: 'Nightly import' })).toBeInTheDocument();
    expect(within(first!).getByRole('cell', { name: 'read, edit, publish' })).toBeInTheDocument();
    expect(within(first!).getByRole('cell', { name: /December/ })).toBeInTheDocument();
    expect(within(first!).getByRole('cell', { name: /September/ })).toBeInTheDocument();
    expect(within(second!).getByRole('cell', { name: 'read' })).toBeInTheDocument();
    expect(within(second!).getByRole('cell', { name: 'never' })).toBeInTheDocument();
  });

  it('issues a token with its name, scopes and expiry, shows the secret once with Copy, and forgets it on closing', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { client, asked } = service();
    render(<ApiTokens client={client} onClose={vi.fn()} />);
    await screen.findByRole('table', { name: 'Your tokens' });

    const opener = screen.getByRole('button', { name: 'New token' });
    await user.click(opener);
    const form = screen.getByRole('dialog', { name: 'New token' });
    // Focus moves into the dialog, on its first field.
    expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveFocus();
    expect(within(form).getByText(/Reading is always allowed/)).toBeInTheDocument();
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Publish on merge');
    await user.click(within(form).getByRole('checkbox', { name: 'Edit' }));
    await user.click(within(form).getByRole('checkbox', { name: 'Publish' }));
    // Ninety days away unless changed.
    expect(within(form).getByLabelText('Expires on')).toHaveValue(dateField(daysFromToday(90)));
    await user.click(within(form).getByRole('button', { name: 'Create token' }));

    const shown = await screen.findByRole('dialog', { name: 'Copy your token' });
    const posted = asked.find((each) => each.method === 'POST');
    expect(posted?.body).toEqual({
      name: 'Publish on merge',
      scopes: ['edit', 'publish'],
      expiresAt: daysFromToday(90).toISOString(),
    });
    expect(within(shown).getByRole('textbox', { name: 'Token' })).toHaveValue(SECRET);
    expect(within(shown).getByText(/will not be shown again/)).toBeInTheDocument();
    await user.click(within(shown).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(await within(shown).findByText('Copied.')).toBeInTheDocument();
    // The new token joins the list, never its secret.
    const table = screen.getByRole('table', { name: 'Your tokens' });
    expect(within(table).getByRole('cell', { name: 'Publish on merge' })).toBeInTheDocument();
    expect(table).not.toHaveTextContent(SECRET);

    await user.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Copy your token' })).toBeNull();
    expect(document.body).not.toHaveTextContent(SECRET);
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    // Focus goes back to what opened it.
    expect(opener).toHaveFocus();
    // Opened again, it is a new form, not the secret.
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'New token' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
  });

  it('forgets the secret when the dialog is closed by Escape, as by Done', async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<ApiTokens client={client} onClose={vi.fn()} />);
    await screen.findByRole('table', { name: 'Your tokens' });
    await user.click(screen.getByRole('button', { name: 'New token' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Script');
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByDisplayValue(SECRET)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Copy your token' })).toBeNull();
    // Only the inner dialog closed.
    expect(screen.getByRole('dialog', { name: 'API tokens' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(SECRET);
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
  });

  it('never writes the secret to storage, the address or the console', async () => {
    const user = userEvent.setup();
    const stored = vi.spyOn(Storage.prototype, 'setItem');
    const logged = vi.spyOn(console, 'log');
    const before = window.location.href;
    const { client } = service();
    render(<ApiTokens client={client} onClose={vi.fn()} />);
    await screen.findByRole('table', { name: 'Your tokens' });
    await user.click(screen.getByRole('button', { name: 'New token' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Script');
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByDisplayValue(SECRET)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    const written = stored.mock.calls.flat().join('\n');
    expect(written).not.toContain(SECRET);
    expect(written).not.toContain('awt_');
    expect(logged.mock.calls.flat().map(String).join('\n')).not.toContain(SECRET);
    expect(window.location.href).toBe(before);
    expect(window.location.href).not.toContain('awt_');
  });

  it('bounds the expiry from tomorrow to a year away, and refuses a date outside that without asking the service', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<ApiTokens client={client} onClose={vi.fn()} />);
    await screen.findByRole('table', { name: 'Your tokens' });
    await user.click(screen.getByRole('button', { name: 'New token' }));

    const expiry = screen.getByLabelText('Expires on');
    expect(expiry).toHaveAttribute('type', 'date');
    expect(expiry).toHaveAttribute('min', dateField(daysFromToday(1)));
    expect(expiry).toHaveAttribute('max', dateField(daysFromToday(365)));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Script');
    for (const days of [366, 0, -3]) {
      await user.clear(expiry);
      await user.type(expiry, dateField(daysFromToday(days)));
      await user.click(screen.getByRole('button', { name: 'Create token' }));
      expect(
        await screen.findByText('Choose an expiry from tomorrow to a year from today.'),
      ).toBeInTheDocument();
    }
    expect(asked.filter((each) => each.method === 'POST')).toEqual([]);
    await user.clear(expiry);
    await user.type(expiry, dateField(daysFromToday(365)));
    await user.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByDisplayValue(SECRET)).toBeInTheDocument();
    expect(asked.find((each) => each.method === 'POST')?.body).toMatchObject({
      expiresAt: daysFromToday(365).toISOString(),
    });
  });

  it("says in the service's own words why a token was not issued, and keeps the form", async () => {
    const user = userEvent.setup();
    const { client } = service({
      create: () =>
        json(400, {
          code: 'token_expiry_invalid',
          message: 'A token needs an expiry in the future, and no more than 365 days away.',
          traceId: 't',
        }),
    });
    render(<ApiTokens client={client} onClose={vi.fn()} />);
    await screen.findByRole('table', { name: 'Your tokens' });
    await user.click(screen.getByRole('button', { name: 'New token' }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Script');
    await user.click(screen.getByRole('button', { name: 'Create token' }));

    expect(
      await screen.findByText(
        'A token needs an expiry in the future, and no more than 365 days away.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New token' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Script');
  });

  it('asks before revoking, then revokes, takes the token off the list and keeps focus in the dialog', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<ApiTokens client={client} onClose={vi.fn()} />);
    const table = await screen.findByRole('table', { name: 'Your tokens' });

    await user.click(within(table).getByRole('button', { name: 'Revoke Nightly import' }));
    const confirming = screen.getByRole('dialog', { name: 'Revoke Nightly import?' });
    expect(asked.filter((each) => each.method === 'DELETE')).toEqual([]);
    // Kept, where the person thinks better of it.
    await user.click(within(confirming).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog', { name: 'Revoke Nightly import?' })).toBeNull();
    expect(within(table).getByRole('cell', { name: 'Nightly import' })).toBeInTheDocument();
    expect(asked.filter((each) => each.method === 'DELETE')).toEqual([]);

    await user.click(within(table).getByRole('button', { name: 'Revoke Nightly import' }));
    await user.click(screen.getByRole('button', { name: 'Revoke token' }));
    expect(await screen.findByText('Revoked Nightly import.')).toBeInTheDocument();
    expect(asked.filter((each) => each.method === 'DELETE').map((each) => each.path)).toEqual([
      `/v1/tokens/${nightly.id}`,
    ]);
    expect(within(table).queryByRole('cell', { name: 'Nightly import' })).toBeNull();
    expect(within(table).getByRole('cell', { name: 'Reader' })).toBeInTheDocument();
    // Focus stays in the dialog, though the button that had it has gone, so Escape still closes it.
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'API tokens' })).toContainElement(
        document.activeElement as HTMLElement,
      ),
    );
  });

  it("says in the service's own words why a token was not revoked, and keeps it listed", async () => {
    const user = userEvent.setup();
    const { client } = service({
      revoke: () =>
        json(403, {
          code: 'token_not_allowed',
          message: 'This takes a signed-in session: an API token cannot do it.',
          traceId: 't',
        }),
    });
    render(<ApiTokens client={client} onClose={vi.fn()} />);
    const table = await screen.findByRole('table', { name: 'Your tokens' });
    await user.click(within(table).getByRole('button', { name: 'Revoke Reader' }));
    await user.click(screen.getByRole('button', { name: 'Revoke token' }));

    expect(
      await screen.findByText('This takes a signed-in session: an API token cannot do it.'),
    ).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'Reader' })).toBeInTheDocument();
  });

  it('says so, with nothing to revoke, when the person has no tokens', async () => {
    const { client } = service({ list: () => json(200, { items: [], next: null }) });
    render(<ApiTokens client={client} onClose={vi.fn()} />);
    expect(await screen.findByText('You have no API tokens.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New token' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
  });
});
