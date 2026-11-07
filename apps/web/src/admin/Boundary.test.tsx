import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Boundary } from './Boundary.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const way = (name: string, more: Record<string, unknown> = {}) => ({
  way: name,
  what: 'What may leave, in the service’s words.',
  onByDefault: false,
  changedBy: { operation: 'setModelRoute', permission: 'configure_services' },
  residency: 'not_declared',
  absent: null,
  on: false,
  items: [],
  ...more,
});

const BOUNDARY = {
  ways: [
    way('model_endpoint', {
      residency: 'endpoint',
      on: true,
      items: [
        {
          id: 'e1',
          name: 'Hosted',
          on: true,
          host: 'hosted.example.test',
          boundary: 'outside',
          detail: null,
        },
      ],
    }),
    way('reference_source', {
      onByDefault: true,
      on: true,
      changedBy: { operation: 'setReferenceSource', permission: 'configure_services' },
      items: [
        {
          id: 'crossref',
          name: 'Crossref',
          on: true,
          host: 'api.crossref.org',
          boundary: null,
          detail: null,
        },
        {
          id: 'pubmed',
          name: 'PubMed',
          on: false,
          host: 'eutils.ncbi.nlm.nih.gov',
          boundary: null,
          detail: null,
        },
      ],
    }),
    way('malware_scanning', { changedBy: null, absent: 'No scanning service exists (AST-Q03).' }),
    way('webhook', {
      changedBy: { operation: 'createWebhook', permission: 'configure_webhooks' },
    }),
  ],
};

/** The service as the section meets it: whether the reader administers, and the boundary. */
function service(administers: boolean) {
  const asked: string[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    asked.push(url.pathname);
    if (url.pathname === '/v1/access') {
      return json(200, {
        target: url.searchParams.get('target'),
        permissions: [
          { permission: 'read', allowed: true },
          { permission: 'administer', allowed: administers },
        ],
      });
    }
    if (url.pathname === '/v1/boundary') return json(200, BOUNDARY);
    return json(404, { code: 'not_found', message: 'Not found' });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), asked };
}

describe("Administration's What leaves", () => {
  it('ADM-041 shows each way out: what may leave, whether on by default, who may change it, residency and what is set up here', async () => {
    const { client } = service(true);
    render(<Boundary client={client} />);
    const list = await screen.findByRole('list', { name: 'What leaves' });
    const ways = within(list).getAllByRole('region');
    expect(ways).toHaveLength(4);
    const fact = (way: HTMLElement, term: string) =>
      within(way).getByText(term, { selector: 'dt' }).nextElementSibling;
    const models = screen.getByRole('region', { name: 'Model endpoints' });
    expect(models).toHaveTextContent('Each endpoint says whether it is inside or outside');
    expect(fact(models, 'Before anyone changes it')).toHaveTextContent('Off');
    expect(fact(models, 'Who may change it')).toHaveTextContent('Whoever may configure services');
    expect(fact(models, 'Set up here')).toHaveTextContent(
      'Hosted, on, to hosted.example.test, outside your data boundary',
    );
    expect(within(models).getByRole('link', { name: 'Change Model endpoints' })).toHaveAttribute(
      'href',
      '#/admin/models',
    );
    const sources = screen.getByRole('region', { name: 'Reference sources' });
    expect(fact(sources, 'Before anyone changes it')).toHaveTextContent('On');
    expect(fact(sources, 'Residency')).toHaveTextContent('Not declared');
    expect(within(sources).getAllByRole('listitem')[1]).toHaveTextContent('PubMed, off');
    expect(within(sources).getByRole('link')).toHaveAttribute('href', '#/admin/reference-sources');
    const scanning = screen.getByRole('region', { name: 'Malware scanning' });
    expect(scanning).toHaveTextContent('No scanning service exists yet.');
    expect(within(scanning).queryByRole('link')).toBeNull();
    const webhooks = screen.getByRole('region', { name: 'Webhooks' });
    expect(fact(webhooks, 'Who may change it')).toHaveTextContent('Whoever may configure webhooks');
    expect(fact(webhooks, 'Set up here')).toHaveTextContent('Nothing set up');
    expect(within(webhooks).getByRole('link')).toHaveAttribute('href', '#/admin/webhooks');
  });

  it('asks the service first, and sends one who does not administer nothing more', async () => {
    const { client, asked } = service(false);
    render(<Boundary client={client} />);
    expect(
      await screen.findByText(
        'You need permission to administer the environment to see what leaves it.',
      ),
    ).toBeInTheDocument();
    expect(asked).not.toContain('/v1/boundary');
  });
});
