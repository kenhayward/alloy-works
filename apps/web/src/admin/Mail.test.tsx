import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Mail } from './Mail.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const OFF = {
  enabled: false,
  relay: 'platform',
  host: null,
  port: null,
  username: null,
  fromAddress: null,
  fromName: null,
  hasPassword: false,
  failingSince: null,
  lastSuccessAt: null,
  kindsOff: [],
};

/** A fake service: the channel, its password, a test and the listing, each call kept. */
function service(
  over: { channel?: Record<string, unknown>; status?: number; items?: unknown[] } = {},
) {
  let channel: Record<string, unknown> = { ...OFF, ...over.channel };
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const items: unknown[] = [...(over.items ?? [])];
  const read = () => ({
    channel,
    platform: { offered: true, fromAddress: 'mail@operator.test' },
  });
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.text();
    calls.push({ method: request.method, path, ...(body ? { body: JSON.parse(body) } : {}) });
    if (over.status !== undefined) return json(over.status, { code: 'forbidden', message: 'No.' });
    if (path === '/v1/mail-channel' && request.method === 'PUT') {
      const sent = JSON.parse(body!) as Record<string, unknown>;
      channel = { ...OFF, ...sent, hasPassword: false };
      return json(200, read());
    }
    if (path === '/v1/mail-channel/password') {
      channel = { ...channel, hasPassword: true };
      return json(200, read());
    }
    if (path === '/v1/mail-channel/test') {
      items.unshift({
        id: '3b0a0a52-1d8e-4c55-9c39-2a5f0b0e9a01',
        purpose: 'test',
        state: 'given_up',
        droppedReason: null,
        attempts: 1,
        createdAt: '2026-11-05T10:00:00.000Z',
        nextAt: null,
        last: { at: '2026-11-05T10:00:05.000Z', failure: 'recipient_refused', smtpCode: 550 },
      });
      return json(200, { id: '3b0a0a52-1d8e-4c55-9c39-2a5f0b0e9a01' });
    }
    if (path === '/v1/mail-channel/mail') {
      return json(200, {
        items,
        next: null,
        counts: { waiting: 0, sent: 0, givenUp: items.length, dropped: {} },
      });
    }
    return json(200, read());
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), calls };
}

describe("Administration's Email (the EM plan, EMb)", () => {
  it('turns mail on by a relay of its own, then takes its password write-only', async () => {
    const { client, calls } = service();
    render(<Mail client={client} mayChange />);
    await userEvent.click(await screen.findByRole('radio', { name: /^By a relay of your own/ }));
    await userEvent.type(screen.getByLabelText('Host'), 'mail.example.test');
    await userEvent.selectOptions(screen.getByLabelText('Port'), '465');
    await userEvent.type(screen.getByLabelText('Username'), 'news');
    await userEvent.type(screen.getByLabelText('Sent from'), 'news@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((each) => each.method === 'PUT')?.body).toEqual({
        enabled: false,
        relay: 'own',
        host: 'mail.example.test',
        port: 465,
        username: 'news',
        fromAddress: 'news@example.test',
        fromName: null,
        kindsOff: [],
      }),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(screen.getByText(/No password is held/)).toBeInTheDocument();
    const password = screen.getByLabelText('New password');
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.type(password, 'relay-dev-password');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByText('Password set.')).toBeInTheDocument();
    expect(screen.getByText(/A password is held/)).toBeInTheDocument();
    expect(password).toHaveValue('');
  });

  it('names the operator’s address, and sends the operator’s relay no address of its own', async () => {
    const { client, calls } = service();
    render(<Mail client={client} mayChange />);
    expect(await screen.findByText(/From mail@operator\.test/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('checkbox', { name: 'Send mail from this environment' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((each) => each.method === 'PUT')?.body).toEqual({
        enabled: true,
        relay: 'platform',
        fromName: null,
        kindsOff: [],
      }),
    );
  });

  it('sends a test to the reader’s own address and lists what came of it by code alone', async () => {
    const { client } = service();
    render(<Mail client={client} mayChange />);
    expect(await screen.findByText('No mail yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send a test to yourself' }));
    expect(await screen.findByText(/A test is on its way/)).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Mail of these 30 days' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent('Test');
    expect(row).toHaveTextContent('Given up');
    expect(row).toHaveTextContent('recipient_refused, SMTP 550');
  });

  it('says since when mail has failed to leave', async () => {
    const { client } = service({
      channel: { enabled: true, failingSince: '2026-11-05T09:00:00.000Z' },
    });
    render(<Mail client={client} mayChange />);
    expect(await screen.findByText(/Mail has failed to leave since/)).toBeInTheDocument();
  });

  it('shows the settings unchangeable to somebody who may not configure them', async () => {
    const { client } = service();
    render(<Mail client={client} mayChange={false} />);
    expect(
      await screen.findByRole('checkbox', { name: 'Send mail from this environment' }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByText(/Only someone who may configure/)).toBeInTheDocument();
  });

  it('says so where the reader may not see the channel', async () => {
    const { client } = service({ status: 403 });
    render(<Mail client={client} mayChange={false} />);
    expect(await screen.findByText(/can see how its mail leaves/)).toBeInTheDocument();
  });

  it('COL-060 chooses the kinds of notification this environment mails', async () => {
    const { client, calls } = service({ channel: { enabled: true, kindsOff: ['reply'] } });
    render(<Mail client={client} mayChange />);
    const kinds = await screen.findByRole('group', { name: 'Notifications it mails' });
    expect(within(kinds).getByRole('checkbox', { name: /^Replies/ })).not.toBeChecked();
    await userEvent.click(within(kinds).getByRole('checkbox', { name: 'The daily digest' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(calls.find((each) => each.method === 'PUT')?.body).toMatchObject({
        kindsOff: ['reply', 'digest'],
      }),
    );
  });

  it('names an invitation’s mail and a notice of closing, and why one was not sent', async () => {
    const queued = (purpose: string, droppedReason: string | null, id: string) => ({
      id,
      purpose,
      state: droppedReason === null ? 'pending' : 'dropped',
      droppedReason,
      attempts: 0,
      createdAt: '2026-11-05T10:00:00.000Z',
      nextAt: null,
      last: null,
    });
    const { client } = service({
      items: [
        queued('invitation', 'invitation_repeated', '3b0a0a52-1d8e-4c55-9c39-2a5f0b0e9a02'),
        queued('closure', null, '3b0a0a52-1d8e-4c55-9c39-2a5f0b0e9a03'),
      ],
    });
    render(<Mail client={client} mayChange />);
    const table = await screen.findByRole('table', { name: 'Mail of these 30 days' });
    const [, invited, closing] = within(table).getAllByRole('row');
    expect(invited).toHaveTextContent('Invitation');
    expect(invited).toHaveTextContent('invitation_repeated');
    expect(closing).toHaveTextContent('Notice of closing');
  });
});
