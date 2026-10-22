import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TermPage } from './TermPage.js';
import { Terms } from './Terms.js';

const GENERAL = '11111111-1111-4111-8111-111111111111';
const TERM = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const COMPONENT = '44444444-4444-4444-8444-444444444444';
const MARSUPIAL = '55555555-5555-4555-8555-555555555555';
const VERSION_NEXT = '66666666-6666-4666-8666-666666666666';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const term = {
  schemaVersion: 1,
  base: 'en',
  labels: [
    {
      language: 'en',
      preferred: 'Fat-tailed dunnart',
      alternatives: ['Dunnart'],
      abbreviation: 'FTD',
    },
    { language: 'fr', preferred: 'Dunnart à queue grasse', alternatives: [] },
  ],
  definition: [{ language: 'en', text: 'A small carnivorous marsupial.' }],
  broader: [],
  narrower: [],
  related: [],
};

const summary = (id: string, label: string, state: string, name: string) => ({
  id,
  label,
  abbreviation: label === 'Fat-tailed dunnart' ? 'FTD' : null,
  term,
  version: { id: VERSION, number: '0.1' },
  changedAt: '2026-10-22T09:00:00.000Z',
  state: { key: state, name, approved: state === 'approved' },
});

const view = {
  id: TERM,
  space: { id: GENERAL, name: 'General' },
  version: { id: VERSION, number: '0.1', author: null, createdAt: '2026-10-22T09:00:00.000Z' },
  term,
  archived: false,
  deprecated: false,
  mayEdit: true,
  mayRetire: true,
  state: { key: 'approved', name: 'Approved', approved: true },
  transitions: [
    {
      key: 'deprecate',
      name: 'Deprecate',
      to: { key: 'deprecated', name: 'Deprecated' },
      reasonRequired: true,
    },
  ],
  gates: [],
  revision: { number: 1, versionId: VERSION, at: '2026-10-22T09:00:00.000Z' },
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
    asked.push({ method: request.method, path: `${path}${url.search}`, body });
    if (path === '/v1/spaces') {
      return json(200, {
        items: [{ id: GENERAL, name: 'General', archived: false, mayCreate: true }],
        next: null,
      });
    }
    if (request.method === 'GET' && path === `/v1/spaces/${GENERAL}/terms`) {
      return json(200, {
        items: [
          summary(TERM, 'Fat-tailed dunnart', 'approved', 'Approved'),
          summary(MARSUPIAL, 'Marsupial', 'deprecated', 'Deprecated'),
        ],
        next: null,
        total: 2,
      });
    }
    if (request.method === 'POST' && path === `/v1/spaces/${GENERAL}/terms`) {
      return json(200, { ...view, state: { key: 'draft', name: 'Draft', approved: false } });
    }
    if (request.method === 'POST' && path === `/v1/spaces/${GENERAL}/terms/import`) {
      return json(200, {
        concepts: [
          {
            key: 'urn:x:numbat',
            outcome: 'created',
            term: { id: MARSUPIAL, label: 'Numbat' },
            merged: [],
            message: null,
          },
        ],
        unrepresented: [
          {
            concept: 'urn:x:numbat',
            what: 'predicate',
            detail: 'http://www.w3.org/2004/02/skos/core#scopeNote',
          },
        ],
        unrepresentedTotal: 1,
      });
    }
    if (path === `/v1/spaces/${GENERAL}/terms/export`) {
      return json(200, { format: 'json-ld', text: '{"@graph":[]}' });
    }
    if (request.method === 'POST' && path === `/v1/terms/${TERM}/versions`) {
      const asking = body as { term: unknown };
      return json(200, {
        ...view,
        version: { ...view.version, id: VERSION_NEXT, number: '0.2' },
        term: asking.term,
      });
    }
    if (request.method === 'POST' && path === `/v1/terms/${TERM}/transitions`) {
      return json(200, {
        state: { key: 'deprecated', name: 'Deprecated', approved: false },
        transitions: [],
        gates: [],
        revision: view.revision,
      });
    }
    if (path === `/v1/terms/${TERM}`) return json(200, view);
    if (path === `/v1/terms/${TERM}/uses`) {
      return json(200, {
        named: [{ id: COMPONENT, title: 'The dunnart section' }],
        unreadable: true,
      });
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  });
  return { client: createApiClient({ baseUrl: 'http://terms.test', fetch: fetching }), asked };
}

