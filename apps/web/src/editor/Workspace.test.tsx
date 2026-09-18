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
    // The list mounts `NewComponent` beside it, which reads this itself (S26): answered here so
    // every test that reaches the list is not also, incidentally, exercising a failed spaces read.
    if (url.pathname === '/v1/spaces') return json(200, { items: [] });
    if (url.pathname === '/v1/access' && pages.access) return json(200, pages.access);
    return json(404, { code: 'not_found', message: 'none', traceId: 't' });
  }) as unknown as typeof fetch;
}

const answers = (administer: boolean) => ({
  target: `artifact:${COMPONENT}`,
  permissions: [
    { permission: 'read', allowed: true },
    { permission: 'administer', allowed: administer },
  ],
});

const COMPONENT_TWO = '7b1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';

const componentBody = (id: string, title: string, mayEdit = false) => ({
  id,
  space: { id: 's1', name: 'General' },
  version: {
    id: 'v1',
    number: '0.1',
    author: 'p1',
    createdAt: '2026-09-17T09:00:00.000Z',
    note: null,
  },
  content: {
    schemaVersion: 1,
    title,
    language: 'en-GB',
    direction: 'ltr',
    content: [
      {
        type: 'paragraph',
        id: 'b1',
        style: 'body',
        content: [{ type: 'text', value: 'Text.', marks: [] }],
      },
    ],
  },
  mayEdit,
  lock: null,
});

/**
 * Every route the access page needs, for one or more components by id: the component itself, the
 * people and roles it offers to choose from (empty, which is enough to reach the open state), and an
 * empty grants listing at whatever level is asked.
 */
function accessService(titles: Record<string, string>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/me') return json(200, me);
    for (const [id, title] of Object.entries(titles)) {
      if (url.pathname === `/v1/components/${id}`) return json(200, componentBody(id, title));
    }
    if (url.pathname === '/v1/principals' || url.pathname === '/v1/roles') {
      return json(200, { items: [], next: null });
    }
    if (url.pathname === '/v1/grants') return json(200, { items: [], next: null });
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

  it('offers Manage access beside an open component only to someone who may administer it', async () => {
    window.location.hash = `#/components/${COMPONENT}`;
    const { unmount } = render(<Workspace fetch={serviceThat({ access: answers(true) })} />);
    expect(await screen.findByRole('link', { name: 'Manage access' })).toHaveAttribute(
      'href',
      `#/components/${COMPONENT}/access`,
    );
    unmount();

    let asked = false;
    const refusing = serviceThat({ access: answers(false) });
    const watching = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname === '/v1/access') asked = true;
      return refusing(request);
    }) as typeof fetch;
    render(<Workspace fetch={watching} />);
    await screen.findByRole('link', { name: 'Back to components' });
    await vi.waitFor(() => expect(asked).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('link', { name: 'Manage access' })).toBeNull();
  });

  it('opens the access page the address names, with a way back to the component', async () => {
    window.location.hash = `#/components/${COMPONENT}/access`;
    render(<Workspace fetch={serviceThat({})} />);
    expect(await screen.findByRole('link', { name: 'Back to the component' })).toHaveAttribute(
      'href',
      `#/components/${COMPONENT}`,
    );
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });

  it('mounts a fresh access page for each component, never showing what an earlier one left behind', async () => {
    window.location.hash = `#/components/${COMPONENT}/access`;
    const fetching = accessService({
      [COMPONENT]: 'Install the printer',
      [COMPONENT_TWO]: 'Replace the toner',
    });
    render(<Workspace fetch={fetching} />);
    await screen.findByRole('heading', { name: 'Access to Install the printer' });
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    expect(await screen.findByText('Choose a person, a role and where.')).toBeInTheDocument();

    window.location.hash = `#/components/${COMPONENT_TWO}/access`;
    fireEvent(window, new HashChangeEvent('hashchange'));

    expect(
      await screen.findByRole('heading', { name: 'Access to Replace the toner' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Choose a person, a role and where.')).toBeNull();
  });

  it('unmounts the editor the normal way when its access page is opened, with no second editor and no remount loop', async () => {
    window.location.hash = `#/components/${COMPONENT}`;
    const fetching = accessService({ [COMPONENT]: 'Install the printer' });
    render(<Workspace fetch={fetching} />);
    await screen.findByRole('textbox', { name: 'Content of Install the printer' });

    window.location.hash = `#/components/${COMPONENT}/access`;
    fireEvent(window, new HashChangeEvent('hashchange'));

    expect(
      await screen.findByRole('heading', { name: 'Access to Install the printer' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Content of Install the printer' })).toBeNull();
    // Settled, not mid-loop: the surface stays gone and the heading stays single a tick later.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('textbox', { name: 'Content of Install the printer' })).toBeNull();
    expect(screen.getAllByRole('heading', { name: 'Access to Install the printer' })).toHaveLength(
      1,
    );
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
      if (url.pathname === '/v1/spaces') return json(200, { items: [] });
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
      if (url.pathname === '/v1/spaces') return json(200, { items: [] });
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
      if (url.pathname === '/v1/spaces') return json(200, { items: [] });
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
      if (url.pathname === '/v1/spaces') return json(200, { items: [] });
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

  it('offers Documents beside Components, and lists the documents the address asks for', async () => {
    const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === '/v1/components') return json(200, { items: [], next: null });
      if (url.pathname === '/v1/spaces') return json(200, { items: [] });
      if (url.pathname === '/v1/documents') {
        return json(200, {
          items: [
            {
              id: DOCUMENT,
              title: 'The dosing report',
              space: { id: 's1', name: 'General' },
              version: '0.1',
            },
          ],
        });
      }
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;

    render(<Workspace fetch={fetching} />);
    const documents = await screen.findByRole('link', { name: 'Documents' });
    expect(documents).toHaveAttribute('href', '#/documents');
    expect(screen.getByRole('link', { name: 'Components' })).toHaveAttribute('href', '#/');

    window.location.hash = '#/documents';
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(await screen.findByRole('link', { name: 'The dosing report' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}`,
    );
    expect(screen.queryByRole('heading', { name: 'Components' })).toBeNull();
  });

  it('opens the document the address names, with a way back to the documents', async () => {
    window.location.hash = '#/documents/eeeeeeee-0000-4000-8000-000000000001';
    render(<Workspace fetch={serviceThat({})} />);
    expect(await screen.findByRole('link', { name: 'Back to documents' })).toHaveAttribute(
      'href',
      '#/documents',
    );
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });
});
