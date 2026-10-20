import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { EmbeddingPanel } from './EmbeddingPanel.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const inside = { id: 'e1', name: 'Our embedder', boundary: 'inside', retired: false };

function service() {
  const sent: unknown[] = [];
  let view = {
    serving: { model: 'embed-small-768', dims: 768, endpoint: inside },
    pending: {
      model: 'embed-large-1024',
      dims: null as number | null,
      endpoint: { ...inside, id: 'e2', name: 'Bigger embedder' },
      confirmed: false,
      texts: 12000,
      missing: 12000,
      estimate: { tokens: 3_400_000, cost: '0.442000', currency: 'USD' },
    },
  };
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (path === '/v1/embedding') return json(200, view);
    if (path === '/v1/embedding/confirmation') {
      sent.push(await request.json());
      view = { ...view, pending: { ...view.pending, confirmed: true, dims: 1024, missing: 11000 } };
      return json(200, view);
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

describe("Models' searching by meaning", () => {
  it('GEN-044 shows what embedding the corpus would cost before it runs, embedding nothing until it is confirmed, the old model serving meanwhile', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<EmbeddingPanel client={client} generation={0} />);
    const panel = await screen.findByRole('region', { name: 'Searching by meaning' });
    expect(panel).toHaveTextContent('Meaning is searched by embed-small-768, on Our embedder.');
    expect(panel).toHaveTextContent(
      'Embedding is routed to embed-large-1024, on Bigger embedder. Embedding the 12000 of 12000 texts it lacks would take about 3,400,000 tokens, about USD 0.44. Nothing is embedded until you confirm it, and embed-small-768 goes on serving until it is done.',
    );
    await user.click(within(panel).getByRole('button', { name: 'Confirm and embed' }));
    expect(sent).toEqual([{ model: 'embed-large-1024' }]);
    expect(
      await within(panel).findByText(
        'embed-large-1024 is embedding the parts: 1000 of 12000 texts done. embed-small-768 serves until it is done.',
      ),
    ).toBeInTheDocument();
  });
});
