import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { groupsIn, PlaceGroupButton, PlacedGroup } from './PlacedGroup.js';

const DOCUMENT = 'dd000000-0000-4000-8000-000000000001';
const GROUP = 'cc000000-0000-4000-8000-0000000000a1';
const DRAFT = 'cc000000-0000-4000-8000-0000000000a2';
const PLACEMENT = 'n-run';
const SECTIONS = [
  { id: 'n-scope', title: 'Scope' },
  { id: 'n-refs', title: 'References' },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const row = (id: string, title: string, approved: boolean) => ({
  id,
  title,
  space: { id: 's1', name: 'General' },
  version: { id: `${id}-v`, number: approved ? '1.0' : '0.1' },
  members: 2,
  changedAt: '2026-11-06T09:00:00Z',
  state: { key: approved ? 'approved' : 'draft', name: approved ? 'Approved' : 'Draft', approved },
});

function service() {
  const sent: { url: string; body: unknown }[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url).pathname;
    const body = request.method === 'GET' ? undefined : await request.clone().json();
    sent.push({ url, body });
    if (url === '/v1/component-groups') {
      return json(200, {
        items: [row(GROUP, 'SOP references', true), row(DRAFT, 'Not yet approved', false)],
        next: null,
      });
    }
    if (url === `/v1/documents/${DOCUMENT}/groups`)
      return json(200, { id: DOCUMENT, placed: true });
    if (url === `/v1/documents/${DOCUMENT}/groups/${PLACEMENT}/take/preview`) {
      return json(200, {
        added: [{ id: 'w', title: 'Warning' }],
        removed: [],
        kept: 3,
        overridesDropped: 0,
      });
    }
    if (url === `/v1/documents/${DOCUMENT}/groups/${PLACEMENT}/take`) {
      return json(200, { id: DOCUMENT, taken: true });
    }
    if (url === `/v1/documents/${DOCUMENT}/groups/${PLACEMENT}/remove`) {
      return json(200, { id: DOCUMENT, removed: true });
    }
    return json(404, {});
  }) as typeof globalThis.fetch;
  return { client: createApiClient({ baseUrl: 'http://localhost', fetch }), sent };
}

describe('a component group in a document', () => {
  it('REU-061 reads the groups a document view places, leaving out what it cannot read', () => {
    expect(
      groupsIn([
        {
          placement: PLACEMENT,
          group: { id: GROUP, title: 'SOP references' },
          version: { id: 'g1', number: '1.0' },
          newer: { id: 'g2', number: '2.0' },
        },
        { placement: 'n-other', group: null },
        'nonsense',
      ]),
    ).toEqual([
      {
        placement: PLACEMENT,
        group: { id: GROUP, title: 'SOP references' },
        version: { id: 'g1', number: '1.0' },
        newer: { id: 'g2', number: '2.0' },
      },
    ]);
    expect(groupsIn(undefined)).toEqual([]);
  });

  it('REU-061 places an approved group at the end of the section chosen, offering only approved ones', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    let answered: unknown;
    render(
      <PlaceGroupButton
        client={client}
        documentId={DOCUMENT}
        openedFrom="doc-v1"
        sections={SECTIONS.map((each, index) => ({ ...each, children: index }))}
        onPlaced={(answer) => (answered = answer)}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Place a component group' }));
    const dialog = await screen.findByRole('dialog', { name: 'Place a component group' });
    const group = await within(dialog).findByRole('combobox', { name: 'Component group' });
    expect([...group.querySelectorAll('option')].map((each) => each.textContent)).toEqual([
      'SOP references',
    ]);
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'In section' }),
      'n-refs',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Place' }));
    await waitFor(() => expect(answered).toEqual({ id: DOCUMENT, placed: true }));
    expect(sent.at(-1)).toEqual({
      url: `/v1/documents/${DOCUMENT}/groups`,
      body: { openedFrom: 'doc-v1', group: GROUP, parent: 'n-refs', position: 1 },
    });
  });

  it('REU-062 offers a newer group version, says first what taking it changes, then takes it', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    let answered: unknown;
    render(
      <PlacedGroup
        client={client}
        documentId={DOCUMENT}
        openedFrom="doc-v1"
        editable
        placed={{
          placement: PLACEMENT,
          group: { id: GROUP, title: 'SOP references' },
          version: { id: 'g1', number: '1.0' },
          newer: { id: 'g2', number: '2.0' },
        }}
        onAnswer={(answer) => (answered = answer)}
      />,
    );
    expect(screen.getByText(/Part of the component group/)).toHaveTextContent(
      'Part of the component group SOP references, version 1.0.',
    );
    expect(screen.getByRole('link', { name: 'SOP references' })).toHaveAttribute(
      'href',
      `#/component-groups/${GROUP}`,
    );
    await user.click(screen.getByRole('button', { name: 'Take version 2.0' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Take version 2.0 of SOP references',
    });
    expect(await within(dialog).findByText('Adds Warning.')).toBeVisible();
    expect(within(dialog).getByText('Keeps 3 components, with their rewordings.')).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Take version 2.0' }));
    await waitFor(() => expect(answered).toEqual({ id: DOCUMENT, taken: true }));
    expect(sent.at(-1)).toEqual({
      url: `/v1/documents/${DOCUMENT}/groups/${PLACEMENT}/take`,
      body: { openedFrom: 'doc-v1', version: 'g2' },
    });
  });

  it('REU-061 removes a placed group as one, after asking', async () => {
    const user = userEvent.setup();
    const { client, sent } = service();
    let answered: unknown;
    render(
      <PlacedGroup
        client={client}
        documentId={DOCUMENT}
        openedFrom="doc-v1"
        editable
        placed={{
          placement: PLACEMENT,
          group: { id: GROUP, title: 'SOP references' },
          version: { id: 'g1', number: '1.0' },
          newer: null,
        }}
        onAnswer={(answer) => (answered = answer)}
      />,
    );
    expect(screen.queryByRole('button', { name: /Take version/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove group' }));
    await user.click(screen.getByRole('button', { name: 'Remove its components' }));
    await waitFor(() => expect(answered).toEqual({ id: DOCUMENT, removed: true }));
    expect(sent.at(-1)).toEqual({
      url: `/v1/documents/${DOCUMENT}/groups/${PLACEMENT}/remove`,
      body: { openedFrom: 'doc-v1' },
    });
  });
});
