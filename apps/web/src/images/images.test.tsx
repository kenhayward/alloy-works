import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Images } from './Images.js';

const GENERAL = '11111111-1111-4111-8111-111111111111';
const HARBOUR = '22222222-2222-4222-8222-222222222222';
const HARBOUR_VERSION = '33333333-3333-4333-8333-333333333333';
const TOWER = '44444444-4444-4444-8444-444444444444';
const TOWER_VERSION = '55555555-5555-4555-8555-555555555555';
const STOCK = '66666666-6666-4666-8666-666666666666';
const PUMPS = '77777777-7777-4777-8777-777777777777';
const MANUAL = '88888888-8888-4888-8888-888888888888';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const harbour = {
  id: HARBOUR,
  version: { id: HARBOUR_VERSION, number: '0.1' },
  name: 'harbour.png',
  alternative: { text: 'A harbour at dawn', language: 'en-GB' },
  format: 'png',
  width: 1600,
  height: 900,
  rights: {
    kind: 'declared',
    source: { text: 'A stock library' },
    licence: STOCK,
  },
  licence: { id: STOCK, name: 'Stock, editorial' },
  expired: false,
  used: true,
  changedAt: '2026-11-01T09:00:00.000Z',
};

const tower = {
  ...harbour,
  id: TOWER,
  version: { id: TOWER_VERSION, number: '0.1' },
  name: 'tower.jpg',
  alternative: null,
  format: 'jpeg',
  width: 600,
  height: 1200,
  rights: { kind: 'declared', source: { text: 'Grace' }, licence: STOCK, expires: '2020-01-31' },
  expired: true,
  used: false,
};

function service() {
  const asked: string[] = [];
  const fetching = vi.fn(async (input: string | URL | Request) => {
    const request = input instanceof Request ? input : new Request(String(input));
    const url = new URL(request.url);
    const path = url.pathname;
    asked.push(`${path}${url.search}`);
    if (path === '/v1/spaces') {
      return json(200, {
        items: [{ id: GENERAL, name: 'General', archived: false, mayCreate: true }],
        next: null,
      });
    }
    if (path === '/v1/licences') {
      return json(200, {
        items: [{ id: STOCK, licence: { name: 'Stock, editorial' } }],
        next: null,
      });
    }
    if (path === `/v1/spaces/${GENERAL}/assets`) {
      const q = url.searchParams.get('q');
      const unused = url.searchParams.get('unused');
      const items = [harbour, tower].filter(
        (each) => (q === null || each.name.includes(q)) && (unused === null || !each.used),
      );
      return json(200, { items, next: null, total: items.length });
    }
    if (path === `/v1/assets/${HARBOUR}/uses`) {
      return json(200, {
        components: { named: [{ id: PUMPS, title: 'Pump station' }], unreadable: true },
        documents: { named: [{ id: MANUAL, title: 'Operating manual' }], unreadable: false },
        baselines: { named: [], unreadable: false },
        publications: { named: [], unreadable: false },
      });
    }
    return json(404, { code: 'not_found', message: 'Nothing here' });
  });
  return {
    client: createApiClient({ baseUrl: 'http://localhost', fetch: fetching }),
    asked,
  };
}

const listed = (asked: readonly string[]) =>
  asked.filter((each) => each.startsWith(`/v1/spaces/${GENERAL}/assets`));

describe("the Images page: a space's images (the AL plan, AL-J, AL-K)", () => {
  it('AST-028 AST-009 shows each image by its thumbnail, never its original, with its name, size and rights', async () => {
    const { client } = service();
    render(<Images client={client} />);
    const list = await screen.findByRole('list', { name: 'Images' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const first = within(items[0]!);
    expect(first.getByRole('img', { name: 'A harbour at dawn' })).toHaveAttribute(
      'src',
      `/v1/asset-versions/${HARBOUR_VERSION}/derivatives/thumbnail`,
    );
    expect(first.getByText('harbour.png')).toBeInTheDocument();
    expect(first.getByText('PNG, 1,600 by 900')).toBeInTheDocument();
    expect(first.getByText('Stock, editorial')).toBeInTheDocument();
    const second = within(items[1]!);
    // No description of its own: the name beside it says what it is.
    expect(items[1]!.querySelector('img')).toHaveAttribute('alt', '');
    expect(second.getByText('Licence expired')).toBeInTheDocument();
    expect(second.getByText('Unused')).toBeInTheDocument();
    expect(screen.getByText('2 images you may read.')).toBeInTheDocument();
  });

  it('AST-028 AST-050 asks the service again for what is searched and filtered, unused among them', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<Images client={client} />);
    await screen.findByRole('list', { name: 'Images' });

    await user.type(screen.getByRole('searchbox', { name: 'Search images' }), 'tower');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(listed(asked).at(-1)).toContain('q=tower'));

    await user.selectOptions(screen.getByRole('combobox', { name: 'Format' }), 'JPEG');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Rights' }), 'Licence expired');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Orientation' }), 'Portrait');
    await user.selectOptions(
      await screen.findByRole('combobox', { name: 'Licence' }),
      'Stock, editorial',
    );
    await user.click(screen.getByRole('checkbox', { name: 'Only unused' }));
    await waitFor(() => {
      const last = new URL(`http://localhost${listed(asked).at(-1)}`).searchParams;
      expect(Object.fromEntries(last)).toEqual({
        q: 'tower',
        format: 'jpeg',
        rights: 'expired',
        orientation: 'portrait',
        licence: STOCK,
        unused: 'true',
      });
    });
    const list = await screen.findByRole('list', { name: 'Images' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
  });

  it('AST-018 says where an image is used, naming only what the reader may read', async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<Images client={client} />);
    const list = await screen.findByRole('list', { name: 'Images' });
    await user.click(within(list).getAllByRole('button', { name: 'Where used' })[0]!);
    const uses = await screen.findByRole('region', { name: 'Where harbour.png is used' });
    expect(within(uses).getByRole('link', { name: 'Pump station' })).toHaveAttribute(
      'href',
      `#/components/${PUMPS}`,
    );
    expect(within(uses).getByRole('link', { name: 'Operating manual' })).toHaveAttribute(
      'href',
      `#/documents/${MANUAL}`,
    );
    expect(within(uses).getByText('And components you may not read.')).toBeInTheDocument();
    expect(within(uses).getByText('No baselines.')).toBeInTheDocument();
    expect(within(uses).getByText('No publications.')).toBeInTheDocument();
  });

  it('says when the space holds no images, and when they could not be listed', async () => {
    const empty = createApiClient({
      baseUrl: 'http://localhost',
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname === '/v1/spaces')
          return json(200, { items: [{ id: GENERAL, name: 'General' }], next: null });
        if (url.pathname === '/v1/licences') return json(200, { items: [], next: null });
        return json(200, { items: [], next: null, total: 0 });
      }),
    });
    const { unmount } = render(<Images client={empty} />);
    expect(await screen.findByText('No images here match.')).toBeInTheDocument();
    unmount();

    const failing = createApiClient({
      baseUrl: 'http://localhost',
      fetch: vi.fn(async (input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname === '/v1/spaces')
          return json(200, { items: [{ id: GENERAL, name: 'General' }], next: null });
        if (url.pathname === '/v1/licences') return json(200, { items: [], next: null });
        return json(500, { code: 'internal', message: 'Broken' });
      }),
    });
    render(<Images client={failing} />);
    expect(await screen.findByText('The images could not be listed.')).toBeInTheDocument();
  });
});
