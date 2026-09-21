import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Administration } from './Administration.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const everything: Record<string, () => Response> = {
  '/v1/tenant': () => json(200, { name: 'Development' }),
  '/v1/spaces': () =>
    json(200, {
      items: [
        { id: 's1', name: 'General', mayCreate: true },
        { id: 's2', name: 'Training', mayCreate: false },
      ],
    }),
  '/v1/principals': () =>
    json(200, {
      items: [
        { id: 'p1', name: 'Ada', email: 'ada@example.test', kind: 'user', invited: false },
        { id: 'p2', name: null, email: 'ivy@example.test', kind: 'external', invited: true },
      ],
      next: null,
    }),
  '/v1/invitations': () =>
    json(200, {
      items: [
        {
          id: 'i1',
          email: 'ivy@example.test',
          person: 'p2',
          external: true,
          invitedBy: { id: 'p1', name: 'Ada' },
          createdAt: '2026-09-17T09:00:00.000Z',
          expiresAt: '2026-10-01T09:00:00.000Z',
          lapsed: false,
          acceptedAt: null,
          acceptedThrough: null,
        },
      ],
      next: null,
    }),
  '/v1/roles': () =>
    json(200, {
      items: [{ id: 'r1', name: 'Author', permissions: ['read', 'create', 'edit'] }],
      next: null,
    }),
};

function service(answers: Record<string, () => Response>) {
  const asked: URL[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(url);
    const answer = answers[url.pathname];
    return answer ? answer() : json(404, {});
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), asked };
}

const section = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('Administration', () => {
  it('opens on Environment, and moves between the sections it can answer', async () => {
    const { client } = service(everything);
    render(<Administration client={client} about={null} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Administration' });
    expect(section('Environment')).toHaveAttribute('aria-current', 'true');
    // Beside the heading, and in the section.
    expect(await within(dialog).findAllByText('Development')).toHaveLength(2);
    for (const name of ['Spaces', 'People and invitations', 'Roles', 'About']) {
      expect(section(name)).toBeInTheDocument();
    }
    // What nothing answers yet is not offered.
    for (const name of ['Groups', 'Component types', 'Layouts']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${name}`) })).toBeNull();
    }
    await userEvent.click(section('Roles'));
    expect(section('Roles')).toHaveAttribute('aria-current', 'true');
    expect(section('Environment')).not.toHaveAttribute('aria-current');
  });

  it('lists the spaces, the people and the waiting invitations, and the roles with what each holds', async () => {
    const { client, asked } = service(everything);
    render(<Administration client={client} about={null} onClose={vi.fn()} />);

    await userEvent.click(section('Spaces'));
    const spaces = await screen.findByRole('table', { name: 'Spaces' });
    expect(within(spaces).getByRole('cell', { name: 'General' })).toBeInTheDocument();
    expect(within(spaces).getAllByRole('cell', { name: 'You may create here' })).toHaveLength(1);

    await userEvent.click(section('People and invitations'));
    const people = await screen.findByRole('table', { name: 'People' });
    expect(within(people).getByRole('cell', { name: 'Ada' })).toBeInTheDocument();
    expect(within(people).getByText(/invited and not signed in yet/)).toBeInTheDocument();
    const waiting = await screen.findByRole('table', { name: 'Waiting invitations' });
    expect(within(waiting).getByRole('cell', { name: 'ivy@example.test' })).toBeInTheDocument();

    await userEvent.click(section('Roles'));
    const roles = await screen.findByRole('table', { name: 'Roles' });
    expect(within(roles).getByRole('cell', { name: 'read, create, edit' })).toBeInTheDocument();

    // Read at the environment's own level.
    expect(asked.find((url) => url.pathname === '/v1/roles')?.searchParams.get('level')).toBe(
      'tenant',
    );
  });

  it('says so in the section, and only there, where the reader may not manage the environment', async () => {
    const refused = () => json(403, { code: 'forbidden', message: 'x', traceId: 't' });
    const { client } = service({
      ...everything,
      '/v1/principals': refused,
      '/v1/invitations': refused,
      '/v1/roles': refused,
    });
    render(<Administration client={client} about={null} onClose={vi.fn()} />);

    await userEvent.click(section('People and invitations'));
    // Said of the people and of the invitations, each refused.
    expect(await screen.findAllByText('You may not manage access here.')).toHaveLength(2);
    await userEvent.click(section('Spaces'));
    expect(await screen.findByRole('table', { name: 'Spaces' })).toBeInTheDocument();
    expect(screen.queryByText('You may not manage access here.')).toBeNull();
  });

  it('says which version this is in About, beside what it is given', async () => {
    const { client } = service(everything);
    render(
      <Administration client={client} about={<p>the environment panel</p>} onClose={vi.fn()} />,
    );

    await userEvent.click(section('About'));
    expect(screen.getByText(/^Version \d+\.\d+\.\d+$/)).toBeInTheDocument();
    expect(screen.getByText('the environment panel')).toBeInTheDocument();
  });
});
