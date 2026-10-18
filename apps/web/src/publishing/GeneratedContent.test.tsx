import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GeneratedContent } from './GeneratedContent.js';

const DOCUMENT = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const PUBLICATION = '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const run = {
  id: 'r1',
  model: 'claude-test-20260101',
  endpoint: 'Drafting',
  instructions: 'assistant-1',
  promptVersion: null,
  contextDigest: 'd'.repeat(64),
};

function service(asked: string[]) {
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    asked.push(path);
    if (
      path === `/v1/documents/${DOCUMENT}/generated` ||
      path === `/v1/publications/${PUBLICATION}/generated`
    ) {
      return json(200, {
        placements: [
          {
            node: 'n1',
            component: 'c1',
            version: 'v3',
            number: '0.3',
            restoredFrom: null,
            items: [
              {
                kind: 'suggestion',
                id: 's1',
                state: 'accepted',
                askedBy: { id: 'a', name: 'Ada' },
                actedBy: { id: 'g', name: 'Grace' },
                actedAt: '2026-10-18T09:00:00.000Z',
                acceptedInto: { version: 'v3', number: '0.3', inPlaced: true },
                run,
              },
              {
                kind: 'suggestion',
                id: 's2',
                state: 'open',
                askedBy: { id: 'a', name: 'Ada' },
                actedBy: null,
                actedAt: null,
                acceptedInto: null,
                run,
              },
              {
                kind: 'proposal',
                id: 'p1',
                state: 'discarded',
                askedBy: { id: 'a', name: 'Ada' },
                actedBy: { id: 'a', name: 'Ada' },
                actedAt: '2026-10-18T10:00:00.000Z',
                acceptedInto: null,
                run,
              },
            ],
          },
        ],
        unreadable: 1,
      });
    }
    return json(404, { code: 'not_found', message: 'There is nothing at this address.' });
  }) as typeof fetch;
  return createApiClient({ baseUrl: 'http://doc.test', fetch: fetching });
}

describe('Generated content (the G3 plan, G3-C)', () => {
  it('GEN-026 says, for each part, what came from a model and who accepted it, and counts the parts the reader may not read', async () => {
    const asked: string[] = [];
    render(
      <GeneratedContent
        client={service(asked)}
        of={{ document: DOCUMENT }}
        placeOf={() => 'Scope'}
      />,
    );
    const section = await screen.findByRole('region', { name: 'Generated content' });
    expect(within(section).getByText('Scope, version 0.3')).toBeVisible();
    expect(
      within(section).getByText(
        'Accepted by Grace on 18 Oct 2026 into 0.3. Asked of claude-test-20260101 on Drafting by Ada.',
      ),
    ).toBeVisible();
    expect(
      within(section).getByText(/^Waiting to be accepted or rejected in Review\./),
    ).toBeVisible();
    expect(
      within(section).getByText(/^Discarded by Ada on 18 Oct 2026 before it was suggested\./),
    ).toBeVisible();
    expect(within(section).getByText('One part you may not read is not shown.')).toBeVisible();
    expect(asked).toEqual([`/v1/documents/${DOCUMENT}/generated`]);
  });

  it("reads a publication's own report, as it recorded it", async () => {
    const asked: string[] = [];
    render(<GeneratedContent client={service(asked)} of={{ publication: PUBLICATION }} />);
    expect(
      await screen.findByRole('region', { name: 'Generated content it printed' }),
    ).toBeVisible();
    expect(asked).toEqual([`/v1/publications/${PUBLICATION}/generated`]);
  });
});
