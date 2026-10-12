import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SuggestionsPanel } from './SuggestionsPanel.js';

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const COMPONENT = 'cccccccc-0000-4000-8000-000000000001';
const ADA = 'aaaaaaaa-0000-4000-8000-000000000001';
const GRACE = 'aaaaaaaa-0000-4000-8000-000000000002';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const words = (value: string) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    { type: 'paragraph', id: 'b1', style: 'body', content: [{ type: 'text', value, marks: [] }] },
  ],
});
const suggestion = (id: string, by: { id: string; name: string }, stale: unknown[] = []) => ({
  id,
  component: COMPONENT,
  madeAgainst: 'v1',
  madeBy: by,
  madeAt: '2026-10-12T10:00:00.000Z',
  state: 'pending',
  stale,
  resolution: null,
  drawnOver: { version: 'v1', content: words('Unbox it.') },
  drawn: words('Unbox it carefully.'),
});

function service() {
  const asked: { route: string; body: unknown }[] = [];
  const listed = [
    suggestion('gggggggg-0000-4000-8000-000000000001', { id: GRACE, name: 'Grace' }),
    suggestion('gggggggg-0000-4000-8000-000000000002', { id: ADA, name: 'Ada' }, [
      { block: 'b1', why: 'changed' },
    ]),
  ];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const body =
      request.method === 'POST' ? await request.json().catch(() => undefined) : undefined;
    asked.push({ route: `${request.method} ${url.pathname}`, body });
    if (url.pathname.endsWith('/suggestions'))
      return json(200, { suggestions: listed, next: null });
    if (url.pathname === '/v1/suggestions/resolutions') {
      return json(200, {
        resolved: [{ suggestion: listed[0]!.id, version: 'v2' }],
        left: [{ suggestion: listed[1]!.id, why: 'stale' }],
      });
    }
    const found = listed.find((each) => url.pathname.includes(each.id))!;
    return json(200, found);
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }), asked };
}

describe('the suggestions panel in Review', () => {
  it('COL-052 COL-022 lists each suggestion and says why one no longer fits, and accepts every pending one at once', async () => {
    const { client, asked } = service();
    const changed = vi.fn();
    render(
      <SuggestionsPanel
        client={client}
        document={DOCUMENT}
        principalId={ADA}
        mayResolve={() => true}
        placeOf={() => '1 Method'}
        onChanged={changed}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Grace on 1 Method' })).toBeInTheDocument();
    expect(
      screen.getByText('No longer fits: a block it changes has changed since.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept all' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Accepted 1. Left 1 pending, which could not be.',
    );
    expect(asked).toContainEqual({
      route: 'POST /v1/suggestions/resolutions',
      body: { act: 'accept', scope: `artifact:${DOCUMENT}` },
    });
    expect(changed).toHaveBeenCalled();
  });

  it('COL-048 COL-020 draws one as a redline, and offers its author Withdraw and an editor Accept and Reject', async () => {
    const { client } = service();
    render(
      <SuggestionsPanel
        client={client}
        document={DOCUMENT}
        principalId={ADA}
        mayResolve={() => false}
        placeOf={() => '1 Method'}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Grace on 1 Method' }));
    const opened = (await screen.findByRole('heading', { name: /Grace's suggestion/ })).closest(
      'section',
    )!;
    expect(within(opened).getByRole('list', { name: 'What it changes' })).toBeInTheDocument();
    // Grace's: Ada may neither withdraw it nor, here, accept it.
    expect(within(opened).queryByRole('button', { name: 'Withdraw' })).toBeNull();
    expect(within(opened).queryByRole('button', { name: 'Accept' })).toBeNull();
    await userEvent.click(within(opened).getByRole('button', { name: 'All suggestions' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Ada on 1 Method' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument(),
    );
  });
});
