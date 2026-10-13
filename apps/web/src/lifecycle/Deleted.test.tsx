import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { DeletedList } from './Deleted.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const PRINTER = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const PUMP = '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d';
const ADA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ada' };

const deleted = (id: string, title: string, mayUndelete: boolean) => ({
  id,
  kind: 'component',
  title,
  space: { id: 's1', name: 'Clinical' },
  deletedBy: ADA,
  deletedAt: '2026-10-13T09:00:00.000Z',
  mayUndelete,
});

/** The Deleted listing a page of one at a time, and Undelete, as the service answers them. */
function service() {
  const asked: string[] = [];
  let gone = [
    deleted(PRINTER, 'Install the printer', true),
    deleted(PUMP, 'Prime the pump', false),
  ];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(`${request.method} ${url.pathname}${url.search}`);
    if (request.method === 'POST') {
      gone = gone.filter((each) => !url.pathname.includes(each.id));
      return json(200, { deleted: false });
    }
    const at = url.searchParams.get('cursor') === 'second' ? 1 : 0;
    return json(200, {
      items: gone.slice(at, at + 1),
      next: at === 0 && gone.length > 1 ? 'second' : null,
      total: gone.length,
    });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://deleted.test', fetch: fetching }), asked };
}

describe('the Deleted listing (the DL plan, DL-H)', () => {
  it('lists the deleted of a kind with who deleted each and when, a page at a time', async () => {
    const { client, asked } = service();
    render(<DeletedList client={client} kind="component" />);
    const table = await screen.findByRole('table', { name: 'Deleted components' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Install the printer');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Clinical');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Ada');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('13 Oct 2026');
    expect(screen.getByText('2 deleted components you may read.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await within(table).findByText('Prime the pump')).toBeInTheDocument();
    expect(asked).toEqual([
      'GET /v1/deleted?kind=component',
      'GET /v1/deleted?kind=component&cursor=second',
    ]);
  });

  it('offers Undelete only where the reader may, and undeletes it', async () => {
    const { client, asked } = service();
    render(<DeletedList client={client} kind="component" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await screen.findByText('Prime the pump');
    expect(screen.queryByRole('button', { name: 'Undelete Prime the pump' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Undelete Install the printer' }));
    expect(await screen.findByText('Undeleted Install the printer.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Install the printer' })).toHaveAttribute(
      'href',
      `#/components/${PRINTER}`,
    );
    expect(asked).toContain(`POST /v1/components/${PRINTER}/undelete`);
    expect(screen.queryByRole('cell', { name: /Install the printer/ })).toBeNull();
  });
});
