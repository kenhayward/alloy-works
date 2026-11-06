import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ComponentGroupPage } from './ComponentGroupPage.js';

const GROUP = 'cc000000-0000-4000-8000-0000000000a1';
const NOTICE = 'cc000000-0000-4000-8000-000000000001';
const TABLE = 'cc000000-0000-4000-8000-000000000002';
const CHECK = 'cc000000-0000-4000-8000-000000000003';
const WARNING = 'cc000000-0000-4000-8000-000000000004';
const GENERAL = { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'General' };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const member = (id: string, title: string, number: string, newest: string | null = null) => ({
  component: { id, title },
  version: { id: `${id}-v${number}`, number },
  newest: newest === null ? null : { id: `${id}-v${newest}`, number: newest },
});
const view = (
  version = '0.1',
  members = [
    member(NOTICE, 'Boilerplate', '1.0', '1.1'),
    member(TABLE, 'References', '1.0'),
    member(CHECK, 'Checking references', '0.3'),
  ],
) => ({
  id: GROUP,
  title: 'SOP references',
  space: GENERAL,
  version: { id: `group-v${version}`, number: version },
  members,
  mayEdit: true,
  archived: false,
  state: { key: 'draft', name: 'Draft', approved: false },
  states: [{ key: 'draft', name: 'Draft' }],
  transitions: [],
  gates: [],
});

function service() {
  const sent: { url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ url, body });
    if (url === `/v1/component-groups/${GROUP}`) return json(200, view());
    if (url === '/v1/components') {
      return json(200, {
        items: [
          { id: NOTICE, title: 'Boilerplate', space: GENERAL, version: '1.0' },
          { id: WARNING, title: 'Warning', space: GENERAL, version: '0.1' },
        ],
        next: null,
        total: 2,
        spaces: [],
      });
    }
    if (url === `/v1/component-groups/${GROUP}/versions`) {
      return json(200, view('0.2', [member(WARNING, 'Warning', '0.1')]));
    }
    return json(404, {});
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: 'http://localhost', fetch }), sent };
}

const members = () =>
  within(screen.getByRole('list', { name: 'Members' }))
    .getAllByRole('listitem')
    .map((each) => within(each).getByRole('link').textContent);

describe('a component group', () => {
  it('REU-060 shows its members in order, each at the version the group pins, offering a newer one', async () => {
    const { client } = service();
    render(<ComponentGroupPage client={client} id={GROUP} />);
    expect(await screen.findByRole('heading', { name: 'SOP references', level: 1 })).toBeVisible();
    expect(members()).toEqual(['Boilerplate', 'References', 'Checking references']);
    expect(screen.getAllByText('Version 1.0')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Use version 1.1 of Boilerplate' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Boilerplate' })).toHaveAttribute(
      'href',
      `#/components/${NOTICE}`,
    );
  });

  it('REU-060 adds, removes, reorders and repins members, and saves them as one new version', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    render(<ComponentGroupPage client={client} id={GROUP} />);
    await screen.findByRole('heading', { name: 'SOP references', level: 1 });
    await user.click(screen.getByRole('button', { name: 'Move Checking references up' }));
    expect(members()).toEqual(['Boilerplate', 'Checking references', 'References']);
    await user.click(screen.getByRole('button', { name: 'Remove References' }));
    await user.click(screen.getByRole('button', { name: 'Use version 1.1 of Boilerplate' }));
    // A component already in the group is not offered again (CG-C).
    const adding = await screen.findByRole('combobox', { name: 'Add a component' });
    expect([...adding.querySelectorAll('option')].map((each) => each.textContent)).toEqual([
      'Warning',
    ]);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(members()).toEqual(['Boilerplate', 'Checking references', 'Warning']);
    expect(screen.getByText('Changes not yet saved as a version.')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Save as a new version' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Saved as version 0.2.'),
    );
    expect(sent.at(-1)).toEqual({
      url: `/v1/component-groups/${GROUP}/versions`,
      body: {
        openedFrom: 'group-v0.1',
        title: 'SOP references',
        members: [
          { component: NOTICE, version: `${NOTICE}-v1.1` },
          { component: CHECK, version: `${CHECK}-v0.3` },
          { component: WARNING },
        ],
      },
    });
  });
});
