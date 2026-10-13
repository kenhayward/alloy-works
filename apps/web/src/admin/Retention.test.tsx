import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Retention } from './Retention.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const CLINICAL = { id: '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41', name: 'Clinical' };
const SURGICAL = { id: '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d', name: 'Surgical' };
const IVY = { id: '11111111-1111-4111-8111-111111111111', name: 'Ivy' };

interface Keep {
  kind: 'component' | 'document' | null;
  space: { id: string; name: string } | null;
  days: number;
  by: typeof IVY;
  at: string;
}

/** The keeps and the spaces, as the service answers them, a PUT changing the keeps. */
function service(status = 200) {
  let keeps: Keep[] = [
    { kind: 'document', space: null, days: 365, by: IVY, at: '2026-10-12T09:00:00.000Z' },
    { kind: null, space: CLINICAL, days: 30, by: IVY, at: '2026-10-13T09:00:00.000Z' },
  ];
  const sent: unknown[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    if (url === '/v1/spaces') {
      return json(200, {
        items: [CLINICAL, SURGICAL].map((each) => ({ ...each, archived: false })),
        next: null,
      });
    }
    if (status !== 200) return json(status, {});
    if (request.method === 'PUT') {
      const body = (await request.json()) as {
        kind: Keep['kind'];
        space: string | null;
        days: number | null;
      };
      sent.push(body);
      const space = [CLINICAL, SURGICAL].find((each) => each.id === body.space) ?? null;
      keeps = keeps.filter(
        (each) => each.kind !== body.kind || (each.space?.id ?? null) !== body.space,
      );
      if (body.days !== null) {
        keeps.push({
          kind: body.kind,
          space,
          days: body.days,
          by: IVY,
          at: '2026-10-13T10:00:00.000Z',
        });
      }
    }
    return json(200, { keeps });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

describe("Administration's Retention", () => {
  it('LIF-019 lists the keeps by kind and by space, with who set each and when', async () => {
    const { client } = service();
    render(<Retention client={client} />);
    const table = await screen.findByRole('table', { name: 'Retention keeps' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Documents');
    expect(rows[0]).toHaveTextContent('Every space');
    expect(rows[0]).toHaveTextContent('365 days');
    expect(rows[0]).toHaveTextContent('Ivy');
    expect(rows[0]).toHaveTextContent('12 Oct 2026');
    expect(rows[1]).toHaveTextContent('Components and documents');
    expect(rows[1]).toHaveTextContent('Clinical');
    expect(rows[1]).toHaveTextContent('30 days');
  });

  it('LIF-019 sets a keep for a kind in a space, and clears one', async () => {
    const { client, sent } = service();
    render(<Retention client={client} />);
    await screen.findByRole('table', { name: 'Retention keeps' });
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'Components');
    await userEvent.selectOptions(await screen.findByLabelText('Space'), 'Surgical');
    await userEvent.type(screen.getByLabelText('Days'), '90');
    await userEvent.click(screen.getByRole('button', { name: 'Set keep' }));
    expect(
      await screen.findByText('Components in Surgical are kept for at least 90 days.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('90 days')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Clear the keep on components and documents in Clinical',
      }),
    );
    expect(
      await screen.findByText('Cleared the keep on components and documents in Clinical.'),
    ).toBeInTheDocument();
    expect(sent).toEqual([
      { kind: 'component', space: SURGICAL.id, days: 90 },
      { kind: null, space: CLINICAL.id, days: null },
    ]);
  });

  it('asks for a kind or a space, and whole days, before it sends anything', async () => {
    const { client, sent } = service();
    render(<Retention client={client} />);
    await screen.findByRole('table', { name: 'Retention keeps' });
    await userEvent.type(screen.getByLabelText('Days'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Set keep' }));
    expect(await screen.findByText('Choose a kind, a space or both.')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'Documents');
    await userEvent.clear(screen.getByLabelText('Days'));
    await userEvent.type(screen.getByLabelText('Days'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Set keep' }));
    expect(await screen.findByText('Give whole days, from 1 to 36500.')).toBeInTheDocument();
    expect(sent).toEqual([]);
  });

  it('says so to somebody who may not see the keeps', async () => {
    const { client } = service(403);
    render(<Retention client={client} />);
    expect(await screen.findByText('You may not manage access here.')).toBeInTheDocument();
  });
});
