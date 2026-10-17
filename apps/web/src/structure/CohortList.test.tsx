import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CohortList } from './CohortList.js';

const TEMPLATE = 'tttttttt-0000-4000-8000-000000000001';
const cohort = (id: string, title: string, rows: { made: number; failed: number; pending: number }) => ({
  id,
  title,
  template: { id: TEMPLATE, version: 'tttttttt-0000-4000-8000-0000000000a1', name: 'Site report' },
  space: { id: 'ssssssss-0000-4000-8000-000000000001', name: 'General' },
  requestedAt: '2026-10-17T09:00:00.000Z',
  rows,
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  const asked: string[] = [];
  const fetching = vi.fn(async (input: Request) => {
    const url = new URL(input.url);
    asked.push(`${url.pathname}${url.search}`);
    const state = url.searchParams.get('state');
    const all = [
      cohort('cccccccc-0000-4000-8000-000000000002', 'Board {name}', { made: 1, failed: 1, pending: 0 }),
      cohort('cccccccc-0000-4000-8000-000000000001', 'Annual {name}', { made: 2, failed: 0, pending: 0 }),
    ];
    const shown =
      state === 'failed' ? all.filter((each) => each.rows.failed > 0) : all;
    return json(200, { items: shown, next: null });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }), asked };
}

describe('the cohorts listing (the R14 plan, R14-A)', () => {
  it('SCH-065 TPL-040 lists cohorts with how their rows stand, each opening its page, sorted and filtered as asked', async () => {
    const { client, asked } = service();
    render(<CohortList client={client} />);
    const table = await screen.findByRole('table', { name: 'Cohorts' });
    const board = within(table).getByRole('link', { name: 'Board {name}' });
    expect(board).toHaveAttribute('href', '#/cohorts/cccccccc-0000-4000-8000-000000000002');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(
      'Board {name}Site reportGeneral1 made, 1 failed',
    );
    expect(within(table).getAllByRole('row')[2]).toHaveTextContent('2 made');

    await userEvent.selectOptions(screen.getByLabelText('Show'), 'failed');
    await waitFor(() => expect(asked.at(-1)).toContain('state=failed'));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));

    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'title');
    await waitFor(() => expect(asked.at(-1)).toContain('sort=title'));
  });
});
