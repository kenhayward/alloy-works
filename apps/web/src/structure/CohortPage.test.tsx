import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CohortPage } from './CohortPage.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const COHORT = '00000000-0000-4000-8000-0000000000f3';
const LEEDS = '00000000-0000-4000-8000-0000000000f4';
const YORK = '00000000-0000-4000-8000-0000000000f5';

const row = (n: number, site: string, state: string, document: string | null = null) => ({
  row: n,
  parameters: { site },
  state,
  document,
  failure:
    state === 'failed'
      ? { code: 'parameter.invalid', message: 'A value it gives does not fit its parameter.' }
      : null,
  attempts: state === 'pending' ? 0 : 1,
});
const cohort = (rows: unknown[]) => ({
  id: COHORT,
  space: '00000000-0000-4000-8000-0000000000f1',
  template: {
    id: '00000000-0000-4000-8000-0000000000f2',
    version: '00000000-0000-4000-8000-0000000000f6',
  },
  title: 'Site {site}',
  source: { rows: rows.length },
  requestedAt: '2026-10-16T09:00:00.000Z',
  rows,
});

function service(answers: unknown[], rerun?: unknown) {
  const asked: { method: string; path: string; body?: unknown }[] = [];
  let next = 0;
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = request.method === 'GET' ? '' : await request.text();
    asked.push({
      method: request.method,
      path: url.pathname,
      ...(text === '' ? {} : { body: JSON.parse(text) as unknown }),
    });
    if (request.method === 'POST') return json(200, rerun);
    const answer = answers[Math.min(next, answers.length - 1)];
    next += 1;
    return json(200, answer);
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://cohorts.test', fetch: fetching }), asked };
}

describe("a cohort's page (the R7 plan, R7-E to R7-G)", () => {
  it('REU-033 follows the rows as they are made, linking each document and saying why a row failed', async () => {
    const { client } = service([
      cohort([
        row(1, 'Leeds', 'made', LEEDS),
        row(2, 'Bath', 'pending'),
        row(3, 'York', 'pending'),
      ]),
      cohort([
        row(1, 'Leeds', 'made', LEEDS),
        row(2, 'Bath', 'failed'),
        row(3, 'York', 'made', YORK),
      ]),
    ]);
    render(<CohortPage client={client} id={COHORT} pollMs={10} />);
    expect(await screen.findByText('1 of 3 made. Still making the rest.')).toBeInTheDocument();
    expect(await screen.findByText('2 of 3 made, 1 failed.')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: 'Open the document' });
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `#/documents/${LEEDS}`,
      `#/documents/${YORK}`,
    ]);
    expect(screen.getByText('A value it gives does not fit its parameter.')).toBeInTheDocument();
  });

  it('REU-035 runs the failed rows again with their parameters corrected, and no other', async () => {
    const failed = cohort([row(1, 'Leeds', 'made', LEEDS), row(2, 'Bath', 'failed')]);
    const { client, asked } = service([failed], {
      cohort: cohort([row(1, 'Leeds', 'made', LEEDS), row(2, 'Hull', 'pending')]),
      job: {},
    });
    render(<CohortPage client={client} id={COHORT} pollMs={60_000} />);
    const table = await screen.findByRole('table');
    const field = within(table).getByRole('textbox', { name: 'site' });
    await userEvent.clear(field);
    await userEvent.type(field, 'Hull');
    await userEvent.click(screen.getByRole('button', { name: 'Run the failed again' }));
    await waitFor(() =>
      expect(asked.find((each) => each.method === 'POST')).toEqual({
        method: 'POST',
        path: `/v1/cohorts/${COHORT}/rerun`,
        body: { corrections: { '2': { site: 'Hull' } } },
      }),
    );
    expect(await screen.findByText('1 of 2 made. Still making the rest.')).toBeInTheDocument();
  });
});
