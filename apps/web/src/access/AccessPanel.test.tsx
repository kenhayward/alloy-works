import { createApiClient } from '@alloy-works/api-client';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AccessPanel } from './AccessPanel.js';
import type { ShownGrant } from './describe.js';

/** A grant exactly as the service lists one, with the members the panel does not show. */
type GrantView = ShownGrant & {
  readonly extends: string | null;
  readonly grantedBy: { readonly id: string; readonly name: string | null };
  readonly grantedAt: string;
};

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const GENERAL = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const ADA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const GRACE = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';
const ALICE = '2c3d4e5f-6071-4829-9bac-1d2e3f4a5b6c';
const AUTHOR = '3d4e5f60-7182-493a-8cbd-2e3f4a5b6c7d';
const EDITING = '4e5f6071-8293-4a4b-9dce-3f4a5b6c7d8e';
const ADMINISTRATOR = '5f607182-93a4-4b5c-8edf-4a5b6c7d8e9f';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const refused = (status: number, code: string, message = 'refused') =>
  json(status, { code, message, traceId: 't' });

const IVY = '6a718293-a4b5-4c6d-9e0f-5b6c7d8e9f0a';

const people = [
  { id: ADA, name: 'Ada', email: 'ada@example.test', kind: 'user', invited: false },
  { id: GRACE, name: 'Grace', email: 'grace@example.test', kind: 'user', invited: false },
  { id: ALICE, name: 'Alice', email: 'alice@example.test', kind: 'user', invited: false },
];

/** An invitation exactly as the service lists one. */
const invitationOf = (id: string, email: string, person: string) => ({
  id,
  email,
  person,
  external: false,
  invitedBy: { id: ADA, name: 'Ada' },
  createdAt: '2026-09-17T09:00:00.000Z',
  expiresAt: '2026-10-01T09:00:00.000Z',
  lapsed: false,
  acceptedAt: null,
  acceptedThrough: null,
});

const roles = [
  { id: AUTHOR, name: 'Author', permissions: ['read', 'create', 'edit', 'comment', 'suggest'] },
  { id: EDITING, name: 'Editing', permissions: ['edit'] },
  { id: ADMINISTRATOR, name: 'Administrator', permissions: ['read', 'administer'] },
];

const grantOf = (
  id: string,
  level: string,
  role: (typeof roles)[number],
  who: (typeof people)[number],
  effect: 'allow' | 'deny' = 'allow',
): GrantView => ({
  id,
  role: { id: role.id, name: role.name },
  subject: { principal: { id: who.id, name: who.name, email: who.email } },
  level,
  effect,
  expiresAt: null,
  extends: null,
  grantedBy: { id: ADA, name: 'Ada' },
  grantedAt: '2026-09-17T09:00:00.000Z',
});

type Handler = (request: Request, url: URL) => Response | Promise<Response>;

/**
 * The service as the panel meets it: grants held per level, and changed by what the panel sends, so a
 * list read again after a change shows the change. `levels` names the levels the signed-in person may
 * manage; any other is refused as forbidden. `override` answers a route before the default does.
 */
function service(
  options: {
    grants?: GrantView[];
    levels?: string[];
    override?: Record<string, Handler>;
  } = {},
) {
  const grants = [...(options.grants ?? [])];
  const everybody: {
    id: string;
    name: string | null;
    email: string | null;
    kind: string;
    invited: boolean;
  }[] = [...people];
  const invitations: ReturnType<typeof invitationOf>[] = [];
  const levels = options.levels ?? [`artifact:${COMPONENT}`, `space:${GENERAL}`, 'tenant'];
  const asked: { route: string; body: unknown }[] = [];
  let made = 0;
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    const text = request.method === 'POST' ? await request.clone().text() : '';
    asked.push({ route, body: text === '' ? undefined : JSON.parse(text) });
    const override = options.override?.[route];
    if (override) return override(request, url);
    switch (route) {
      case `GET /v1/components/${COMPONENT}`:
        return json(200, {
          id: COMPONENT,
          space: { id: GENERAL, name: 'General' },
          version: {
            id: 'v1',
            number: '0.1',
            author: ADA,
            createdAt: '2026-09-17T09:00:00.000Z',
            note: null,
          },
          content: { schemaVersion: 1, title: 'Install the printer', content: [] },
          mayEdit: false,
          lock: null,
        });
      case 'GET /v1/principals':
        return json(200, { items: everybody, next: null });
      case 'GET /v1/invitations':
        if (!levels.includes('tenant')) return refused(403, 'forbidden');
        return json(200, { items: invitations, next: null });
      case 'POST /v1/invitations': {
        const body = JSON.parse(text) as { email: string; external: boolean };
        const invitation = invitationOf(`i${invitations.length + 1}`, body.email, IVY);
        invitations.push(invitation);
        everybody.push({ id: IVY, name: null, email: body.email, kind: 'user', invited: true });
        return json(200, { invitation, renewed: false });
      }
      case 'GET /v1/roles':
        return json(200, { items: roles, next: null });
      case 'GET /v1/grants': {
        const level = url.searchParams.get('level')!;
        if (!levels.includes(level)) return refused(403, 'forbidden');
        return json(200, { items: grants.filter((each) => each.level === level), next: null });
      }
      case 'POST /v1/grants': {
        const body = JSON.parse(text) as {
          role: string;
          subject: { principal: string };
          level: string;
          effect: 'allow' | 'deny';
        };
        made += 1;
        const grant = grantOf(
          `90000000-0000-4000-8000-00000000000${made}`,
          body.level,
          roles.find((each) => each.id === body.role)!,
          everybody.find((each) => each.id === body.subject.principal)! as (typeof people)[number],
          body.effect,
        );
        grants.push(grant);
        return json(200, { grant });
      }
      default: {
        const withdrawing = /^DELETE \/v1\/invitations\/(.+)$/.exec(route);
        if (withdrawing) {
          const index = invitations.findIndex((each) => each.id === withdrawing[1]);
          if (index < 0) return refused(404, 'not_found');
          const [gone] = invitations.splice(index, 1);
          const personIndex = everybody.findIndex((each) => each.id === gone!.person);
          if (personIndex >= 0) everybody.splice(personIndex, 1);
          for (let i = grants.length - 1; i >= 0; i -= 1) {
            const subject = grants[i]!.subject;
            if ('principal' in subject && subject.principal.id === gone!.person) {
              grants.splice(i, 1);
            }
          }
          return json(200, { withdrawn: withdrawing[1] });
        }
        const removing = /^DELETE \/v1\/grants\/(.+)$/.exec(route);
        if (removing) {
          const index = grants.findIndex((each) => each.id === removing[1]);
          if (index < 0) return refused(404, 'not_found');
          grants.splice(index, 1);
          return json(200, { removed: removing[1] });
        }
        return refused(404, 'not_found');
      }
    }
  }) as unknown as typeof fetch;
  return { fetching, asked, grants };
}

