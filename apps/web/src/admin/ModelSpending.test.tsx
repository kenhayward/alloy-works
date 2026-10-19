import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ModelSpending } from './ModelSpending.js';

const GRACE = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const IVY = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  const sent: { method: string; path: string; body: unknown }[] = [];
  let limits = {
    perHour: 20 as number | null,
    people: [{ person: { id: GRACE, name: 'Grace Hopper' }, perHour: 60 }],
  };
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (path === '/v1/model-limits' && request.method === 'GET') return json(200, limits);
    if (request.method === 'PUT') {
      const body = (await request.json()) as { perHour: number | null };
      sent.push({ method: 'PUT', path, body });
      if (path === '/v1/model-limits') limits = { ...limits, perHour: body.perHour };
      else if (body.perHour === null) {
        limits = {
          ...limits,
          people: limits.people.filter((each) => !path.endsWith(each.person.id)),
        };
      } else {
        limits = {
          ...limits,
          people: [
            { person: { id: IVY, name: 'Ivy Lane' }, perHour: body.perHour },
            ...limits.people,
          ],
        };
      }
      return json(200, limits);
    }
    if (path === '/v1/principals') {
      return json(200, {
        items: [
          {
            id: GRACE,
            name: 'Grace Hopper',
            email: 'grace@example.test',
            kind: 'user',
            invited: false,
          },
          { id: IVY, name: 'Ivy Lane', email: 'ivy@example.test', kind: 'user', invited: false },
        ],
        next: null,
      });
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

describe("Administration's Model spending", () => {
  it("GEN-035 sets the environment's runs an hour, a person's own in place of it, and removes one", async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<ModelSpending client={client} />);
    const limits = await screen.findByRole('region', { name: 'Rate limits' });
    const each = within(limits).getByRole('spinbutton', { name: 'Runs an hour per person' });
    expect(each).toHaveValue(20);
    await user.clear(each);
    await user.type(each, '30');
    await user.click(within(limits).getByRole('button', { name: 'Save limit' }));
    expect(sent).toContainEqual({ method: 'PUT', path: '/v1/model-limits', body: { perHour: 30 } });

    const table = within(limits).getByRole('table', { name: 'People with their own limit' });
    expect(within(table).getByText('Grace Hopper')).toBeInTheDocument();
    await user.selectOptions(within(limits).getByRole('combobox', { name: 'Person' }), 'Ivy Lane');
    await user.type(within(limits).getByRole('spinbutton', { name: 'Their runs an hour' }), '5');
    await user.click(within(limits).getByRole('button', { name: 'Set theirs' }));
    expect(sent).toContainEqual({
      method: 'PUT',
      path: `/v1/model-limits/people/${IVY}`,
      body: { perHour: 5 },
    });
    expect(await within(table).findByText('Ivy Lane')).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: 'Remove Grace Hopper' }));
    expect(sent).toContainEqual({
      method: 'PUT',
      path: `/v1/model-limits/people/${GRACE}`,
      body: { perHour: null },
    });
  });
});
