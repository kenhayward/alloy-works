import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Bibliography } from './Bibliography.js';
import { EntryPage } from './EntryPage.js';

const GENERAL = '11111111-1111-4111-8111-111111111111';
const ENTRY = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const COMPONENT = '44444444-4444-4444-8444-444444444444';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const csl = {
  type: 'article-journal',
  title: 'The Dunnart in Winter',
  author: [
    { family: 'Smith', given: 'Ada' },
    { family: 'Okafor', given: 'Grace' },
  ],
  issued: { 'date-parts': [[2020]] },
  DOI: '10.1234/dunnart.2020',
};

const summary = {
  id: ENTRY,
  key: 'smith2020',
  csl,
  version: { id: VERSION, number: '0.1' },
  changedAt: '2026-10-22T09:00:00.000Z',
};

const view = {
  id: ENTRY,
  space: { id: GENERAL, name: 'General' },
  version: { id: VERSION, number: '0.1', author: null, createdAt: '2026-10-22T09:00:00.000Z' },
  entry: { schemaVersion: 1, csl, key: 'smith2020' },
  archived: false,
  mayEdit: true,
  mayRetire: true,
};

interface Asked {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

function service() {
  const asked: Asked[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = await request.text();
    const body = text === '' ? undefined : (JSON.parse(text) as unknown);
    const path = url.pathname;
    asked.push({ method: request.method, path, body });
    if (path === '/v1/spaces') {
      return json(200, {
        items: [{ id: GENERAL, name: 'General', archived: false, mayCreate: true }],
        next: null,
      });
    }
    if (request.method === 'GET' && path === `/v1/spaces/${GENERAL}/bibliography-entries`) {
      return json(200, { items: [summary], next: null, total: 1 });
    }
    if (request.method === 'POST' && path === `/v1/spaces/${GENERAL}/bibliography-entries`) {
      const asking = body as { despiteMatches?: boolean };
      return asking.despiteMatches === true
        ? json(200, {
            entry: { ...view, entry: { ...view.entry, key: 'smith2020a' } },
            matches: [],
          })
        : json(200, { entry: null, matches: [{ by: 'doi', entry: summary }] });
    }
    if (request.method === 'POST' && path === `/v1/spaces/${GENERAL}/bibliography-entries/import`) {
      return json(200, {
        records: [
          {
            outcome: 'merged',
            entry: summary,
            by: 'doi',
            merged: ['volume'],
            dropped: ['custom'],
            message: null,
          },
        ],
      });
    }
    if (path === `/v1/bibliography-entries/${ENTRY}`) return json(200, view);
    if (path === `/v1/bibliography-entries/${ENTRY}/uses`) {
      return json(200, {
        components: { named: [{ id: COMPONENT, title: 'The dunnart section' }], unreadable: true },
        baselines: { named: [], unreadable: false },
      });
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  });
  return {
    client: createApiClient({ baseUrl: 'http://bibliography.test', fetch: fetching }),
    asked,
  };
}

afterEach(() => {
  window.location.hash = '';
});

describe("a space's bibliography", () => {
  it('lists each entry by its key, authors, title and year', async () => {
    const { client } = service();
    render(<Bibliography client={client} />);
    const row = (await screen.findByRole('link', { name: 'smith2020' })).closest('tr')!;
    expect(row).toHaveTextContent('Smith, Okafor');
    expect(row).toHaveTextContent('The Dunnart in Winter');
    expect(row).toHaveTextContent('2020');
    expect(within(row).getByRole('link', { name: 'smith2020' })).toHaveAttribute(
      'href',
      `#/bibliography/${ENTRY}`,
    );
  });

  it('LIB-044 offers the entry already there when one is made by hand, and makes it anyway when asked', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<Bibliography client={client} />);
    await user.click(await screen.findByRole('button', { name: 'New entry' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'The Dunnart in Winter');
    await user.type(screen.getByRole('textbox', { name: /^Authors/ }), 'Smith, Ada');
    await user.type(screen.getByRole('textbox', { name: 'Year' }), '2020');
    await user.type(screen.getByRole('textbox', { name: 'DOI' }), '10.1234/dunnart.2020');
    await user.click(screen.getByRole('button', { name: 'Make entry' }));
    const offer = await screen.findByRole('region', { name: 'Already in this space' });
    expect(within(offer).getByRole('link', { name: 'smith2020' })).toHaveAttribute(
      'href',
      `#/bibliography/${ENTRY}`,
    );
    expect(offer).toHaveTextContent('Found by its DOI');
    expect(
      asked.find((each) => each.method === 'POST' && each.path.endsWith('/bibliography-entries'))
        ?.body,
    ).toEqual({
      entry: {
        csl: {
          type: 'article-journal',
          title: 'The Dunnart in Winter',
          author: [{ family: 'Smith', given: 'Ada' }],
          issued: { 'date-parts': [[2020]] },
          DOI: '10.1234/dunnart.2020',
        },
      },
    });
    await user.click(within(offer).getByRole('button', { name: 'Make it anyway' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/bibliography/${ENTRY}`));
  });

  it('LIB-010 imports pasted text, saying what was merged and what could not be kept', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<Bibliography client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Format' }), 'BibTeX');
    await user.click(screen.getByRole('textbox', { name: 'Records' }));
    await user.paste('@article{x, title={The Dunnart in Winter}, volume={12}}');
    await user.click(screen.getByRole('button', { name: 'Import records' }));
    const report = await screen.findByRole('region', { name: 'Imported' });
    expect(report).toHaveTextContent('smith2020: merged, found by its DOI, and given volume');
    expect(report).toHaveTextContent('Not kept: custom');
    expect(asked.find((each) => each.path.endsWith('/bibliography-entries/import'))?.body).toEqual({
      format: 'bibtex',
      text: '@article{x, title={The Dunnart in Winter}, volume={12}}',
    });
  });
});

describe('an entry page', () => {
  it('shows its key, authors, title and year, and where it is cited', async () => {
    const { client } = service();
    render(<EntryPage client={client} id={ENTRY} />);
    expect(await screen.findByRole('heading', { name: 'smith2020' })).toBeInTheDocument();
    expect(screen.getByText('Smith, Ada; Okafor, Grace')).toBeInTheDocument();
    expect(screen.getByText('The Dunnart in Winter')).toBeInTheDocument();
    expect(screen.getByText('2020')).toBeInTheDocument();
    const uses = await screen.findByRole('region', { name: 'Cited in' });
    expect(within(uses).getByRole('link', { name: 'The dunnart section' })).toHaveAttribute(
      'href',
      `#/components/${COMPONENT}`,
    );
    expect(uses).toHaveTextContent('Cited in more you may not read.');
  });
});
