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
  let budget = {
    budget: null as { currency: string; limit: number; thresholds: number[] } | null,
    month: '2026-10',
    spent: '42.500000',
    otherCurrencyRuns: 0,
    recipients: [] as { id: string; name: string }[],
    whenSpent: 'everything_continues',
  };
  let limits = {
    perHour: 20 as number | null,
    people: [{ person: { id: GRACE, name: 'Grace Hopper' }, perHour: 60 }],
  };
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (path === '/v1/model-limits' && request.method === 'GET') return json(200, limits);
    if (path === '/v1/model-usage') {
      return json(200, {
        months: ['2026-09', '2026-10'],
        models: [
          {
            month: '2026-09',
            purpose: 'chat',
            runs: 40,
            tokensIn: 120000,
            tokensOut: 9000,
            tokensCached: 80000,
            costs: [{ currency: 'USD', cost: '0.531000' }],
          },
          {
            month: '2026-10',
            purpose: 'drafting',
            runs: 12,
            tokensIn: 30000,
            tokensOut: 2000,
            tokensCached: 0,
            costs: [{ currency: 'USD', cost: '0.120000' }],
          },
        ],
        queries: [{ month: '2026-10', runs: 5, rows: 1200, bytes: 48000 }],
      });
    }
    if (path.startsWith('/v1/model-budget')) {
      if (request.method === 'PUT') {
        const body = (await request.json()) as Record<string, unknown>;
        sent.push({ method: 'PUT', path, body });
        if (path === '/v1/model-budget') budget = { ...budget, budget: body.budget as never };
        else {
          budget = {
            ...budget,
            recipients: (body.principals as string[]).map((id) => ({
              id,
              name: id === IVY ? 'Ivy Lane' : 'Grace Hopper',
            })),
          };
        }
      }
      return json(200, budget);
    }
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
  it('shows model use by month and purpose, the oldest first, with what came from the cache, and query runs by month', async () => {
    const { client } = service();
    render(<ModelSpending client={client} />);
    const months = await screen.findByRole('region', { name: 'Twelve months' });
    const table = await within(months).findByRole('table', { name: 'Model use by month' });
    expect(
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) =>
          within(row)
            .getAllByRole('cell')
            .map((cell) => cell.textContent),
        ),
    ).toEqual([
      ['2026-09', 'Conversations', '40', '120,000', '80,000', '9,000', 'USD 0.53'],
      ['2026-10', 'Drafting', '12', '30,000', '0', '2,000', 'USD 0.12'],
    ]);
    expect(within(months).getByRole('table', { name: 'Query runs by month' })).toHaveTextContent(
      '1,200',
    );
  });

  it('GEN-034 ADM-013 ADM-014 sets a monthly budget with alerts before it, declares that nothing stops when it is spent, and names who is told', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<ModelSpending client={client} />);
    const section = await screen.findByRole('region', { name: 'Budget' });
    expect(
      within(section).getByText('When it is spent, nothing stops: every capability continues.'),
    ).toBeInTheDocument();
    expect(
      await within(section).findByText('No budget is set. USD 42.50 spent in 2026-10.'),
    ).toBeInTheDocument();
    await user.type(within(section).getByRole('spinbutton', { name: 'Monthly limit' }), '500');
    const percents = within(section).getByRole('textbox', { name: 'Alert at percents' });
    await user.clear(percents);
    await user.type(percents, '80, 100');
    await user.click(within(section).getByRole('button', { name: 'Save budget' }));
    expect(sent).toContainEqual({
      method: 'PUT',
      path: '/v1/model-budget',
      body: { budget: { currency: 'USD', limit: 500, thresholds: [80, 100] } },
    });
    expect(
      await within(section).findByText('USD 42.50 of USD 500.00 spent in 2026-10.'),
    ).toBeInTheDocument();

    await user.click(await within(section).findByRole('checkbox', { name: 'Ivy Lane' }));
    await user.click(within(section).getByRole('button', { name: 'Save who is told' }));
    expect(sent).toContainEqual({
      method: 'PUT',
      path: '/v1/model-budget/recipients',
      body: { principals: [IVY] },
    });
    expect(await within(section).findByText('1 person is told.')).toBeInTheDocument();
  });

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
    // Nought is no limit lifted: only an empty box lifts it.
    const sending = sent.length;
    await user.clear(each);
    await user.type(each, '0');
    await user.click(within(limits).getByRole('button', { name: 'Save limit' }));
    expect(sent).toHaveLength(sending);
    expect(
      within(limits).getByText(
        'A limit is a whole number of runs, 1 or more. Leave it empty for none.',
      ),
    ).toBeInTheDocument();

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
