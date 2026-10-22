import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ReferenceSources } from './ReferenceSources.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  const on: Record<string, boolean> = { crossref: true, pubmed: true };
  const put: unknown[] = [];
  const view = (id: 'crossref' | 'pubmed') =>
    id === 'crossref'
      ? { id, name: 'Crossref', host: 'api.crossref.org', identifier: 'DOI', enabled: on[id] }
      : {
          id,
          name: 'PubMed',
          host: 'eutils.ncbi.nlm.nih.gov',
          identifier: 'PMID',
          enabled: on[id],
        };
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (request.method === 'PUT') {
      const body = (await request.json()) as { source: 'crossref' | 'pubmed'; enabled: boolean };
      put.push(body);
      on[body.source] = body.enabled;
      return json(200, view(body.source));
    }
    return json(200, { items: [view('crossref'), view('pubmed')] });
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), put };
}

describe("Administration's Reference sources (the XR plan, XR-C)", () => {
  it('LIB-032 shows each declared source, on by default, and lets an administrator switch one off', async () => {
    const { client, put } = service();
    render(<ReferenceSources client={client} mayChange />);
    const pubmed = await screen.findByRole('checkbox', { name: /PubMed/ });
    expect(pubmed).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Crossref/ })).toBeChecked();
    expect(screen.getByText(/eutils\.ncbi\.nlm\.nih\.gov/)).toBeInTheDocument();
    await userEvent.click(pubmed);
    await waitFor(() => expect(put).toEqual([{ source: 'pubmed', enabled: false }]));
    expect(await screen.findByText('PubMed is off.')).toBeInTheDocument();
    expect(pubmed).not.toBeChecked();
  });

  it('shows the sources to somebody who may not switch them, unchangeable', async () => {
    const { client } = service();
    render(<ReferenceSources client={client} mayChange={false} />);
    expect(await screen.findByRole('checkbox', { name: /Crossref/ })).toBeDisabled();
    expect(screen.getByText(/Only an administrator/)).toBeInTheDocument();
  });
});
