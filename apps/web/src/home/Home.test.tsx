import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Home } from './Home.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service(answers: Record<string, () => Response>) {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const answer = answers[new URL(request.url).pathname];
    return answer ? answer() : json(404, {});
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://home.test', fetch: fetching });
}

const everything = {
  '/v1/me': () => json(200, { id: 'p1', displayName: 'Ada Lovelace', email: null }),
  '/v1/tenant': () => json(200, { name: 'Development' }),
  '/v1/components': () => json(200, { items: [], next: null, total: 412, spaces: [] }),
  '/v1/documents': () => json(200, { items: [{}], next: 'more', total: 3 }),
  '/v1/publications': () => json(200, { items: [{}], next: null, total: 1 }),
};

describe('Home', () => {
  it('greets the reader and offers every module in its group, with how many there are to read', async () => {
    render(<Home client={service(everything)} />);

    expect(await screen.findByRole('heading', { name: 'Welcome back, Ada' })).toBeInTheDocument();
    expect(await screen.findByText('Development')).toBeInTheDocument();
    const group = (name: string) => screen.getByRole('region', { name });
    expect(
      within(group('Author'))
        .getAllByRole('link')
        .map((each) => each.getAttribute('href')),
    ).toEqual(['#/components', '#/documents', '#/templates']);
    expect(within(group('Publish')).getAllByRole('link')).toHaveLength(1);
    expect(
      within(group('Data'))
        .getAllByRole('link')
        .map((each) => each.getAttribute('href')),
    ).toEqual(['#/connections', '#/query-definitions']);

    const components = screen.getByRole('link', { name: /^Components/ });
    expect(await within(components).findByText('412')).toBeInTheDocument();
    expect(within(components).getByText('components you may read')).toBeInTheDocument();
    expect(
      within(components).getByText(
        'Write and version the typed pieces documents are assembled from.',
      ),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByRole('link', { name: /^Documents/ })).findByText('3'),
    ).toBeInTheDocument();
    const publications = screen.getByRole('link', { name: /^Publications/ });
    expect(await within(publications).findByText('1')).toBeInTheDocument();
    expect(within(publications).getByText('publication you may read')).toBeInTheDocument();
  });

  it('shows no total where the service gives none, rather than a guess', async () => {
    render(<Home client={service(everything)} />);

    const templates = await screen.findByRole('link', { name: /^Templates/ });
    expect(
      await within(screen.getByRole('link', { name: /^Components/ })).findByText('412'),
    ).toBeInTheDocument();
    expect(within(templates).queryByText(/\d/)).not.toBeInTheDocument();
  });

  it('leaves a total off when it could not be read', async () => {
    render(
      <Home
        client={service({
          ...everything,
          '/v1/me': () => json(200, { id: 'p1', displayName: null, email: null }),
          '/v1/documents': () => json(500, {}),
        })}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    const components = screen.getByRole('link', { name: /^Components/ });
    expect(await within(components).findByText('412')).toBeInTheDocument();
    const documents = screen.getByRole('link', { name: /^Documents/ });
    expect(within(documents).queryByText(/documents? you may read/)).not.toBeInTheDocument();
  });
});
