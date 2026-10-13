import { createApiClient } from '@alloy-works/api-client';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ThreadPage } from './ThreadPage.js';

const COMPONENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const THREAD = 'bbbbbbbb-0000-4000-8000-000000000001';
const FIRST = 'cccccccc-0000-4000-8000-000000000001';
const SECOND = 'cccccccc-0000-4000-8000-000000000002';
const ADA = 'dddddddd-0000-4000-8000-000000000001';
const GRACE = 'dddddddd-0000-4000-8000-000000000002';
const VERSION = 'eeeeeeee-0000-4000-8000-000000000001';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ada = { id: ADA, name: 'Ada' };
const thread = {
  id: THREAD,
  on: { id: COMPONENT, kind: 'component' },
  anchor: { kind: 'span', block: 'b1', quote: 'the spindle', before: 'Turn ' },
  madeAgainst: VERSION,
  startedBy: ada,
  startedAt: '2026-10-02T09:00:00.000Z',
  resolution: { by: ada, at: '2026-10-03T09:00:00.000Z' },
  comments: [
    {
      id: FIRST,
      author: ada,
      at: '2026-10-02T09:00:00.000Z',
      texts: [{ parts: [{ text: 'Is the torque wrong?' }], at: '2026-10-02T09:00:00.000Z' }],
    },
    {
      id: SECOND,
      author: ada,
      at: '2026-10-02T10:00:00.000Z',
      texts: [
        { parts: [{ text: 'Use a wrench.' }], at: '2026-10-02T10:00:00.000Z' },
        {
          parts: [{ mention: GRACE }, { text: ' use the calibrated wrench.' }],
          at: '2026-10-02T11:00:00.000Z',
        },
      ],
    },
  ],
};

function client(answer: Response) {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/people') {
      return json(200, { items: [ada, { id: GRACE, name: 'Grace' }], next: null });
    }
    if (url.pathname === `/v1/threads/${THREAD}`) return answer.clone();
    return json(404, {});
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://threads.test', fetch: fetching });
}

describe('a thread at its own address', () => {
  it('SCH-071 shows a thread found by search, each message at its latest text, the matched one focused', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <ThreadPage
        client={client(json(200, thread))}
        on={{ kind: 'component', id: COMPONENT }}
        thread={THREAD}
        comment={SECOND}
      />,
    );
    expect(
      await screen.findByRole('heading', { name: 'A thread on “the spindle”' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('@Grace')).toBeInTheDocument();
    expect(screen.queryByText('Use a wrench.')).toBeNull();
    expect(screen.getByText('Is the torque wrong?')).toBeInTheDocument();
    expect(screen.getByText(/^Resolved by Ada/)).toBeInTheDocument();
    const matched = screen.getByText('use the calibrated wrench.').closest('li');
    expect(matched).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Open the component' })).toHaveAttribute(
      'href',
      `#/components/${COMPONENT}`,
    );
  });

  it('says so where there is no thread it may read', async () => {
    render(
      <ThreadPage
        client={client(json(404, { code: 'not_found', message: 'No.' }))}
        on={{ kind: 'component', id: COMPONENT }}
        thread={THREAD}
        comment={null}
      />,
    );
    expect(
      await screen.findByText('There is no such thread, or you may not read it.'),
    ).toBeInTheDocument();
  });
});
