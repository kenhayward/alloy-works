import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Restore } from './Restore.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ID = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const PLAN = {
  format: 2,
  scope: 'tenant',
  cutAt: '2026-10-12T09:00:00.000Z',
  tables: { artifact: 4, principal: 2 },
  missingObjects: ['a'.repeat(64)],
  secrets: [{ reference: 'model_endpoint:one', kind: 'model_endpoint' }],
  issuers: [{ issuer: 'https://old.example', people: 2 }],
  groups: 1,
  externals: 0,
  serviceIdentities: 0,
  leftOut: {},
  rebuilt: {},
};
const row = (state: string, over: Record<string, unknown> = {}) => ({
  id: ID,
  state,
  requestedAt: '2026-10-12T09:00:00.000Z',
  finishedAt: null,
  plan: state === 'previewed' ? PLAN : null,
  answers: null,
  refusal: null,
  providers: ['https://here.example'],
  ...over,
});
const NOT_RESTORED = { restoredAt: null, underReview: false, datesPast: 0, reviewDatesPast: 0 };

function service(start: unknown[] = [], review: unknown = NOT_RESTORED) {
  let items = start;
  let held = review;
  const asked: { what: string; body?: unknown; type?: string | null }[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    const what = `${request.method} ${path}`;
    if (what === 'GET /v1/restorations') return json(200, { items });
    if (what === 'GET /v1/restore-review') return json(200, held);
    if (what === 'POST /v1/restorations') {
      asked.push({ what });
      return json(200, row('awaiting_archive'));
    }
    if (what === `PUT /v1/restorations/${ID}/archive`) {
      asked.push({ what, type: request.headers.get('content-type') });
      items = [row('previewed')];
      return json(200, row('checking'));
    }
    if (what === `PUT /v1/restorations/${ID}/answers`) {
      asked.push({ what, body: await request.clone().json() });
      return json(200, row('previewed'));
    }
    if (what === `POST /v1/restorations/${ID}/apply`) {
      asked.push({ what });
      items = [row('restored')];
      return json(200, row('applying'));
    }
    if (what === 'POST /v1/restore-review/end') {
      asked.push({ what });
      held = { ...(held as object), underReview: false };
      return json(200, held);
    }
    return json(404, { code: 'not_found', message: what });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://service.test', fetch: fetching }), asked };
}

describe('Restore in Administration (the EI plan, EIc)', () => {
  it('IMP-039 sends an archive as bytes, says what it would do, and answers before applying', async () => {
    const { client, asked } = service();
    render(<Restore client={client} followMs={1} />);
    const input = await screen.findByLabelText('Archive to restore');
    await userEvent.upload(input, new File(['tar'], 'env.tar', { type: 'application/x-tar' }));

    expect(await screen.findByText('What this would restore')).toBeTruthy();
    expect(asked.map((each) => each.what)).toEqual([
      'POST /v1/restorations',
      `PUT /v1/restorations/${ID}/archive`,
    ]);
    expect(asked[1]!.type).toBe('application/x-tar');
    expect(screen.getByRole('alert').textContent).toContain('1');
    expect(screen.getByText('model_endpoint:one')).toBeTruthy();

    await userEvent.selectOptions(
      screen.getByLabelText(/https:\/\/old\.example/),
      'https://here.example',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Restore this environment' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Restored'));
    expect(asked[2]!.body).toEqual({
      issuers: { 'https://old.example': 'https://here.example' },
      switchedOff: ['model_endpoint:one'],
    });
    expect(asked[3]!.what).toBe(`POST /v1/restorations/${ID}/apply`);
  });

  it('IMP-052 says why a whole archive was refused', async () => {
    const { client } = service([
      row('refused', { refusal: { code: 'tenant_not_empty', message: 'This holds a space.' } }),
    ]);
    render(<Restore client={client} />);
    expect((await screen.findByRole('alert')).textContent).toBe('This holds a space.');
  });

  it('holds dates and reminders until the review is ended', async () => {
    const { client, asked } = service([row('restored')], {
      restoredAt: '2026-10-12T09:00:00.000Z',
      underReview: true,
      datesPast: 3,
      reviewDatesPast: 2,
    });
    render(<Restore client={client} />);
    const end = await screen.findByRole('button', { name: 'Let dates and reminders run' });
    expect(screen.getByRole('group').textContent).toContain('3 revisions');
    await userEvent.click(end);
    await waitFor(() => expect(screen.queryByRole('group')).toBeNull());
    expect(asked.map((each) => each.what)).toContain('POST /v1/restore-review/end');
  });
});