afterEach(() => {
  window.location.hash = '';
});

describe("a space's terms", () => {
  it('LIB-049 lists each term by its label and abbreviation, with its standing', async () => {
    const { client } = service();
    render(<Terms client={client} />);
    const row = (await screen.findByRole('link', { name: 'Fat-tailed dunnart' })).closest('tr')!;
    expect(row).toHaveTextContent('FTD');
    expect(row).toHaveTextContent('Approved');
    expect(within(row).getByRole('link')).toHaveAttribute('href', `#/terms/${TERM}`);
    expect(screen.getByRole('link', { name: 'Marsupial' }).closest('tr')).toHaveTextContent(
      'Deprecated',
    );
  });

  it('makes a term from its preferred label, and opens it', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<Terms client={client} />);
    await user.click(await screen.findByRole('button', { name: 'New term' }));
    await user.type(screen.getByRole('textbox', { name: 'Preferred label' }), 'Quoll');
    await user.click(screen.getByRole('button', { name: 'Make term' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/terms/${TERM}`));
    expect(asked.find((each) => each.method === 'POST')?.body).toEqual({
      term: {
        schemaVersion: 1,
        base: 'en',
        labels: [{ language: 'en', preferred: 'Quoll', alternatives: [] }],
        definition: [],
        broader: [],
        narrower: [],
        related: [],
      },
    });
  });

  it('LIB-029 imports Turtle and names what no term could hold', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<Terms client={client} />);
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Format' }), 'turtle');
    await user.type(
      screen.getByRole('textbox', { name: 'SKOS' }),
      '<urn:x:numbat> a skos:Concept .',
    );
    await user.click(screen.getByRole('button', { name: 'Import terms' }));
    const done = await screen.findByRole('region', { name: 'Imported' });
    expect(done).toHaveTextContent('Numbat: made');
    expect(done).toHaveTextContent(
      'Not represented: urn:x:numbat, http://www.w3.org/2004/02/skos/core#scopeNote',
    );
    expect(asked.find((each) => each.path.endsWith('/terms/import'))?.body).toMatchObject({
      format: 'turtle',
    });
  });
});

describe("a term's page", () => {
  it('LIB-014 shows its labels per language, its definition, where it is used and its workflow', async () => {
    const { client } = service();
    render(<TermPage client={client} id={TERM} />);
    await screen.findByRole('heading', { name: 'Fat-tailed dunnart' });
    const labels = screen.getByRole('table', { name: 'Labels' });
    expect(
      within(labels)
        .getAllByRole('row')
        .map((row) => row.textContent),
    ).toEqual([
      'LanguagePreferredAlternativesAbbreviation',
      'en (base)Fat-tailed dunnartDunnartFTD',
      'frDunnart à queue grasse',
    ]);
    expect(screen.getByText('A small carnivorous marsupial.')).toBeInTheDocument();
    const uses = await screen.findByRole('region', { name: 'Used in' });
    expect(within(uses).getByRole('link', { name: 'The dunnart section' })).toHaveAttribute(
      'href',
      `#/components/${COMPONENT}`,
    );
    expect(uses).toHaveTextContent('Used in more you may not read.');
    expect(screen.getByRole('button', { name: 'Deprecate' })).toBeInTheDocument();
  });

  it('LIB-025 cuts a version relating it to a term of its space, picked by its label', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<TermPage client={client} id={TERM} />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.selectOptions(await screen.findByRole('listbox', { name: 'Broader' }), 'Marsupial');
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    await screen.findByText('0.2');
    const saved = asked.find((each) => each.path.endsWith('/versions'))?.body as {
      term: { broader: string[] };
    };
    expect(saved.term.broader).toEqual([MARSUPIAL]);
  });
});
