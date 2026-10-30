import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { RoundsPanel, type Round } from './RoundsPanel.js';

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const ROUND = 'rrrrrrrr-0000-4000-8000-000000000001';
const ADA = 'aaaaaaaa-0000-4000-8000-000000000001';
const GRACE = 'aaaaaaaa-0000-4000-8000-000000000002';
const SECTION = 'ssssssssssssssssssssssssss';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const round = (state: Round['reviewers'][number]['state'], over: Partial<Round> = {}): Round => ({
  id: ROUND,
  title: 'First review',
  scope: [],
  dueAt: '2026-10-19T09:00:00.000Z',
  baseline: null,
  openedBy: { id: ADA, name: 'Ada' },
  closed: null,
  reviewers: [
    {
      person: { id: GRACE, name: 'Grace' },
      state,
      ...(state === 'complete' ? { outcome: 'nothing_to_say' as const } : {}),
      mayReview: true,
      threads: state === 'not_started' ? 0 : 2,
      suggestions: 0,
    },
  ],
  complete: state === 'complete' ? 1 : 0,
  of: 1,
  everybody: state === 'complete',
  mayClose: false,
  reviewing: true,
  ...over,
});

function service(start: Round) {
  const sent: { path: string; body: unknown }[] = [];
  let now = start;
  const fetching = (async (input: Request) => {
    const path = new URL(input.url).pathname;
    const body = input.method === 'POST' ? await input.json().catch(() => undefined) : undefined;
    if (input.method === 'POST') sent.push({ path, body });
    if (path.endsWith('/start')) now = round('in_progress');
    if (path.endsWith('/completion')) now = round('complete');
    if (path.endsWith('/reopening')) now = round('in_progress');
    if (path === `/v1/documents/${DOCUMENT}/rounds` && input.method === 'POST') {
      return json(200, now);
    }
    if (path === `/v1/documents/${DOCUMENT}/rounds`) return json(200, { rounds: [now] });
    if (path === `/v1/documents/${DOCUMENT}/baselines`) return json(200, { baselines: [] });
    return json(200, now);
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }), sent };
}

describe('the Rounds panel in Review (the RR plan, Task 4)', () => {
  it('COL-029 COL-032 COL-057 lets a reviewer start, finish with nothing to say and reopen, each reviewer shown by state and what they said', async () => {
    const { client, sent } = service(round('not_started'));
    render(
      <RoundsPanel
        client={client}
        document={DOCUMENT}
        principalId={GRACE}
        mayOpen={false}
        people={[]}
        sections={[]}
      />,
    );
    const reviewers = await screen.findByRole('list', { name: 'Reviewers of First review' });
    expect(reviewers).toHaveTextContent('GraceNot started');
    expect(screen.getByText('0 of 1 done.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(reviewers).toHaveTextContent('In progress, 2 threads'));
    await userEvent.click(screen.getByRole('button', { name: 'Done, nothing to say' }));
    expect(await screen.findByText('Everybody has reviewed it.')).toBeInTheDocument();
    expect(reviewers).toHaveTextContent('Done, nothing to say');
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(reviewers).toHaveTextContent('In progress'));
    expect(sent.map((each) => each.path)).toEqual([
      `/v1/rounds/${ROUND}/start`,
      `/v1/rounds/${ROUND}/completion`,
      `/v1/rounds/${ROUND}/reopening`,
    ]);
    expect(sent[1]!.body).toEqual({ outcome: 'nothing_to_say' });
  });

  it('COL-028 opens a round naming its reviewers, its sections and its due date', async () => {
    const { client, sent } = service(round('not_started', { reviewing: false }));
    render(
      <RoundsPanel
        client={client}
        document={DOCUMENT}
        principalId={ADA}
        mayOpen
        people={[{ id: GRACE, name: 'Grace' }]}
        sections={[{ id: SECTION, label: '1 Method' }]}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open a round' }));
    const form = screen.getByRole('form', { name: 'A new round' });
    await userEvent.type(within(form).getByLabelText('Title'), 'Second review');
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Grace' }));
    await userEvent.click(within(form).getByRole('checkbox', { name: '1 Method' }));
    await userEvent.type(within(form).getByLabelText('Due'), '2099-10-30T09:00');
    await userEvent.click(within(form).getByRole('button', { name: 'Open the round' }));
    await waitFor(() =>
      expect(
        sent.find((each) => each.path === `/v1/documents/${DOCUMENT}/rounds`)?.body,
      ).toMatchObject({
        title: 'Second review',
        reviewers: [GRACE],
        scope: [SECTION],
      }),
    );
  });

  it('IAM-045 COL-059 says a reviewer from outside the organisation is so, on the round and when naming one', async () => {
    const outside = round('not_started', {
      reviewers: [
        {
          person: { id: GRACE, name: 'Grace', external: true },
          state: 'not_started',
          mayReview: true,
          threads: 0,
          suggestions: 0,
        },
      ],
    });
    const { client } = service(outside);
    render(
      <RoundsPanel
        client={client}
        document={DOCUMENT}
        principalId={ADA}
        mayOpen
        people={[{ id: GRACE, name: 'Grace', external: true }]}
        sections={[]}
      />,
    );
    const reviewers = await screen.findByRole('list', { name: 'Reviewers of First review' });
    expect(within(reviewers).getByText('Outside')).toBeInTheDocument();
    expect(reviewers).toHaveTextContent(/Grace\s*Outside, from outside the organisation/);
    await userEvent.click(screen.getByRole('button', { name: 'Open a round' }));
    expect(
      await screen.findByRole('checkbox', { name: 'Grace, from outside the organisation' }),
    ).toBeInTheDocument();
  });
});
