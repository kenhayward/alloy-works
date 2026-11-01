import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ImagesPolicy } from './ImagesPolicy.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  let settings = { undeclared: 'warn' };
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

describe("Administration's Images (the AL plan, AL-F)", () => {
  it('AST-053 shows the policy for images with no licence declared, warn by default, and lets an administrator refuse them', async () => {
    const { client, put } = service();
    render(<ImagesPolicy client={client} mayChange />);
    expect(await screen.findByRole('radio', { name: /Publish and report them/ })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: /Refuse the publish/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toEqual([{ undeclared: 'refuse' }]));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    // Whatever the policy, a licence that does not permit publication refuses.
    expect(screen.getByText(/always refused/)).toBeInTheDocument();
  });

  it('shows the policy to somebody who may not change it, unchangeable', async () => {
    const { client } = service();
    render(<ImagesPolicy client={client} mayChange={false} />);
    expect(await screen.findByRole('radio', { name: /Publish and report them/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
