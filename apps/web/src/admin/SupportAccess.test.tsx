import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { SupportAccess } from './SupportAccess.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ADA = { id: 'p1', name: 'Ada' };
const DAY = 86_400_000;
const soon = new Date(Date.now() + 5 * DAY).toISOString();

const grant = (over: Record<string, unknown>) => ({
  id: 'g1',
  person: { id: 'p9', name: 'Sam', email: 'sam@vendor.example' },
  scope: 'content',
  spaces: ['s1'],
  purpose: 'Why the outline will not save',
  expiresAt: soon,
  grantedBy: ADA,
  grantedAt: '2026-11-01T09:00:00.000Z',
  revokedAt: null,
  revokedBy: null,
  revokedReason: null,
  active: true,
  ...over,
});

const GRANTS = [
  grant({}),
  grant({
    id: 'g2',
    person: { id: 'p8', name: null, email: 'cam@vendor.example' },
    scope: 'metadata',
    spaces: ['s2'],
    purpose: 'Slow search',
    revokedAt: '2026-10-20T09:00:00.000Z',
    revokedReason: 'cap_lowered',
    active: false,
  }),
  grant({
    id: 'g3',
    person: { id: 'p7', name: 'Dot', email: 'dot@vendor.example' },
    scope: 'diagnostics',
    spaces: [],
    purpose: 'Failing deliveries',
    revokedAt: '2026-10-10T09:00:00.000Z',
    revokedBy: ADA,
    revokedReason: 'revoked',
    active: false,
  }),
];

/** The support listing, the spaces, and granting and revoking, as the service answers them. */
function service(granting: (body: unknown) => Response = () => json(200, { support: grant({}) })) {
  const sent: { method: string; path: string; body?: unknown }[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (path === '/v1/spaces') {
      return json(200, {
        items: [
          { id: 's1', name: 'Clinical' },
          { id: 's2', name: 'Quality' },
        ],
        next: null,
      });
    }
    if (path === '/v1/support-access' && request.method === 'GET') {
      return json(200, { items: GRANTS, active: 1, defaultDays: 30, capDays: 90 });
    }
    if (path === '/v1/support-access') {
      const body = await request.json();
      sent.push({ method: 'POST', path, body });
      return granting(body);
    }
    if (request.method === 'DELETE') {
      sent.push({ method: 'DELETE', path });
      return json(200, grant({ active: false }));
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

const shown = (client: ReturnType<typeof createApiClient>, mayGrant = true) =>
  render(<SupportAccess client={client} mayGrant={mayGrant} generation={0} onChanged={() => {}} />);

describe("Administration's Support access", () => {
  it('ADM-042 lists every support grant, active and ended, with who, what, where, why, by whom, until when and how it ended', async () => {
    const { client } = service();
    shown(client);
    const table = await screen.findByRole('table', { name: 'Support access' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Sam');
    expect(rows[0]).toHaveTextContent('sam@vendor.example');
    expect(rows[0]).toHaveTextContent('Content');
    expect(await within(rows[0]!).findByText('Clinical')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent('Why the outline will not save');
    expect(rows[0]).toHaveTextContent('Ada');
    expect(rows[0]).toHaveTextContent('Active');
    expect(rows[1]).toHaveTextContent('cam@vendor.example');
    expect(rows[1]).toHaveTextContent('Titles and names');
    expect(rows[1]).toHaveTextContent('when the cap on access from outside was lowered');
    expect(rows[2]).toHaveTextContent('Diagnostics');
    expect(rows[2]).toHaveTextContent('Revoked by Ada');
    // Only an active grant can be revoked.
    expect(within(rows[1]!).queryByRole('button')).toBeNull();
  });

  it('ADM-042 gives support access with an address, a scope explained, its spaces, why and an end defaulting to the policy', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    shown(client);
    const form = await screen.findByRole('form', { name: 'Give support access' });
    // Each scope says what it lets them see.
    expect(within(form).getByRole('radio', { name: /Content/ })).toHaveAccessibleDescription(
      /asked before they open any/,
    );
    expect(
      within(form).getByRole('radio', { name: /Titles and names/ }),
    ).toHaveAccessibleDescription(/No text, comments, files or publications/);
    // The end the environment gives unless chosen otherwise, and no later than its cap.
    const ends = within(form).getByLabelText('Ends on') as HTMLInputElement;
    const day = (days: number) => {
      const at = new Date();
      const on = new Date(at.getFullYear(), at.getMonth(), at.getDate() + days);
      return `${on.getFullYear()}-${String(on.getMonth() + 1).padStart(2, '0')}-${String(on.getDate()).padStart(2, '0')}`;
    };
    expect(ends.value).toBe(day(30));
    expect(ends.max).toBe(day(90));

    await user.type(within(form).getByLabelText('Their address'), 'rex@vendor.example');
    await user.click(within(form).getByRole('radio', { name: /Titles and names/ }));
    await user.type(within(form).getByLabelText('Why they need it'), 'Broken numbering');
    await user.click(within(form).getByRole('button', { name: 'Give support access' }));
    // A metadata grant names a space, said before anything is sent.
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'Choose at least one space for support to look at.',
    );
    expect(sent).toEqual([]);

    await user.click(within(form).getByRole('checkbox', { name: 'Quality' }));
    await user.click(within(form).getByRole('button', { name: 'Give support access' }));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({
      email: 'rex@vendor.example',
      scope: 'metadata',
      spaces: ['s2'],
      purpose: 'Broken numbering',
    });
    const until = new Date((sent[0]!.body as { expiresAt: string }).expiresAt).getTime();
    expect(until).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(until).toBeLessThan(Date.now() + 30 * DAY);
    expect(await screen.findByRole('status')).toHaveTextContent(
      /rex@vendor\.example was given support access until/,
    );
  });

  it("says the service's refusal of a grant as a sentence", async () => {
    const user = userEvent.setup();
    const { client } = service(() =>
      json(409, { code: 'support_member', message: 'x', traceId: 't' }),
    );
    shown(client);
    const form = await screen.findByRole('form', { name: 'Give support access' });
    await user.type(within(form).getByLabelText('Their address'), 'grace@acme.example');
    await user.type(within(form).getByLabelText('Why they need it'), 'Testing');
    await user.click(within(form).getByRole('button', { name: 'Give support access' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'That address is somebody in the organisation. Support access is for somebody from outside.',
    );
  });

  it('revokes support access after saying what it ends, and offers neither to somebody without grant_support', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    const { unmount } = shown(client);
    await user.click(await screen.findByRole('button', { name: 'Revoke support access for Sam' }));
    const dialog = screen.getByRole('dialog', { name: 'Revoke support access for Sam?' });
    expect(dialog).toHaveTextContent(
      'Sam can no longer look at Content in Clinical, from now. Anything they have open stops, and an invitation it made ends.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(sent).toEqual([{ method: 'DELETE', path: '/v1/support-access/g1' }]);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Support access for Sam was revoked.',
    );
    unmount();

    shown(client, false);
    expect(await screen.findByRole('table', { name: 'Support access' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Give support access' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Revoke/ })).toBeNull();
  });
});
