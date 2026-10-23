import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ImportPolicy } from './ImportPolicy.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  let settings = { policy: 'map' };
  const put: unknown[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (request.method === 'PUT') {
      settings = (await request.json()) as typeof settings;
      put.push(settings);
    }
    return json(200, settings);
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), put };
}

describe("Administration's Imports", () => {
  it('IMP-010 shows the identity policy for imports and lets an administrator change it', async () => {
    const { client, put } = service();
    render(<ImportPolicy client={client} mayChange />);
    const map = await screen.findByRole('radio', { name: /Match to members/ });
    expect(map).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Keep as text/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toEqual([{ policy: 'keep' }]));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    // Whatever the policy, the importer makes what an import makes.
    expect(screen.getByText(/made by whoever accepts the import/)).toBeInTheDocument();
  });

  it('shows the policy to somebody who may not change it, unchangeable', async () => {
    const { client } = service();
    render(<ImportPolicy client={client} mayChange={false} />);
    expect(await screen.findByRole('radio', { name: /Match to members/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
