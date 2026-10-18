import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Guardrails } from './Guardrails.js';

const RULE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service(refuse = false) {
  const sent: unknown[] = [];
  let rules = [
    {
      id: RULE,
      phrase: 'Project Osprey',
      applies: 'both',
      reason: 'An unannounced project',
      madeAt: '2026-10-18T09:00:00.000Z',
      retiredAt: null,
    },
  ];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (refuse) return json(403, { code: 'forbidden', message: 'This needs administer.' });
    if (request.method === 'GET' && path === '/v1/guardrails') return json(200, { items: rules });
    if (request.method === 'POST' && path === '/v1/guardrails') {
      const body = (await request.json()) as Record<string, string>;
      sent.push(body);
      const made = { id: 'r2', ...body, madeAt: '2026-10-18T10:00:00.000Z', retiredAt: null };
      rules = [made as (typeof rules)[number], ...rules];
      return json(200, made);
    }
    if (path === `/v1/guardrails/${RULE}/retirement`) {
      rules = rules.filter((each) => each.id !== RULE);
      return json(200, { id: RULE });
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

describe("Administration's Guardrails", () => {
  it('GEN-049 lists the phrases the environment forbids, adds one and retires one', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Guardrails client={client} />);
    const table = await screen.findByRole('table', { name: 'Guardrails' });
    expect(within(table).getByText('Project Osprey')).toBeInTheDocument();
    expect(within(table).getByText('An unannounced project')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Phrase' }), 'Project Kestrel');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Watches' }), 'What is sent');
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Not yet public');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(sent).toEqual([
      { phrase: 'Project Kestrel', applies: 'sent', reason: 'Not yet public' },
    ]);
    expect(
      await screen.findByText('"Project Kestrel" is forbidden from the next call.'),
    ).toBeVisible();

    await user.click(await screen.findByRole('button', { name: 'Retire Project Osprey' }));
    expect(
      await screen.findByText('"Project Osprey" is retired. It refuses nothing now.'),
    ).toBeVisible();
  });

  it('says so to somebody who does not administer the environment', async () => {
    const { client } = service(true);
    render(<Guardrails client={client} />);
    expect(await screen.findByText('You may not manage access here.')).toBeInTheDocument();
  });
});
