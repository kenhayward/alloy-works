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
  '/v1/documents': () => json(200, { items: [{}, {}, {}] }),
  '/v1/publications': () => json(200, { items: [{}] }),
};

describe('Home', () => {
  it('greets the reader and offers each module with what can be done there and how many there are', async () => {
    render(<Home client={service(everything)} />);

    expect(await screen.findByRole('heading', { name: 'Welcome back, Ada' })).toBeInTheDocument();
    expect(await screen.findByText('Development')).toBeInTheDocument();

    const components = screen.getByRole('link', { name: /^Components/ });
    expect(components).toHaveAttribute('href', '#/components');
    expect(await within(components).findByText('412')).toBeInTheDocument();
    expect(within(components).getByText('components you may read')).toBeInTheDocument();
    expect(within(components).getByText('Edit text, lists and marks')).toBeInTheDocument();

    const documents = screen.getByRole('link', { name: /^Documents/ });
    expect(documents).toHaveAttribute('href', '#/documents');
    expect(await within(documents).findByText('3')).toBeInTheDocument();

    const publications = screen.getByRole('link', { name: /^Publications/ });
    expect(publications).toHaveAttribute('href', '#/publications');
    expect(await within(publications).findByText('1')).toBeInTheDocument();
    expect(within(publications).getByText('publication you may read')).toBeInTheDocument();
  });

  it('says a document publishes to PDF and Word, and a publication downloads as either', async () => {
    render(<Home client={service(everything)} />);

    const documents = await screen.findByRole('link', { name: /^Documents/ });
    expect(
      within(documents).getByText('Publish as a tagged PDF, a Word document or both'),
    ).toBeInTheDocument();
    expect(within(documents).queryByText('Publish as a tagged PDF')).not.toBeInTheDocument();

    const publications = screen.getByRole('link', { name: /^Publications/ });
    expect(
      within(publications).getByText('Download the PDF or the Word document'),
    ).toBeInTheDocument();
    expect(within(publications).queryByText('Download the PDF')).not.toBeInTheDocument();
    // The totals arrive after the first render; waiting for one keeps React's update inside the test.
    expect(await within(publications).findByText('1')).toBeInTheDocument();
  });

  it('leaves a total off its card when it could not be read', async () => {
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
