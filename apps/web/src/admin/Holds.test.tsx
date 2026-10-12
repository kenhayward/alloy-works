import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Holds } from './Holds.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const HOLD = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const OLD = '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d';
const IVY = { id: '11111111-1111-4111-8111-111111111111', name: 'Ivy' };
const UNTITLED = '2c4e6a8b-1d3f-4a5b-8c7d-9e0f1a2b3c4d';

/** The holds listing and its release, as the service answers them. */
function service(status = 200) {
  let released: { reason: string; by: typeof IVY; at: string } | null = null;
  const sent: { url: string; body: unknown }[] = [];
  const holds = () => [
    {
      id: HOLD,
      target: { kind: 'component', id: 'c1', title: 'Dosing procedure' },
      reason: 'Matter 2026-14',
      appliedBy: IVY,
      appliedAt: '2026-10-12T09:00:00.000Z',
      released,
    },
    {
      id: OLD,
      target: { kind: 'space', id: 's1', title: 'Clinical' },
      reason: 'Audit request',
      appliedBy: IVY,
      appliedAt: '2026-10-01T09:00:00.000Z',
      released: { reason: 'Audit done', by: IVY, at: '2026-10-05T09:00:00.000Z' },
    },
    {
      id: UNTITLED,
      target: { kind: 'publication', id: 'p1', title: null },
      reason: 'Audit request',
      appliedBy: IVY,
      appliedAt: '2026-09-01T09:00:00.000Z',
      released: null,
    },
  ];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    if (request.method === 'GET') {
      return status === 200
        ? json(200, { items: holds(), next: null, total: 3 })
        : json(status, {});
    }
    const body = (await request.json()) as { reason: string };
    sent.push({ url, body });
    released = { reason: body.reason, by: IVY, at: '2026-10-12T10:00:00.000Z' };
    return json(200, holds()[0]);
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

describe("Administration's Legal holds", () => {
  it('LIF-022 lists each hold with what it holds, who placed it, when and why, and its release', async () => {
    const { client } = service();
    render(<Holds client={client} />);
    const table = await screen.findByRole('table', { name: 'Legal holds' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Dosing procedure');
    expect(rows[0]).toHaveTextContent('Component');
    expect(rows[0]).toHaveTextContent('Matter 2026-14');
    expect(rows[0]).toHaveTextContent('Ivy');
    expect(rows[0]).toHaveTextContent('12 Oct 2026');
    expect(rows[0]).toHaveTextContent('In force');
    expect(rows[1]).toHaveTextContent('Clinical');
    expect(rows[1]).toHaveTextContent('Space');
    expect(rows[1]).toHaveTextContent('Released');
    expect(rows[1]).toHaveTextContent('Audit done');
    expect(within(rows[1]!).queryByRole('button', { name: /Release/ })).toBeNull();
  });

  it('LIF-022 releases a hold only with a reason, and shows it released', async () => {
    const { client, sent } = service();
    render(<Holds client={client} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Release the hold on Dosing procedure' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Release hold' }));
    expect(await within(dialog).findByText('Give a reason.')).toBeInTheDocument();
    expect(sent).toEqual([]);
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Matter closed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Release hold' }));
    expect(await screen.findByText('Released the hold on Dosing procedure.')).toBeInTheDocument();
    expect(sent).toEqual([{ url: `/v1/holds/${HOLD}/release`, body: { reason: 'Matter closed' } }]);
    const table = screen.getByRole('table', { name: 'Legal holds' });
    expect(await within(table).findByText('Matter closed', { exact: false })).toBeInTheDocument();
  });

  it('names a hold on something untitled by its kind, and shows one in force as a fact, not a success', async () => {
    const { client } = service();
    render(<Holds client={client} />);
    const table = await screen.findByRole('table', { name: 'Legal holds' });
    const untitled = within(table).getAllByRole('row')[3]!;
    expect(untitled).toHaveTextContent('the publication');
    expect(
      within(untitled).getByRole('button', { name: 'Release the hold on the publication' }),
    ).toBeInTheDocument();
    expect(within(untitled).getByText('In force')).toHaveAttribute('data-tone', 'neutral');
  });

  it('says so to somebody who may not see the holds', async () => {
    const { client } = service(403);
    render(<Holds client={client} />);
    expect(await screen.findByText('You may not manage access here.')).toBeInTheDocument();
  });
});
