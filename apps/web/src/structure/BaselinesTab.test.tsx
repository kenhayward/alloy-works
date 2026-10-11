import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BaselinesTab } from './BaselinesTab.js';

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const VERSION = 'dddddddd-0000-4000-8000-000000000002';
const ADA = 'aaaaaaaa-0000-4000-8000-000000000001';
const id = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Row {
  id: string;
  name: string;
  madeAt: string;
  superseded: { by: string; principal: string; at: string } | null;
}

/** The baselines routes, answered from a list the test holds. */
function service(initial: readonly string[] = []) {
  const rows: Row[] = initial.map((name, index) => ({
    id: id(index + 1),
    name,
    madeAt: `2026-10-11T1${index}:00:00.000Z`,
    superseded: null,
  }));
  const view = (row: Row) => ({
    ...row,
    document: DOCUMENT,
    madeBy: { id: ADA, name: 'Ada' },
    digest: 'a'.repeat(64),
  });
  const asked: string[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(`${request.method} ${url.pathname}${url.search}`);
    if (request.method === 'GET') {
      const state = url.searchParams.get('state');
      const shown = rows
        .filter((row) =>
          state === null ? true : state === 'current' ? !row.superseded : !!row.superseded,
        )
        .sort((a, b) => (a.madeAt < b.madeAt ? 1 : -1))
        .map(view);
      return json(200, { baselines: shown });
    }
    if (url.pathname.endsWith('/baselines')) {
      const { name } = (await request.json()) as { name: string };
      if (rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
        return json(409, {
          code: 'name_taken',
          message: 'This document has a baseline by that name already.',
          traceId: 't',
        });
      }
      const row: Row = {
        id: id(rows.length + 1),
        name,
        madeAt: `2026-10-11T1${rows.length}:00:00.000Z`,
        superseded: null,
      };
      rows.push(row);
      return json(200, view(row));
    }
    const { by } = (await request.json()) as { by: string };
    const row = rows.find((each) => url.pathname.includes(each.id))!;
    row.superseded = { by, principal: ADA, at: '2026-10-11T18:00:00.000Z' };
    return json(200, view(row));
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }), asked };
}

describe('the Baselines tab', () => {
  it('VER-017 makes a baseline of the version shown, by the name given, and lists it newest first', async () => {
    const { client, asked } = service(['Issue 1']);
    render(<BaselinesTab client={client} document={DOCUMENT} version={VERSION} mayPublish />);
    expect(await screen.findByRole('listitem', { name: /Issue 1/ })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Name'), 'Issue 2');
    await userEvent.click(screen.getByRole('button', { name: 'Make baseline' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Made Issue 2.');
    const items = await screen.findAllByRole('listitem');
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Issue 2',
      'Issue 1',
    ]);
    expect(asked).toContain(`POST /v1/documents/${DOCUMENT}/baselines`);
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('VER-046 says in words why a name was refused, and keeps it to correct', async () => {
    const { client } = service(['Issue 1']);
    render(<BaselinesTab client={client} document={DOCUMENT} version={VERSION} mayPublish />);
    await screen.findByRole('listitem', { name: /Issue 1/ });
    await userEvent.type(screen.getByLabelText('Name'), 'issue 1');
    await userEvent.click(screen.getByRole('button', { name: 'Make baseline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This document has a baseline by that name already.',
    );
    expect(screen.getByLabelText('Name')).toHaveValue('issue 1');
  });

  it('VER-049 marks one superseded by a later one, and filters the list by state', async () => {
    const { client, asked } = service(['Issue 1', 'Issue 2']);
    render(<BaselinesTab client={client} document={DOCUMENT} version={VERSION} mayPublish />);
    const first = await screen.findByRole('listitem', { name: /Issue 1/ });
    // The newest has nothing later to be superseded by.
    expect(
      within(screen.getByRole('listitem', { name: /Issue 2/ })).queryByRole('button', {
        name: 'Mark superseded',
      }),
    ).toBeNull();
    await userEvent.click(within(first).getByRole('button', { name: 'Mark superseded' }));
    await userEvent.selectOptions(within(first).getByLabelText('Superseded by'), 'Issue 2');
    await userEvent.click(within(first).getByRole('button', { name: 'Mark' }));
    await waitFor(() =>
      expect(screen.getByRole('listitem', { name: /Issue 1/ })).toHaveTextContent(
        'Superseded by Issue 2',
      ),
    );
    expect(asked).toContain(`POST /v1/baselines/${id(1)}/supersession`);

    await userEvent.selectOptions(screen.getByLabelText('Show'), 'Current');
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /Issue 1/ })).toBeNull());
    expect(screen.getByRole('listitem', { name: /Issue 2/ })).toBeInTheDocument();
    expect(asked).toContain(`GET /v1/documents/${DOCUMENT}/baselines?state=current`);
  });

  it('shows the baselines to somebody who may not publish, with nothing to make or mark', async () => {
    const { client } = service(['Issue 1', 'Issue 2']);
    render(
      <BaselinesTab client={client} document={DOCUMENT} version={VERSION} mayPublish={false} />,
    );
    await screen.findByRole('listitem', { name: /Issue 1/ });
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark superseded' })).toBeNull();
  });

  it('says when the document has none yet', async () => {
    const { client } = service();
    render(<BaselinesTab client={client} document={DOCUMENT} version={VERSION} mayPublish />);
    expect(await screen.findByText('No baseline yet.')).toBeInTheDocument();
  });
});
