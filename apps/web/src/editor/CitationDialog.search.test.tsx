import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CitationDialog, MAY_NOT_MAKE } from './CitationDialog.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SPACE = '11111111-1111-4111-8111-111111111111';
const MARLOW = '22222222-2222-4222-8222-222222222221';
const MADE = '22222222-2222-4222-8222-222222222229';
const version = { id: '33333333-3333-4333-8333-333333333333', number: '0.1' };

const marsh = {
  type: 'article-journal',
  title: 'Salt Marsh Accretion',
  author: [{ family: 'Marlow', given: 'Ada' }],
  issued: { 'date-parts': [[2021]] },
  DOI: '10.5555/marsh.2021.017',
};
const quolls = {
  type: 'chapter',
  title: 'Quolls of the Northern Ranges',
  author: [{ family: 'Thornbury', given: 'Ivy' }],
  issued: { 'date-parts': [[2019]] },
  DOI: '10.5555/quolls.ch4',
};

/** A space holding Marlow's entry; Crossref on and PubMed off; a search finding both records. */
/** A reference extension the tenant installed (the XR plan, XR-J), by its key. */
const HERBARIUM = 'ext:3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f';

function service(mayCreate: boolean, herbarium = false) {
  const asked: { path: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const body = request.method === 'POST' ? ((await request.json()) as unknown) : undefined;
    asked.push({ path: url.pathname, body });
    if (url.pathname === `/v1/spaces/${SPACE}/bibliography-entries`) {
      return json(200, {
        items: [
          {
            id: MARLOW,
            key: 'marlow2021',
            csl: marsh,
            version,
            changedAt: '2026-10-22T09:00:00Z',
            flag: 'retracted',
          },
        ],
        next: null,
        total: 1,
      });
    }
    if (url.pathname === '/v1/reference-sources') {
      return json(200, {
        items: [
          {
            id: 'crossref',
            name: 'Crossref',
            host: 'api.crossref.org',
            identifier: 'DOI',
            enabled: true,
          },
          {
            id: 'pubmed',
            name: 'PubMed',
            host: 'eutils.ncbi.nlm.nih.gov',
            identifier: 'PMID',
            enabled: false,
          },
          ...(herbarium
            ? [
                {
                  id: HERBARIUM,
                  name: 'Herbarium records',
                  host: 'herbarium.example.test',
                  identifier: 'Identifier',
                  enabled: true,
                },
              ]
            : []),
        ],
      });
    }
    if (decodeURIComponent(url.pathname) === `/v1/reference-sources/${HERBARIUM}/search`) {
      return json(200, {
        mayCreate,
        results: [
          {
            identifier: 'HERB-0042',
            csl: { type: 'article-journal', title: 'Saltbush specimens of the eastern plains' },
            dropped: [],
            matches: [],
          },
        ],
      });
    }
    if (url.pathname === '/v1/reference-sources/crossref/search') {
      return json(200, {
        mayCreate,
        results: [
          {
            identifier: marsh.DOI,
            csl: marsh,
            dropped: [],
            matches: [
              {
                by: 'doi',
                entry: {
                  id: MARLOW,
                  key: 'marlow2021',
                  csl: marsh,
                  version,
                  changedAt: '2026-10-22T09:00:00Z',
                  flag: 'retracted',
                },
              },
            ],
          },
          { identifier: quolls.DOI, csl: quolls, dropped: [], matches: [] },
        ],
      });
    }
    if (url.pathname === `/v1/spaces/${SPACE}/bibliography-entries/from-source`) {
      return json(200, { entry: { id: MADE }, matches: [], dropped: [] });
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://citing.test', fetch: fetching }), asked };
}

async function searched(mayCreate: boolean) {
  const { client, asked } = service(mayCreate);
  const done = vi.fn(() => null);
  render(
    <CitationDialog
      client={client}
      space={SPACE}
      current={null}
      onDone={done}
      onCancel={() => undefined}
    />,
  );
  await screen.findByRole('radio', { name: /marlow2021/ });
  await userEvent.click(screen.getByRole('tab', { name: 'Search' }));
  const source = await screen.findByRole('combobox', { name: 'Source' });
  expect(
    within(source)
      .getAllByRole('option')
      .map((each) => each.textContent),
  ).toEqual(['Crossref']);
  expect(screen.getByText('Your search is sent to Crossref.')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search terms' }), 'salt marsh');
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('radio', { name: /Quolls/ });
  return { asked, done };
}

describe("the Cite dialog's Search tab (the XR plan, XR-D)", () => {
  it('LIB-031 searches a source that is on, saying the search is sent there, and cites a new result as an entry made from it', async () => {
    const { asked, done } = await searched(true);
    expect(asked.find((each) => each.path.endsWith('/search'))?.body).toEqual({
      space: `space:${SPACE}`,
      terms: 'salt marsh',
    });
    const quollsRadio = screen.getByRole('radio', { name: /Quolls/ });
    expect(quollsRadio).toBeEnabled();
    await userEvent.click(quollsRadio);
    await userEvent.type(screen.getByRole('textbox', { name: /Locator/ }), 'p. 80');
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(asked.at(-1)).toEqual({
      path: `/v1/spaces/${SPACE}/bibliography-entries/from-source`,
      body: { source: 'crossref', identifier: '10.5555/quolls.ch4' },
    });
    expect(done).toHaveBeenCalledWith({ entry: MADE, locator: 'p. 80' });
  });

  it('LIB-031 cites a result already in the bibliography as its entry, and without the space’s write shows the rest disabled, saying why', async () => {
    const { asked, done } = await searched(false);
    const matched = screen.getByRole('radio', { name: /Salt Marsh Accretion/ });
    expect(matched.closest('label')).toHaveTextContent('In the bibliography as marlow2021');
    const quollsRadio = screen.getByRole('radio', { name: /Quolls/ });
    expect(quollsRadio).toBeDisabled();
    expect(quollsRadio).toHaveAccessibleDescription(MAY_NOT_MAKE());
    await userEvent.click(matched);
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(done).toHaveBeenCalledWith({ entry: MARLOW, locator: null });
    expect(asked.some((each) => each.path.endsWith('/from-source'))).toBe(false);
  });

  it('LIB-036 flags an entry its source says is retracted, in the list and among the results', async () => {
    await searched(true);
    expect(
      screen.getByRole('radio', { name: /Salt Marsh Accretion/ }).closest('label'),
    ).toHaveTextContent('In the bibliography as marlow2021, retracted by its source');
    await userEvent.click(screen.getByRole('tab', { name: 'Entries' }));
    expect(
      (await screen.findByRole('radio', { name: /marlow2021/ })).closest('label'),
    ).toHaveTextContent('Retracted by its source');
  });

  it('LIB-032 lists a reference extension among the sources, searches it by its key and cites from it', async () => {
    const { client, asked } = service(true, true);
    const done = vi.fn(() => null);
    render(
      <CitationDialog
        client={client}
        space={SPACE}
        current={null}
        onDone={done}
        onCancel={() => undefined}
      />,
    );
    await screen.findByRole('radio', { name: /marlow2021/ });
    await userEvent.click(screen.getByRole('tab', { name: 'Search' }));
    const source = await screen.findByRole('combobox', { name: 'Source' });
    expect(
      within(source)
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual(['Crossref', 'Herbarium records']);
    await userEvent.selectOptions(source, HERBARIUM);
    expect(screen.getByText('Your search is sent to Herbarium records.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search terms' }), 'saltbush');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Saltbush/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(asked.at(-1)).toEqual({
      path: `/v1/spaces/${SPACE}/bibliography-entries/from-source`,
      body: { source: HERBARIUM, identifier: 'HERB-0042' },
    });
    expect(done).toHaveBeenCalledWith({ entry: MADE, locator: null });
  });
});
