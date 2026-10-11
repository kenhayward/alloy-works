import { createApiClient } from '@alloy-works/api-client';
import { auditKinds } from '@alloy-works/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Administration } from './Administration.js';
import { AuditLog } from './AuditLog.js';
import { FAMILY_WORDS, KIND_WORDS } from './auditWords.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ADA = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const REVIEWERS = '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d';

const event = (sequence: string, overrides: Record<string, unknown> = {}) => ({
  sequence,
  at: '2026-10-11T09:30:00.000Z',
  kind: 'group.made',
  actorKind: 'person',
  actor: ADA,
  token: null,
  subject: { kind: 'group', id: REVIEWERS, version: null },
  space: null,
  outcome: 'done',
  detail: {},
  traceId: 'req-1',
  labels: { actor: { text: 'Ada', erased: false }, subject: { text: 'Reviewers', erased: false } },
  ...overrides,
});

const exportOf = (state: string) => ({
  id: 'e1',
  state,
  requestedAt: '2026-10-11T09:30:00.000Z',
  requestedBy: ADA,
  newest: '3',
  events: state === 'done' ? 12 : null,
  bytes: state === 'done' ? 4096 : null,
  sha256: null,
});

function service(audit: (url: URL) => Response) {
  const asked: URL[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/audit') {
      asked.push(url);
      return audit(url);
    }
    if (url.pathname === '/v1/tenant') return json(200, { name: 'Development' });
    return json(404, {});
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), asked };
}

beforeEach(() => {
  window.location.hash = '#/admin/audit';
});

describe('the Audit log in Administration', () => {
  it('ADM-038 shows the log newest first, each event saying when, who, what and about what, and pages it', async () => {
    const { client, asked } = service((url) =>
      url.searchParams.get('cursor') === null
        ? json(200, {
            items: [
              event('3'),
              event('2', {
                kind: 'access.refused',
                outcome: 'refused',
                actor: null,
                actorKind: 'anonymous',
                subject: null,
                labels: {},
              }),
            ],
            next: 'page-2',
          })
        : json(200, { items: [event('1', { kind: 'authentication.signed_in' })], next: null }),
    );
    render(<Administration client={client} about={null} />);

    expect(await screen.findByRole('heading', { name: 'Audit log', level: 1 })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Audit log' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('cell', { name: /Group made/ })).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('button', { name: 'Only what Ada did' })).toBeInTheDocument();
    expect(
      within(rows[0]!).getByRole('button', { name: 'Only events about Reviewers' }),
    ).toBeInTheDocument();
    expect(within(rows[1]!).getByRole('cell', { name: /Refused/ })).toBeInTheDocument();
    expect(
      within(rows[1]!).getByRole('cell', { name: 'Somebody not signed in' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await within(table).findByRole('cell', { name: /Signed in/ })).toBeInTheDocument();
    expect(asked.at(-1)!.searchParams.get('cursor')).toBe('page-2');
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('ADM-038 filters by a kind or its family, by dates, and by who acted or what it was about, each filter shown and cleared', async () => {
    const { client, asked } = service(() => json(200, { items: [event('3')], next: null }));
    render(<Administration client={client} about={null} />);
    await screen.findByRole('table', { name: 'Audit log' });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'What happened' }),
      'group.',
    );
    await waitFor(() => expect(asked.at(-1)!.searchParams.get('kind')).toBe('group.'));

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-11' } });
    await waitFor(() =>
      expect(asked.at(-1)!.searchParams.get('to')).toBe(
        new Date('2026-10-11T23:59:59.999').toISOString(),
      ),
    );
    expect(asked.at(-1)!.searchParams.get('from')).toBe(
      new Date('2026-10-01T00:00:00').toISOString(),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Only what Ada did' }));
    await waitFor(() => expect(asked.at(-1)!.searchParams.get('actor')).toBe(ADA));
    await userEvent.click(screen.getByRole('button', { name: 'Only events about Reviewers' }));
    await waitFor(() => expect(asked.at(-1)!.searchParams.get('subject')).toBe(REVIEWERS));

    await userEvent.click(screen.getByRole('button', { name: 'Stop showing only what Ada did' }));
    await waitFor(() => expect(asked.at(-1)!.searchParams.get('actor')).toBeNull());
    expect(asked.at(-1)!.searchParams.get('subject')).toBe(REVIEWERS);
  });

  it('says so where the reader may not read the log, and where nothing matches', async () => {
    const refused = service(() => json(403, { code: 'forbidden', message: 'No' }));
    const { unmount } = render(<Administration client={refused.client} about={null} />);
    expect(await screen.findByText('You may not read the audit log here.')).toBeInTheDocument();
    unmount();

    const none = service(() => json(200, { items: [], next: null }));
    render(<Administration client={none.client} about={null} />);
    expect(await screen.findByText('No events match.')).toBeInTheDocument();
  });

  it('ADM-039 exports the log as filtered, says when it is written and how many events it holds, and downloads it', async () => {
    let polled = 0;
    const posted: unknown[] = [];
    const followed: string[] = [];
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/audit') return json(200, { items: [event('3')], next: null });
      if (url.pathname === '/v1/audit/exports' && request.method === 'POST') {
        posted.push(await request.json());
        return json(200, { export: exportOf('queued') });
      }
      if (url.pathname === '/v1/audit/exports/e1') {
        polled += 1;
        return json(200, { export: exportOf(polled < 2 ? 'queued' : 'done') });
      }
      if (url.pathname === '/v1/audit/exports/e1/download') {
        return json(200, { download: 'https://store.test/audit-e1.jsonl?signed' });
      }
      return json(404, {});
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://admin.test', fetch: fetching });
    render(<AuditLog client={client} followMs={1} follow={(url) => followed.push(url)} />);
    await screen.findByRole('table', { name: 'Audit log' });

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'What happened' }),
      'group.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(posted).toEqual([{ kind: 'group.' }]);
    expect(await screen.findByText('The export holds 12 events.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Download export' }));
    await waitFor(() => expect(followed).toEqual(['https://store.test/audit-e1.jsonl?signed']));
  });

  it('has words for every kind the log holds, and a name for each of their families', () => {
    expect(Object.keys(KIND_WORDS).sort()).toEqual([...auditKinds]);
    const families = new Set(auditKinds.map((kind) => kind.split('.')[0]!));
    expect(Object.keys(FAMILY_WORDS).sort()).toEqual([...families].sort());
  });
});
