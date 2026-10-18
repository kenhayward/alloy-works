import { createApiClient } from '@alloy-works/api-client';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Conversations } from './Conversations.js';

const DOCUMENT = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const NOW = '2026-10-18T09:00:00.000Z';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const client = createApiClient({
  baseUrl: 'http://conversations.test',
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (path === '/v1/conversations') {
      return json(200, {
        items: [
          { id: 'c1', document: null, title: 'About cats', madeAt: NOW },
          { id: 'c2', document: DOCUMENT, title: 'About the weir', madeAt: NOW },
        ],
      });
    }
    if (path === '/v1/conversation-endpoints') return json(200, { items: [] });
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch,
});

describe('the Conversations page', () => {
  it('holds conversations on no document, and links each on a document to it', async () => {
    render(<Conversations client={client} />);
    expect(await screen.findByRole('option', { name: 'About cats' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'About the weir' })).toBeNull();
    expect(await screen.findByRole('link', { name: 'About the weir' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}`,
    );
  });
});
