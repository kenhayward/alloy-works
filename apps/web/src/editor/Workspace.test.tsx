import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Workspace } from './Workspace.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const me = { id: 'p1', displayName: 'Ada', email: null, environment: 'Development' };

function serviceThat(pages: Record<string, unknown>, signedIn = true) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/me') {
      return signedIn
        ? json(200, me)
        : json(401, { code: 'unauthenticated', message: 'x', traceId: 't' });
    }
    if (url.pathname === '/v1/components') {
      return json(200, pages[url.searchParams.get('cursor') ?? 'first']);
    }
    return json(404, { code: 'not_found', message: 'none', traceId: 't' });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('the workspace', () => {
  it('lists the components the signed-in person may read, a page at a time, each a link to open it', async () => {
    const fetching = serviceThat({
      first: {
        items: [
          {
            id: COMPONENT,
            title: 'Install the printer',
            space: { id: 's1', name: 'General' },
            version: '0.2',
          },
        ],
        next: 'page-two',
      },
      'page-two': {
        items: [
          {
            id: '7b1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21',
            title: 'Replace the toner',
            space: { id: 's1', name: 'General' },
            version: '0.1',
          },
        ],
        next: null,
      },
    });
    render(<Workspace fetch={fetching} />);
    const link = await screen.findByRole('link', { name: 'Install the printer' });
    expect(link).toHaveAttribute('href', `#/components/${COMPONENT}`);
    expect(screen.getByText(/version 0\.2 in/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('link', { name: 'Replace the toner' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install the printer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('says so when there is nothing to read', async () => {
    render(<Workspace fetch={serviceThat({ first: { items: [], next: null } })} />);
    expect(await screen.findByText('There are no components you may read.')).toBeInTheDocument();
  });

  it('opens the component the address names', async () => {
    window.location.hash = `#/components/${COMPONENT}`;
    render(<Workspace fetch={serviceThat({})} />);
    expect(await screen.findByRole('link', { name: 'Back to components' })).toBeInTheDocument();
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });

  it('shows nothing to somebody not signed in, whose way in is the environment panel', async () => {
    const fetching = serviceThat({}, false);
    const { container } = render(<Workspace fetch={fetching} />);
    await vi.waitFor(() => expect(fetching).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('says the workspace could not be loaded, rather than showing nothing, when asking who is signed in fails, and loads on Try again', async () => {
    let attempts = 0;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') {
        attempts += 1;
        if (attempts === 1) return json(500, { code: 'internal', message: 'x', traceId: 't' });
        if (attempts === 2) throw new Error('network down');
        return json(200, me);
      }
      if (url.pathname === '/v1/components') return json(200, { items: [], next: null });
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;

    render(<Workspace fetch={fetching} />);
    expect(await screen.findByText('The workspace could not be loaded.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(attempts).toBe(2));
    expect(await screen.findByText('The workspace could not be loaded.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('There are no components you may read.')).toBeInTheDocument();
  });

  it('offers to try again when the first page fails to load, and succeeds on retry', async () => {
    let attempt = 0;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === '/v1/components') {
        attempt += 1;
        if (attempt === 1) return json(500, { code: 'failed', message: 'x', traceId: 't' });
        return json(200, {
          items: [
            {
              id: COMPONENT,
              title: 'Install the printer',
              space: { id: 's1', name: 'General' },
              version: '0.2',
            },
          ],
          next: null,
        });
      }
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;

    render(<Workspace fetch={fetching} />);
    expect(await screen.findByText('The components could not be loaded.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Install the printer' })).toBeInTheDocument();
  });

  it('keeps what is already shown, and offers to try again, when a later page fails to load', async () => {
    let nextAttempts = 0;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === '/v1/components') {
        const cursor = url.searchParams.get('cursor');
        if (cursor === null) {
          return json(200, {
            items: [
              {
                id: COMPONENT,
                title: 'Install the printer',
                space: { id: 's1', name: 'General' },
                version: '0.2',
              },
            ],
            next: 'page-two',
          });
        }
        nextAttempts += 1;
        if (nextAttempts === 1) return json(500, { code: 'failed', message: 'x', traceId: 't' });
        return json(200, {
          items: [
            {
              id: '7b1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21',
              title: 'Replace the toner',
              space: { id: 's1', name: 'General' },
              version: '0.1',
            },
          ],
          next: null,
        });
      }
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;

    render(<Workspace fetch={fetching} />);
    await screen.findByRole('link', { name: 'Install the printer' });
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('The components could not be loaded.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install the printer' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Replace the toner' })).toBeInTheDocument();
  });

  it('sends one request, not two, when Show more is clicked again before the first answers', async () => {
    const release: { current: (() => void) | null } = { current: null };
    let pageTwoRequests = 0;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === '/v1/components') {
        const cursor = url.searchParams.get('cursor');
        if (cursor === null) {
          return json(200, {
            items: [
              {
                id: COMPONENT,
                title: 'Install the printer',
                space: { id: 's1', name: 'General' },
                version: '0.2',
              },
            ],
            next: 'page-two',
          });
        }
        pageTwoRequests += 1;
        return new Promise<Response>((resolve) => {
          release.current = () =>
            resolve(
              json(200, {
                items: [
                  {
                    id: '7b1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21',
                    title: 'Replace the toner',
                    space: { id: 's1', name: 'General' },
                    version: '0.1',
                  },
                ],
                next: null,
              }),
            );
        });
      }
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;

    render(<Workspace fetch={fetching} />);
    const button = await screen.findByRole('button', { name: 'Show more' });
    fireEvent.click(button);
    fireEvent.click(button);
    release.current?.();
    expect(await screen.findByRole('link', { name: 'Replace the toner' })).toBeInTheDocument();
    expect(pageTwoRequests).toBe(1);
    expect(screen.getAllByRole('link', { name: 'Replace the toner' })).toHaveLength(1);
  });
});
