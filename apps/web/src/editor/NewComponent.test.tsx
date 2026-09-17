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
});
