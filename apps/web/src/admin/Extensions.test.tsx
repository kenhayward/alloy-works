import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Extensions } from './Extensions.js';

const GAUGES = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const READINGS = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const RETIRED = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const FIRST = 'a'.repeat(64);
const NEWER = 'b'.repeat(64);
const URL_OF = 'https://gauges.example.test/alloy/manifest.json';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const manifest = (over: Record<string, unknown> = {}) => ({
  manifest: 1,
  name: 'River gauges',
  version: '1.2.0',
  publisher: 'Grace Gauges',
  description: 'Readings from river gauges, by site.',
  kind: 'source',
  endpoint: 'https://gauges.example.test/alloy',
  settings: [
    { key: 'region', label: 'Region', type: 'text', required: true },
    { key: 'days', label: 'Days of readings', type: 'number', required: false },
  ],
  authentication: { label: 'Gauge API key' },
  capabilities: { parameters: true, keyColumns: false, rowLimit: true },
  outbound: [{ host: 'archive.example.test', purpose: 'Older readings are fetched from here' }],
  ...over,
});

function service(options: { inUse?: boolean } = {}) {
  const sent: { method: string; path: string; body?: unknown }[] = [];
  let extensions: Record<string, unknown>[] = [
    {
      id: GAUGES,
      url: URL_OF,
      digest: FIRST,
      manifest: manifest(),
      installedBy: 'ada',
      installedAt: '2026-10-21T09:00:00.000Z',
      updatedAt: '2026-10-21T09:00:00.000Z',
      removedAt: null,
    },
  ];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    const route = `${request.method} ${path}`;
    if (request.method !== 'GET') {
      const text = await request.text();
      sent.push({ method: request.method, path, ...(text ? { body: JSON.parse(text) } : {}) });
    }
    if (route === 'GET /v1/extensions') return json(200, { items: extensions, next: null });
    if (route === 'POST /v1/extensions/preview') {
      return json(200, {
        url: 'https://tides.example.test/manifest.json',
        digest: NEWER,
        manifest: manifest({
          name: 'Tide tables',
          authentication: 'none',
          settings: [],
          outbound: [],
          endpoint: 'https://tides.example.test/alloy',
        }),
      });
    }
    if (route === 'POST /v1/extensions') {
      const made = {
        ...extensions[0]!,
        id: 'e2',
        url: 'https://tides.example.test/manifest.json',
        digest: NEWER,
        manifest: manifest({ name: 'Tide tables' }),
      };
      extensions = [...extensions, made];
      return json(200, made);
    }
    if (route === `POST /v1/extensions/${GAUGES}/preview`) {
      return json(200, {
        url: URL_OF,
        digest: NEWER,
        manifest: manifest({ version: '1.3.0', endpoint: 'https://gauges.example.test/v2' }),
        changes: ['endpoint', 'outbound'],
      });
    }
    if (route === `POST /v1/extensions/${GAUGES}/update`) {
      extensions = extensions.map((each) => ({
        ...each,
        digest: NEWER,
        manifest: manifest({ version: '1.3.0' }),
      }));
      return json(200, extensions[0]);
    }
    if (route === `GET /v1/extensions/${GAUGES}/uses`) {
      return json(200, {
        items: [
          { connection: READINGS, name: 'Gauge readings', digest: FIRST, retired: false },
          { connection: RETIRED, name: 'Old gauges', digest: FIRST, retired: true },
        ],
      });
    }
    if (route === `DELETE /v1/extensions/${GAUGES}`) {
      if (options.inUse) {
        return json(409, {
          code: 'extension_in_use',
          message: 'A connection not retired uses this extension: retire it first.',
        });
      }
      extensions = extensions.map((each) => ({ ...each, removedAt: '2026-10-22T09:00:00.000Z' }));
      return json(200, { removed: GAUGES });
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

describe("Administration's Extensions (the EX plan, EXc)", () => {
  it('lists the extensions installed, each with its version and whether it is active', async () => {
    const { client } = service();
    render(<Extensions client={client} />);
    const table = await screen.findByRole('table', { name: 'Extensions' });
    expect(within(table).getByText('River gauges')).toBeInTheDocument();
    expect(within(table).getByText('1.2.0')).toBeInTheDocument();
    expect(within(table).getByText('Grace Gauges')).toBeInTheDocument();
    expect(within(table).getByText('Active')).toBeInTheDocument();
  });

  it('API-030 previews a manifest by its URL, showing everything it declares, before installing it at that digest', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Extensions client={client} />);
    const form = await screen.findByRole('form', { name: 'Install an extension' });
    await user.type(
      within(form).getByRole('textbox', { name: 'Manifest URL' }),
      'https://tides.example.test/manifest.json',
    );
    await user.click(within(form).getByRole('button', { name: 'Preview' }));
    const declared = await screen.findByRole('region', { name: 'What Tide tables declares' });
    expect(declared).toHaveTextContent('1.2.0');
    expect(declared).toHaveTextContent('Grace Gauges');
    expect(declared).toHaveTextContent('https://tides.example.test/alloy');
    expect(declared).toHaveTextContent('Takes no secret');
    expect(declared).toHaveTextContent('Sends data to no other host');
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/v1/extensions/preview',
        body: { url: 'https://tides.example.test/manifest.json' },
      },
    ]);
    await user.click(within(declared).getByRole('button', { name: 'Install' }));
    expect(sent.at(-1)).toEqual({
      method: 'POST',
      path: '/v1/extensions',
      body: { url: 'https://tides.example.test/manifest.json', digest: NEWER },
    });
    expect(await screen.findByText('Installed Tide tables.')).toBeInTheDocument();
  });

  it("shows an installed extension's settings, secret, capabilities and outbound hosts, each with its purpose", async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<Extensions client={client} />);
    await user.click(await screen.findByRole('button', { name: 'What River gauges declares' }));
    const declared = screen.getByRole('region', { name: 'What River gauges declares' });
    expect(declared).toHaveTextContent('Region (text, required)');
    expect(declared).toHaveTextContent('Days of readings (number, not required)');
    expect(declared).toHaveTextContent('Takes one secret: Gauge API key');
    expect(declared).toHaveTextContent('Binds parameters');
    expect(declared).toHaveTextContent('Declares no key columns');
    expect(declared).toHaveTextContent('Takes the row limit');
    expect(declared).toHaveTextContent(
      'archive.example.test: Older readings are fetched from here',
    );
  });

  it('API-048 shows what an update changes before updating to the digest its preview showed', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Extensions client={client} />);
    await user.click(
      await screen.findByRole('button', { name: 'Check River gauges for an update' }),
    );
    const update = await screen.findByRole('region', { name: 'Update River gauges' });
    expect(update).toHaveTextContent(
      'Version 1.3.0 changes: its endpoint, the hosts it sends data to.',
    );
    expect(update).toHaveTextContent(
      'A connection keeps the manifest it was saved against until it is saved again; one whose endpoint moves needs its secret set again.',
    );
    expect(sent.map((each) => each.path)).toEqual([`/v1/extensions/${GAUGES}/preview`]);
    await user.click(within(update).getByRole('button', { name: 'Update' }));
    expect(sent.at(-1)).toEqual({
      method: 'POST',
      path: `/v1/extensions/${GAUGES}/update`,
      body: { digest: NEWER },
    });
    expect(await screen.findByText('Updated River gauges to 1.3.0.')).toBeInTheDocument();
  });

  it('lists the connections using an extension, a retired one marked', async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<Extensions client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Uses of River gauges' }));
    const uses = await screen.findByRole('list', { name: 'Connections using River gauges' });
    expect(uses).toHaveTextContent('Gauge readings');
    expect(uses).toHaveTextContent('Old gauges, retired');
    expect(within(uses).getByRole('link', { name: 'Gauge readings' })).toHaveAttribute(
      'href',
      `#/connections/${READINGS}`,
    );
  });

  it('removes an extension only after asking', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Extensions client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Remove River gauges' }));
    const asking = screen.getByRole('dialog', { name: 'Remove River gauges?' });
    await user.click(within(asking).getByRole('button', { name: 'Keep it' }));
    expect(sent).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Remove River gauges' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Remove River gauges?' })).getByRole('button', {
        name: 'Remove',
      }),
    );
    expect(await screen.findByText('Removed River gauges.')).toBeInTheDocument();
    expect(sent.map((each) => `${each.method} ${each.path}`)).toEqual([
      `DELETE /v1/extensions/${GAUGES}`,
    ]);
    const table = screen.getByRole('table', { name: 'Extensions' });
    expect(await within(table).findByText('Removed')).toBeInTheDocument();
  });

  it('says why an extension still in use was not removed', async () => {
    const user = userEvent.setup();
    const { client } = service({ inUse: true });
    render(<Extensions client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Remove River gauges' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Remove River gauges?' })).getByRole('button', {
        name: 'Remove',
      }),
    );
    expect(
      await screen.findByText('A connection not retired uses this extension: retire it first.'),
    ).toBeInTheDocument();
  });
});
