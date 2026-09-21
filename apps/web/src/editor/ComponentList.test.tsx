import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComponentList } from './ComponentList.js';

const GENERAL = '1a1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const TRAINING = '2b1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const PRINTER = '3c1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const TONER = '4d1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const row = (id: string, title: string, space: string, by: { id: string; name: string }) => ({
  id,
  title,
  space: { id: space, name: space === GENERAL ? 'General' : 'Training' },
  version: '0.2',
  type: 'Topic',
  language: 'en-GB',
  changedAt: new Date(2025, 11, 3, 11, 0).toISOString(),
  changedBy: by,
});

const SPACES = [
  { id: GENERAL, name: 'General', count: 1 },
  { id: TRAINING, name: 'Training', count: 1 },
];

/** The service: both components unfiltered, and only a space's own when the filter names it. */
function service() {
  const asked: string[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/spaces') return json(200, { items: [] });
    if (url.pathname !== '/v1/components') return json(404, {});
    const spaces = url.searchParams.get('spaces');
    asked.push(spaces ?? 'all');
    const items = [
      row(PRINTER, 'Install the printer', GENERAL, { id: 'p1', name: 'Ada' }),
      row(TONER, 'Replace the toner', TRAINING, { id: 'p2', name: 'Grace' }),
    ].filter((item) => spaces === null || spaces.split(',').includes(item.space.id));
    return json(200, { items, next: null, total: items.length, spaces: SPACES });
  }) as unknown as typeof fetch;
  const client = createApiClient({ baseUrl: 'http://list.test', fetch: fetching });
  return { client, asked };
}

afterEach(() => window.localStorage.clear());

describe('the components list', () => {
  it('shows each component as a row: title linking to it, type, space, version, language, when changed and by whom', async () => {
    const { client } = service();
    render(<ComponentList client={client} principalId="p9" />);

    const link = await screen.findByRole('link', { name: 'Replace the toner' });
    expect(link).toHaveAttribute('href', `#/components/${TONER}`);
    const cells = within(link.closest('tr')!).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Replace the toner',
      'Topic',
      'Training',
      '0.2',
      'en-GB',
      '3 Dec 2025',
      'Grace',
    ]);
    expect(screen.getByRole('heading', { name: 'Components' })).toBeInTheDocument();
    expect(screen.getByText('2 components you may read. Showing 1 to 2.')).toBeInTheDocument();
  });

  it('filters by space, and clears the filter', async () => {
    const { client, asked } = service();
    render(<ComponentList client={client} principalId="p9" />);
    await screen.findByRole('link', { name: 'Replace the toner' });

    await userEvent.click(screen.getByRole('checkbox', { name: /General/ }));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Replace the toner' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Install the printer' })).toBeInTheDocument();
    expect(asked).toContain(GENERAL);
    expect(screen.getByText(/Space: General/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(await screen.findByRole('link', { name: 'Replace the toner' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /General/ })).not.toBeChecked();
  });

  it("says You for the reader's own change", async () => {
    const { client } = service();
    render(<ComponentList client={client} principalId="p1" />);

    const link = await screen.findByRole('link', { name: 'Install the printer' });
    const cells = within(link.closest('tr')!).getAllByRole('cell');
    expect(cells.at(-1)).toHaveTextContent('You');
  });
});