const panel = (fetching: typeof fetch) =>
  render(
    <AccessPanel
      componentId={COMPONENT}
      client={createApiClient({ baseUrl: 'http://dev.acme.alloy.test', fetch: fetching })}
    />,
  );

const section = (name: string) => screen.getByRole('region', { name });

describe('access to a component', () => {
  it('lists what is granted at the component, its space and the whole environment, each under its own heading', async () => {
    const { fetching } = service({
      grants: [
        grantOf('g1', `space:${GENERAL}`, roles[0]!, people[1]!),
        grantOf('g2', `artifact:${COMPONENT}`, roles[1]!, people[1]!, 'deny'),
        grantOf('g3', 'tenant', roles[2]!, people[0]!),
      ],
    });
    panel(fetching);

    expect(
      await screen.findByRole('heading', { name: 'Access to Install the printer' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(section('The space General')).getByRole('listitem')).toHaveTextContent(
        'Allowed Author to Grace',
      ),
    );
    expect(within(section('This component')).getByRole('listitem')).toHaveTextContent(
      'Denied Editing to Grace',
    );
    expect(within(section('The whole environment')).getByRole('listitem')).toHaveTextContent(
      'Allowed Administrator to Ada',
    );
  });

  it('lays out what is granted and why on the left, and giving and inviting on the right', async () => {
    const { fetching } = service({
      grants: [grantOf('g1', `space:${GENERAL}`, roles[0]!, people[1]!)],
    });
    panel(fetching);

    const column = (element: HTMLElement) =>
      element.closest('[data-column]')?.getAttribute('data-column');
    await waitFor(() =>
      expect(within(section('The space General')).getByRole('listitem')).toBeInTheDocument(),
    );
    expect(column(section('The space General'))).toBe('granted');
    expect(column(screen.getByRole('heading', { name: 'What someone may do here' }))).toBe(
      'granted',
    );
    expect(column(screen.getByRole('heading', { name: 'Give access' }))).toBe('giving');
    expect(column(await screen.findByRole('heading', { name: 'Invite someone' }))).toBe('giving');
    expect(within(section('The space General')).getByRole('listitem')).toHaveAttribute(
      'data-effect',
      'allow',
    );
  });

  it('says where the person may not manage access, and offers only the levels they may', async () => {
    const { fetching } = service({ levels: [`artifact:${COMPONENT}`, `space:${GENERAL}`] });
    panel(fetching);

    expect(
      await within(await screen.findByRole('region', { name: 'The whole environment' })).findByText(
        'You may not manage access here.',
      ),
    ).toBeInTheDocument();
    const where = screen.getByRole('combobox', { name: 'Where' });
    expect(
      within(where)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['This component', 'The space General']);
  });

  it('says so, and offers nothing, to someone who may manage access nowhere on this component', async () => {
    const { fetching } = service({
      override: { 'GET /v1/roles': () => refused(404, 'not_found') },
    });
    panel(fetching);
    expect(
      await screen.findByText('You may not manage access to this component.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Give' })).toBeNull();
  });

  it('gives a person a role where it is asked, says what was granted, and lists it from the service', async () => {
    const { fetching, asked } = service();
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await within(section('The space General')).findByText('Nothing is granted here.');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), ALICE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Where' }),
      `space:${GENERAL}`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Allowed Author to Alice on the space General.',
    );
    expect(asked.filter((each) => each.route === 'POST /v1/grants')).toEqual([
      {
        route: 'POST /v1/grants',
        body: {
          role: AUTHOR,
          subject: { principal: ALICE },
          level: `space:${GENERAL}`,
          effect: 'allow',
        },
      },
    ]);
    await waitFor(() =>
      expect(within(section('The space General')).getByRole('listitem')).toHaveTextContent(
        'Allowed Author to Alice',
      ),
    );
  });

  it('asks for a person, a role and where before sending anything', async () => {
    const { fetching, asked } = service();
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    expect(screen.getByRole('status')).toHaveTextContent('Choose a person, a role and where.');
    expect(asked.some((each) => each.route === 'POST /v1/grants')).toBe(false);
  });

  it('shows the service refusal in its own words, and the lists as the service holds them', async () => {
    const { fetching } = service({
      override: {
        'POST /v1/grants': () =>
          refused(
            409,
            'grant_allow_without_read',
            'A role that does not include read can only be denied, not allowed.',
          ),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), GRACE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), EDITING);
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'A role that does not include read can only be denied, not allowed.',
    );
    expect(within(section('This component')).getByText('Nothing is granted here.')).toBeTruthy();
  });

  it('removes a grant, and says so when it is the last keeping the environment administered or already gone', async () => {
    let lastAdministrator = true;
    const { fetching } = service({
      grants: [
        grantOf('g1', 'tenant', roles[2]!, people[0]!),
        grantOf('g2', `space:${GENERAL}`, roles[0]!, people[1]!),
      ],
      override: {
        'DELETE /v1/grants/g1': () =>
          lastAdministrator
            ? refused(
                409,
                'grant_last_administrator',
                'This is the last grant that lets anyone administer this environment, so it cannot be removed.',
              )
            : refused(404, 'not_found'),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove: Allowed Administrator to Ada' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'This is the last grant that lets anyone administer this environment, so it cannot be removed.',
    );
    lastAdministrator = false;
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove: Allowed Administrator to Ada' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'That grant is gone, or you may no longer manage it.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove: Allowed Author to Grace' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Removed: Allowed Author to Grace on the space General.',
    );
    await waitFor(() =>
      expect(
        within(section('The space General')).getByText('Nothing is granted here.'),
      ).toBeTruthy(),
    );
  });

  it('sends one change, not two, when Give is pressed again before the first is answered', async () => {
    const release: { current: (() => void) | null } = { current: null };
    const { fetching, asked } = service({
      override: {
        'POST /v1/grants': () =>
          new Promise<Response>((resolve) => {
            release.current = () => resolve(refused(409, 'grant_duplicate', 'Already granted.'));
          }),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), GRACE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    // Submitting the form directly, twice, bypasses the button's own disabled attribute: what stops
    // the second send is the pending ref checked inside `change`, and this is what pins that down.
    const form = screen.getByRole('form', { name: 'Give access' });
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(release.current).not.toBeNull());
    release.current!();
    expect(await screen.findByRole('status')).toHaveTextContent('Already granted.');
    expect(asked.filter((each) => each.route === 'POST /v1/grants')).toHaveLength(1);
  });

  it('invites an address, then offers the person it made to give access to, marked as not signed in yet', async () => {
    const { fetching, asked } = service();
    panel(fetching);
    const inviting = await screen.findByRole('region', { name: 'Invite someone' });
    expect(within(inviting).getByText('Nobody is waiting to accept an invitation.')).toBeTruthy();

    await userEvent.type(
      within(inviting).getByRole('textbox', { name: 'Address' }),
      'ivy@example.test',
    );
    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invited ivy@example.test. Choose them under Give access: what they are given is theirs from their first sign-in.',
    );
    expect(asked.filter((each) => each.route === 'POST /v1/invitations')).toEqual([
      { route: 'POST /v1/invitations', body: { email: 'ivy@example.test', external: false } },
    ]);
    const person = screen.getByRole('combobox', { name: 'Person' });
    await waitFor(() =>
      expect(within(person).getByRole('option', { name: /ivy@example\.test/ })).toHaveTextContent(
        'ivy@example.test, invited and not signed in yet',
      ),
    );
    expect(
      within(screen.getByRole('list', { name: 'Waiting invitations' })).getByRole('listitem'),
    ).toHaveTextContent('ivy@example.test, until 2026-10-01');

    await userEvent.selectOptions(person, IVY);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Allowed Author to ivy@example.test on this component.',
    );
  });

  it('withdraws a waiting invitation, and no longer offers the person it made', async () => {
    const { fetching } = service();
    panel(fetching);
    const inviting = await screen.findByRole('region', { name: 'Invite someone' });
    await userEvent.type(
      within(inviting).getByRole('textbox', { name: 'Address' }),
      'ivy@example.test',
    );
    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));
    await screen.findByRole('button', { name: 'Withdraw the invitation to ivy@example.test' });

    await userEvent.click(
      screen.getByRole('button', { name: 'Withdraw the invitation to ivy@example.test' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Withdrew the invitation to ivy@example.test, and everything granted to them.',
    );
    await waitFor(() =>
      expect(within(inviting).getByText('Nobody is waiting to accept an invitation.')).toBeTruthy(),
    );
    expect(
      within(screen.getByRole('combobox', { name: 'Person' })).queryByRole('option', {
        name: /ivy@example\.test/,
      }),
    ).toBeNull();
  });

  it('drops whoever was chosen to give access to or to explain, once withdrawing the invitation that made them removes them from who can be chosen', async () => {
    const { fetching, asked } = service();
    panel(fetching);
    const inviting = await screen.findByRole('region', { name: 'Invite someone' });
    await userEvent.type(
      within(inviting).getByRole('textbox', { name: 'Address' }),
      'ivy@example.test',
    );
    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));
    const person = screen.getByRole('combobox', { name: 'Person' });
    await waitFor(() =>
      expect(within(person).queryByRole('option', { name: /ivy@example\.test/ })).not.toBeNull(),
    );

    await userEvent.selectOptions(person, IVY);
    const explaining = section('What someone may do here');
    const whose = within(explaining).getByRole('combobox', { name: 'Whose access' });
    await userEvent.selectOptions(whose, IVY);
    expect(within(explaining).getByRole('button', { name: 'Show' })).toBeEnabled();

    await userEvent.click(
      screen.getByRole('button', { name: 'Withdraw the invitation to ivy@example.test' }),
    );
    await screen.findByRole('status');

    // Explaining somebody gone is refused rather than asked for, and Give no longer silently names
    // them: each asks to choose again instead of sending or showing a stale choice.
    await waitFor(() =>
      expect(within(explaining).getByRole('button', { name: 'Show' })).toBeDisabled(),
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Choose a person, a role and where.',
    );
    expect(asked.filter((each) => each.route === 'POST /v1/grants')).toHaveLength(0);
  });

  it('shows the service refusal of an invitation in its own words', async () => {
    const { fetching } = service({
      override: {
        'POST /v1/invitations': () =>
          refused(
            409,
            'invitation_signed_in',
            'Somebody with that address has already signed in. Choose them and give them access directly.',
          ),
      },
    });
    panel(fetching);
    const inviting = await screen.findByRole('region', { name: 'Invite someone' });
    await userEvent.type(
      within(inviting).getByRole('textbox', { name: 'Address' }),
      'grace@example.test',
    );
    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Somebody with that address has already signed in. Choose them and give them access directly.',
    );
  });

  it('offers no inviting to someone who does not administer the whole environment', async () => {
    const { fetching, asked } = service({ levels: [`artifact:${COMPONENT}`, `space:${GENERAL}`] });
    panel(fetching);
    await within(await screen.findByRole('region', { name: 'The whole environment' })).findByText(
      'You may not manage access here.',
    );
    await waitFor(() =>
      expect(asked.filter((each) => each.route === 'GET /v1/invitations')).toHaveLength(1),
    );
    // The invitations answer settled as unmanaged, not merely not-yet-loaded: no failure this page
    // could show by mistake, and no more than the one read.
    await waitFor(() => expect(screen.queryByText('Invitations could not be loaded.')).toBeNull());
    expect(screen.queryByRole('region', { name: 'Invite someone' })).toBeNull();
    expect(asked.filter((each) => each.route === 'GET /v1/invitations')).toHaveLength(1);
  });

  it('shows signed out, not a useless Try again, when the invitations cannot be read because the session is gone', async () => {
    const { fetching } = service({
      override: {
        'GET /v1/invitations': () => refused(401, 'unauthorized', 'Sign in.'),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    expect(
      await screen.findByText('You are signed out. Sign in again to manage access.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Invite someone' })).toBeNull();
    expect(screen.queryByText('Invitations could not be loaded.')).toBeNull();
  });

  it('shows invitations failed, not a crash, when they come back in a shape this page does not expect', async () => {
    const { fetching } = service({
      override: {
        'GET /v1/invitations': () => json(200, { items: [{ id: 'bad' }], next: null }),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    expect(await screen.findByText('Invitations could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // The rest of the page is unaffected: a bad shape in the invitations did not take the page down.
    expect(screen.queryByRole('region', { name: 'Invite someone' })).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Access to Install the printer' }),
    ).toBeInTheDocument();
  });

  it("shows invitations failed, not stuck reading for ever, when a page's next is missing rather than null", async () => {
    let requests = 0;
    const { fetching } = service({
      override: {
        'GET /v1/invitations': () => {
          requests += 1;
          // No `next` at all: neither the null that ends paging nor a cursor that continues it.
          return json(200, { items: [] });
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    expect(await screen.findByText('Invitations could not be loaded.')).toBeInTheDocument();
    // One request, not an unbounded loop of them.
    expect(requests).toBe(1);
  });

  it('offers Try again when invitations fail to load, and trying again can succeed', async () => {
    let failing = true;
    const { fetching } = service({
      override: {
        'GET /v1/invitations': () =>
          failing ? refused(500, 'internal', 'broken') : json(200, { items: [], next: null }),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    expect(await screen.findByText('Invitations could not be loaded.')).toBeInTheDocument();

    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await within(await screen.findByRole('region', { name: 'Invite someone' })).findByText(
      'Nobody is waiting to accept an invitation.',
    );
  });

  it("shows invitations' Try again as reading while its re-read is in flight, disabled rather than pressable again", async () => {
    let attempt = 0;
    const resolvers: (() => void)[] = [];
    const { fetching } = service({
      override: {
        'GET /v1/invitations': () => {
          attempt += 1;
          if (attempt === 1) return refused(500, 'internal', 'broken');
          return new Promise<Response>((resolve) => {
            resolvers.push(() => resolve(json(200, { items: [], next: null })));
          });
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    const tryAgain = await screen.findByRole('button', { name: 'Try again' });

    await userEvent.click(tryAgain);
    await waitFor(() => expect(resolvers).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Reading...' })).toBeDisabled();
    // Only the one re-read this click asked for: nothing further went out while it was in flight.
    expect(attempt).toBe(2);

    resolvers[0]!();
    await within(await screen.findByRole('region', { name: 'Invite someone' })).findByText(
      'Nobody is waiting to accept an invitation.',
    );
  });

  it('says an invitation was renewed, in the same words the waiting list would use for it', async () => {
    const { fetching } = service({
      override: {
        'POST /v1/invitations': () =>
          json(200, {
            invitation: invitationOf('i9', 'ivy@example.test', IVY),
            renewed: true,
          }),
      },
    });
    panel(fetching);
    const inviting = await screen.findByRole('region', { name: 'Invite someone' });
    await userEvent.type(
      within(inviting).getByRole('textbox', { name: 'Address' }),
      'ivy@example.test',
    );
    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Renewed the invitation to ivy@example.test, now until 2026-10-01.',
    );
  });

  it('says an address was invited though what exactly could not be shown, and clears the address anyway, whether the invitation or the renewed flag is unreadable', async () => {
    let bad: 'invitation' | 'renewed' = 'invitation';
    const { fetching } = service({
      override: {
        'POST /v1/invitations': () =>
          bad === 'invitation'
            ? json(200, { invitation: { id: 'i9' }, renewed: false })
            : json(200, { invitation: invitationOf('i9', 'ivy@example.test', IVY), renewed: 'no' }),
      },
    });
    panel(fetching);
    const inviting = await screen.findByRole('region', { name: 'Invite someone' });
    const address = within(inviting).getByRole('textbox', { name: 'Address' });

    await userEvent.type(address, 'ivy@example.test');
    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'That address was invited, though what exactly could not be shown.',
    );
    expect(address).toHaveValue('');

    bad = 'renewed';
    await userEvent.type(address, 'ivy@example.test');
    await userEvent.click(within(inviting).getByRole('button', { name: 'Invite' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'That address was invited, though what exactly could not be shown.',
    );
    expect(address).toHaveValue('');
  });

  it('IAM-030 names, for each answer about a chosen person, the level that decided it and the grants that did', async () => {
    const { fetching } = service({
      override: {
        'GET /v1/access/explain': (_request, url) => {
          expect(url.searchParams.get('principal')).toBe(GRACE);
          expect(url.searchParams.get('target')).toBe(`artifact:${COMPONENT}`);
          return json(200, {
            principal: GRACE,
            target: `artifact:${COMPONENT}`,
            permissions: [
              {
                permission: 'edit',
                allowed: true,
                reason: 'allowed',
                level: `space:${GENERAL}`,
                checked: [`artifact:${COMPONENT}`, `space:${GENERAL}`],
                grants: [
                  {
                    id: 'g1',
                    role: 'Author',
                    effect: 'allow',
                    subject: { principal: GRACE },
                    through: null,
                    expiresAt: null,
                  },
                  {
                    id: 'g2',
                    role: 'Author',
                    effect: 'allow',
                    subject: { group: 'e1' },
                    through: 'e1',
                    expiresAt: null,
                  },
                ],
              },
            ],
          });
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    const explaining = section('What someone may do here');
    await userEvent.selectOptions(
      within(explaining).getByRole('combobox', { name: 'Whose access' }),
      GRACE,
    );
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));

    const table = await within(explaining).findByRole('table', {
      name: 'What Grace may do with this component',
    });
    const edit = within(table).getByRole('row', { name: /^edit/ });
    expect(
      within(edit)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'Allowed',
      'Allowed at the space General, by Author allowed to Grace; Author allowed to a group.',
    ]);
  });

  it('IAM-031 answers why a chosen person may not do something: the denying grants, or every level that granted nothing', async () => {
    const { fetching } = service({
      override: {
        'GET /v1/access/explain': () =>
          json(200, {
            principal: ALICE,
            target: `artifact:${COMPONENT}`,
            permissions: [
              {
                permission: 'edit',
                allowed: false,
                reason: 'denied',
                level: `artifact:${COMPONENT}`,
                checked: [`artifact:${COMPONENT}`],
                grants: [
                  {
                    id: 'g1',
                    role: 'Editing',
                    effect: 'deny',
                    subject: { principal: ALICE },
                    through: null,
                    expiresAt: null,
                  },
                ],
              },
              {
                permission: 'publish',
                allowed: false,
                reason: 'not_granted',
                level: null,
                checked: [`artifact:${COMPONENT}`, `space:${GENERAL}`, 'tenant'],
                grants: [],
              },
            ],
          }),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    const explaining = section('What someone may do here');
    await userEvent.selectOptions(
      within(explaining).getByRole('combobox', { name: 'Whose access' }),
      ALICE,
    );
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));

    const table = await within(explaining).findByRole('table');
    const cells = (name: RegExp) =>
      within(within(table).getByRole('row', { name }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells(/^edit/)).toEqual([
      'Refused',
      'Refused at this component, by Editing denied to Alice.',
    ]);
    expect(cells(/^publish/)).toEqual([
      'Refused',
      'Refused: nothing grants it at this component, the space General, the whole environment.',
    ]);
  });

  it('takes an explanation down once access changes, and never shows one for a person no longer chosen', async () => {
    const answers: Record<string, (() => void) | undefined> = {};
    const explanationFor = (principal: string) =>
      json(200, {
        principal,
        target: `artifact:${COMPONENT}`,
        permissions: [
          {
            permission: 'read',
            allowed: false,
            reason: 'not_granted',
            level: null,
            checked: ['tenant'],
            grants: [],
          },
        ],
      });
    const { fetching } = service({
      override: {
        'GET /v1/access/explain': (_request, url) => {
          const principal = url.searchParams.get('principal')!;
          if (principal === GRACE) {
            return new Promise<Response>((resolve) => {
              answers[GRACE] = () => resolve(explanationFor(GRACE));
            });
          }
          return explanationFor(principal);
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    const explaining = section('What someone may do here');
    const chooser = within(explaining).getByRole('combobox', { name: 'Whose access' });

    await userEvent.selectOptions(chooser, ALICE);
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));
    expect(await within(explaining).findByRole('table')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), GRACE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    await screen.findByText('Allowed Author to Grace on this component.');
    expect(within(explaining).queryByRole('table')).toBeNull();

    await userEvent.selectOptions(chooser, GRACE);
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(answers[GRACE]).toBeDefined());

    // A positive signal, not merely the table's absence, before Grace's late answer is released: this
    // rules out the assertion below passing only because nothing had re-rendered yet.
    await userEvent.selectOptions(chooser, ALICE);
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));
    await within(explaining).findByRole('table', { name: 'What Alice may do with this component' });

    answers[GRACE]!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      within(explaining).getByRole('table', { name: 'What Alice may do with this component' }),
    ).toBeInTheDocument();
  });

  it('drops a level that stops being listed, and only ever sends a level still shown', async () => {
    let tenantReads = 0;
    const { fetching, asked } = service({
      override: {
        'GET /v1/grants': (_request, url) => {
          const level = url.searchParams.get('level')!;
          if (level === 'tenant') {
            tenantReads += 1;
            if (tenantReads > 1) return refused(403, 'forbidden');
          }
          return json(200, { items: [], next: null });
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await within(section('The whole environment')).findByText('Nothing is granted here.');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), ALICE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Where' }), 'tenant');
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    await screen.findByText('Allowed Author to Alice on the whole environment.');

    // Tenant's listing is refused on the re-read: it is no longer offered, and the choice already
    // made for it is dropped rather than sent again without being shown.
    await waitFor(() =>
      expect(
        within(screen.getByRole('combobox', { name: 'Where' }))
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Choose where', 'This component', 'The space General']),
    );
    expect(screen.getByRole('combobox', { name: 'Where' })).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Choose a person, a role and where.',
    );
    expect(asked.filter((each) => each.route === 'POST /v1/grants')).toHaveLength(1);

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Where' }),
      `artifact:${COMPONENT}`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Allowed Author to Alice on this component.',
    );
    const posts = asked.filter((each) => each.route === 'POST /v1/grants');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toEqual({
      role: AUTHOR,
      subject: { principal: ALICE },
      level: `artifact:${COMPONENT}`,
      effect: 'allow',
    });
  });

  it('disables Give until at least one level has loaded, and enables it once one has', async () => {
    const resolvers: (() => void)[] = [];
    const { fetching } = service({
      override: {
        'GET /v1/grants': () =>
          new Promise<Response>((resolve) => {
            resolvers.push(() => resolve(json(200, { items: [], next: null })));
          }),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    expect(screen.getByRole('button', { name: 'Give' })).toBeDisabled();

    await waitFor(() => expect(resolvers).toHaveLength(3));
    resolvers.forEach((release) => release());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Give' })).toBeEnabled());
  });

  it("shows a level's listing failed, not a crash, when its grants come back in a shape this page does not expect", async () => {
    const { fetching } = service({
      override: {
        'GET /v1/grants': (_request, url) => {
          const level = url.searchParams.get('level')!;
          if (level === `space:${GENERAL}`)
            return json(200, { items: [{ id: 'bad' }], next: null });
          return json(200, { items: [], next: null });
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    expect(
      await within(section('The space General')).findByText(
        'What is granted here could not be loaded.',
      ),
    ).toBeInTheDocument();
    expect(
      within(section('The space General')).getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
    // The rest of the page is unaffected: a bad shape at one level did not take the page down.
    expect(
      within(section('This component')).getByText('Nothing is granted here.'),
    ).toBeInTheDocument();
  });

  it("shows a listing failed, not stuck reading for ever, when a page's next is missing rather than null", async () => {
    let requests = 0;
    const { fetching } = service({
      override: {
        'GET /v1/grants': (_request, url) => {
          const level = url.searchParams.get('level')!;
          if (level !== `space:${GENERAL}`) return json(200, { items: [], next: null });
          requests += 1;
          // No `next` at all: neither the null that ends paging nor a cursor that continues it.
          return json(200, { items: [] });
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    expect(
      await within(section('The space General')).findByText(
        'What is granted here could not be loaded.',
      ),
    ).toBeInTheDocument();
    // One request, not an unbounded loop of them.
    expect(requests).toBe(1);
  });

  it("shows every page of a listing, gathered across more than one of the service's responses", async () => {
    const { fetching } = service({
      override: {
        'GET /v1/grants': (_request, url) => {
          const level = url.searchParams.get('level')!;
          if (level !== `space:${GENERAL}`) return json(200, { items: [], next: null });
          const cursor = url.searchParams.get('cursor');
          if (cursor === null) {
            return json(200, {
              items: [grantOf('g1', `space:${GENERAL}`, roles[0]!, people[1]!)],
              next: 'page2',
            });
          }
          return json(200, {
            items: [grantOf('g2', `space:${GENERAL}`, roles[2]!, people[0]!)],
            next: null,
          });
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await waitFor(() =>
      expect(within(section('The space General')).getAllByRole('listitem')).toHaveLength(2),
    );
    expect(
      within(section('The space General')).getByText(/Allowed Author to Grace/),
    ).toBeInTheDocument();
    expect(
      within(section('The space General')).getByText(/Allowed Administrator to Ada/),
    ).toBeInTheDocument();
  });

  it('says what was granted could not be told, not a crash, when giving access answers a grant in a shape this page does not expect', async () => {
    const { fetching } = service({
      override: {
        'POST /v1/grants': () => json(200, { grant: { id: 'g9', level: `artifact:${COMPONENT}` } }),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), GRACE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));

    // The full status, not merely a prefix: nothing else is appended to the one true sentence.
    expect(await screen.findByRole('status')).toHaveTextContent(
      /^That was granted, though what exactly could not be shown\.$/,
    );
    expect(
      screen.getByRole('heading', { name: 'Access to Install the printer' }),
    ).toBeInTheDocument();
  });

  it("says it was refused, not that it could not be told, when a 409 or 400 refusal's own message is not text", async () => {
    let refusalStatus = 409;
    const { fetching } = service({
      override: {
        'POST /v1/grants': () =>
          json(refusalStatus, { code: 'grant_duplicate', message: 42, traceId: 't' }),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), GRACE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));

    // A 409 or a 400 always means nothing was done: the wording says so, rather than the more
    // guarded "could not be told" that a lost or unrecognised response gets.
    expect(await screen.findByRole('status')).toHaveTextContent(
      'That was refused, for a reason that could not be shown.',
    );

    refusalStatus = 400;
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'That was refused, for a reason that could not be shown.',
    );
  });

  it('says whether the change happened could not be told, not that it failed, when the request itself is lost', async () => {
    const { fetching } = service({
      override: {
        'POST /v1/grants': () => Promise.reject(new Error('network down')),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), GRACE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Whether that was done could not be told. What is shown below is what the service now holds.',
    );
  });

  it('says the caller is signed out when opening the component answers unauthorized', async () => {
    const { fetching } = service({
      override: {
        [`GET /v1/components/${COMPONENT}`]: () => refused(401, 'unauthorized', 'Sign in.'),
      },
    });
    panel(fetching);
    expect(
      await screen.findByText('You are signed out. Sign in again to manage access.'),
    ).toBeInTheDocument();
  });

  it('offers Try again when the page fails to load, and trying again can succeed', async () => {
    let failing = true;
    const componentBody = {
      id: COMPONENT,
      space: { id: GENERAL, name: 'General' },
      version: {
        id: 'v1',
        number: '0.1',
        author: ADA,
        createdAt: '2026-09-17T09:00:00.000Z',
        note: null,
      },
      content: { schemaVersion: 1, title: 'Install the printer', content: [] },
      mayEdit: false,
      lock: null,
    };
    const { fetching } = service({
      override: {
        [`GET /v1/components/${COMPONENT}`]: () =>
          failing ? refused(500, 'internal', 'Something broke.') : json(200, componentBody),
      },
    });
    panel(fetching);
    expect(
      await screen.findByText('Access to this component could not be loaded.'),
    ).toBeInTheDocument();

    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { name: 'Access to Install the printer' }),
    ).toBeInTheDocument();
  });

  it("offers Try again when a level's listing fails to load, and trying again can succeed", async () => {
    let failing = true;
    const { fetching } = service({
      override: {
        'GET /v1/grants': (_request, url) => {
          const level = url.searchParams.get('level')!;
          if (level === `space:${GENERAL}` && failing) return refused(500, 'internal', 'broken');
          return json(200, { items: [], next: null });
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    expect(
      await within(section('The space General')).findByText(
        'What is granted here could not be loaded.',
      ),
    ).toBeInTheDocument();

    failing = false;
    await userEvent.click(
      within(section('The space General')).getByRole('button', { name: 'Try again' }),
    );
    await within(section('The space General')).findByText('Nothing is granted here.');
  });

  it("shows a level's Try again as reading while its re-read is in flight, disabled rather than pressable again", async () => {
    let attempt = 0;
    const resolvers: (() => void)[] = [];
    const { fetching } = service({
      override: {
        'GET /v1/grants': (_request, url) => {
          const level = url.searchParams.get('level')!;
          if (level !== `space:${GENERAL}`) return json(200, { items: [], next: null });
          attempt += 1;
          if (attempt === 1) return refused(500, 'internal', 'broken');
          return new Promise<Response>((resolve) => {
            resolvers.push(() => resolve(json(200, { items: [], next: null })));
          });
        },
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    const tryAgain = await within(section('The space General')).findByRole('button', {
      name: 'Try again',
    });

    await userEvent.click(tryAgain);
    await waitFor(() => expect(resolvers).toHaveLength(1));
    expect(
      within(section('The space General')).getByRole('button', { name: 'Reading...' }),
    ).toBeDisabled();
    // Only the one re-read this click asked for: nothing further went out while it was in flight.
    expect(attempt).toBe(2);

    resolvers[0]!();
    await within(section('The space General')).findByText('Nothing is granted here.');
  });

  it('shows a message, not a crash, when explaining answers a body this page does not expect', async () => {
    let bad: 'missing-permissions' | 'malformed-permission' = 'missing-permissions';
    const { fetching } = service({
      override: {
        'GET /v1/access/explain': () =>
          bad === 'missing-permissions'
            ? json(200, { principal: ALICE, target: `artifact:${COMPONENT}` })
            : json(200, {
                principal: ALICE,
                target: `artifact:${COMPONENT}`,
                permissions: [{ permission: 'edit' }],
              }),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    const explaining = section('What someone may do here');
    await userEvent.selectOptions(
      within(explaining).getByRole('combobox', { name: 'Whose access' }),
      ALICE,
    );
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));
    expect(await within(explaining).findByRole('status')).toHaveTextContent(
      'What they may do could not be shown. Try again.',
    );
    expect(within(explaining).queryByRole('table')).toBeNull();

    bad = 'malformed-permission';
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));
    expect(await within(explaining).findByRole('status')).toHaveTextContent(
      'What they may do could not be shown. Try again.',
    );
    expect(within(explaining).queryByRole('table')).toBeNull();
  });

  it('says the caller is signed out, or may no longer see, when asking what someone may do is refused', async () => {
    let status = 401;
    const { fetching } = service({
      override: {
        'GET /v1/access/explain': () =>
          refused(status, status === 401 ? 'unauthorized' : 'not_found'),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    const explaining = section('What someone may do here');
    await userEvent.selectOptions(
      within(explaining).getByRole('combobox', { name: 'Whose access' }),
      ALICE,
    );
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));
    expect(await within(explaining).findByRole('status')).toHaveTextContent(
      'You are signed out. Sign in again to see what they may do.',
    );

    status = 404;
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));
    expect(await within(explaining).findByRole('status')).toHaveTextContent(
      'You may no longer see what they may do.',
    );
  });

  it("keeps a change's status separate from an explanation's, so failing to explain does not erase a give's own result", async () => {
    const { fetching } = service({
      override: {
        'GET /v1/access/explain': () => refused(404, 'not_found'),
      },
    });
    panel(fetching);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Person' }), GRACE);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), AUTHOR);
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    await screen.findByText('Allowed Author to Grace on this component.');

    const explaining = section('What someone may do here');
    await userEvent.selectOptions(
      within(explaining).getByRole('combobox', { name: 'Whose access' }),
      ALICE,
    );
    await userEvent.click(within(explaining).getByRole('button', { name: 'Show' }));
    await within(explaining).findByRole('status');

    // The give's own result is still there, in its own status, not replaced by the explain refusal.
    expect(screen.getByText('Allowed Author to Grace on this component.')).toBeInTheDocument();
  });

  it('says there is nothing here for a component that is missing or unreadable', async () => {
    const { fetching } = service({
      override: { [`GET /v1/components/${COMPONENT}`]: () => refused(404, 'not_found') },
    });
    panel(fetching);
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });
});
