import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentList } from './DocumentList.js';

const GENERAL = '1a1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const TRAINING = '2b1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const MANUAL = '3c1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const WORKBOOK = '4d1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const PACK = '5e1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const row = (
  id: string,
  title: string,
  space: string,
  publishing: 'published' | 'changedSince' | 'neverPublished',
) => ({
  id,
  title,
  space: { id: space, name: space === GENERAL ? 'General' : 'Training' },
  version: '1.12',
  changedAt: new Date(2025, 11, 3, 11, 0).toISOString(),
  sections: 46,
  components: 128,
  publishing,
});

function listed() {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/spaces') {
      return json(200, { items: [{ id: GENERAL, name: 'General', mayCreate: true }] });
    }
    if (url.pathname !== '/v1/documents') return json(404, {});
    return json(200, {
      items: [
        row(MANUAL, 'Operator manual', GENERAL, 'changedSince'),
        row(WORKBOOK, 'Training workbook', TRAINING, 'neverPublished'),
        row(PACK, 'Commissioning pack', GENERAL, 'published'),
      ],
    });
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://documents.test', fetch: fetching });
}

afterEach(() => window.localStorage.clear());

describe('the documents list', () => {
  it('shows each document as a row: title linking to it, space, version, sections, components, publishing state and when changed', async () => {
    render(<DocumentList client={listed()} onOpen={vi.fn()} />);

    const link = await screen.findByRole('link', { name: 'Operator manual' });
    expect(link).toHaveAttribute('href', `#/documents/${MANUAL}`);
    const cells = within(link.closest('tr')!).getAllByRole('cell');
    expect(cells.map((cell) => cell.textContent)).toEqual([
      'Operator manual',
      'General',
      '1.12',
      '46',
      '128',
      'Changed since',
      '3 Dec 2025',
    ]);
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByText('3 documents you may read.')).toBeInTheDocument();
  });

  it('filters by space and by publishing state, counting each, and clears', async () => {
    render(<DocumentList client={listed()} onOpen={vi.fn()} />);
    await screen.findByRole('link', { name: 'Operator manual' });

    // Counted from the documents listed.
    expect(screen.getByRole('checkbox', { name: /^General\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^Never published\s*1$/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /^General\s*2$/ }));
    expect(screen.queryByRole('link', { name: 'Training workbook' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Commissioning pack' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /^Published\s*1$/ }));
    expect(screen.queryByRole('link', { name: 'Operator manual' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Commissioning pack' })).toBeInTheDocument();
    expect(screen.getByText(/Showing 1 of 3/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('link', { name: 'Training workbook' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^General\s*2$/ })).not.toBeChecked();
  });

  it('offers New document as a dialog from the primary button', async () => {
    render(<DocumentList client={listed()} onOpen={vi.fn()} />);
    await screen.findByRole('link', { name: 'Operator manual' });

    await userEvent.click(screen.getByRole('button', { name: 'New document' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
