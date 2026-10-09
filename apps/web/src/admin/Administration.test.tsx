import { createApiClient } from '@alloy-works/api-client';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Administration } from './Administration.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** What the fake answers each path with, given the URL it was asked. */
type Answers = Record<string, (url: URL) => Response>;

const everything: Answers = {
  '/v1/tenant': () => json(200, { name: 'Development' }),
  '/v1/spaces': () =>
    json(200, {
      items: [
        { id: 's1', name: 'General', mayCreate: true },
        { id: 's2', name: 'Training', mayCreate: false },
      ],
      next: null,
    }),
  '/v1/principals': () =>
    json(200, {
      items: [
        { id: 'p1', name: 'Ada', email: 'ada@example.test', kind: 'user', invited: false },
        { id: 'p2', name: null, email: 'ivy@example.test', kind: 'external', invited: true },
      ],
      next: null,
      total: 2,
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

function service(answers: Answers) {
  const asked: URL[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(url);
    const answer = answers[url.pathname];
    return answer ? answer(url) : json(404, {});
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), asked };
}

/** A section's link in Administration's menu, its count after its name. */
const section = (name: string) => screen.getByRole('link', { name: new RegExp(`^${name}`) });

// Each test opens Administration at its start, as Admin on the rail does.
beforeEach(() => {
  window.location.hash = '#/admin/overview';
});

describe('Administration', () => {
  it('opens on Overview, and moves between the sections it can answer by its menu', async () => {
    const { client } = service(everything);
    render(<Administration client={client} about={null} />);

    const dialog = screen.getByRole('region', { name: 'Administration' });
    expect(section('Overview')).toHaveAttribute('aria-current', 'page');
    // In the menu, and in the section.
    expect(await within(dialog).findAllByText('Development')).toHaveLength(2);
    for (const name of ['Spaces', 'People', 'Roles', 'Groups', 'About and release notes']) {
      expect(section(name)).toBeInTheDocument();
    }
    // What nothing answers yet is not offered.
    for (const name of ['Component types', 'Layouts']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${name}`) })).toBeNull();
    }
    await userEvent.click(section('Roles'));
    expect(await screen.findByRole('heading', { name: 'Roles', level: 1 })).toBeInTheDocument();
    expect(section('Roles')).toHaveAttribute('aria-current', 'page');
    expect(section('Overview')).not.toHaveAttribute('aria-current');
  });

  it('lists the spaces, the people and the waiting invitations, and the roles with what each holds', async () => {
    const { client, asked } = service(everything);
    render(<Administration client={client} about={null} />);

    await userEvent.click(section('Spaces'));
    const spaces = await screen.findByRole('table', { name: 'Spaces' });
    expect(within(spaces).getByRole('cell', { name: 'General' })).toBeInTheDocument();
    expect(within(spaces).getAllByRole('cell', { name: 'May create' })).toHaveLength(1);

    await userEvent.click(section('People'));
    const people = await screen.findByRole('table', { name: 'People' });
    expect(within(people).getByRole('row', { name: /^Ada ada@example\.test/ })).toBeInTheDocument();
    expect(within(people).getByRole('cell', { name: 'Invited' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: /^Waiting invitations/ }));
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
    render(<Administration client={client} about={null} />);

    await userEvent.click(section('People'));
    // Said of the people, and of the invitations in their own tab, each refused.
    expect(await screen.findAllByText('You may not manage access here.')).toHaveLength(1);
    await userEvent.click(screen.getByRole('tab', { name: /^Waiting invitations/ }));
    expect(await screen.findAllByText('You may not manage access here.')).toHaveLength(1);
    await userEvent.click(section('Spaces'));
    expect(await screen.findByRole('table', { name: 'Spaces' })).toBeInTheDocument();
    expect(screen.queryByText('You may not manage access here.')).toBeNull();
  });

  it('says which version this is in About, beside what it is given', async () => {
    const { client } = service(everything);
    render(<Administration client={client} about={<p>the environment panel</p>} />);

    await userEvent.click(section('About and release notes'));
    expect(screen.getByText(/^Version \d+\.\d+\.\d+$/)).toBeInTheDocument();
    expect(screen.getByText('the environment panel')).toBeInTheDocument();
  });
});

/**
 * `GET /v1/access` as the service answers it: `administer` allowed at the targets named, and refused
 * everywhere else.
 */
const administering =
  (...targets: string[]) =>
  (url: URL) => {
    const target = url.searchParams.get('target') ?? '';
    return json(200, {
      target,
      permissions: [
        { permission: 'read', allowed: true },
        { permission: 'administer', allowed: targets.includes(target) },
      ],
    });
  };

/** The service as People meets it: people a page at a time, invitations, tokens, and why. */
function peopleService() {
  const people = [
    { id: 'p1', name: 'Ada', email: 'ada@example.test', kind: 'user', invited: false },
    { id: 'p2', name: 'Marta', email: 'marta@partner.test', kind: 'external', invited: false },
    { id: 'p3', name: 'Publishing robot', email: null, kind: 'service', invited: false },
    { id: 'p4', name: null, email: 'sam@example.test', kind: 'user', invited: true },
  ];
  const invitation = (id: string, email: string, lapsed: boolean, external: boolean) => ({
    id,
    email,
    person: 'p4',
    external,
    invitedBy: { id: 'p1', name: 'Ada' },
    createdAt: '2026-10-01T09:00:00.000Z',
    expiresAt: '2026-10-17T09:00:00.000Z',
    lapsed,
    acceptedAt: null,
    acceptedThrough: null,
  });
  const invitations = [
    invitation('i1', 'sam@example.test', false, false),
    invitation('i2', 'jo@cro.test', false, true),
    invitation('i3', 'old@example.test', true, false),
  ];
  const tokens = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'CI publishing',
      scopes: ['publish'],
      createdAt: '2026-09-01T09:00:00.000Z',
      expiresAt: '2027-03-12T09:00:00.000Z',
      lastUsedAt: '2026-10-04T09:00:00.000Z',
    },
  ];
  const sent: { method: string; path: string; body: unknown }[] = [];
  const asked: URL[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(url);
    const text = request.method === 'GET' ? '' : await request.clone().text();
    const body = text === '' ? undefined : JSON.parse(text);
    if (request.method !== 'GET') sent.push({ method: request.method, path: url.pathname, body });
    const route = `${request.method} ${url.pathname}`;
    if (route === 'GET /v1/tenant') return json(200, { name: 'Development' });
    if (route === 'GET /v1/principals') {
      const limit = Number(url.searchParams.get('limit') ?? '100');
      const from = Number(url.searchParams.get('cursor') ?? '0');
      const page = people.slice(from, from + limit);
      const next = from + limit < people.length ? String(from + limit) : null;
      return json(200, { items: page, next, total: people.length });
    }
    if (route === 'GET /v1/invitations')
      return json(200, { items: invitations, next: null, total: invitations.length });
    if (route === 'POST /v1/invitations') {
      const { email, external } = body as { email: string; external?: boolean };
      const made = invitation(`i${invitations.length + 1}`, email, false, external ?? false);
      invitations.push(made);
      return json(200, { invitation: made, renewed: false });
    }
    const withdrawing = /^DELETE \/v1\/invitations\/(\w+)$/.exec(route);
    if (withdrawing) {
      invitations.splice(
        invitations.findIndex((each) => each.id === withdrawing[1]),
        1,
      );
      return json(200, { withdrawn: withdrawing[1] });
    }
    if (route === 'GET /v1/principals/p1/tokens') return json(200, { items: tokens, next: null });
    if (route.startsWith('DELETE /v1/principals/p1/tokens/')) {
      tokens.splice(0, 1);
      return json(200, { revoked: 'x' });
    }
    if (route === 'GET /v1/access/explain') {
      return json(200, {
        principal: url.searchParams.get('principal'),
        target: url.searchParams.get('target'),
        permissions: [
          {
            permission: 'read',
            allowed: true,
            reason: 'allowed',
            level: 'tenant',
            checked: ['tenant'],
            grants: [
              {
                role: 'Reader',
                effect: 'allow',
                subject: { principal: 'p1' },
                through: null,
                groupName: null,
              },
            ],
          },
        ],
      });
    }
    return json(200, { items: [], next: null, total: 0 });
  }) as unknown as typeof fetch;
  return {
    client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }),
    sent,
    asked,
  };
}

describe('People in Administration', () => {
  const openPeople = async (client: ReturnType<typeof peopleService>['client']) => {
    render(<Administration client={client} about={null} />);
    await userEvent.click(section('People'));
    const table = await screen.findByRole('table', { name: 'People' });
    return { table, page: screen.getByRole('region', { name: 'Administration' }) };
  };
  const row = (table: HTMLElement, name: RegExp) => within(table).getByRole('row', { name });

  it('lists each person with their kind and status, found by name and shown by kind', async () => {
    const { client } = peopleService();
    const { table, page } = await openPeople(client);
    expect(within(page).getByRole('tab', { name: 'People 4' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(
      within(row(table, /Marta/))
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['MMarta marta@partner.test', 'Outside', 'Signed in', '']);
    expect(
      within(row(table, /Publishing robot/)).getByRole('cell', { name: 'Active' }),
    ).toBeInTheDocument();
    expect(
      within(row(table, /sam@example/)).getByRole('cell', { name: 'Invited' }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(within(page).getByRole('group', { name: 'Show' })).getByRole('button', {
        name: 'Services',
      }),
    );
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    await userEvent.click(
      within(within(page).getByRole('group', { name: 'Show' })).getByRole('button', {
        name: 'All',
      }),
    );
    await userEvent.type(
      within(page).getByRole('searchbox', { name: 'Name or address' }),
      'partner',
    );
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  it("opens a person's tokens beside the list, revokes one only after asking, and gives the focus back", async () => {
    const { client, sent } = peopleService();
    const { table } = await openPeople(client);
    // Somebody invited has signed in nowhere, so has no tokens to show, and says why.
    const theirs = within(row(table, /sam@example/)).getByRole('button', {
      name: /^API tokens of/,
    });
    expect(theirs).toHaveAttribute('aria-disabled', 'true');
    expect(theirs).toHaveAttribute('title', 'Not signed in yet, so no tokens');

    const opener = within(row(table, /^Ada /)).getByRole('button', { name: 'API tokens of Ada' });
    await userEvent.click(opener);
    const panel = screen.getByRole('complementary', { name: 'Ada' });
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Ada' }));
    expect(await within(panel).findByRole('tab', { name: 'API tokens 1' })).toBeInTheDocument();
    const tokens = await within(panel).findByRole('list', { name: 'Tokens of Ada' });
    expect(tokens).toHaveTextContent('CI publishing');
    expect(tokens).toHaveTextContent('May publish');
    expect(tokens).toHaveTextContent('Until 12 Mar 2027');
    expect(tokens).toHaveTextContent('Used 4 Oct');

    await userEvent.click(within(tokens).getByRole('button', { name: 'Revoke CI publishing' }));
    const asking = screen.getByRole('dialog', { name: 'Revoke CI publishing?' });
    await userEvent.click(within(asking).getByRole('button', { name: 'Keep it' }));
    expect(sent).toEqual([]);
    await userEvent.click(within(tokens).getByRole('button', { name: 'Revoke CI publishing' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Revoke CI publishing?' })).getByRole('button', {
        name: 'Revoke token',
      }),
    );
    expect(await within(panel).findByText('Revoked CI publishing.')).toBeInTheDocument();
    expect(within(panel).getByText('Ada has no API tokens.')).toBeInTheDocument();
    expect(sent.map((each) => each.method)).toEqual(['DELETE']);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('says what a person may do across the environment, and why, from More actions', async () => {
    const { client, asked } = peopleService();
    const { table } = await openPeople(client);
    await userEvent.click(
      within(row(table, /^Ada /)).getByRole('button', { name: 'More actions for Ada' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'What they may do' }));
    const panel = screen.getByRole('complementary', { name: 'Ada' });
    expect(within(panel).getByRole('tab', { name: 'What they may do' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const answers = await within(panel).findByRole('table', {
      name: 'What Ada may do across the whole environment',
    });
    expect(answers).toHaveTextContent(
      'Allowed at the whole environment, by Reader allowed to Ada.',
    );
    const explained = asked.find((url) => url.pathname === '/v1/access/explain')!;
    expect([explained.searchParams.get('principal'), explained.searchParams.get('target')]).toEqual(
      ['p1', 'tenant'],
    );
  });

  it('pages the people, saying how many are shown of how many there are', async () => {
    const { client, asked } = peopleService();
    const { table, page } = await openPeople(client);
    // Fifty a page: every one of four on the first, so nothing more is offered.
    expect(
      asked.find(
        (url) =>
          url.pathname === '/v1/principals' &&
          url.searchParams.has('cursor') === false &&
          url.searchParams.get('limit') === '50',
      ),
    ).toBeDefined();
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(page).queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('lists the invitations waiting or lapsed, and withdraws one only after asking', async () => {
    const { client, sent } = peopleService();
    const { page } = await openPeople(client);
    await userEvent.click(within(page).getByRole('tab', { name: 'Waiting invitations 2' }));
    const waiting = await within(page).findByRole('table', { name: 'Waiting invitations' });
    expect(within(waiting).getByRole('row', { name: /^jo@cro\.test/ })).toHaveTextContent(
      'From outside',
    );
    expect(within(waiting).getByRole('row', { name: /^sam@example\.test/ })).toHaveTextContent(
      '17 October 2026',
    );
    expect(page).toHaveTextContent('2 waiting');
    await userEvent.click(
      within(within(page).getByRole('group', { name: 'Show' })).getByRole('button', {
        name: 'Lapsed',
      }),
    );
    expect(within(page).getByRole('table', { name: 'Waiting invitations' })).toHaveTextContent(
      'old@example.test',
    );
    await userEvent.click(
      within(within(page).getByRole('group', { name: 'Show' })).getByRole('button', {
        name: 'Waiting',
      }),
    );

    await userEvent.click(
      within(page).getByRole('button', { name: 'Withdraw the invitation to jo@cro.test' }),
    );
    const asking = screen.getByRole('dialog', { name: 'Withdraw the invitation to jo@cro.test?' });
    expect(asking).toHaveTextContent('Everything granted to them goes with it.');
    await userEvent.click(within(asking).getByRole('button', { name: 'Withdraw' }));
    expect(
      await screen.findByText(
        'Withdrew the invitation to jo@cro.test, and everything granted to them.',
      ),
    ).toBeInTheDocument();
    expect(sent).toEqual([{ method: 'DELETE', path: '/v1/invitations/i2', body: undefined }]);
    expect(
      await within(page).findByRole('tab', { name: 'Waiting invitations 1' }),
    ).toBeInTheDocument();
  });

  it('invites somebody by address, from outside the organisation where they are', async () => {
    const { client, sent } = peopleService();
    const { page } = await openPeople(client);
    await userEvent.click(within(page).getByRole('button', { name: 'Invite people' }));
    const inviting = screen.getByRole('dialog', { name: 'Invite people' });
    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));
    expect(within(inviting).getByRole('status')).toHaveTextContent('Give the address to invite.');
    await userEvent.type(
      within(inviting).getByRole('textbox', { name: 'Address' }),
      'lee@lab.test',
    );
    await userEvent.click(
      within(inviting).getByRole('checkbox', { name: 'From outside the organisation' }),
    );
    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));
    expect(await screen.findByText('Invited lee@lab.test.')).toBeInTheDocument();
    expect(sent).toEqual([
      { method: 'POST', path: '/v1/invitations', body: { email: 'lee@lab.test', external: true } },
    ]);
  });
});

describe("Administration's menu", () => {
  it('counts each section from its listing, and leaves a count out where the reader may not see it', async () => {
    const { client } = service({
      ...everything,
      '/v1/principals': () => json(200, { items: [], next: 'more', total: 31 }),
      '/v1/groups': () => json(403, { code: 'forbidden', message: 'x', traceId: 't' }),
    });
    render(<Administration client={client} about={null} />);
    await waitFor(() => expect(section('People')).toHaveTextContent('People31'));
    expect(section('Spaces')).toHaveTextContent('Spaces2');
    expect(section('Roles')).toHaveTextContent('Roles1');
    expect(section('Groups')).toHaveTextContent(/^Groups$/);
    // Grouped as the drawing has them.
    expect(
      within(screen.getByRole('list', { name: 'People and access' }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual(['#/admin/people', '#/admin/groups', '#/admin/roles']);
  });

  it('opens the section the address names, and Overview for one it does not know', async () => {
    const { client } = service(everything);
    window.location.hash = '#/admin/roles';
    const { unmount } = render(<Administration client={client} about={null} />);
    expect(screen.getByRole('heading', { name: 'Roles', level: 1 })).toBeInTheDocument();
    unmount();
    window.location.hash = '#/admin/nowhere';
    render(<Administration client={client} about={null} />);
    expect(screen.getByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument();
  });
});

describe('Access from Administration', () => {
  const answering: Answers = {
    ...everything,
    '/v1/access': administering('tenant', 'space:s1', 'space:s2'),
    '/v1/grants': () => json(200, { items: [], next: null }),
    '/v1/groups': () => json(200, { items: [], next: null }),
  };

  /** A grant as `GET /v1/grants` lists one. */
  const adaAuthor = {
    id: 'g1',
    role: { id: 'r1', name: 'Author' },
    subject: { principal: { id: 'p1', name: 'Ada', email: 'ada@example.test' } },
    level: 'tenant',
    effect: 'allow',
    expiresAt: null,
    extends: null,
    grantedBy: { id: 'p1', name: 'Ada' },
    grantedAt: '2026-09-17T09:00:00.000Z',
  };

  it('opens Access at a space in a side panel beside Spaces, and at the environment from Overview with a way back', async () => {
    const { client, asked } = service(answering);
    render(<Administration client={client} about={null} />);
    const dialog = screen.getByRole('region', { name: 'Administration' });

    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Access to the whole environment' }),
    );
    expect(
      await within(dialog).findByRole('heading', { name: 'Access to the whole environment' }),
    ).toBeInTheDocument();
    await within(within(dialog).getByRole('region', { name: 'The whole environment' })).findByText(
      'Nothing is granted here.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back to the environment' }));
    expect(within(dialog).queryByRole('heading', { name: /^Access to/ })).toBeNull();

    await userEvent.click(section('Spaces'));
    const spaces = await screen.findByRole('table', { name: 'Spaces' });
    await userEvent.click(
      await within(spaces).findByRole('button', { name: 'Access to the space General' }),
    );
    const panel = await screen.findByRole('complementary', { name: 'Access to General' });
    expect(panel).toHaveTextContent("Space. Grants here add to the environment's.");
    await within(within(panel).getByRole('region', { name: 'The space General' })).findByText(
      'Nothing is granted here.',
    );
    // The list stays where it was beside it.
    expect(screen.getByRole('table', { name: 'Spaces' })).toBe(spaces);
    // Asked at the space, and at the environment above it.
    expect(
      asked
        .filter((url) => url.pathname === '/v1/grants')
        .map((url) => url.searchParams.get('level')),
    ).toEqual(['tenant', 'space:s1', 'tenant']);
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('keeps focus in Administration opening Access and leaving it, at a space and at the environment', async () => {
    const { client } = service(answering);
    render(<Administration client={client} about={null} />);
    const dialog = screen.getByRole('region', { name: 'Administration' });

    await userEvent.click(section('Spaces'));
    const spaces = await screen.findByRole('table', { name: 'Spaces' });
    await userEvent.click(
      await within(spaces).findByRole('button', { name: 'Access to the space Training' }),
    );
    // On the side panel's heading, which takes the focus as it opens.
    const panel = screen.getByRole('complementary', { name: 'Access to Training' });
    expect(document.activeElement).toBe(
      within(panel).getByRole('heading', { name: 'Access to Training' }),
    );
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await userEvent.keyboard('{Escape}');
    // Back on the Access button that opened it.
    expect(document.activeElement).toBe(
      within(screen.getByRole('table', { name: 'Spaces' })).getByRole('button', {
        name: 'Access to the space Training',
      }),
    );

    await userEvent.click(section('Overview'));
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Access to the whole environment' }),
    );
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Back to the environment' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back to the environment' }));
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Access to the whole environment' }),
    );
  });

  it('heads Access below the page it opens in, and its cards below that', async () => {
    const { client } = service(answering);
    render(<Administration client={client} about={null} />);
    const dialog = screen.getByRole('region', { name: 'Administration' });
    expect(within(dialog).getByRole('heading', { name: 'Overview', level: 1 })).toBeTruthy();

    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Access to the whole environment' }),
    );
    expect(
      await within(dialog).findByRole('heading', {
        name: 'Access to the whole environment',
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('heading', { name: 'The whole environment', level: 3 }),
    ).toBeInTheDocument();
  });

  it('offers Access only where the reader may administer: not the environment, and only the spaces they administer', async () => {
    const { client, asked } = service({
      ...answering,
      '/v1/access': administering('space:s1'),
    });
    render(<Administration client={client} about={null} />);
    const dialog = screen.getByRole('region', { name: 'Administration' });
    await within(dialog).findAllByText('Development');

    await userEvent.click(section('Spaces'));
    const spaces = await screen.findByRole('table', { name: 'Spaces' });
    expect(
      await within(spaces).findByRole('button', { name: 'Access to the space General' }),
    ).toBeInTheDocument();
    expect(
      within(spaces).queryByRole('button', { name: 'Access to the space Training' }),
    ).toBeNull();
    await userEvent.click(section('Overview'));
    expect(
      within(dialog).queryByRole('button', { name: 'Access to the whole environment' }),
    ).toBeNull();
    // Asked once of the environment and once of each space, and not again on coming back.
    expect(
      asked
        .filter((url) => url.pathname === '/v1/access')
        .map((url) => url.searchParams.get('target'))
        .sort(),
    ).toEqual(['space:s1', 'space:s2', 'tenant']);
  });

  it('keeps focus in Administration once a grant removed takes its Remove button with it', async () => {
    const grants = [adaAuthor];
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (request.method === 'DELETE' && url.pathname === '/v1/grants/g1') {
        grants.splice(0, 1);
        return json(200, { removed: 'g1' });
      }
      if (url.pathname === '/v1/grants') {
        return json(200, {
          items: grants.filter((each) => each.level === url.searchParams.get('level')),
          next: null,
        });
      }
      const answer = answering[url.pathname];
      return answer ? answer(url) : json(404, {});
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://admin.test', fetch: fetching });
    render(<Administration client={client} about={null} />);
    const dialog = screen.getByRole('region', { name: 'Administration' });

    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Access to the whole environment' }),
    );
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Remove: Allowed Author to Ada' }),
    );
    const level = within(dialog).getByRole('region', { name: 'The whole environment' });
    await within(level).findByText('Nothing is granted here.');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(level).getByRole('heading', { name: 'The whole environment' }),
      ),
    );
    // Still inside Administration.
    await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("keeps focus in Administration once a level's Try again gives way to what it read", async () => {
    let failing = true;
    const { client } = service({
      ...answering,
      '/v1/grants': () =>
        failing
          ? json(500, { code: 'internal', message: 'broken', traceId: 't' })
          : json(200, { items: [], next: null }),
    });
    render(<Administration client={client} about={null} />);
    const dialog = screen.getByRole('region', { name: 'Administration' });

    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Access to the whole environment' }),
    );
    const level = await within(dialog).findByRole('region', { name: 'The whole environment' });
    await within(level).findByText('What is granted here could not be loaded.');
    failing = false;
    await userEvent.click(within(level).getByRole('button', { name: 'Try again' }));
    await within(level).findByText('Nothing is granted here.');
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(level).getByRole('heading', { name: 'The whole environment' }),
      ),
    );
  });
});

/** A person as `GET /v1/principals` lists one. */
const personOf = (id: string, name: string) => ({
  id,
  name,
  email: `${name.toLowerCase()}@example.test`,
  kind: 'user',
  invited: false,
});

/**
 * The service as Groups meets it: the groups held, made, filled and deleted by what the page sends,
 * so a list read again after a change shows the change. The people are listed in two pages, Alice on
 * the second; `authors` names who is in Authors to begin with.
 */
function groupsService(authors: readonly string[] = ['p2']) {
  const people = [personOf('p1', 'Ada'), personOf('p2', 'Grace'), personOf('p3', 'Alice')];
  const member = (id: string) => {
    const person = people.find((each) => each.id === id)!;
    return { id: person.id, name: person.name, email: person.email };
  };
  const groups: {
    id: string;
    name: string;
    source: 'tenant' | 'provider';
    providerValue: string | null;
    members: { id: string; name: string; email: string }[];
  }[] = [
    {
      id: 'g1',
      name: 'Authors',
      source: 'tenant',
      providerValue: null,
      members: authors.map(member),
    },
    {
      id: 'g2',
      name: 'Readers',
      source: 'provider',
      providerValue: 'readers',
      members: [member('p3')],
    },
  ];
  const sent: { method: string; path: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.clone().text();
    const body = text === '' ? undefined : JSON.parse(text);
    if (request.method !== 'GET') sent.push({ method: request.method, path: url.pathname, body });
    const route = `${request.method} ${url.pathname}`;
    if (route === 'GET /v1/tenant') return json(200, { name: 'Development' });
    if (route === 'GET /v1/principals') {
      return url.searchParams.get('cursor') === 'second'
        ? json(200, { items: people.slice(2), next: null })
        : json(200, { items: people.slice(0, 2), next: 'second' });
    }
    if (route === 'GET /v1/groups') return json(200, { items: groups, next: null });
    if (route === 'POST /v1/groups') {
      const { name, providerValue } = body as { name: string; providerValue?: string };
      if (groups.some((each) => each.name === name)) {
        return json(409, {
          code: 'group_name_taken',
          message: 'There is already a group with that name.',
          traceId: 't',
        });
      }
      const group = {
        id: `g${groups.length + 1}`,
        name,
        source: providerValue === undefined ? ('tenant' as const) : ('provider' as const),
        providerValue: providerValue ?? null,
        members: [],
      };
      groups.push(group);
      return json(200, { group });
    }
    const setting = /^PUT \/v1\/groups\/(\w+)\/members$/.exec(route);
    if (setting) {
      const group = groups.find((each) => each.id === setting[1])!;
      group.members = (body as { principals: string[] }).principals.map(member);
      return json(200, { group });
    }
    const deleting = /^DELETE \/v1\/groups\/(\w+)$/.exec(route);
    if (deleting) {
      const index = groups.findIndex((each) => each.id === deleting[1]);
      if (index < 0) return json(404, { code: 'not_found', message: 'x', traceId: 't' });
      groups.splice(index, 1);
      return json(200, { deleted: deleting[1] });
    }
    return json(404, { code: 'not_found', message: 'x', traceId: 't' });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

describe('Groups in Administration', () => {
  const openGroups = async (client: ReturnType<typeof groupsService>['client']) => {
    render(<Administration client={client} about={null} />);
    await userEvent.click(section('Groups'));
    const table = await screen.findByRole('table', { name: 'Groups' });
    return { table, dialog: screen.getByRole('region', { name: 'Administration' }) };
  };
  const row = (table: HTMLElement, name: string) =>
    within(table).getByRole('row', { name: new RegExp(`^${name}`) });
  const cells = (element: HTMLElement) =>
    within(element)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);

  it('says the reader is signed out, not that the groups could not be loaded, when the session is gone', async () => {
    const { client } = service({
      ...everything,
      '/v1/groups': () => json(401, { code: 'unauthenticated', message: 'x', traceId: 't' }),
    });
    render(<Administration client={client} about={null} />);
    await userEvent.click(section('Groups'));
    expect(
      await screen.findByText('You are signed out. Sign in again to manage access.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('The groups could not be loaded.')).toBeNull();
  });

  it('lists each group with where its members come from and who they are', async () => {
    const { client } = groupsService();
    const { table } = await openGroups(client);
    expect(cells(row(table, 'Authors')).slice(0, 3)).toEqual([
      'Authors',
      'This environment',
      'Grace',
    ]);
    expect(cells(row(table, 'Readers')).slice(0, 3)).toEqual([
      'Readers',
      "The organisation's sign-in, as readers",
      'Alice',
    ]);
  });

  it("makes a group of the environment's own, or one standing for a value from the organisation's sign-in", async () => {
    const { client, sent } = groupsService();
    const { table } = await openGroups(client);

    await userEvent.click(screen.getByRole('button', { name: 'New group' }));
    let making = screen.getByRole('dialog', { name: 'New group' });
    await userEvent.type(within(making).getByRole('textbox', { name: 'Name' }), 'Reviewers');
    await userEvent.click(within(making).getByRole('button', { name: 'Make group' }));
    expect(await screen.findByText('Made the group Reviewers.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'New group' })).toBeNull();
    expect(
      cells(await within(table).findByRole('row', { name: /^Reviewers/ })).slice(0, 3),
    ).toEqual(['Reviewers', 'This environment', 'Nobody']);

    await userEvent.click(screen.getByRole('button', { name: 'New group' }));
    making = screen.getByRole('dialog', { name: 'New group' });
    await userEvent.type(within(making).getByRole('textbox', { name: 'Name' }), 'Publishers');
    await userEvent.type(
      within(making).getByRole('textbox', { name: "Value from the organisation's sign-in" }),
      'publishers',
    );
    await userEvent.click(within(making).getByRole('button', { name: 'Make group' }));
    expect(await screen.findByText('Made the group Publishers.')).toBeInTheDocument();

    expect(sent).toEqual([
      { method: 'POST', path: '/v1/groups', body: { name: 'Reviewers' } },
      {
        method: 'POST',
        path: '/v1/groups',
        body: { name: 'Publishers', providerValue: 'publishers' },
      },
    ]);
  });

  it('says why a group was not made, in the dialog, and makes nothing without a name', async () => {
    const { client, sent } = groupsService();
    await openGroups(client);
    await userEvent.click(screen.getByRole('button', { name: 'New group' }));
    const making = screen.getByRole('dialog', { name: 'New group' });
    await userEvent.click(within(making).getByRole('button', { name: 'Make group' }));
    expect(within(making).getByRole('status')).toHaveTextContent('Give the group a name.');
    expect(sent).toEqual([]);

    await userEvent.type(within(making).getByRole('textbox', { name: 'Name' }), 'Authors');
    await userEvent.click(within(making).getByRole('button', { name: 'Make group' }));
    expect(await within(making).findByRole('status')).toHaveTextContent(
      'There is already a group with that name.',
    );
  });

  it("sets the members of the environment's own group from the people, and shows a sign-in group's members with no way to change them", async () => {
    const { client, sent } = groupsService();
    const { table, dialog } = await openGroups(client);
    // A group from the sign-in has its members listed, and nothing to change them with.
    expect(within(row(table, 'Readers')).queryByRole('button', { name: /^Members/ })).toBeNull();

    const opener = within(row(table, 'Authors')).getByRole('button', {
      name: 'Members of Authors',
    });
    await userEvent.click(opener);
    const choosing = await screen.findByRole('dialog', { name: 'Members of Authors' });
    expect(await within(choosing).findByRole('checkbox', { name: /^Grace/ })).toBeChecked();
    expect(within(choosing).getByRole('checkbox', { name: /^Ada/ })).not.toBeChecked();
    await userEvent.click(within(choosing).getByRole('checkbox', { name: /^Ada/ }));
    await userEvent.click(within(choosing).getByRole('button', { name: 'Save members' }));

    expect(await screen.findByText('Authors now has 2 members.')).toBeInTheDocument();
    expect(sent).toEqual([
      { method: 'PUT', path: '/v1/groups/g1/members', body: { principals: ['p1', 'p2'] } },
    ]);
    await waitFor(() => expect(cells(row(table, 'Authors'))[2]).toBe('Ada, Grace'));
    // Back where it was opened from, inside Administration.
    expect(document.activeElement).toBe(opener);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("keeps a member listed on the people's second page when the members are saved", async () => {
    const { client, sent } = groupsService(['p2', 'p3']);
    const { table } = await openGroups(client);
    await userEvent.click(
      within(row(table, 'Authors')).getByRole('button', { name: 'Members of Authors' }),
    );
    const choosing = await screen.findByRole('dialog', { name: 'Members of Authors' });
    expect(await within(choosing).findByRole('checkbox', { name: /^Alice/ })).toBeChecked();
    await userEvent.click(within(choosing).getByRole('checkbox', { name: /^Ada/ }));
    await userEvent.click(within(choosing).getByRole('button', { name: 'Save members' }));

    expect(await screen.findByText('Authors now has 3 members.')).toBeInTheDocument();
    expect(sent).toEqual([
      { method: 'PUT', path: '/v1/groups/g1/members', body: { principals: ['p1', 'p2', 'p3'] } },
    ]);
  });

  it('deletes a group only after asking, saying its grants go with it, and keeps focus in Administration', async () => {
    const { client, sent } = groupsService();
    const { table, dialog } = await openGroups(client);

    await userEvent.click(
      within(row(table, 'Authors')).getByRole('button', { name: 'Delete Authors' }),
    );
    const asking = screen.getByRole('dialog', { name: 'Delete Authors?' });
    expect(asking).toHaveTextContent(
      'Everything granted to this group is deleted with it, so its members lose whatever they held only through it.',
    );
    await userEvent.click(within(asking).getByRole('button', { name: 'Keep it' }));
    expect(sent).toEqual([]);

    await userEvent.click(
      within(row(table, 'Authors')).getByRole('button', { name: 'Delete Authors' }),
    );
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete Authors?' })).getByRole('button', {
        name: 'Delete group',
      }),
    );
    expect(
      await screen.findByText('Deleted the group Authors, and everything granted to it.'),
    ).toBeInTheDocument();
    expect(sent).toEqual([{ method: 'DELETE', path: '/v1/groups/g1', body: undefined }]);
    await waitFor(() => expect(within(table).queryByRole('row', { name: /^Authors/ })).toBeNull());
    // The Delete button that had focus has gone with its row: focus stays in Administration.
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
});

/** A service holding spaces that change as an administrator makes, renames, archives and restores. */
function spacesService(administers: readonly string[] = ['tenant', 'space:s1', 'space:s2']) {
  const spaces = [
    { id: 's1', name: 'General', archived: false, mayCreate: true },
    { id: 's2', name: 'Training', archived: false, mayCreate: false },
  ];
  const sent: { method: string; path: string; body: unknown }[] = [];
  const viewOf = (space: (typeof spaces)[number]) => ({
    id: space.id,
    name: space.name,
    archived: space.archived,
    archivedAt: space.archived ? '2026-10-08T09:00:00.000Z' : null,
    archivedBy: space.archived ? 'p1' : null,
  });
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.clone().text();
    const body = text === '' ? undefined : JSON.parse(text);
    if (request.method !== 'GET') sent.push({ method: request.method, path: url.pathname, body });
    const route = `${request.method} ${url.pathname}`;
    if (route === 'GET /v1/tenant') return json(200, { name: 'Development' });
    if (route === 'GET /v1/access') return administering(...administers)(url);
    if (route === 'GET /v1/spaces') {
      return json(200, { items: spaces.map((each) => ({ ...each })), next: null });
    }
    if (route === 'POST /v1/spaces') {
      const { name } = body as { name: string };
      if (spaces.some((each) => each.name === name.trim())) {
        return json(409, {
          code: 'space_name_taken',
          message: 'There is already a space with that name, perhaps an archived one.',
          traceId: 't',
        });
      }
      const space = {
        id: `s${spaces.length + 1}`,
        name: name.trim(),
        archived: false,
        mayCreate: true,
      };
      spaces.push(space);
      return json(200, viewOf(space));
    }
    const changing = /^PATCH \/v1\/spaces\/(\w+)$/.exec(route);
    if (changing) {
      const space = spaces.find((each) => each.id === changing[1]);
      if (!space) return json(404, { code: 'not_found', message: 'x', traceId: 't' });
      const { name, archived } = body as { name?: string; archived?: boolean };
      if (archived === true && spaces.filter((each) => !each.archived).length <= 1) {
        return json(409, {
          code: 'space_last',
          message: 'This is the last space not archived, so it cannot be archived.',
          traceId: 't',
        });
      }
      if (name !== undefined) space.name = name.trim();
      if (archived !== undefined) {
        space.archived = archived;
        space.mayCreate = !archived;
      }
      return json(200, viewOf(space));
    }
    return json(404, { code: 'not_found', message: 'x', traceId: 't' });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

describe('Spaces in Administration', () => {
  const openSpaces = async (client: ReturnType<typeof spacesService>['client']) => {
    render(<Administration client={client} about={null} />);
    await userEvent.click(section('Spaces'));
    const table = await screen.findByRole('table', { name: 'Spaces' });
    return { table, dialog: screen.getByRole('region', { name: 'Administration' }) };
  };
  const row = (table: HTMLElement, name: string) =>
    within(table).getByRole('row', { name: new RegExp(`^${name}`) });

  it('ADM-049 lets an administrator make, rename, archive and restore a space from Spaces', async () => {
    const { client, sent } = spacesService();
    const { table, dialog } = await openSpaces(client);

    await userEvent.click(await within(dialog).findByRole('button', { name: 'New space' }));
    const making = screen.getByRole('dialog', { name: 'New space' });
    await userEvent.type(within(making).getByRole('textbox', { name: 'Name' }), 'Regulatory');
    await userEvent.click(within(making).getByRole('button', { name: 'Make space' }));
    expect(await screen.findByText('Made the space Regulatory.')).toBeInTheDocument();
    expect(await within(table).findByRole('row', { name: /^Regulatory/ })).toBeInTheDocument();

    await userEvent.click(
      within(row(table, 'Regulatory')).getByRole('button', { name: 'Rename Regulatory' }),
    );
    const renaming = screen.getByRole('dialog', { name: 'Rename Regulatory' });
    const named = within(renaming).getByRole('textbox', { name: 'Name' });
    expect(named).toHaveValue('Regulatory');
    await userEvent.clear(named);
    await userEvent.type(named, 'Regulatory affairs');
    await userEvent.click(within(renaming).getByRole('button', { name: 'Rename space' }));
    expect(
      await screen.findByText('Renamed Regulatory to Regulatory affairs.'),
    ).toBeInTheDocument();

    await userEvent.click(
      await within(table).findByRole('button', { name: 'More actions for Regulatory affairs' }),
    );
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    const archiving = screen.getByRole('dialog', { name: 'Archive Regulatory affairs?' });
    expect(archiving).toHaveTextContent('Nothing new can be made in it.');
    expect(archiving).toHaveTextContent('Nothing already in it changes');
    await userEvent.click(within(archiving).getByRole('button', { name: 'Archive space' }));
    expect(await screen.findByText('Archived Regulatory affairs.')).toBeInTheDocument();
    expect(
      await within(row(table, 'Regulatory affairs')).findByRole('cell', { name: 'Archived' }),
    ).toBeInTheDocument();

    await userEvent.click(
      within(row(table, 'Regulatory affairs')).getByRole('button', {
        name: 'Restore Regulatory affairs',
      }),
    );
    const restoring = screen.getByRole('dialog', { name: 'Restore Regulatory affairs?' });
    await userEvent.click(within(restoring).getByRole('button', { name: 'Restore space' }));
    expect(await screen.findByText('Restored Regulatory affairs.')).toBeInTheDocument();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    expect(sent).toEqual([
      { method: 'POST', path: '/v1/spaces', body: { name: 'Regulatory' } },
      { method: 'PATCH', path: '/v1/spaces/s3', body: { name: 'Regulatory affairs' } },
      { method: 'PATCH', path: '/v1/spaces/s3', body: { archived: true } },
      { method: 'PATCH', path: '/v1/spaces/s3', body: { archived: false } },
    ]);
  });

  it('shows the spaces in a table with a head, found by name and shown all, active or archived, counted', async () => {
    const { client } = spacesService();
    const { table, dialog } = await openSpaces(client);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((head) => head.textContent),
    ).toEqual(['Name', 'Status', 'Your access', 'Actions']);
    expect(within(row(table, 'General')).getByRole('cell', { name: 'Active' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      'A space holds components and documents, and has access of its own.',
    );
    const counted = () => within(dialog).getByText(/^\d+ spaces?$/).textContent;
    const before = counted();

    await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Find a space' }), 'gen');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(counted()).toBe('1 space');
    await userEvent.clear(within(dialog).getByRole('searchbox', { name: 'Find a space' }));

    const show = within(dialog).getByRole('group', { name: 'Show' });
    expect(within(show).getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(show).getByRole('button', { name: 'Archived' }));
    expect(within(table).queryByRole('row', { name: /^General/ })).toBeNull();
    await userEvent.click(within(show).getByRole('button', { name: 'All' }));
    expect(counted()).toBe(before);
  });

  it('says why a space was not made or archived: a name taken, and the last space', async () => {
    const { client, sent } = spacesService();
    const { table, dialog } = await openSpaces(client);

    await userEvent.click(await within(dialog).findByRole('button', { name: 'New space' }));
    const making = screen.getByRole('dialog', { name: 'New space' });
    await userEvent.click(within(making).getByRole('button', { name: 'Make space' }));
    expect(within(making).getByRole('status')).toHaveTextContent('Give the space a name.');
    expect(sent).toEqual([]);
    await userEvent.type(within(making).getByRole('textbox', { name: 'Name' }), 'General');
    await userEvent.click(within(making).getByRole('button', { name: 'Make space' }));
    expect(await within(making).findByRole('status')).toHaveTextContent(
      'There is already a space with that name, perhaps an archived one.',
    );
    await userEvent.click(within(making).getByRole('button', { name: 'Cancel' }));

    for (const name of ['Training', 'General']) {
      await userEvent.click(
        await within(table).findByRole('button', { name: `More actions for ${name}` }),
      );
      await userEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
      await userEvent.click(
        within(screen.getByRole('dialog', { name: `Archive ${name}?` })).getByRole('button', {
          name: 'Archive space',
        }),
      );
    }
    expect(
      await screen.findByText('This is the last space not archived, so it cannot be archived.'),
    ).toBeInTheDocument();
    expect(within(row(table, 'General')).queryByRole('cell', { name: 'Archived' })).toBeNull();
  });

  it('counts a name in characters as the service does, not in UTF-16 units', async () => {
    const { client, sent } = spacesService();
    const { dialog } = await openSpaces(client);
    await userEvent.click(await within(dialog).findByRole('button', { name: 'New space' }));
    const making = screen.getByRole('dialog', { name: 'New space' });
    const name = within(making).getByRole('textbox', { name: 'Name' });
    // Each a character outside the Basic Multilingual Plane: two UTF-16 units, one code point.
    const wide = String.fromCodePoint(0x1d538);
    fireEvent.change(name, { target: { value: wide.repeat(201) } });
    await userEvent.click(within(making).getByRole('button', { name: 'Make space' }));
    expect(within(making).getByRole('status')).toHaveTextContent(
      'A space name is at most 200 characters.',
    );
    expect(sent).toEqual([]);
    fireEvent.change(name, { target: { value: wide.repeat(200) } });
    await userEvent.click(within(making).getByRole('button', { name: 'Make space' }));
    await waitFor(() =>
      expect(sent).toEqual([
        { method: 'POST', path: '/v1/spaces', body: { name: wide.repeat(200) } },
      ]),
    );
  });

  it('offers none of it to one who administers only a space', async () => {
    const { client } = spacesService(['space:s1']);
    const { table, dialog } = await openSpaces(client);
    await within(table).findByRole('button', { name: 'Access to the space General' });
    expect(within(dialog).queryByRole('button', { name: 'New space' })).toBeNull();
    expect(within(table).queryByRole('button', { name: /^(Rename|Archive|Restore) / })).toBeNull();
  });
});
