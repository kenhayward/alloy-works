import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublicationList } from './PublicationList.js';

const MANUAL = 'aaaaaaaa-0000-4000-8000-000000000001';
const GUIDE = 'aaaaaaaa-0000-4000-8000-000000000002';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const publication = (
  id: string,
  document: string,
  title: string,
  number: string,
  formats: string[] = ['pdf'],
) => ({
  id,
  document,
  version: { id: `v${number}`, number },
  title,
  publisher: { id: 'p1', displayName: 'Grace' },
  publishedAt: new Date(2025, 8, 18, 10, 4).toISOString(),
  approval: 'none',
  formats,
});

function listed() {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname !== '/v1/publications') return json(404, {});
    return json(200, {
      items: [
        publication('ffffffff-0000-4000-8000-000000000003', MANUAL, 'Operator manual', '1.9', [
          'pdf',
          'docx',
        ]),
        publication('ffffffff-0000-4000-8000-000000000002', GUIDE, 'Installation guide', '2.0', [
          'docx',
        ]),
        publication('ffffffff-0000-4000-8000-000000000001', MANUAL, 'Operator manual', '1.8'),
      ],
    });
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://publications.test', fetch: fetching });
}

afterEach(() => window.localStorage.clear());

describe('the publications list', () => {
  it('lists each publication as a row, filters by document, and links each to its page', async () => {
    render(<PublicationList client={listed()} />);

    const links = await screen.findAllByRole('link', { name: 'Operator manual' });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '#/publications/ffffffff-0000-4000-8000-000000000003');
    const cells = within(links[0]!.closest('tr')!).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Operator manual',
      '1.9',
      'PDF and Word',
      '18 Sep 2025',
      'Grace',
      'Not approved',
    ]);
    // What each was made in, in the words an author knows them by (Word 1, ruling R14).
    const made = (name: string) =>
      screen
        .getAllByRole('link', { name })
        .map((link) => within(link.closest('tr')!).getAllByRole('cell')[2]!.textContent);
    expect(made('Operator manual')).toEqual(['PDF and Word', 'PDF']);
    expect(made('Installation guide')).toEqual(['Word']);
    expect(screen.getByRole('columnheader', { name: 'Formats' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Publications' })).toBeInTheDocument();
    expect(screen.getByText('3 publications you may read.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /^Installation guide\s*1$/ }));
    expect(screen.queryAllByRole('link', { name: 'Operator manual' })).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Installation guide' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getAllByRole('link', { name: 'Operator manual' })).toHaveLength(2);
  });
});
