import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Diagnostics, needsAttention, type DiagnosticsView } from './Diagnostics.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const AT = '2026-11-06T12:00:00.000Z';

const calm: DiagnosticsView = {
  at: AT,
  capabilities: [],
  work: [],
  jobs: [],
  index: { serving: 'nomic-embed', pending: null, p95LagSeconds: 4, maxLagSeconds: 9 },
  webhooks: { subscriptions: 2, failing: 0, disabledFailing: 0 },
  mail: { enabled: true, failingSince: null, waiting: 0, givenUp: 0 },
  connections: [],
  performance: [],
  budgets: { model: null, queryRunsAtOnce: 4 },
};

const held = {
  owner: 'docs/design/search.md',
  reference: 'A generated tenant of a million components',
  percentile: 0.95,
  withinMs: 250,
  neverAboveMs: 500,
  provisional: true,
  confirmedBy: 'T7',
};

const measured: DiagnosticsView['performance'] = [
  {
    ...held,
    budget: 'SCH-033',
    requirement: 'SCH-033',
    measuredAs: 'request',
    capability: 'Searches',
    verdict: 'missed',
    atMs: 500,
    largestMs: 1000,
    why: null,
  },
  {
    ...held,
    budget: 'STR-063',
    requirement: 'STR-063',
    measuredAs: 'request',
    capability: 'Document structure',
    verdict: 'met',
    atMs: 100,
    largestMs: 250,
    why: null,
  },
  {
    ...held,
    budget: 'API-036',
    requirement: 'API-036',
    neverAboveMs: 1000,
    measuredAs: 'unmeasured',
    capability: null,
    verdict: 'unmeasured',
    atMs: null,
    largestMs: null,
    why: 'A viewer does not acknowledge a change it is sent.',
  },
];

const troubled: DiagnosticsView = {
  ...calm,
  capabilities: [
    { capability: 'Components', health: 'healthy', requests: 120, errorRate: 0, p95Ms: 100 },
    { capability: 'Indexing', health: 'failing', requests: 10, errorRate: 0.8, p95Ms: 2500 },
  ],
  work: [
    {
      work: 'sendMail',
      health: 'failing',
      outcome: 'failed',
      lastStartedAt: AT,
      lastFinishedAt: AT,
      nextDueAt: null,
      failure: 'connection_refused',
      failedAt: AT,
      failures: 3,
    },
  ],
  jobs: [
    {
      kind: 'publish',
      capability: 'Publishing work',
      state: 'failed',
      jobs: 2,
      firstAt: AT,
      lastAt: AT,
      lastError: 'typst_failed',
    },
  ],
  webhooks: { subscriptions: 2, failing: 1, disabledFailing: 1 },
  mail: { enabled: true, failingSince: AT, waiting: 5, givenUp: 1 },
  connections: [
    {
      connection: 'c1',
      name: 'Site readings',
      runs: 4,
      failed: 2,
      timedOut: 2,
      lastRunAt: AT,
      down: true,
      lastFailure: 'timeout',
    },
  ],
  budgets: {
    model: { currency: 'GBP', spentMicros: '12500000', limitMicros: '50000000' },
    queryRunsAtOnce: 4,
  },
};

function service(view: DiagnosticsView) {
  const fetching = vi.fn(async () => json(200, view)) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://admin.test', fetch: fetching });
}

describe("Administration's Diagnostics (the DG plan, DG-H)", () => {
  it('ADM-036 shows health per capability, the search index, webhook delivery, recent background work and the budgets', async () => {
    render(<Diagnostics client={service(troubled)} />);
    const health = await screen.findByRole('table', { name: 'Health by capability' });
    const indexing = within(health).getByRole('row', { name: /Indexing/ });
    // In icon and words, never colour alone.
    expect(indexing).toHaveTextContent('Failing');
    expect(indexing).toHaveTextContent('80%');
    expect(indexing.querySelector('svg[data-icon]')).not.toBeNull();
    expect(within(health).getByRole('row', { name: /Components/ })).toHaveTextContent('Healthy');
    expect(screen.getByRole('region', { name: 'Search index' })).toHaveTextContent('nomic-embed');
    expect(screen.getByRole('region', { name: 'Deliveries' })).toHaveTextContent(
      '1 of 2 webhooks failing',
    );
    const work = screen.getByRole('table', { name: 'Background work' });
    // Each kind of work by a name an administrator reads, never the code's.
    expect(within(work).getByRole('row', { name: /Mail sending/ })).toHaveTextContent(
      'connection_refused',
    );
    expect(screen.getByRole('region', { name: 'Budgets' })).toHaveTextContent('25%');
  });

  it('ADM-021 COL-061 surfaces what failed silently: a data source down, a failing channel, work and jobs that failed', () => {
    const said = needsAttention(troubled);
    expect(said).toEqual([
      expect.stringContaining('Indexing'),
      expect.stringContaining('Mail sending'),
      expect.stringContaining('Publishing work'),
      expect.stringContaining('failing to deliver'),
      expect.stringContaining('turned off'),
      expect.stringContaining('Mail'),
      expect.stringContaining('Site readings'),
    ]);
    expect(needsAttention(calm)).toEqual([]);
  });

  it('shows each performance budget, what it is held to and whether production meets it', async () => {
    render(<Diagnostics client={service({ ...calm, performance: measured })} />);
    const table = await screen.findByRole('table', { name: 'Performance budgets' });
    const search = within(table).getByRole('row', { name: /SCH-033/ });
    expect(search).toHaveTextContent('A search’s first page');
    expect(search).toHaveTextContent('95% within 250 ms, none above 500 ms');
    expect(search).toHaveTextContent('Provisional');
    expect(search).toHaveTextContent('95% within 500 ms, the largest 1 sec');
    // In icon and words, never colour alone.
    expect(search).toHaveTextContent('Missed');
    expect(search.querySelector('svg[data-icon]')).not.toBeNull();
    expect(within(table).getByRole('row', { name: /STR-063/ })).toHaveTextContent('Met');
    const realtime = within(table).getByRole('row', { name: /API-036/ });
    expect(realtime).toHaveTextContent('Not measured in production');
    expect(realtime).toHaveTextContent('acknowledge');
  });

  it('says so when nothing has failed and nothing was asked', async () => {
    render(<Diagnostics client={service(calm)} />);
    expect(await screen.findByText('Nothing has failed silently.')).toBeInTheDocument();
    expect(
      screen.getByText('Nothing was asked of this environment in the last 15 minutes.'),
    ).toBeInTheDocument();
  });
});
