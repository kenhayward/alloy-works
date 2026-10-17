import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';

import { Shares } from './Shares.js';

const PUBLICATION = 'ffffffff-0000-4000-8000-000000000001';
const SHARE = 'cccccccc-0000-4000-8000-000000000001';
const DAY = 86_400_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const share = (over: Record<string, unknown> = {}) => ({
  id: SHARE,
  recipient: { id: 'r', email: 'iris@example.net', name: null, signedIn: false },
  expiresAt: new Date(Date.now() + 30 * DAY).toISOString(),
  expired: false,
  sharedBy: { id: 'g', name: 'Grace' },
  sharedAt: '2026-10-17T09:00:00.000Z',
  accesses: [],
  ...over,
});

/** The panel over a fake service answering by method and path; every request it took, in order. */
const open = (answer: (method: string, path: string, body: unknown) => Response) => {
  const asked: { method: string; path: string; body: unknown }[] = [];
  render(
    <StrictMode>
      <Shares
        client={createApiClient({
          baseUrl: 'http://acme.example.test',
          fetch: (async (input: Request) => {
            const path = new URL(input.url).pathname;
            const text = input.method === 'GET' ? '' : await input.clone().text();
            const body = text === '' ? undefined : (JSON.parse(text) as unknown);
            asked.push({ method: input.method, path, body });
            return answer(input.method, path, body);
          }) as unknown as typeof fetch,
        })}
        publication={PUBLICATION}
      />
    </StrictMode>,
  );
  return asked;
};

describe("a publication's shares outside the organisation", () => {
  it('PUB-057 shares a publication with a named address, and says they read it once they sign in with it', async () => {
    let shared = false;
    const asked = open((method) =>
      method === 'POST'
        ? ((shared = true), json(200, { share: share(), invited: true }))
        : json(200, { shares: shared ? [share()] : [] }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Share outside' }));
    const dialog = screen.getByRole('dialog', { name: 'Share outside the organisation' });
    await userEvent.type(within(dialog).getByLabelText('Their email address'), 'iris@example.net');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Share' }));
    expect(
      await screen.findByText(
        'Shared with iris@example.net. Send them the address of this page: they read it once they sign in with that address.',
      ),
    ).toBeInTheDocument();
    expect(asked.find((each) => each.method === 'POST')).toMatchObject({
      path: `/v1/publications/${PUBLICATION}/shares`,
      body: { email: 'iris@example.net' },
    });
    expect(await screen.findByText('iris@example.net')).toBeInTheDocument();
    expect(screen.getByText('Not signed in yet')).toBeInTheDocument();
  });

  it('PUB-058 offers an expiry from tomorrow, 30 days unless changed, and never past 90', async () => {
    const asked = open((method) =>
      method === 'POST' ? json(200, { share: share(), invited: false }) : json(200, { shares: [] }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Share outside' }));
    const until = screen.getByLabelText('Until');
    const local = (at: Date) =>
      `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    const day = (days: number) => local(new Date(Date.now() + days * DAY));
    expect(until).toHaveValue(day(30));
    expect(until).toHaveAttribute('max', day(90));
    expect(until).toHaveAttribute('min', day(1));
    await userEvent.type(screen.getByLabelText('Their email address'), 'iris@example.net');
    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    await screen.findByText(/^Shared with iris@example.net\./);
    const sent = asked.find((each) => each.method === 'POST')!.body as { expiresAt: string };
    expect(local(new Date(sent.expiresAt))).toBe(day(30));
  });

  it('PUB-058 revokes a share at once, asking first', async () => {
    let revoked = false;
    const asked = open((method) =>
      method === 'DELETE'
        ? ((revoked = true), json(200, { revoked: SHARE }))
        : json(200, { shares: revoked ? [] : [share()] }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke iris@example.net' }));
    const confirm = screen.getByRole('dialog', { name: 'Revoke this share?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    expect(asked.find((each) => each.method === 'DELETE')!.path).toBe(
      `/v1/publications/${PUBLICATION}/shares/${SHARE}`,
    );
    expect(
      await screen.findByText('Shared with nobody outside the organisation.'),
    ).toBeInTheDocument();
  });

  it('PUB-060 says each access to whoever may share it, and says nothing to anybody else', async () => {
    open(() =>
      json(200, {
        shares: [
          share({
            recipient: { id: 'r', email: 'iris@example.net', name: 'Iris', signedIn: true },
            accesses: [
              { at: '2026-10-17T11:00:00.000Z', output: 'pdf' },
              { at: '2026-10-17T10:00:00.000Z', output: null },
            ],
          }),
        ],
      }),
    );
    const row = (await screen.findByText('Iris')).closest('li')!;
    expect(within(row).getByText(/^Opened 2 times, last on /)).toBeInTheDocument();
    expect(within(row).getByText(/^Until /)).toBeInTheDocument();
  });

  it('shows nothing to somebody who may not share it', async () => {
    const asked = open(() => json(403, { code: 'forbidden', message: 'No.' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked.length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Share outside' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});
