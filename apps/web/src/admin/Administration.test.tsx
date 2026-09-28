import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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

const section = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

describe('Administration', () => {
  it('opens on Environment, and moves between the sections it can answer', async () => {
    const { client } = service(everything);
    render(<Administration client={client} about={null} onClose={vi.fn()} />);

    const dialog = screen.getByRole('dialog', { name: 'Administration' });
    expect(section('Environment')).toHaveAttribute('aria-current', 'true');
    // Beside the heading, and in the section.
    expect(await within(dialog).findAllByText('Development')).toHaveLength(2);
    for (const name of ['Spaces', 'People and invitations', 'Roles', 'Groups', 'About']) {
      expect(section(name)).toBeInTheDocument();
    }
    // What nothing answers yet is not offered.
    for (const name of ['Component types', 'Layouts']) {
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

  it("lets an administrator open a person's tokens from People, and revoke one after asking", async () => {
    const token = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Nightly import',
      scopes: ['edit'],
      createdAt: '2026-09-01T09:00:00.000Z',
      expiresAt: '2026-12-01T09:00:00.000Z',
      lastUsedAt: null,
    };
    const deleted: string[] = [];
    const answers: Record<string, () => Response> = {
      ...everything,
      '/v1/principals/p1/tokens': () => json(200, { items: [token], next: null }),
    };
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (request.method === 'DELETE') {
        deleted.push(url.pathname);
        return json(200, { revoked: token.id });
      }
      const answer = answers[url.pathname];
      return answer ? answer() : json(404, {});
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://admin.test', fetch: fetching });
    render(<Administration client={client} about={null} onClose={vi.fn()} />);

    await userEvent.click(section('People and invitations'));
    const people = await screen.findByRole('table', { name: 'People' });
    // Somebody invited who has not signed in yet has no tokens to list.
    expect(within(people).queryByRole('button', { name: /^Tokens of ivy/ })).toBeNull();
    await userEvent.click(within(people).getByRole('button', { name: 'Tokens of Ada' }));
    const tokens = await screen.findByRole('table', { name: 'Tokens of Ada' });
    expect(within(tokens).getByRole('cell', { name: 'Nightly import' })).toBeInTheDocument();
    expect(within(tokens).getByRole('cell', { name: 'read, edit' })).toBeInTheDocument();

    await userEvent.click(within(tokens).getByRole('button', { name: 'Revoke Nightly import' }));
    expect(deleted).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke token' }));
    expect(await screen.findByText('Revoked Nightly import.')).toBeInTheDocument();
    expect(deleted).toEqual([`/v1/principals/p1/tokens/${token.id}`]);
    expect(screen.queryByRole('table', { name: 'Tokens of Ada' })).toBeNull();
    expect(screen.getByText('Ada has no API tokens.')).toBeInTheDocument();
    expect(tokens).not.toBeInTheDocument();

    // And back to the people.
    await userEvent.click(screen.getByRole('button', { name: 'Back to people' }));
    expect(await screen.findByRole('table', { name: 'People' })).toBeInTheDocument();
  });

  it("keeps focus in Administration going to a person's tokens and back, though each button that had it goes", async () => {
    const answers: Record<string, () => Response> = {
      ...everything,
      '/v1/principals/p1/tokens': () => json(200, { items: [], next: null }),
    };
    const { client } = service(answers);
    const onClose = vi.fn();
    render(<Administration client={client} about={null} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Administration' });

    await userEvent.click(section('People and invitations'));
    const people = await screen.findByRole('table', { name: 'People' });
    await userEvent.click(within(people).getByRole('button', { name: 'Tokens of Ada' }));
    // On the person's tokens heading, which the Tokens button gave way to.
    expect(document.activeElement).toBe(
      within(dialog).getByRole('heading', { name: 'Tokens of Ada' }),
    );
    expect(await screen.findByText('Ada has no API tokens.')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Back to people' }));
    // Back on the Tokens button it left from.
    expect(document.activeElement).toBe(
      within(screen.getByRole('table', { name: 'People' })).getByRole('button', {
        name: 'Tokens of Ada',
      }),
    );
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    // So Escape still closes Administration.
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
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

  it('opens Access at a space from its row in Spaces, and at the environment from Environment, each with a way back', async () => {
    const { client, asked } = service(answering);
    render(<Administration client={client} about={null} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Administration' });

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
    expect(
      await within(dialog).findByRole('heading', { name: 'Access to the space General' }),
    ).toBeInTheDocument();
    await within(within(dialog).getByRole('region', { name: 'The space General' })).findByText(
      'Nothing is granted here.',
    );
    // Asked at the space, and at the environment above it.
    expect(
      asked
        .filter((url) => url.pathname === '/v1/grants')
        .map((url) => url.searchParams.get('level')),
    ).toEqual(['tenant', 'space:s1', 'tenant']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back to spaces' }));
    expect(await screen.findByRole('table', { name: 'Spaces' })).toBeInTheDocument();
  });

  it('keeps focus in Administration opening Access and going back, though the button that had it goes', async () => {
    const { client } = service(answering);
    const onClose = vi.fn();
    render(<Administration client={client} about={null} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Administration' });

    await userEvent.click(section('Spaces'));
    const spaces = await screen.findByRole('table', { name: 'Spaces' });
    await userEvent.click(
      await within(spaces).findByRole('button', { name: 'Access to the space Training' }),
    );
    // On the way back, which the Access button gave way to.
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Back to spaces' }),
    );
    await within(dialog).findByRole('heading', { name: 'Access to the space Training' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Back to spaces' }));
    // Back on the Access button it left from.
    expect(document.activeElement).toBe(
      within(screen.getByRole('table', { name: 'Spaces' })).getByRole('button', {
        name: 'Access to the space Training',
      }),
    );

    await userEvent.click(section('Environment'));
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
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('heads Access below the section it opens in, and its cards below that', async () => {
    const { client } = service(answering);
    render(<Administration client={client} about={null} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Administration' });
    expect(within(dialog).getByRole('heading', { name: 'Environment', level: 3 })).toBeTruthy();

    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Access to the whole environment' }),
    );
    expect(
      await within(dialog).findByRole('heading', {
        name: 'Access to the whole environment',
        level: 4,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('heading', { name: 'The whole environment', level: 5 }),
    ).toBeInTheDocument();
  });

  it('offers Access only where the reader may administer: not the environment, and only the spaces they administer', async () => {
    const { client, asked } = service({
      ...answering,
      '/v1/access': administering('space:s1'),
    });
    render(<Administration client={client} about={null} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Administration' });
    await within(dialog).findAllByText('Development');

    await userEvent.click(section('Spaces'));
    const spaces = await screen.findByRole('table', { name: 'Spaces' });
    expect(
      await within(spaces).findByRole('button', { name: 'Access to the space General' }),
    ).toBeInTheDocument();
    expect(
      within(spaces).queryByRole('button', { name: 'Access to the space Training' }),
    ).toBeNull();
    await userEvent.click(section('Environment'));
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
    const onClose = vi.fn();
    render(<Administration client={client} about={null} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Administration' });

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
    // Still inside the dialog, so Tab stays in it and Escape still closes it.
    await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
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
    const onClose = vi.fn();
    render(<Administration client={client} about={null} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Administration' });

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
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
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
    const onClose = vi.fn();
    render(<Administration client={client} about={null} onClose={onClose} />);
    await userEvent.click(section('Groups'));
    const table = await screen.findByRole('table', { name: 'Groups' });
    return { table, onClose, dialog: screen.getByRole('dialog', { name: 'Administration' }) };
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
    render(<Administration client={client} about={null} onClose={vi.fn()} />);
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
    const { table, dialog, onClose } = await openGroups(client);

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
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
