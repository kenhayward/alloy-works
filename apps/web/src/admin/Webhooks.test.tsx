import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Webhooks } from './Webhooks.js';

const HOOK = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const ROBOT = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const DELIVERY = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f';
const SECRET = `whsec_${'A'.repeat(43)}=`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service(disabled = false) {
  const sent: { method: string; path: string; body?: unknown }[] = [];
  let hooks = [
    {
      id: HOOK,
      serviceIdentity: ROBOT,
      url: 'https://receiver.example.test/hooks',
      description: 'Publishing feed',
      eventTypes: ['publication.produced'],
      createdBy: null,
      createdAt: '2026-10-21T09:00:00.000Z',
      disabledAt: disabled ? '2026-10-24T09:00:00.000Z' : null,
      disabledReason: disabled ? 'failing' : null,
      lastSuccessAt: null,
    },
  ] as {
    id: string;
    serviceIdentity: string;
    url: string;
    description: string;
    eventTypes: string[];
    createdBy: null;
    createdAt: string;
    disabledAt: string | null;
    disabledReason: string | null;
    lastSuccessAt: null;
  }[];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    const route = `${request.method} ${path}`;
    if (request.method !== 'GET') {
      const text = await request.text();
      sent.push({ method: request.method, path, ...(text ? { body: JSON.parse(text) } : {}) });
    }
    if (route === 'GET /v1/webhooks') return json(200, { items: hooks, next: null });
    if (route === 'GET /v1/service-identities') {
      return json(200, {
        items: [{ id: ROBOT, name: 'Receiver', disabledAt: null }],
        next: null,
      });
    }
    if (route === 'POST /v1/webhooks') {
      const body = sent.at(-1)!.body as Record<string, unknown>;
      const made = { ...hooks[0]!, id: 'h2', ...body };
      hooks = [...hooks, made as (typeof hooks)[number]];
      return json(200, { webhook: made, secret: SECRET });
    }
    if (route === `GET /v1/webhooks/${HOOK}/deliveries`) {
      return json(200, {
        items: [
          {
            id: DELIVERY,
            type: 'publication.produced',
            sequence: 'audit:7',
            state: 'given_up',
            attempts: 2,
            nextAt: null,
            createdAt: '2026-10-21T09:30:00.000Z',
          },
        ],
        next: null,
      });
    }
    if (route === `GET /v1/webhooks/${HOOK}/deliveries/${DELIVERY}`) {
      return json(200, {
        id: DELIVERY,
        type: 'publication.produced',
        sequence: 'audit:7',
        state: 'given_up',
        attempts: 2,
        nextAt: null,
        createdAt: '2026-10-21T09:30:00.000Z',
        payload: { type: 'publication.produced', id: DELIVERY },
        tried: [
          {
            at: '2026-10-21T09:30:01.000Z',
            status: 503,
            latencyMs: 40,
            failure: null,
            reply: 'Down',
          },
          {
            at: '2026-10-21T09:31:01.000Z',
            status: null,
            latencyMs: 10000,
            failure: 'timeout',
            reply: null,
          },
        ],
      });
    }
    if (route === `PATCH /v1/webhooks/${HOOK}`) {
      hooks = hooks.map((each) => ({ ...each, disabledAt: null, disabledReason: null }));
      return json(200, { webhook: hooks[0] });
    }
    if (route === `DELETE /v1/webhooks/${HOOK}`) {
      hooks = hooks.filter((each) => each.id !== HOOK);
      return json(200, { removed: HOOK });
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

describe("Administration's Webhooks (the WB plan, WB-J)", () => {
  it('makes a webhook for a service identity, showing its signing secret once', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Webhooks client={client} />);
    const table = await screen.findByRole('table', { name: 'Webhooks' });
    expect(within(table).getByText('https://receiver.example.test/hooks')).toBeInTheDocument();
    expect(within(table).getByText('Receiver')).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'New webhook' });
    expect(within(form).getByRole('button', { name: 'Make' })).toBeDisabled();
    await user.selectOptions(
      within(form).getByRole('combobox', { name: 'Service identity' }),
      'Receiver',
    );
    await user.type(
      within(form).getByRole('textbox', { name: 'HTTPS URL' }),
      'https://other.example.test',
    );
    await user.click(within(form).getByRole('checkbox', { name: 'content.version_cut' }));
    await user.click(within(form).getByRole('button', { name: 'Make' }));
    expect(sent).toEqual([
      {
        method: 'POST',
        path: '/v1/webhooks',
        body: {
          serviceIdentity: ROBOT,
          url: 'https://other.example.test',
          description: '',
          eventTypes: ['content.version_cut'],
        },
      },
    ]);
    const shown = await screen.findByRole('dialog', { name: 'Copy the signing secret' });
    expect(within(shown).getByRole('textbox', { name: 'Signing secret' })).toHaveValue(SECRET);
    await user.click(within(shown).getByRole('button', { name: 'Done' }));
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
  });

  it("API-029 shows a delivery's every attempt: what came back, or why nothing did", async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<Webhooks client={client} />);
    await user.click(
      await screen.findByRole('button', {
        name: 'Deliveries to https://receiver.example.test/hooks',
      }),
    );
    const deliveries = await screen.findByRole('table', {
      name: 'Deliveries to https://receiver.example.test/hooks',
    });
    expect(within(deliveries).getByText('Given up')).toBeInTheDocument();
    await user.click(within(deliveries).getByRole('button', { name: /^What was sent for/ }));
    const attempts = await screen.findByRole('list', { name: 'Attempts' });
    expect(attempts).toHaveTextContent('answered 503');
    expect(attempts).toHaveTextContent('Down');
    expect(attempts).toHaveTextContent('no answer (timeout)');
  });

  it('removes a webhook only after asking', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Webhooks client={client} />);
    await user.click(
      await screen.findByRole('button', { name: 'Remove https://receiver.example.test/hooks' }),
    );
    const asking = screen.getByRole('dialog', {
      name: 'Remove the webhook to https://receiver.example.test/hooks?',
    });
    await user.click(within(asking).getByRole('button', { name: 'Keep it' }));
    expect(sent).toEqual([]);
    await user.click(
      screen.getByRole('button', { name: 'Remove https://receiver.example.test/hooks' }),
    );
    await user.click(
      within(
        screen.getByRole('dialog', {
          name: 'Remove the webhook to https://receiver.example.test/hooks?',
        }),
      ).getByRole('button', { name: 'Remove' }),
    );
    expect(
      await screen.findByText('Removed the webhook to https://receiver.example.test/hooks.'),
    ).toBeInTheDocument();
    expect(sent.map((each) => `${each.method} ${each.path}`)).toEqual([
      `DELETE /v1/webhooks/${HOOK}`,
    ]);
  });

  it('turns on a webhook turned off for failing', async () => {
    const user = userEvent.setup();
    const { client, sent } = service(true);
    render(<Webhooks client={client} />);
    const table = await screen.findByRole('table', { name: 'Webhooks' });
    expect(within(table).getByText('Off: failing')).toBeInTheDocument();
    await user.click(
      within(table).getByRole('button', { name: 'Turn on https://receiver.example.test/hooks' }),
    );
    expect(sent).toEqual([
      { method: 'PATCH', path: `/v1/webhooks/${HOOK}`, body: { enabled: true } },
    ]);
    expect(await within(table).findByText('Active')).toBeInTheDocument();
  });
});
