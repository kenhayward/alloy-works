import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { needsAttention, type DiagnosticsView } from './Diagnostics.js';
import { Secrets } from './Secrets.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SECRETS = {
  items: [
    {
      kind: 'model_endpoint_key',
      of: { id: 'e1', name: 'Drafting' },
      replacedAt: '2026-11-01T09:00:00.000Z',
      previousUntil: null,
      replacement: {
        operation: 'setModelEndpointKey',
        permission: 'rotate_secrets',
        how: 'atomic',
      },
      consumers: [
        { kind: 'purpose', id: 'drafting', name: 'drafting' },
        { kind: 'guardrails', id: null, name: null },
      ],
    },
    {
      kind: 'scim_token',
      of: { id: 'i1', name: 'Entra' },
      replacedAt: '2026-11-06T09:00:00.000Z',
      previousUntil: '2026-11-07T09:00:00.000Z',
      replacement: { operation: 'issueScimToken', permission: 'rotate_secrets', how: 'overlap' },
      consumers: [{ kind: 'provisioning', id: 'i1', name: 'Entra' }],
    },
    {
      kind: 'connection_credential',
      of: { id: 'c1', name: 'Warehouse' },
      replacedAt: null,
      previousUntil: null,
      replacement: {
        operation: 'setConnectionCredential',
        permission: 'rotate_secrets',
        how: 'atomic',
      },
      consumers: [],
    },
  ],
  absent: [{ what: 'Scanning services', why: 'None exists' }],
};

/** The service as Secrets meets it: whether the reader may replace secrets, and the listing. */
function service(rotates: boolean) {
  const asked: string[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(url.pathname);
    if (url.pathname === '/v1/access') {
      return json(200, {
        target: url.searchParams.get('target'),
        permissions: [
          { permission: 'read', allowed: true },
          { permission: 'rotate_secrets', allowed: rotates },
        ],
      });
    }
    if (url.pathname === '/v1/secrets') return json(200, SECRETS);
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), asked };
}

describe("Administration's Secrets", () => {
  it('ADM-047 lists every secret with everything that uses it, when last replaced, an old value still accepted and where it is replaced', async () => {
    const { client } = service(true);
    render(<Secrets client={client} />);
    const table = await screen.findByRole('table', { name: 'Secrets' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Drafting');
    expect(rows[0]).toHaveTextContent('Model endpoint key');
    expect(rows[0]).toHaveTextContent('Model purpose: drafting');
    expect(rows[0]).toHaveTextContent('Guardrails, on every call');
    expect(
      within(rows[0]!).getByRole('link', { name: 'Replace the secret of Drafting' }),
    ).toHaveAttribute('href', '#/admin/models');
    expect(rows[1]).toHaveTextContent('SCIM token');
    expect(rows[1]).toHaveTextContent('Provisioning: Entra');
    expect(rows[1]).toHaveTextContent('The old value works until');
    expect(within(rows[1]!).getByRole('link')).toHaveAttribute('href', '#/admin/sign-in');
    expect(rows[2]).toHaveTextContent('Nothing uses it now');
    expect(rows[2]).toHaveTextContent('Not recorded');
    expect(within(rows[2]!).getByRole('link')).toHaveAttribute(
      'href',
      '#/connections/c1/credential',
    );
    expect(screen.getByText(/No scanning service exists yet/)).toBeInTheDocument();
  });

  it('asks the service first, and sends one without rotate_secrets nothing more', async () => {
    const { client, asked } = service(false);
    render(<Secrets client={client} />);
    expect(
      await screen.findByText('You need permission to replace secrets to see them here.'),
    ).toBeInTheDocument();
    expect(asked).not.toContain('/v1/secrets');
  });

  it('ADM-047 says in Needs attention which secret a consumer failed with since its replacement, naming every consumer', () => {
    const view = {
      capabilities: [],
      work: [],
      jobs: [],
      webhooks: { subscriptions: 0, failing: 0, disabledFailing: 0 },
      mail: { enabled: false, failingSince: null, waiting: 0, givenUp: 0 },
      connections: [],
      index: { waitingSeconds: null },
      integrity: { periodDays: 28, classes: [] },
      secrets: [
        { kind: 'model_endpoint_key', name: 'Drafting', consumers: ['drafting', 'translate'] },
      ],
    } as unknown as DiagnosticsView;
    expect(needsAttention(view)).toEqual([
      'The secret of Drafting (Model endpoint key) was replaced, and something using it has failed to authenticate since. It is used by drafting and translate.',
    ]);
  });
});
