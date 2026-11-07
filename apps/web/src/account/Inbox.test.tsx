import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Inbox } from './Inbox.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ADA = 'aaaaaaaa-0000-4000-8000-000000000001';
const GRACE = 'aaaaaaaa-0000-4000-8000-000000000002';
const COMPONENT = 'cccccccc-0000-4000-8000-000000000001';
const HIDDEN = 'cccccccc-0000-4000-8000-000000000002';
const THREAD = 'tttttttt-0000-4000-8000-000000000001';
const GONE = 'tttttttt-0000-4000-8000-000000000002';
const id = (n: number) => `nnnnnnnn-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** The inbox routes, answered from notifications the test holds. */
function service(only?: Record<string, unknown>[], emailSent = false) {
  const held = [
    {
      id: id(1),
      kind: 'mention',
      actor: { id: ADA, name: 'Ada' },
      thread: THREAD,
      on: {
        id: COMPONENT,
        title: 'Install the printer',
        state: { key: 'in_review', name: 'In review' },
      },
      counts: null,
      at: '2026-10-12T10:00:00.000Z',
      read: false,
    },
    {
      id: id(2),
      kind: 'reply',
      actor: { id: ADA, name: 'Ada' },
      thread: GONE,
      on: { id: HIDDEN, title: null, state: null },
      counts: null,
      at: '2026-10-12T09:00:00.000Z',
      read: false,
    },
    {
      id: id(3),
      kind: 'digest',
      actor: null,
      thread: null,
      on: null,
      counts: {
        mention: 0,
        reply: 2,
        resolution: 1,
        threads: [THREAD],
        places: [{ id: COMPONENT, title: 'Install the printer' }],
      },
      at: '2026-10-12T07:00:00.000Z',
      read: true,
    },
  ];
  const rows = (only ?? held) as typeof held;
  let cadences = { mention: 'at_once', reply: 'at_once', resolution: 'daily' };
  let email = { mention: true, reply: true, resolution: true, round: true, digest: true };
  const bodies: unknown[] = [];
  const asked: string[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(`${request.method} ${url.pathname}`);
    if (url.pathname === '/v1/inbox/preferences') {
      if (request.method === 'PUT') {
        const body = (await request.json()) as { email?: typeof email };
        bodies.push(body);
        const { email: mailed, ...told } = body;
        cadences = { ...cadences, ...told };
        email = { ...email, ...mailed };
      }
      return json(200, { ...cadences, email, emailSent });
    }
    if (url.pathname === '/v1/inbox') {
      return json(200, {
        notifications: rows,
        unread: rows.filter((row) => !row.read).length,
        next: null,
      });
    }
    if (url.pathname === '/v1/people') {
      return json(200, { items: [{ id: GRACE, name: 'Grace' }], next: null });
    }
    if (url.pathname === `/v1/threads/${THREAD}`) {
      return json(200, {
        id: THREAD,
        on: { id: COMPONENT, kind: 'component' },
        resolution: null,
        comments: [
          {
            id: id(9),
            author: { id: ADA, name: 'Ada' },
            at: '2026-10-12T10:00:00.000Z',
            texts: [{ parts: [{ text: 'Over to ' }, { mention: GRACE }], at: '' }],
          },
        ],
      });
    }
    if (url.pathname.startsWith('/v1/threads/')) return json(404, { code: 'not_found' });
    const row = rows.find((each) => url.pathname.includes(each.id))!;
    if (request.method === 'DELETE') rows.splice(rows.indexOf(row), 1);
    else row.read = true;
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return {
    client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }),
    asked,
    cadences: () => cadences,
    email: () => email,
    bodies,
  };
}

describe('the inbox, from the account chip', () => {
  it('COL-063 COL-036 LIF-005 lists what happened newest first, unread said, in the state of what it is on, opens a thread as the reader may read it now, and marks it read', async () => {
    const { client, asked } = service();
    render(<Inbox client={client} onClose={() => undefined} />);
    const list = await screen.findByRole('list', { name: 'Notifications' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.firstChild?.textContent)).toEqual([
      'Ada mentioned you on Install the printer',
      'Ada replied on something you may no longer read',
      'Your daily digest: 2 replies, 1 resolution, on Install the printer',
    ]);
    expect(screen.getByText('2 unread')).toBeInTheDocument();
    // What it is on, in its state now; nothing of one its reader may no longer read (LIF-005).
    expect(within(items[0]!).getByText('In review')).toBeInTheDocument();
    expect(within(items[1]!).queryByText(/In review|Draft|Approved/)).toBeNull();

    await userEvent.click(within(items[0]!).getByRole('button', { name: 'Open' }));
    expect(await within(items[0]!).findByText('@Grace')).toBeInTheDocument();
    expect(
      within(items[0]!).getByRole('link', { name: 'Go to Install the printer' }),
    ).toHaveAttribute('href', `#/components/${COMPONENT}`);
    await waitFor(() => expect(asked).toContain(`POST /v1/inbox/${id(1)}/read`));
    expect(await screen.findByText('1 unread')).toBeInTheDocument();

    // A thread its reader may no longer read is gone to them.
    await userEvent.click(within(items[1]!).getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('You may no longer read this thread.')).toBeInTheDocument();
  });

  it('ADM-034 says a model budget alert to its recipient: how much of the month’s budget is spent, that nothing stops, and where to see it', async () => {
    const { client } = service([
      {
        id: id(4),
        kind: 'budget',
        actor: null,
        thread: null,
        on: null,
        counts: null,
        budget: {
          threshold: 80,
          currency: 'USD',
          spent: '412.500000',
          limit: '500.000000',
          month: '2026-10',
        },
        at: '2026-10-12T11:00:00.000Z',
        read: false,
      },
    ]);
    render(<Inbox client={client} onClose={() => undefined} />);
    const list = await screen.findByRole('list', { name: 'Notifications' });
    const item = within(list).getByRole('listitem');
    expect(item.firstChild?.textContent).toBe(
      'Models have cost USD 412.50 this month, 80% of the USD 500.00 budget. Nothing stops.',
    );
    expect(within(item).getByRole('link', { name: 'Open Model spending' })).toHaveAttribute(
      'href',
      '#/admin/spending',
    );
  });

  it('LIB-036 tells the owner a source cited in their document was retracted, and opens the document', async () => {
    const document = 'dddddddd-0000-4000-8000-000000000009';
    const { client } = service([
      {
        id: id(5),
        kind: 'reference',
        actor: null,
        thread: null,
        on: { id: document, kind: 'document', title: 'Marsh report', state: null },
        counts: null,
        reference: { entry: 'eeeeeeee-0000-4000-8000-000000000001', outcome: 'retracted' },
        at: '2026-10-12T11:00:00.000Z',
        read: false,
      },
    ]);
    render(<Inbox client={client} onClose={() => undefined} />);
    const list = await screen.findByRole('list', { name: 'Notifications' });
    const item = within(list).getByRole('listitem');
    expect(item.firstChild?.textContent).toBe(
      'A source cited in Marsh report was retracted by its source.',
    );
    expect(within(item).getByRole('link', { name: 'Open the document' })).toHaveAttribute(
      'href',
      `#/documents/${document}`,
    );
  });

  it('LIB-035 tells the owner a source cited in their document was superseded', async () => {
    const { client } = service([
      {
        id: id(5),
        kind: 'reference',
        actor: null,
        thread: null,
        on: {
          id: 'dddddddd-0000-4000-8000-000000000009',
          kind: 'document',
          title: 'Marsh report',
          state: null,
        },
        counts: null,
        reference: { entry: 'eeeeeeee-0000-4000-8000-000000000001', outcome: 'superseded' },
        at: '2026-10-12T11:00:00.000Z',
        read: false,
      },
    ]);
    render(<Inbox client={client} onClose={() => undefined} />);
    const list = await screen.findByRole('list', { name: 'Notifications' });
    expect(within(list).getByRole('listitem').firstChild?.textContent).toBe(
      'A source cited in Marsh report was superseded by its source.',
    );
  });

  it('COL-062 deletes one of your own notifications', async () => {
    const { client, asked } = service();
    render(<Inbox client={client} onClose={() => undefined} />);
    const list = await screen.findByRole('list', { name: 'Notifications' });
    await userEvent.click(within(list).getAllByRole('button', { name: 'Delete' })[0]!);
    expect(await screen.findByRole('status')).toHaveTextContent('Deleted.');
    expect(asked).toContain(`DELETE /v1/inbox/${id(1)}`);
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
  });

  it('COL-034 saves how often each kind is told', async () => {
    const { client, cadences } = service();
    render(<Inbox client={client} onClose={() => undefined} />);
    await userEvent.selectOptions(
      await screen.findByLabelText('When a comment names you'),
      'In a daily digest',
    );
    await userEvent.selectOptions(screen.getByLabelText('Threads you are in resolved'), 'Never');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved how often you are told.');
    expect(cadences()).toEqual({ mention: 'daily', reply: 'at_once', resolution: 'never' });
  });

  it('chooses which kinds are sent by email, where the environment mails', async () => {
    const { client, email, bodies } = service(undefined, true);
    render(<Inbox client={client} onClose={() => undefined} />);
    const mailed = await screen.findByRole('group', { name: 'Sent to you by email' });
    await userEvent.click(
      within(mailed).getByRole('checkbox', { name: 'When a comment names you' }),
    );
    await userEvent.click(within(mailed).getByRole('checkbox', { name: 'The daily digest' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved how often you are told.');
    expect(email()).toEqual({
      mention: false,
      reply: true,
      resolution: true,
      round: true,
      digest: false,
    });
    // Its own choices alone: whether the environment mails is not the person's to send.
    expect(bodies[0]).not.toHaveProperty('emailSent');
  });

  it('offers no choice of email where the environment sends none', async () => {
    const { client } = service();
    render(<Inbox client={client} onClose={() => undefined} />);
    await screen.findByLabelText('When a comment names you');
    expect(screen.queryByRole('group', { name: 'Sent to you by email' })).toBeNull();
  });

  it('tells those who configure services that the environment’s email is failing, and opens Email', async () => {
    const { client } = service([
      {
        id: id(7),
        kind: 'mail',
        actor: null,
        thread: null,
        on: null,
        counts: null,
        at: '2026-11-06T10:00:00.000Z',
        read: false,
      },
    ]);
    render(<Inbox client={client} onClose={() => undefined} />);
    const row = (await screen.findByText(/email is failing/)).closest('li')!;
    expect(row).toHaveTextContent(
      'Your environment’s email is failing: mail waits until its relay answers.',
    );
    expect(within(row).getByRole('link', { name: 'Open Email' })).toHaveAttribute(
      'href',
      '#/admin/email',
    );
  });

  it('ADM-037 tells those who administer of a silent failure in words, and opens Diagnostics', async () => {
    const { client } = service([
      {
        id: id(8),
        kind: 'diagnostics',
        actor: null,
        thread: null,
        on: null,
        counts: null,
        diagnostics: { kind: 'capability_failing', subject: 'Search' },
        at: '2026-11-07T10:00:00.000Z',
        read: false,
      },
      {
        id: id(9),
        kind: 'diagnostics',
        actor: null,
        thread: null,
        on: null,
        counts: null,
        diagnostics: { kind: 'work_failing', subject: 'sweepDates' },
        at: '2026-11-07T09:00:00.000Z',
        read: false,
      },
    ]);
    render(<Inbox client={client} onClose={() => undefined} />);
    const row = (await screen.findByText(/Search is failing/)).closest('li')!;
    expect(row).toHaveTextContent('Search is failing most of what it is asked.');
    expect(within(row).getByRole('link', { name: 'Open Diagnostics' })).toHaveAttribute(
      'href',
      '#/admin/diagnostics',
    );
    expect(
      await screen.findByText('Background work in your environment is failing or late.'),
    ).toBeInTheDocument();
  });
});
