import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SourcesPanel } from './SourcesPanel.js';

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const ENTRY = 'eeeeeeee-0000-4000-8000-000000000001';
const COMPONENT = 'cccccccc-0000-4000-8000-000000000001';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service(items: unknown[]) {
  const fetching = (async (input: Request) => {
    const path = new URL(input.url).pathname;
    if (path === `/v1/documents/${DOCUMENT}/flagged-sources`) return json(200, { items });
    return json(404, {});
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://acme.test', fetch: fetching });
}

describe('the Sources panel in Review (the XR plan, XR-G)', () => {
  it('LIB-036 lists each flagged source and the components citing it, the flag alone where its entry is not the reader’s', async () => {
    const client = service([
      {
        flag: 'retracted',
        entry: { id: ENTRY, key: 'marlow2021', title: 'Salt Marsh Accretion' },
        components: [{ id: COMPONENT, title: 'The marsh section' }],
        unreadable: false,
      },
      { flag: 'corrected', entry: null, components: [], unreadable: true },
    ]);
    render(<SourcesPanel client={client} document={DOCUMENT} active />);
    const list = await screen.findByRole('list', { name: 'Flagged sources' });
    const [first, second] = within(list).getAllByRole('listitem');
    expect(first).toHaveTextContent('Retracted by its source: marlow2021, Salt Marsh Accretion');
    expect(
      within(first!).getByRole('link', { name: 'marlow2021, Salt Marsh Accretion' }),
    ).toHaveAttribute('href', `#/bibliography/${ENTRY}`);
    expect(within(first!).getByRole('link', { name: 'The marsh section' })).toHaveAttribute(
      'href',
      `#/components/${COMPONENT}`,
    );
    expect(second).toHaveTextContent('Corrected by its source: a source you may not read');
    expect(second).toHaveTextContent('Cited in components you may not read.');
  });

  it('LIB-035 lists a source superseded at its source as superseded', async () => {
    const client = service([
      {
        flag: 'superseded',
        entry: { id: ENTRY, key: 'marlow2021', title: 'Salt Marsh Accretion' },
        components: [],
        unreadable: false,
      },
    ]);
    render(<SourcesPanel client={client} document={DOCUMENT} active />);
    const list = await screen.findByRole('list', { name: 'Flagged sources' });
    expect(within(list).getByRole('listitem')).toHaveTextContent(
      'Superseded by its source: marlow2021, Salt Marsh Accretion',
    );
  });

  it('says when no source is flagged', async () => {
    render(<SourcesPanel client={service([])} document={DOCUMENT} active />);
    expect(
      await screen.findByText('No cited source is retracted, superseded or corrected.'),
    ).toBeInTheDocument();
  });
});
