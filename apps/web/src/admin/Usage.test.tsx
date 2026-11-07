import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Usage, type UsageView } from './Usage.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const MEASURES = [
  ['databaseBytes', 'sample', 'bytes'],
  ['publicationBytes', 'sample', 'bytes'],
  ['assetBytes', 'sample', 'bytes'],
  ['importBytes', 'sample', 'bytes'],
  ['exportBytes', 'sample', 'bytes'],
  ['publications', 'count', 'count'],
  ['assets', 'count', 'count'],
  ['mail', 'count', 'count'],
  ['webhooks', 'count', 'count'],
  ['translationJobs', 'count', 'count'],
  ['referenceSearches', 'count', 'count'],
  ['embeddingRuns', 'count', 'count'],
  ['queryMs', 'count', 'ms'],
] as const;

const view = (days: Partial<Record<string, { day: string; amount: number }[]>>): UsageView => ({
  from: '2025-10-08',
  to: '2026-11-06',
  measures: MEASURES.map(([measure, kind, unit]) => ({
    measure,
    kind,
    unit,
    days: days[measure] ?? [],
  })),
});

const counted = view({
  databaseBytes: [
    { day: '2026-10-31', amount: 40_000_000 },
    { day: '2026-11-06', amount: 52_000_000 },
  ],
  publications: [
    { day: '2025-11-03', amount: 2 },
    { day: '2026-10-02', amount: 4 },
    { day: '2026-10-20', amount: 3 },
    { day: '2026-11-05', amount: 5 },
  ],
  queryMs: [{ day: '2026-11-05', amount: 90_000 }],
});

function service(answer: UsageView) {
  const fetching = vi.fn(async () => json(200, answer)) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://admin.test', fetch: fetching });
}

describe("Administration's Usage (the DG plan, DGd2)", () => {
  it('ADM-033 presents each measure as a trend of 13 months, this month against the last and a year before', async () => {
    render(<Usage client={service(counted)} />);
    const table = await screen.findByRole('table', { name: 'Usage by month' });
    const publications = within(table).getByRole('row', { name: /Publications made/ });
    // This month so far, last month, the same month a year before.
    expect(
      within(publications)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([expect.anything(), '5', '7', '2']);
    expect(within(publications).getByRole('img', { name: /13 months/ })).toBeInTheDocument();
    // A sample is what was held at the month's last count, never a sum.
    const database = within(table).getByRole('row', { name: /Database/ });
    expect(within(database).getAllByRole('cell')[1]).toHaveTextContent('52 MB');
    expect(within(database).getAllByRole('cell')[2]).toHaveTextContent('40 MB');
    expect(within(table).getByRole('row', { name: /Query time/ })).toHaveTextContent('1.5 min');
  });

  it('ADM-033 shows one measure by month or by day, newest first', async () => {
    const user = userEvent.setup();
    render(<Usage client={service(counted)} />);
    await screen.findByRole('table', { name: 'Usage by month' });
    await user.selectOptions(screen.getByLabelText('Measure'), 'Publications made');
    const byMonth = screen.getByRole('table', { name: 'Publications made by month' });
    expect(within(byMonth).getAllByRole('row')).toHaveLength(14);
    await user.click(screen.getByRole('radio', { name: 'By day' }));
    const byDay = screen.getByRole('table', { name: 'Publications made by day' });
    const rows = within(byDay).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('5');
    expect(rows).toHaveLength(4);
  });

  it('says so when nothing has been counted yet', async () => {
    render(<Usage client={service(view({}))} />);
    expect(
      await screen.findByText('Nothing has been counted yet. Usage is counted each night.'),
    ).toBeInTheDocument();
  });
});
