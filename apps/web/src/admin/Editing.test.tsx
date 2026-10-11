import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Editing } from './Editing.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  let settings = { iterationRetentionDays: 30, lockReleaseMinutes: 15, lockTakeMinutes: 5 };
  const put: unknown[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (request.method === 'PUT') {
      const body = (await request.json()) as typeof settings;
      put.push(body);
      settings = { ...settings, ...body };
    }
    return json(200, settings);
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), put };
}

describe("Administration's Editing", () => {
  it('COL-008 COL-046 shows how long a lock lasts and how soon it may be taken over, and lets an administrator change both, the second always shorter', async () => {
    const { client, put } = service();
    render(<Editing client={client} mayChange />);
    const lasts = await screen.findByLabelText(/A lock lasts/);
    const taken = screen.getByLabelText(/may be taken over after/);
    expect(lasts).toHaveValue(15);
    expect(taken).toHaveValue(5);

    await userEvent.clear(taken);
    await userEvent.type(taken, '20');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/make that time shorter/)).toBeInTheDocument();
    expect(put).toEqual([]);

    await userEvent.clear(lasts);
    await userEvent.type(lasts, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(put).toEqual([
        { lockReleaseMinutes: 30, lockTakeMinutes: 20, iterationRetentionDays: 30 },
      ]),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('shows the settings to somebody who may not change them, unchangeable', async () => {
    const { client } = service();
    render(<Editing client={client} mayChange={false} />);
    expect(await screen.findByLabelText(/A lock lasts/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
