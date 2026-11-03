import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TenantExport } from './TenantExport.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const READY = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const GONE = '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d';
const ASKED = '2c4e6a8b-1d3f-4a5b-8c7d-9e0f1a2b3c4d';
const SPACE = '3d5f7a9c-2e4a-4b6c-8d0e-0f1a2b3c4d5e';

const row = (id: string, state: string, over: Record<string, unknown> = {}) => ({
  id,
  state,
  scope: 'tenant',
  scopeId: null,
  followReferences: false,
  requestedAt: '2026-10-12T09:00:00.000Z',
  requestedBy: null,
  finishedAt: state === 'queued' ? null : '2026-10-12T09:05:00.000Z',
  expiresAt: state === 'queued' || state === 'failed' ? null : '2026-10-19T09:05:00.000Z',
  bytes: state === 'queued' ? null : 2_097_152,
  sha256: null,
  counts: null,
  ...over,
});

/** The exports listing, an export asked for, and its download, as the service answers them. */
function service() {
  const asked: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  let made: 'none' | 'queued' | 'done' = 'none';
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    asked.push(`${request.method} ${path}`);
    if (request.method === 'GET' && path === '/v1/spaces') {
      return json(200, { items: [{ id: SPACE, name: 'Regulatory' }], next: null });
    }
    if (request.method === 'POST' && path === '/v1/exports') {
      bodies.push((await request.clone().json()) as Record<string, unknown>);
      made = 'queued';
      return json(200, { export: row(ASKED, 'queued') });
    }
    if (request.method === 'GET' && path === '/v1/exports') {
      const items = [
        ...(made === 'none' ? [] : [row(ASKED, made, { requestedAt: '2026-10-18T09:00:00.000Z' })]),
        row(READY, 'done'),
        row(GONE, 'expired', { requestedAt: '2026-10-01T09:00:00.000Z' }),
      ];
      // Written by its job by the time the list is read again.
      if (made === 'queued') made = 'done';
      return json(200, { items, next: null });
    }
    if (request.method === 'GET' && path === `/v1/exports/${READY}/download`) {
      return json(200, { download: 'https://store.test/export.zip?signed' });
    }
    return json(404, { code: 'not_found', message: 'There is nothing at this address.' });
  }) as typeof fetch;
  return {
    client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }),
    asked,
    bodies,
  };
}

describe("Administration's Export (the R21 plan, R21-B)", () => {
  it('IMP-022 IMP-024 asks for the configuration or one space, following its references unless told not to', async () => {
    const user = userEvent.setup();
    const { client, bodies } = service();
    render(<TenantExport client={client} followMs={1} follow={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'Export the configuration' }));
    await waitFor(() => expect(bodies).toEqual([{ scope: 'configuration' }]));
    expect(await screen.findByLabelText('Space')).toHaveValue(SPACE);
    await user.click(screen.getByRole('button', { name: 'Export this space' }));
    await waitFor(() =>
      expect(bodies[1]).toEqual({ scope: 'space', id: SPACE, followReferences: true }),
    );
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Export this space' }));
    await waitFor(() =>
      expect(bodies[2]).toEqual({ scope: 'space', id: SPACE, followReferences: false }),
    );
  });

  it('API-044 asks for an export of the environment and lists the past ones, each downloadable while it is kept', async () => {
    const user = userEvent.setup();
    const follow = vi.fn();
    const { client, asked } = service();
    render(<TenantExport client={client} followMs={1} follow={follow} />);
    const table = await screen.findByRole('table', { name: 'Exports' });
    const [, ready, gone] = within(table).getAllByRole('row');
    expect(within(ready!).getByText('Ready')).toBeVisible();
    expect(within(ready!).getByText('2.0 MB')).toBeVisible();
    expect(within(gone!).getByText('Expired')).toBeVisible();
    // An expired one has nothing left to download.
    expect(within(gone!).queryByRole('button', { name: /^Download/ })).toBeNull();

    await user.click(within(ready!).getByRole('button', { name: /^Download the export/ }));
    await waitFor(() =>
      expect(follow).toHaveBeenCalledWith('https://store.test/export.zip?signed'),
    );

    await user.click(screen.getByRole('button', { name: 'Export everything' }));
    expect(asked).toContain('POST /v1/exports');
    expect(await screen.findByRole('status')).toHaveTextContent('Export asked for.');
    // Listed while it is written, and read again until it is ready.
    await waitFor(() => {
      const rows = within(screen.getByRole('table', { name: 'Exports' })).getAllByRole('row');
      expect(rows).toHaveLength(4);
      expect(within(rows[1]!).getByText('Ready')).toBeVisible();
    });
  });
});
