import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Licences } from './Licences.js';

const CC_BY = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ccBy = {
  schemaVersion: 1,
  id: CC_BY,
  name: 'CC BY 4.0',
  key: 'cc_by_4',
  base: 'en',
  names: [{ language: 'en', text: 'CC BY 4.0' }],
  permits: ['internal', 'publication', 'redistribution', 'modification'],
  attribution: { required: true, wording: 'Photograph by Ada' },
};

function service(refuse = false) {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  let licences = [{ id: CC_BY, version: { id: 'v1', number: '0.1' }, licence: ccBy }];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/v1/licences') return json(200, { items: licences });
    if (refuse) return json(403, { code: 'forbidden', message: 'This needs manage definitions.' });
    if (request.method === 'POST') {
      const body = (await request.json()) as Record<string, unknown>;
      sent.push({ path, body });
      const definition = body['definition'] as Record<string, unknown>;
      if (path === '/v1/definitions') {
        const made = { id: 'l2', version: { id: 'v2', number: '0.1' } };
        licences = [...licences, { ...made, licence: { ...definition, id: 'l2' } as typeof ccBy }];
        return json(200, { ...made, kind: 'licence', definition });
      }
      licences = [{ ...licences[0]!, licence: { ...(definition as typeof ccBy), id: CC_BY } }];
      return json(200, { id: CC_BY, version: { id: 'v3', number: '0.2' }, definition });
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

describe("Administration's Licences (the AL plan, AL-B)", () => {
  it('AST-022 lists what each licence permits and the credit it needs, and adds one', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Licences client={client} />);
    const table = await screen.findByRole('table', { name: 'Licences' });
    const row = within(table).getByRole('row', { name: /CC BY 4\.0/ });
    expect(
      within(row).getByText('Internal use, Publication, Redistribution, Modification'),
    ).toBeInTheDocument();
    expect(within(row).getByText('Photograph by Ada')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Stock, editorial');
    await user.type(screen.getByRole('textbox', { name: 'Key' }), 'stock_editorial');
    await user.click(screen.getByRole('checkbox', { name: 'Internal use' }));
    await user.click(screen.getByRole('checkbox', { name: 'Publication' }));
    await user.click(screen.getByRole('checkbox', { name: 'Requires attribution' }));
    await user.type(screen.getByRole('textbox', { name: 'Attribution' }), 'Photograph: Grace');
    await user.click(screen.getByRole('button', { name: 'Add licence' }));
    expect(sent).toEqual([
      {
        path: '/v1/definitions',
        body: {
          kind: 'licence',
          definition: {
            schemaVersion: 1,
            name: 'Stock, editorial',
            key: 'stock_editorial',
            base: 'en',
            names: [{ language: 'en', text: 'Stock, editorial' }],
            permits: ['internal', 'publication'],
            attribution: { required: true, wording: 'Photograph: Grace' },
          },
        },
      },
    ]);
    expect(await screen.findByText('Stock, editorial is added.')).toBeVisible();
  });

  it('AST-022 changes what a licence permits as a new version, its key kept', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<Licences client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Edit CC BY 4.0' }));
    expect(screen.getByRole('textbox', { name: 'Key' })).toHaveAttribute('readonly');
    await user.click(screen.getByRole('checkbox', { name: 'Redistribution' }));
    await user.click(screen.getByRole('button', { name: 'Save licence' }));
    expect(sent).toEqual([
      {
        path: `/v1/definitions/${CC_BY}/versions`,
        body: {
          openedFrom: 'v1',
          definition: {
            ...Object.fromEntries(Object.entries(ccBy).filter(([key]) => key !== 'id')),
            permits: ['internal', 'publication', 'modification'],
          },
        },
      },
    ]);
    expect(await screen.findByText('CC BY 4.0 is saved at 0.2.')).toBeVisible();
  });

  it('says so to somebody who may not manage definitions', async () => {
    const user = userEvent.setup();
    const { client } = service(true);
    render(<Licences client={client} />);
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), 'Stock');
    await user.type(screen.getByRole('textbox', { name: 'Key' }), 'stock');
    await user.click(screen.getByRole('button', { name: 'Add licence' }));
    expect(await screen.findByText('This needs manage definitions.')).toBeVisible();
  });
});
