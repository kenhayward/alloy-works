import { defaultLayout, OUTLINE_SCHEMA_VERSION } from '@alloy-works/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DOCK_KEY } from '../structure/DocumentPage.js';
import { Workspace } from './Workspace.js';

/** The environment's layout, as every `DocumentView` carries it: what the page numbers with. */
const LAYOUT = {
  id: 'llllllll-0000-4000-8000-000000000001',
  version: { id: 'llllllll-0000-4000-8000-000000000002', number: '0.1' },
  language: defaultLayout.language,
  scheme: defaultLayout.scheme,
};

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';

/**
 * A listing as the service answers it since the components list gained its columns (interface
 * slice 3): a total and the spaces to filter by beside the page, and each component's type,
 * language and last change. These tests are about the workspace around the list, so the fakes
 * below name only what each is about and this fills in the rest.
 */
function asListed(body: unknown): unknown {
  if (typeof body !== 'object' || body === null || !('items' in body) || !('next' in body)) {
    return body;
  }
  const { items } = body as { items: Record<string, unknown>[] };
  return {
    total: items.length,
    spaces: [],
    ...body,
    items: items.map((item) =>
      'space' in item && 'version' in item
        ? {
            type: 'Topic',
            language: 'en-GB',
            changedAt: '2026-09-01T09:00:00.000Z',
            changedBy: null,
            ...item,
          }
        : item,
    ),
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(asListed(body)), {
    status,
    headers: { 'content-type': 'application/json' },
  });

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
    if (url.pathname === '/v1/spaces') return json(200, { items: [], next: null });
    if (url.pathname === '/v1/access' && pages.access) return json(200, pages.access);
    if (url.pathname === '/v1/search' && pages.search) {
      return json(200, { ...(pages.search as object), asked: url.searchParams.get('q') });
    }
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
  type: { id: 'type-topic', name: 'Topic' },
  fields: [],
  schemas: [],
  values: {},
});

/**
 * Every route the access page needs, for one or more components by id: the component itself, the
 * people and roles it offers to choose from (empty, which is enough to reach the open state), and an
 * empty grants listing at whatever level is asked.
 */
function accessService(
  titles: Record<string, string>,
  others: {
    documents?: Record<string, string>;
    templates?: Record<string, string>;
    connections?: Record<string, string>;
  } = {},
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/me') return json(200, me);
    for (const [id, title] of Object.entries(titles)) {
      if (url.pathname === `/v1/components/${id}`) return json(200, componentBody(id, title));
    }
    const space = { id: 's1', name: 'General' };
    const version = {
      id: 'v1',
      number: '0.1',
      author: 'p1',
      createdAt: '2026-09-17T09:00:00.000Z',
      note: null,
    };
    for (const [id, title] of Object.entries(others.documents ?? {})) {
      if (url.pathname === `/v1/documents/${id}`) {
        return json(200, { id, space, version, outline: { title, nodes: [] } });
      }
    }
    for (const [id, name] of Object.entries(others.templates ?? {})) {
      if (url.pathname === `/v1/templates/${id}`) {
        return json(200, { id, space, version, definition: { name }, mayDesign: true });
      }
    }
    for (const [id, name] of Object.entries(others.connections ?? {})) {
      if (url.pathname === `/v1/connections/${id}`) {
        return json(200, { id, space, version, settings: { name } });
      }
    }
    if (url.pathname === '/v1/principals' || url.pathname === '/v1/roles') {
      return json(200, { items: [], next: null });
    }
    if (url.pathname === '/v1/grants') return json(200, { items: [], next: null });
    return json(404, { code: 'not_found', message: 'none', traceId: 't' });
  }) as unknown as typeof fetch;
}

