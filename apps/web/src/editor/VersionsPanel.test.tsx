import { createApiClient } from '@alloy-works/api-client';
import { compareContent, type ContentDocument } from '@alloy-works/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { VersionsPanel } from './VersionsPanel.js';

const COMPONENT = 'cccccccc-0000-4000-8000-000000000001';
const V2 = 'cccccccc-0000-4000-8000-000000000002';
const V3 = 'cccccccc-0000-4000-8000-000000000003';

const docOf = (value: string): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    { type: 'paragraph', id: 'p1', style: 'body', content: [{ type: 'text', value, marks: [] }] },
  ],
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  const asked: string[] = [];
  const fetching = vi.fn(async (input: Request) => {
    const url = new URL(input.url);
    asked.push(`${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/versions')) {
      return json(200, {
        items: [
          {
            id: V3,
            number: '0.3',
            createdAt: '2026-10-11T12:00:00.000Z',
            author: { id: 'a', name: 'Ada' },
            note: null,
          },
          {
            id: V2,
            number: '0.2',
            createdAt: '2026-10-10T12:00:00.000Z',
            author: { id: 'g', name: 'Grace' },
            note: null,
          },
        ],
        next: null,
      });
    }
    const older = docOf('Set the tray.');
    const newer = docOf('Set the new tray.');
    return json(200, {
      component: COMPONENT,
      from: { id: V2, number: '0.2' },
      to: { id: V3, number: '0.3' },
      older,
      newer,
      changes: compareContent(older, newer).changes,
    });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://acme.test', fetch: fetching }), asked };
}

describe('the Versions panel', () => {
  it('CNT-111 CNT-112 lists each version with who cut it and when, and compares an earlier one with the latest as a redline', async () => {
    const { client, asked } = service();
    render(<VersionsPanel client={client} id={COMPONENT} />);
    const list = await screen.findByRole('list', { name: 'Versions' });
    expect(within(list).getByText(/Grace, 10 Oct/)).toBeInTheDocument();
    // The latest has nothing later to be compared with.
    expect(within(list).queryByRole('button', { name: 'Compare 0.3 with 0.3' })).toBeNull();
    await userEvent.click(within(list).getByRole('button', { name: 'Compare 0.2 with 0.3' }));
    const changes = await screen.findByRole('list', { name: 'Changes from 0.2 to 0.3' });
    expect(changes.querySelector('ins')).toHaveTextContent('Added: new');
    expect(asked).toContain(`/v1/components/${COMPONENT}/comparison?from=${V2}&to=${V3}`);
  });

  it('CNT-113 COL-026 shows my own changes since the version I opened, from what the editor holds now', async () => {
    const { client, asked } = service();
    render(
      <VersionsPanel
        client={client}
        id={COMPONENT}
        mine={() => ({ older: docOf('Set the tray.'), newer: docOf('Set the tray, then wait.') })}
      />,
    );
    await screen.findByRole('list', { name: 'Versions' });
    await userEvent.click(screen.getByRole('button', { name: 'My changes' }));
    const changes = screen.getByRole('list', { name: 'My changes' });
    expect(changes.querySelector('ins')).toHaveTextContent('Added: , then wait');
    // Compared in the browser: nothing asked of the service for it.
    expect(asked.some((each) => each.includes('/comparison'))).toBe(false);
  });
});
