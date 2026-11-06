import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { ComponentGroupList } from './ComponentGroupList.js';

const GROUP = 'cc000000-0000-4000-8000-0000000000a1';
const NOTICE = 'cc000000-0000-4000-8000-000000000001';
const GENERAL = { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'General' };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service() {
  const sent: { url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ url, body });
    if (url === '/v1/component-groups') {
      return json(200, {
        items: [
          {
            id: GROUP,
            title: 'SOP references',
            space: GENERAL,
            version: { id: 'v1', number: '1.0' },
            members: 3,
            changedAt: '2026-11-06T09:00:00Z',
            state: { key: 'approved', name: 'Approved', approved: true },
          },
        ],
        next: null,
      });
    }
    if (url === '/v1/spaces') {
      return json(200, { items: [{ ...GENERAL, mayCreate: true }], next: null });
    }
    if (url === '/v1/components') {
      return json(200, {
        items: [{ id: NOTICE, title: 'Boilerplate', space: GENERAL, version: '1.0' }],
        next: null,
        total: 1,
        spaces: [],
      });
    }
    if (url === `/v1/spaces/${GENERAL.id}/component-groups`) return json(201, { id: 'made' });
    return json(404, {});
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: 'http://localhost', fetch }), sent };
}

afterEach(() => {
  window.location.hash = '';
});

describe('component groups in Components', () => {
  it('REU-060 lists the groups the reader may read, each with its members counted and its state', async () => {
    const { client } = service();
    render(<ComponentGroupList client={client} />);
    const table = await screen.findByRole('table', { name: 'Component groups' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByRole('link', { name: 'SOP references' })).toHaveAttribute(
      'href',
      `#/component-groups/${GROUP}`,
    );
    expect(row).toHaveTextContent('3 components');
    expect(row).toHaveTextContent('Approved');
  });

  it('REU-060 makes a group from a title, a space and its first component, and opens it', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<ComponentGroupList client={client} />);
    await user.click(await screen.findByRole('button', { name: 'New component group' }));
    await user.type(await screen.findByLabelText('Title'), 'SOP references');
    await screen.findByRole('option', { name: 'Boilerplate' });
    await user.click(screen.getByRole('button', { name: 'Make group' }));
    await waitFor(() => expect(window.location.hash).toBe('#/component-groups/made'));
    expect(sent.at(-1)).toEqual({
      url: `/v1/spaces/${GENERAL.id}/component-groups`,
      body: { title: 'SOP references', members: [{ component: NOTICE }] },
    });
  });
});
