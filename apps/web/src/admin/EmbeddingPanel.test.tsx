import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { EmbeddingPanel } from './EmbeddingPanel.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const inside = { id: 'e1', name: 'Our embedder', boundary: 'inside', retired: false };

const measured = { versions: 20, p95Seconds: 1.4, maxSeconds: 4.02 };

function service(freshness: unknown = measured, confirming?: () => Response | Promise<Response>) {
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
    if (path === '/v1/search/meaning/freshness') return json(200, freshness);
    if (path === '/v1/embedding/confirmation') {
      sent.push(await request.json());
      if (confirming) return confirming();
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
      'Embedding is routed to embed-large-1024, on Bigger embedder. Embedding the 12,000 of 12,000 texts it lacks would take about 3,400,000 tokens, about USD 0.44. Nothing is embedded until you confirm it, and embed-small-768 goes on serving until it is done.',
    );
    await user.click(within(panel).getByRole('button', { name: 'Confirm and embed' }));
    expect(sent).toEqual([{ model: 'embed-large-1024' }]);
    expect(
      await within(panel).findByText(
        'embed-large-1024 is embedding the parts: 1,000 of 12,000 texts done. embed-small-768 serves until it is done.',
      ),
    ).toBeInTheDocument();
  });

  it('SCH-067 shows how long new versions took to be findable by meaning over the last seven days', async () => {
    render(<EmbeddingPanel client={service().client} generation={0} />);
    expect(
      await screen.findByText(
        'Findable by meaning within 2 s at p95, at most 5 s, over 20 versions in the last 7 days.',
      ),
    ).toBeInTheDocument();
  });

  it('says when nothing has been measured yet', async () => {
    const none = { versions: 0, p95Seconds: null, maxSeconds: null };
    render(<EmbeddingPanel client={service(none).client} generation={0} />);
    expect(
      await screen.findByText(
        'How long new versions take to be findable by meaning has not been measured in the last 7 days.',
      ),
    ).toBeInTheDocument();
  });

  it("says why confirming failed, in the service's words", async () => {
    const user = userEvent.setup();
    const { client } = service(measured, () =>
      json(409, {
        code: 'embedding_unavailable',
        message: 'The model did not answer a sample: The endpoint did not finish in time.',
      }),
    );
    render(<EmbeddingPanel client={client} generation={0} />);
    const panel = await screen.findByRole('region', { name: 'Searching by meaning' });
    await user.click(within(panel).getByRole('button', { name: 'Confirm and embed' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'embed-large-1024 could not be confirmed: The model did not answer a sample: The endpoint did not finish in time.',
    );
    expect(within(panel).getByRole('button', { name: 'Confirm and embed' })).toBeEnabled();
  });

  it('says so when the service could not be reached, or failed without saying why', async () => {
    const user = userEvent.setup();
    let failing: () => Response = () => {
      throw new TypeError('Failed to fetch');
    };
    const { client } = service(measured, () => failing());
    render(<EmbeddingPanel client={client} generation={0} />);
    const panel = await screen.findByRole('region', { name: 'Searching by meaning' });
    await user.click(within(panel).getByRole('button', { name: 'Confirm and embed' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'embed-large-1024 could not be confirmed: the service could not be reached.',
    );
    failing = () => new Response('', { status: 500 });
    await user.click(within(panel).getByRole('button', { name: 'Confirm and embed' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'embed-large-1024 could not be confirmed: the service failed (HTTP 500).',
    );
  });
});
