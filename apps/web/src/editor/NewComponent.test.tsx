import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NewComponent } from './NewComponent.js';

const SPACES = {
  items: [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'General', mayCreate: true },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Quality', mayCreate: false },
    { id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Regulatory', mayCreate: true },
  ],
};
const TYPES = {
  items: [
    { id: 'bbbbbbbb-0000-4000-8000-000000000001', name: 'Procedure', isDefault: false },
    { id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Topic', isDefault: true },
  ],
};

/**
 * The requests made, and canned answers by path; a path with no answer is a 500. Built on the house
 * shape (S22): `openapi-fetch` calls `fetch(request, init)` with a `Request`, not a plain URL, so the
 * body has to be read off the request itself, and only for a method that carries one.
 */
function service(answers: Record<string, unknown>, failures: Record<string, number> = {}) {
  const sent: { url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ url, body });
    const status = failures[url];
    if (status !== undefined) {
      return new Response(JSON.stringify({ code: 'forbidden', message: 'No.' }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    const answer = answers[url];
    if (answer === undefined) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const client = (fetch: typeof globalThis.fetch) =>
  createApiClient({ baseUrl: 'http://acme.example.test', fetch });

describe('New component', () => {
  it('CNT-149 creates a component in a space the author may create in, with a title, a base language and a base direction', async () => {
    const made = {
      id: 'cccccccc-0000-4000-8000-000000000001',
      space: { id: SPACES.items[0]!.id, name: 'General' },
      version: {
        id: 'dddddddd-0000-4000-8000-000000000001',
        number: '0.1',
        author: null,
        createdAt: '2026-09-17T09:00:00.000Z',
        note: null,
      },
      content: {
        schemaVersion: 1,
        title: 'Replace the toner',
        language: 'fr-CA',
        direction: 'rtl',
        content: [],
      },
      mayEdit: true,
      lock: null,
    };
    const { fetch, sent } = service({
      '/v1/spaces': SPACES,
      [`/v1/spaces/${SPACES.items[0]!.id}/component-types`]: TYPES,
      [`/v1/spaces/${SPACES.items[2]!.id}/component-types`]: TYPES,
      [`/v1/spaces/${SPACES.items[0]!.id}/components`]: made,
    });
    const onCreated = vi.fn();
    render(<NewComponent client={client(fetch)} onCreated={onCreated} />);

    const where = await screen.findByLabelText('Where');
    expect([...where.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'General',
      'Regulatory',
    ]);
    // The default is preselected, which is MET-011's "offered with the tenant's default preselected".
    await waitFor(() =>
      expect(screen.getByLabelText('Component type')).toHaveValue(TYPES.items[1]!.id),
    );

    await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
    await userEvent.clear(screen.getByLabelText('Language'));
    await userEvent.type(screen.getByLabelText('Language'), 'fr-CA');
    await userEvent.selectOptions(screen.getByLabelText('Direction'), 'rtl');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(made.id));
    expect(sent.at(-1)).toEqual({
      url: `/v1/spaces/${SPACES.items[0]!.id}/components`,
      body: {
        title: 'Replace the toner',
        language: 'fr-CA',
        direction: 'rtl',
        componentType: TYPES.items[1]!.id,
      },
    });
  });

  it('says nothing at all where there is nowhere the caller may create', async () => {
    const { fetch } = service({
      '/v1/spaces': { items: [SPACES.items[1]] },
    });
    const { container } = render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('will not send a title that is empty or a language that is not a tag', async () => {
    const { fetch, sent } = service({
      '/v1/spaces': SPACES,
      [`/v1/spaces/${SPACES.items[0]!.id}/component-types`]: TYPES,
    });
    render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');

    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('status')).toHaveTextContent('A component needs a title.');

    await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
    await userEvent.clear(screen.getByLabelText('Language'));
    await userEvent.type(screen.getByLabelText('Language'), 'english');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByRole('status')).toHaveTextContent('A language tag looks like en-GB.');

    expect(sent.filter((request) => request.url.endsWith('/components'))).toEqual([]);
  });

  it('says so when the service refuses, and keeps what was typed', async () => {
    const { fetch } = service(
      {
        '/v1/spaces': SPACES,
        [`/v1/spaces/${SPACES.items[0]!.id}/component-types`]: TYPES,
      },
      { [`/v1/spaces/${SPACES.items[0]!.id}/components`]: 403 },
    );
    render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');
    await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'You may not create a component here.',
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Replace the toner');
  });

  it('says the title, language or direction was not accepted on a 400, distinctly from Try again', async () => {
    // 400, 404 and 409 are permanent refusals of what was sent, not a transient failure Try again
    // would fix by itself (review round 1, item 5).
    const { fetch } = service(
      {
        '/v1/spaces': SPACES,
        [`/v1/spaces/${SPACES.items[0]!.id}/component-types`]: TYPES,
      },
      { [`/v1/spaces/${SPACES.items[0]!.id}/components`]: 400 },
    );
    render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');
    await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The title, language or direction was not accepted. Check them and try again.',
    );
  });

  it('says a space is no longer open on a 404, and re-reads the spaces it offers', async () => {
    // The chosen space vanishing from under the caller (review round 1, item 5): the message names
    // what to do, and the stale space is not left standing in the list that just refused it.
    const asked: { url: string; body: unknown }[] = [];
    let spacesCall = 0;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url).pathname;
      const body = request.method === 'GET' ? undefined : await request.clone().json();
      asked.push({ url, body });
      if (url === '/v1/spaces') {
        spacesCall += 1;
        const items = spacesCall === 1 ? SPACES.items : [SPACES.items[2]];
        return new Response(JSON.stringify({ items }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/component-types')) {
        return new Response(JSON.stringify(TYPES), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === `/v1/spaces/${SPACES.items[0]!.id}/components`) {
        return new Response(JSON.stringify({ code: 'not_found', message: 'gone' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 500 });
    }) as typeof globalThis.fetch;

    render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');
    await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'This space is no longer open to you. Choose another.',
    );
    await waitFor(() =>
      expect(
        [...screen.getByLabelText('Where').querySelectorAll('option')].map(
          (option) => option.textContent,
        ),
      ).toEqual(['Regulatory']),
    );
  });

  it('says a component type is no longer available on a 409, and re-reads the types it offers', async () => {
    let typesCall = 0;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url).pathname;
      if (url === '/v1/spaces') {
        return new Response(JSON.stringify(SPACES), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === `/v1/spaces/${SPACES.items[0]!.id}/component-types`) {
        typesCall += 1;
        const items = typesCall === 1 ? TYPES.items : [TYPES.items[1]];
        return new Response(JSON.stringify({ items }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === `/v1/spaces/${SPACES.items[0]!.id}/components`) {
        return new Response(JSON.stringify({ code: 'component_type_missing', message: 'gone' }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 500 });
    }) as typeof globalThis.fetch;

    render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');
    await waitFor(() =>
      expect(screen.getByLabelText('Component type')).toHaveValue(TYPES.items[1]!.id),
    );
    await userEvent.selectOptions(screen.getByLabelText('Component type'), TYPES.items[0]!.id);
    await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'That component type is no longer available. Choose another.',
    );
    await waitFor(() =>
      expect(
        [...screen.getByLabelText('Component type').querySelectorAll('option')].map(
          (option) => option.textContent,
        ),
      ).toEqual(['Topic']),
    );
  });

  it('says the author is signed out when the spaces answer 401, not that it could be tried again', async () => {
    // Signed out is distinct from a failure worth retrying, here as everywhere else in this renderer
    // (fix round 2): the status the read already answered with says which this is.
    const { fetch } = service({}, { '/v1/spaces': 401 });
    render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);

    expect(
      await screen.findByText('You are signed out. Sign in again to create a component.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('The spaces you may create in could not be loaded.'),
    ).not.toBeInTheDocument();
  });

  it('keeps saying why a space was refused when the re-read fails, and says there is nowhere left when it leaves none', async () => {
    // A 404 re-reads the spaces, and that read can fail outright or come back with nowhere left to
    // create - and each used to take the whole section away, carrying off the one message that
    // explained what had just happened (fix round 2, finding E). Where it leaves nowhere, the
    // standing message cannot stand: "Choose another" beside no chooser asks for something that is
    // not there, so that branch says what is true of it instead.
    let spacesCall = 0;
    const answers = [SPACES.items, null, []];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url).pathname;
      if (url === '/v1/spaces') {
        const items = answers[spacesCall];
        spacesCall += 1;
        if (!items) return new Response('{}', { status: 500 });
        return new Response(JSON.stringify({ items }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/component-types')) {
        return new Response(JSON.stringify(TYPES), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ code: 'not_found', message: 'gone' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof globalThis.fetch;

    render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');
    await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    // The re-read fails: the failure is said, and so is what was refused in the first place.
    await screen.findByText('The spaces you may create in could not be loaded.');
    expect(screen.getByRole('status')).toHaveTextContent(
      'This space is no longer open to you. Choose another.',
    );

    // Try again, and this time there is nowhere left to create at all.
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(
        screen.queryByText('The spaces you may create in could not be loaded.'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByLabelText('Where')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'There is nowhere left for you to create a component.',
    );
    expect(screen.queryByText(/Choose another/)).not.toBeInTheDocument();
  });

  it('keeps the space the author chose when the list is read again unchanged', async () => {
    // Re-reading the spaces is not a reason to move the author back to the first one (fix round 2,
    // finding G): they chose where this component goes, and the list they chose from is still there.
    const { fetch, sent } = service(
      {
        '/v1/spaces': SPACES,
        [`/v1/spaces/${SPACES.items[0]!.id}/component-types`]: TYPES,
        [`/v1/spaces/${SPACES.items[2]!.id}/component-types`]: TYPES,
      },
      { [`/v1/spaces/${SPACES.items[2]!.id}/components`]: 404 },
    );
    render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    await screen.findByLabelText('Where');
    await userEvent.selectOptions(screen.getByLabelText('Where'), SPACES.items[2]!.id);
    await userEvent.type(screen.getByLabelText('Title'), 'Replace the toner');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(sent.filter((request) => request.url === '/v1/spaces')).toHaveLength(2),
    );
    expect(screen.getByLabelText('Where')).toHaveValue(SPACES.items[2]!.id);
  });

  it('says the spaces could not be loaded, distinctly from nowhere to create, and offers Try again', async () => {
    // A failed read and a legitimately empty list must not look the same (review round 1, item 6):
    // one is nothing to say anything about, the other is a page that never rendered its form at all.
    let attempts = 0;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url).pathname;
      if (url === '/v1/spaces') {
        attempts += 1;
        if (attempts === 1) {
          return new Response(JSON.stringify({ code: 'internal', message: 'x' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(SPACES), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/component-types')) {
        return new Response(JSON.stringify(TYPES), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 500 });
    }) as typeof globalThis.fetch;

    render(<NewComponent client={client(fetch)} onCreated={vi.fn()} />);
    expect(
      await screen.findByText('The spaces you may create in could not be loaded.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Where');
  });
});