// The components list is at #/components since Home took #/ (interface slice 11); a test about some
// other address sets its own.
beforeEach(() => {
  window.location.hash = '#/components';
});

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
  window.localStorage.removeItem(DOCK_KEY);
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
    // The version is its own column since the list became a table (interface slice 3).
    expect(within(link.closest('tr')!).getByRole('cell', { name: '0.2' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('link', { name: 'Replace the toner' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Install the printer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('greets the reader on Home, at #/ and the empty hash', async () => {
    for (const hash of ['#/', '']) {
      window.location.hash = hash;
      const { unmount } = render(
        <Workspace fetch={serviceThat({ first: { items: [], next: null } })} />,
      );
      expect(await screen.findByRole('heading', { name: 'Welcome back, Ada' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^Components/ })).toHaveAttribute(
        'href',
        '#/components',
      );
      unmount();
    }
  });

  it('opens Administration at its address, at the section it names', async () => {
    window.location.hash = '#/admin/about';
    render(<Workspace fetch={serviceThat({ first: { items: [], next: null } })} />);
    expect(
      await screen.findByRole('heading', { name: 'About and release notes', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Administration' })).toBeInTheDocument();
  });

  it('says so when there is nothing to read', async () => {
    render(<Workspace fetch={serviceThat({ first: { items: [], next: null } })} />);
    expect(await screen.findByText('There are no components you may read.')).toBeInTheDocument();
  });

  it('opens Search at its address, holding the query in it', async () => {
    window.location.hash = '#/search?q=lever';
    const nothing = { outcome: 'empty', message: 'Type what to look for.' };
    render(<Workspace fetch={serviceThat({ search: nothing })} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('lever');
    expect(await screen.findByRole('status')).toHaveTextContent('Type what to look for.');
    const box = screen.getByRole('searchbox', { name: 'Search' });
    await userEvent.clear(box);
    await userEvent.type(box, 'hand lever{Enter}');
    expect(window.location.hash).toBe('#/search?q=hand+lever');
  });

  it('keeps a module as it was left while another is open, and shows it again unchanged', async () => {
    window.location.hash = '#/search?q=lever';
    const nothing = { outcome: 'empty', message: 'Type what to look for.' };
    render(
      <Workspace fetch={serviceThat({ search: nothing, first: { items: [], next: null } })} />,
    );
    const box = await screen.findByRole('searchbox', { name: 'Search' });
    await userEvent.type(box, ' arm');

    const leave = (hash: string) => {
      const oldURL = window.location.href;
      window.location.hash = hash;
      fireEvent(
        window,
        new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }),
      );
    };
    leave('#/components');
    expect(await screen.findByText('There are no components you may read.')).toBeVisible();
    // Search is still there, hidden, with what was typed and never sent.
    expect(screen.getByRole('searchbox', { name: 'Search', hidden: true })).not.toBeVisible();

    leave('#/search?q=lever');
    const again = await screen.findByRole('searchbox', { name: 'Search' });
    expect(again).toBe(box);
    expect(again).toHaveValue('lever arm');
    // A list is not kept: it is read afresh when next opened.
    expect(screen.queryByText('There are no components you may read.')).toBeNull();
  });

  it('reads a list afresh on returning to it, since what it lists may have changed meanwhile', async () => {
    window.location.hash = '#/components';
    const fetching = serviceThat({
      search: { outcome: 'empty', message: 'Type what to look for.' },
      first: { items: [], next: null },
    });
    render(<Workspace fetch={fetching} />);
    await screen.findByText('There are no components you may read.');
    const listed = () =>
      vi
        .mocked(fetching)
        .mock.calls.filter(
          ([input]) =>
            new URL(input instanceof Request ? input.url : String(input)).pathname ===
            '/v1/components',
        ).length;
    const before = listed();

    for (const hash of ['#/search?q=lever', '#/components']) {
      const oldURL = window.location.href;
      window.location.hash = hash;
      fireEvent(
        window,
        new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }),
      );
    }
    await screen.findByText('There are no components you may read.');
    await waitFor(() => expect(listed()).toBeGreaterThan(before));
  });

  it('opens the component the address names, under a trail back to the components', async () => {
    window.location.hash = `#/components/${COMPONENT}`;
    render(<Workspace fetch={serviceThat({})} />);
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Components' })).toHaveAttribute(
      'href',
      '#/components',
    );
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
  });

  it('shows the components of its space beside an open component, the open one marked', async () => {
    window.location.hash = `#/components/${COMPONENT}`;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === `/v1/components/${COMPONENT}`) {
        return json(200, componentBody(COMPONENT, 'Install the printer'));
      }
      if (url.pathname === '/v1/components' && url.searchParams.get('spaces') === 's1') {
        return json(200, {
          items: [
            {
              id: COMPONENT,
              title: 'Install the printer',
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

    const pane = await screen.findByRole('navigation', { name: 'General' });
    expect(await within(pane).findByRole('link', { name: /Install the printer/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it("sizes and hides the space pane and the panels beside an open component, as the document page does, the panels' tabs outside what scrolls", async () => {
    window.location.hash = `#/components/${COMPONENT}`;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === `/v1/components/${COMPONENT}`) {
        return json(200, componentBody(COMPONENT, 'Install the printer'));
      }
      if (url.pathname === '/v1/components' && url.searchParams.get('spaces') === 's1') {
        return json(200, { items: [], next: null });
      }
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<Workspace fetch={fetching} />);
    await screen.findByRole('navigation', { name: 'General' });

    const space = screen.getByRole('separator', { name: 'Resize the space pane' });
    space.focus();
    await user.keyboard('{ArrowRight}');
    expect(space).toHaveAttribute('aria-valuenow', '270');
    const panels = screen.getByRole('separator', { name: 'Resize the component panels' });
    panels.focus();
    await user.keyboard('{ArrowLeft}');
    expect(panels).toHaveAttribute('aria-valuenow', '330');

    // The tabs stand apart from the panels' body, which alone scrolls.
    const tabs = screen.getByRole('tablist', { name: 'Component panels' });
    const panel = screen.getByRole('tabpanel', { name: 'Attributes' });
    expect(panel.parentElement?.contains(tabs)).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Hide the space pane' }));
    expect(screen.queryByRole('navigation', { name: 'General' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Hide the component panels' }));
    // Hidden, kept in the page, so the fields keep what is being typed into them.
    expect(screen.getByRole('tabpanel', { name: 'Attributes', hidden: true })).not.toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show the component panels' }));
    expect(screen.getByRole('tabpanel', { name: 'Attributes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Show the space pane' }));
    expect(await screen.findByRole('navigation', { name: 'General' })).toBeInTheDocument();
  });

  it('sets an open component beside its panels, named in words: Attributes, with the fields of its type, Versions and Access', async () => {
    window.location.hash = `#/components/${COMPONENT}`;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === `/v1/components/${COMPONENT}`) {
        return json(200, {
          ...componentBody(COMPONENT, 'Install the printer'),
          type: { id: 'type-protocol', name: 'Protocol' },
          fields: [
            {
              id: 'field-code',
              name: 'Code',
              dataType: 'text',
              multiplicity: 'one',
              validation: { maxLength: 4 },
              required: false,
              requiredBy: [],
              fixed: false,
              fixedBy: [],
            },
          ],
          values: { 'field-code': 'A1' },
        });
      }
      if (url.pathname === `/v1/components/${COMPONENT}/versions`) {
        return json(200, {
          items: [
            {
              id: 'v1',
              number: '0.1',
              createdAt: '2026-09-17T09:00:00.000Z',
              author: { id: 'p1', name: 'Ada' },
              note: 'First cut',
            },
          ],
          next: null,
        });
      }
      if (url.pathname === '/v1/people') return json(200, { items: [], next: null });
      if (url.pathname === '/v1/access') return json(200, answers(true));
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;
    render(<Workspace fetch={fetching} />);

    const tabs = await screen.findByRole('tablist', { name: 'Component panels' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Attributes', 'Versions', 'Access']);
    const attributes = screen.getByRole('tabpanel', { name: 'Attributes' });
    const fields = await within(attributes).findByRole('region', { name: 'Fields of Protocol' });
    expect(within(fields).getByRole('textbox', { name: /^Code/ })).toHaveValue('A1');

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Versions' }));
    const versions = screen.getByRole('tabpanel', { name: 'Versions' });
    expect(await within(versions).findByText('Ada, 17 Sept', { exact: false })).toBeInTheDocument();
    expect(within(versions).getByText('First cut')).toBeInTheDocument();

    await userEvent.click(within(tabs).getByRole('tab', { name: 'Access' }));
    const access = screen.getByRole('tabpanel', { name: 'Access' });
    expect(await within(access).findByRole('link', { name: 'Manage access' })).toHaveAttribute(
      'href',
      `#/components/${COMPONENT}/access`,
    );
  });

  it('offers Manage access beside an open component only to someone who may administer it', async () => {
    window.location.hash = `#/components/${COMPONENT}`;
    const { unmount } = render(<Workspace fetch={serviceThat({ access: answers(true) })} />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Access' }));
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
    await userEvent.click(await screen.findByRole('tab', { name: 'Access' }));
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

  it('opens the access page of the document the address names, with a way back to the document', async () => {
    const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
    window.location.hash = `#/documents/${DOCUMENT}/access`;
    render(
      <Workspace fetch={accessService({}, { documents: { [DOCUMENT]: 'The dosing report' } })} />,
    );
    expect(
      await screen.findByRole('heading', { name: 'Access to The dosing report' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the document' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}`,
    );
    expect(screen.getByRole('region', { name: 'This document' })).toBeInTheDocument();
  });

  it('opens the access page of the template the address names, with a way back to the templates', async () => {
    const TEMPLATE = 'ffffffff-0000-4000-8000-000000000001';
    window.location.hash = `#/templates/${TEMPLATE}/access`;
    render(
      <Workspace fetch={accessService({}, { templates: { [TEMPLATE]: 'Procedure manual' } })} />,
    );
    expect(
      await screen.findByRole('heading', { name: 'Access to Procedure manual' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to templates' })).toHaveAttribute(
      'href',
      '#/templates',
    );
    expect(screen.getByRole('region', { name: 'This template' })).toBeInTheDocument();
  });

  it("keeps a connection's page as it is while its tab changes in the address", async () => {
    const CONNECTION = 'ffffffff-0000-4000-8000-000000000002';
    window.location.hash = `#/connections/${CONNECTION}/credential`;
    render(<Workspace fetch={accessService({}, { connections: { [CONNECTION]: 'Readings' } })} />);
    // Not answered here, which is beside the point: the same page, not a fresh one, says so.
    const said = await screen.findByText('The connection could not be loaded.');

    const oldURL = window.location.href;
    window.location.hash = `#/connections/${CONNECTION}/tables`;
    fireEvent(window, new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }));
    await waitFor(() => expect(window.location.hash).toBe(`#/connections/${CONNECTION}/tables`));
    expect(screen.getByText('The connection could not be loaded.')).toBe(said);
  });
  it('opens the access page of the connection the address names, with a way back to it', async () => {
    const CONNECTION = 'ffffffff-0000-4000-8000-000000000002';
    window.location.hash = `#/connections/${CONNECTION}/access`;
    render(<Workspace fetch={accessService({}, { connections: { [CONNECTION]: 'Readings' } })} />);
    expect(await screen.findByRole('heading', { name: 'Access to Readings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the connection' })).toHaveAttribute(
      'href',
      `#/connections/${CONNECTION}`,
    );
    expect(screen.getByRole('region', { name: 'This connection' })).toBeInTheDocument();
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
      if (url.pathname === '/v1/spaces') return json(200, { items: [], next: null });
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
      if (url.pathname === '/v1/spaces') return json(200, { items: [], next: null });
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
      if (url.pathname === '/v1/spaces') return json(200, { items: [], next: null });
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
      if (url.pathname === '/v1/spaces') return json(200, { items: [], next: null });
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

  it('lists the documents the address asks for, and the components no longer', async () => {
    const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === '/v1/components') return json(200, { items: [], next: null });
      if (url.pathname === '/v1/spaces') return json(200, { items: [], next: null });
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
          next: null,
        });
      }
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;

    render(<Workspace fetch={fetching} />);
    expect(await screen.findByRole('heading', { name: 'Components' })).toBeInTheDocument();

    window.location.hash = '#/documents';
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(await screen.findByRole('link', { name: 'The dosing report' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}`,
    );
    expect(screen.queryByRole('heading', { name: 'Components' })).toBeNull();
  });

  it('lists the publications at their own address', async () => {
    window.location.hash = '#/publications';
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === '/v1/publications') return json(200, { items: [], next: null });
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;
    render(<Workspace fetch={fetching} />);
    expect(await screen.findByRole('heading', { name: 'Publications' })).toBeInTheDocument();
    expect(screen.getByText('Nothing has been published that you may read.')).toBeInTheDocument();
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

  it('answers a link into a document the caller may not read as nothing there, saying nothing of the node', async () => {
    window.location.hash =
      '#/documents/eeeeeeee-0000-4000-8000-000000000001/nodes/iiiiiiiiiiiiiiiiiiiiiiiiii';
    render(
      <StrictMode>
        <Workspace fetch={serviceThat({})} />
      </StrictMode>,
    );
    expect(
      await screen.findByText('There is nothing here, or nothing you may read.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('The linked part is not in this document.')).toBeNull();
  });

  it('opens a publication at its own address', async () => {
    const PUBLICATION = 'ffffffff-0000-4000-8000-000000000001';
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === `/v1/publications/${PUBLICATION}`) {
        return json(200, {
          id: PUBLICATION,
          document: 'eeeeeeee-0000-4000-8000-000000000001',
          version: { id: 'v', number: '0.3' },
          title: 'The dosing report',
          publisher: { id: 'p1', displayName: 'Ada' },
          publishedAt: '2026-09-19T09:00:00.000Z',
          approval: 'none',
          formats: ['pdf'],
          engine: { name: 'typst', version: '0.15.1' },
          template: { name: 'publication', version: 1 },
          pipeline: '1',
          outputs: [],
        });
      }
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;

    window.location.hash = `#/publications/${PUBLICATION}`;
    render(
      <StrictMode>
        <Workspace fetch={fetching} />
      </StrictMode>,
    );
    expect(await screen.findByRole('heading', { name: 'The dosing report' })).toBeInTheDocument();
    expect(screen.getByText(/^Not approved\./)).toBeInTheDocument();
  });

  it('opens a document at the node its address names, and again when that address arrives again', async () => {
    const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
    const node = (id: string, title: string) => ({
      type: 'section',
      id,
      title: [{ type: 'text', value: title, marks: [] }],
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    });
    const INTRODUCTION = 'iiiiiiiiiiiiiiiiiiiiiiiiii';
    const METHOD = 'mmmmmmmmmmmmmmmmmmmmmmmmmm';
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === '/v1/components') return json(200, { items: [], next: null });
      if (url.pathname === `/v1/documents/${DOCUMENT}/publications`) {
        return json(200, { items: [], next: null });
      }
      if (url.pathname === `/v1/documents/${DOCUMENT}`) {
        return json(200, {
          id: DOCUMENT,
          space: { id: 's1', name: 'General' },
          version: {
            id: 'dddddddd-0000-4000-8000-000000000001',
            number: '0.2',
            author: 'p1',
            createdAt: '2026-09-18T09:00:00.000Z',
            note: null,
          },
          outline: {
            schemaVersion: OUTLINE_SCHEMA_VERSION,
            title: 'The dosing report',
            language: 'en-GB',
            direction: 'ltr',
            nodes: [node(INTRODUCTION, 'Introduction'), node(METHOD, 'Method')],
          },
          mayEdit: false,
          mayPublish: false,
          layout: LAYOUT,
        });
      }
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;

    window.location.hash = `#/documents/${DOCUMENT}/nodes/${METHOD}`;
    render(
      <StrictMode>
        <Workspace fetch={fetching} />
      </StrictMode>,
    );
    const method = await screen.findByRole('treeitem', { name: 'Method' });
    await waitFor(() => expect(method).toHaveFocus());

    // Choosing Introduction rewrites the address without a `hashchange` or a history entry...
    const entries = window.history.length;
    const heard = vi.fn();
    window.addEventListener('hashchange', heard);
    await userEvent.click(screen.getByRole('treeitem', { name: 'Introduction' }));
    expect(window.location.hash).toBe(`#/documents/${DOCUMENT}/nodes/${INTRODUCTION}`);
    // A `hashchange` jsdom would fire is queued as a task, so one is let through before looking.
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.removeEventListener('hashchange', heard);
    expect(heard).not.toHaveBeenCalled();
    expect(window.history.length).toBe(entries);
    // ...so a link to Method, followed again, is still news, and takes the reader back to it.
    window.location.hash = `#/documents/${DOCUMENT}/nodes/${METHOD}`;
    fireEvent(window, new HashChangeEvent('hashchange'));
    await waitFor(() =>
      expect(screen.getByRole('treeitem', { name: 'Method' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByRole('treeitem', { name: 'Method' })).toHaveFocus();
  });

  it('takes the reader to a listed figure whose link is the address already shown', async () => {
    // The lists stand in their own panel beside the text (LG6c).
    window.localStorage.setItem(DOCK_KEY, 'lists');
    const DOCUMENT = 'eeeeeeee-0000-4000-8000-000000000001';
    const PRINTER = 'cccccccc-0000-4000-8000-000000000001';
    const INTRODUCTION = 'iiiiiiiiiiiiiiiiiiiiiiiiii';
    const RESULTS = 'rrrrrrrrrrrrrrrrrrrrrrrrrr';
    const VERSION = 'dddddddd-0000-4000-8000-000000000001';
    const placing = {
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
    };
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === '/v1/me') return json(200, me);
      if (url.pathname === '/v1/components') {
        return json(200, {
          items: [
            {
              id: PRINTER,
              title: 'Install the printer',
              space: { id: 's1', name: 'General' },
              version: '0.3',
            },
          ],
          next: null,
        });
      }
      if (url.pathname === `/v1/documents/${DOCUMENT}/publications`) {
        return json(200, { items: [], next: null });
      }
      if (url.pathname === `/v1/documents/${DOCUMENT}`) {
        return json(200, {
          id: DOCUMENT,
          space: { id: 's1', name: 'General' },
          version: {
            id: VERSION,
            number: '0.2',
            author: 'p1',
            createdAt: '2026-09-18T09:00:00.000Z',
            note: null,
          },
          outline: {
            schemaVersion: OUTLINE_SCHEMA_VERSION,
            title: 'The dosing report',
            language: 'en-GB',
            direction: 'ltr',
            nodes: [
              {
                type: 'section',
                id: INTRODUCTION,
                title: [{ type: 'text', value: 'Introduction', marks: [] }],
                ...placing,
                children: [
                  {
                    type: 'reference',
                    id: RESULTS,
                    component: PRINTER,
                    mode: { kind: 'latest' },
                    ...placing,
                    children: [],
                  },
                ],
              },
            ],
          },
          mayEdit: false,
          mayPublish: false,
          layout: LAYOUT,
        });
      }
      if (url.pathname === `/v1/documents/${DOCUMENT}/contributions`) {
        const held = 'vvvvvvvv-0000-4000-8000-000000000001';
        return json(200, {
          document: DOCUMENT,
          version: { id: VERSION, number: '0.2' },
          occurrences: [{ node: RESULTS, version: held }],
          versions: [
            {
              id: held,
              contributions: [
                { block: 'f1', sequence: 'figure', numbered: true, caption: 'The paper tray' },
                { block: 'f2', sequence: 'figure', numbered: true, caption: 'The toner' },
              ],
            },
          ],
        });
      }
      return json(404, { code: 'not_found', message: 'none', traceId: 't' });
    }) as unknown as typeof fetch;

    window.location.hash = `#/documents/${DOCUMENT}`;
    render(
      <StrictMode>
        <Workspace fetch={fetching} />
      </StrictMode>,
    );
    const placed = await screen.findByRole('treeitem', { name: 'Install the printer, latest' });
    const first = await screen.findByRole('link', { name: 'Figure 1.1 The paper tray' });

    // Choosing the component rewrites the address to its own, which is the link its figures list.
    await userEvent.click(placed);
    expect(window.location.hash).toBe(`#/documents/${DOCUMENT}/nodes/${RESULTS}`);
    expect(first).toHaveAttribute('href', window.location.hash);
    expect(placed.querySelector('mark')).toBeNull();

    // Following that link changes no address, and still takes the reader to the component.
    await userEvent.click(first);
    await waitFor(() =>
      expect(screen.getByRole('treeitem', { name: 'Install the printer, latest' })).toHaveFocus(),
    );
    const marked = screen.getByRole('treeitem', { name: 'Install the printer, latest' });
    expect(marked.querySelector('mark')).not.toBeNull();

    // As does the second figure the same component holds.
    await userEvent.click(screen.getByRole('link', { name: 'Figure 1.2 The toner' }));
    await waitFor(() =>
      expect(screen.getByRole('treeitem', { name: 'Install the printer, latest' })).toHaveFocus(),
    );
  });
});
