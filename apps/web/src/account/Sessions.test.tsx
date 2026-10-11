import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Sessions } from './Sessions.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const session = (id: string, current: boolean, route = 'organisation') => ({
  id,
  route,
  startedAt: '2026-10-11T08:00:00.000Z',
  lastActiveAt: '2026-10-11T09:30:00.000Z',
  expiresAt: '2026-10-11T20:00:00.000Z',
  current,
});

const THIS = '11111111-1111-4111-8111-111111111111';
const PHONE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

function service(sessions: () => unknown[]) {
  const asked: string[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(`${request.method} ${url.pathname}`);
    if (request.method === 'GET' && url.pathname === '/v1/sessions') {
      return json(200, { sessions: sessions() });
    }
    if (request.method === 'DELETE' && url.pathname === '/v1/sessions') {
      return json(200, { ended: 2 });
    }
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    return json(404, {});
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://account.test', fetch: fetching }), asked };
}

describe('Sessions, from the account chip', () => {
  it('IAM-040 lists your sessions, saying which is this one, and ends another', async () => {
    let shown = [session(THIS, true), session(PHONE, false, 'google'), session(OTHER, false)];
    const { client, asked } = service(() => shown);
    render(<Sessions client={client} onClose={() => undefined} />);

    const table = await screen.findByRole('table', { name: 'Your sessions' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('This session')).toBeInTheDocument();
    expect(within(rows[0]!).queryByRole('button', { name: /^End/ })).toBeNull();
    expect(within(rows[1]!).getByRole('cell', { name: 'Google' })).toBeInTheDocument();

    shown = shown.filter((each) => each.id !== PHONE);
    await userEvent.click(within(rows[1]!).getByRole('button', { name: /^End the session/ }));
    await waitFor(() => expect(asked).toContain(`DELETE /v1/sessions/${PHONE}`));
    expect(await screen.findByText('Ended that session.')).toBeInTheDocument();
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
  });

  it('IAM-040 ends every other session at once', async () => {
    let shown = [session(THIS, true), session(PHONE, false), session(OTHER, false)];
    const { client, asked } = service(() => shown);
    render(<Sessions client={client} onClose={() => undefined} />);
    await screen.findByRole('table', { name: 'Your sessions' });

    shown = [session(THIS, true)];
    await userEvent.click(screen.getByRole('button', { name: 'End all other sessions' }));
    await waitFor(() => expect(asked).toContain('DELETE /v1/sessions'));
    expect(await screen.findByText('Ended 2 other sessions.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End all other sessions' })).toBeNull();
  });
});
