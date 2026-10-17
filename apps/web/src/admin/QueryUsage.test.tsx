import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { QueryUsage } from './QueryUsage.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const total = (id: string, title: string, over: Record<string, number> = {}) => ({
  id,
  title,
  runs: 12,
  failed: 1,
  throttled: 2,
  durationMs: 61_500,
  rows: 1200,
  bytes: 2_097_152,
  ...over,
});

function service() {
  let settings = {
    rows: null,
    bytes: null,
    seconds: null,
    concurrentRuns: null as number | null,
    defaults: { concurrentRuns: 4 },
    ceilings: { rows: 100000, bytes: 26214400, seconds: 120, concurrentRuns: 16 },
  };
  const asked: { method: string; url: URL; body?: unknown }[] = [];
  const fetching = vi.fn(async (input: Request) => {
    const url = new URL(input.url);
    if (input.method === 'PUT') {
      const body = (await input.json()) as { concurrentRuns: number | null };
      asked.push({ method: 'PUT', url, body });
      settings = { ...settings, concurrentRuns: body.concurrentRuns };
      return json(200, settings);
    }
    asked.push({ method: input.method, url });
    if (url.pathname === '/v1/settings/data') return json(200, settings);
    return json(200, {
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      byQueryDefinition: [total('q1', 'Site readings')],
      byDocument: [total('d1', 'The dosing report', { runs: 3, failed: 0, throttled: 0 })],
    });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), asked };
}

describe("Administration's Query usage", () => {
  it("DAT-053 shows what the environment's query runs cost over the last 30 days, by query and by document, and offers every run as CSV", async () => {
    const { client, asked } = service();
    render(<QueryUsage client={client} mayChange />);
    const byQuery = await screen.findByRole('table', { name: 'By query definition' });
    const row = within(byQuery).getByRole('row', { name: /Site readings/ });
    expect(row).toHaveTextContent('12');
    expect(row).toHaveTextContent('1 failed, 2 throttled');
    expect(row).toHaveTextContent('1 min 2 s');
    expect(row).toHaveTextContent('2.0 MB');
    expect(
      within(screen.getByRole('table', { name: 'By document' })).getByRole('row', {
        name: /The dosing report/,
      }),
    ).toHaveTextContent('3');
    const usage = asked.find((each) => each.url.pathname === '/v1/data/usage')!.url;
    const days =
      (Date.parse(usage.searchParams.get('to')!) - Date.parse(usage.searchParams.get('from')!)) /
      86_400_000;
    expect(Math.round(days)).toBe(30);
    const csv = screen.getByRole('link', { name: 'Download every run (CSV)' });
    expect(csv.getAttribute('href')).toMatch(/^\/v1\/data\/usage\/runs\.csv\?from=.+&to=.+$/);

    // Another period asks again.
    await userEvent.selectOptions(screen.getByLabelText('Period'), '7');
    await waitFor(() =>
      expect(asked.filter((each) => each.url.pathname === '/v1/data/usage')).toHaveLength(2),
    );
  });

  it("DAT-071 shows the environment's runs at once and lets an administrator lower it, or return it to the default", async () => {
    const { client, asked } = service();
    render(<QueryUsage client={client} mayChange />);
    const field = await screen.findByLabelText(/Queries running at once/);
    expect(field).toHaveValue(null);
    expect(field).toHaveAttribute('placeholder', '4');
    expect(field).toHaveAttribute('max', '16');
    await userEvent.type(field, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(asked.find((each) => each.method === 'PUT')!.body).toEqual({
      rows: null,
      bytes: null,
      seconds: null,
      concurrentRuns: 2,
    });
  });

  it('shows the limit to somebody who may not change it, unchangeable', async () => {
    const { client } = service();
    render(<QueryUsage client={client} mayChange={false} />);
    expect(await screen.findByLabelText(/Queries running at once/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
