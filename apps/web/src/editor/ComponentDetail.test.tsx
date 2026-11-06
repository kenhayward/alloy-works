import { createApiClient } from '@alloy-works/api-client';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ComponentDetail } from './ComponentDetail.js';

const COPY = 'cc000000-0000-4000-8000-000000000001';
const SOURCE = 'cc000000-0000-4000-8000-000000000002';
const TEMPLATE = 'ee000000-0000-4000-8000-000000000001';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const item = {
  id: COPY,
  title: 'Please supply a title',
  type: null,
  version: '0.1',
  space: { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'General' },
  language: 'en-GB',
};

function service(origin: unknown) {
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    if (url === `/v1/components/${COPY}`) {
      return json(200, {
        id: COPY,
        content: {
          schemaVersion: 1,
          title: 'Please supply a title',
          language: 'en-GB',
          direction: 'ltr',
          content: [
            {
              type: 'paragraph',
              id: 'p1',
              content: [{ type: 'text', text: 'Please supply the text.' }],
            },
          ],
        },
        origin,
      });
    }
    return json(200, { items: [], next: null });
  }) as typeof globalThis.fetch;
  return createApiClient({ baseUrl: 'http://localhost', fetch });
}

const show = (origin: unknown) =>
  render(<ComponentDetail client={service(origin)} item={item as never} onClose={vi.fn()} />);

describe("a component's origin", () => {
  it('REU-059 says which component and version a copy was made from, and that it has changed since', async () => {
    show({
      from: { id: SOURCE, title: 'Safety notice' },
      version: { id: 'v1', number: '1.0' },
      template: null,
      changedSince: true,
    });
    const said = await screen.findByText(/^Copied from/);
    expect(said).toHaveTextContent('Copied from Safety notice at 1.0, which has changed since.');
    expect(screen.getByRole('link', { name: 'Safety notice' })).toHaveAttribute(
      'href',
      `#/components/${SOURCE}`,
    );
  });

  it('REU-059 says a component was made from the words a template holds', async () => {
    show({
      from: null,
      version: null,
      template: { id: TEMPLATE, name: 'Blank' },
      changedSince: false,
    });
    expect(await screen.findByText('Made from the template Blank.')).toBeInTheDocument();
  });

  it('says nothing of an origin for a component made afresh', async () => {
    show(null);
    // Once its view is read, whatever its text makes of it.
    await screen.findByText(/Please supply the text|The text could not be/);
    expect(screen.queryByText(/^Copied from|^Made from/)).toBeNull();
  });
});
