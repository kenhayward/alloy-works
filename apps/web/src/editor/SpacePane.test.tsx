import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SpacePane } from './SpacePane.js';

const GENERAL = '1a1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const PRINTER = '3c1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const TONER = '4d1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const row = (id: string, title: string, version: string) => ({
  id,
  title,
  space: { id: GENERAL, name: 'General' },
  version,
  type: 'Topic',
  language: 'en-GB',
  changedAt: '2026-09-01T09:00:00.000Z',
  changedBy: null,
});

describe('the space pane', () => {
  it('lists the components of the space, marking the one open', async () => {
    const asked: URL[] = [];
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      asked.push(url);
      return json(200, {
        items: [row(PRINTER, 'Install the printer', '0.2'), row(TONER, 'Replace the toner', '1.4')],
        next: null,
        total: 2,
        spaces: [{ id: GENERAL, name: 'General', count: 2 }],
      });
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://pane.test', fetch: fetching });

    render(<SpacePane client={client} space={{ id: GENERAL, name: 'General' }} current={TONER} />);

    const pane = screen.getByRole('navigation', { name: 'General' });
    const open = await within(pane).findByRole('link', { name: /Replace the toner/ });
    expect(open).toHaveAttribute('aria-current', 'page');
    expect(open).toHaveTextContent('1.4');
    const other = within(pane).getByRole('link', { name: /Install the printer/ });
    expect(other).toHaveAttribute('href', `#/components/${PRINTER}`);
    expect(other).not.toHaveAttribute('aria-current');
    expect(asked[0]?.pathname).toBe('/v1/components');
    expect(asked[0]?.searchParams.get('spaces')).toBe(GENERAL);
  });
});
