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
const VERSION_NEXT = '55555555-5555-4555-8555-555555555555';
const OBTAINED = '66666666-6666-4666-8666-666666666666';
const FROM_EXTENSION = '77777777-7777-4777-8777-777777777777';
const READ_ONLY = '88888888-8888-4888-8888-888888888888';

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
    asked.push({ method: request.method, path: `${path}${url.search}`, body });
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
    if (request.method === 'POST' && path === `/v1/bibliography-entries/${ENTRY}/versions`) {
      const { entry } = body as { entry: { csl: unknown } };
      return json(200, {
        ...view,
        version: { ...view.version, id: VERSION_NEXT, number: '0.2' },
        entry: { ...view.entry, csl: entry.csl },
      });
    }
    if (path === `/v1/spaces/${GENERAL}/bibliography-entries/export`) {
      const format = url.searchParams.get('format');
      return json(200, {
        format,
        text: '@book{smith2020}',
        notCarried:
          format === 'csl-json' ? [] : [{ key: 'smith2020', variables: ['abstract', 'medium'] }],
      });
    }
    if (path === `/v1/bibliography-entries/${OBTAINED}`) {
      return json(200, {
        ...view,
        id: OBTAINED,
        entry: {
          ...view.entry,
          obtained: { from: 'crossref:10.1234/dunnart.2020', at: '2026-01-02T03:04:05Z' },
        },
        status: null,
      });
    }
    if (path === `/v1/bibliography-entries/${READ_ONLY}`) {
      return json(200, {
        ...view,
        id: READ_ONLY,
        entry: {
          ...view.entry,
          obtained: { from: 'crossref:10.1234/dunnart.2020', at: '2026-01-02T03:04:05Z' },
        },
        mayEdit: false,
        mayRetire: false,
        status: null,
      });
    }
    if (path === `/v1/bibliography-entries/${FROM_EXTENSION}`) {
      return json(200, {
        ...view,
        id: FROM_EXTENSION,
        entry: {
          ...view.entry,
          obtained: {
            from: 'ext:3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f:HERB-0042',
            at: '2026-01-02T03:04:05Z',
          },
        },
        status: null,
      });
    }
    if (path === `/v1/bibliography-entries/${OBTAINED}/check`) {
      return json(200, {
        source: 'crossref',
        checkedAt: '2026-10-22T10:00:00.000Z',
        outcome: 'retracted',
        differs: ['title'],
        notice: { kind: 'retraction', identifier: '10.1234/dunnart.r', date: '2026-04-22' },
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

describe("an entry's source (the XR plan, XRb)", () => {
  it('LIB-036 checks an entry obtained from a source now, showing its status and the notice', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<EntryPage client={client} id={OBTAINED} />);
    const source = await screen.findByRole('region', { name: 'Its source' });
    expect(source).toHaveTextContent('Not yet checked against Crossref.');
    await user.click(within(source).getByRole('button', { name: 'Check now' }));
    expect(asked.at(-1)).toMatchObject({
      method: 'POST',
      path: `/v1/bibliography-entries/${OBTAINED}/check`,
    });
    expect(await within(source).findByText(/Retracted by its source/)).toHaveTextContent(
      'Retracted by its source: 10.1234/dunnart.r, 2026-04-22.',
    );
    expect(source).toHaveTextContent('The source now holds otherwise: title.');
    expect(source).toHaveTextContent('Checked 2026-10-22.');
  });

  it('LIB-032 offers a check of an entry a reference extension obtained, naming it so, never by its key', async () => {
    const { client } = service();
    render(<EntryPage client={client} id={FROM_EXTENSION} />);
    const source = await screen.findByRole('region', { name: 'Its source' });
    expect(source).toHaveTextContent('Not yet checked against its reference extension.');
    expect(source).not.toHaveTextContent('ext:');
    expect(within(source).getByRole('button', { name: 'Check now' })).toBeInTheDocument();
  });

  it('offers no check to one who may read the entry but not edit it', async () => {
    const { client } = service();
    render(<EntryPage client={client} id={READ_ONLY} />);
    const source = await screen.findByRole('region', { name: 'Its source' });
    expect(source).toHaveTextContent('Not yet checked against Crossref.');
    expect(within(source).queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('offers no check for an entry made by hand', async () => {
    const { client } = service();
    render(<EntryPage client={client} id={ENTRY} />);
    await screen.findByRole('heading', { name: 'smith2020' });
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
  });
});

describe('changing and exporting an entry (the CI plan, CId)', () => {
  it('cuts its next version from the version opened, its other fields kept and its key never asked', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<EntryPage client={client} id={ENTRY} />);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit entry' });
    expect(within(form).queryByRole('textbox', { name: 'Key' })).toBeNull();
    const title = within(form).getByRole('textbox', { name: 'Title' });
    expect(title).toHaveValue('The Dunnart in Winter');
    expect(within(form).getByRole('textbox', { name: /^Authors/ })).toHaveValue(
      'Smith, Ada\nOkafor, Grace',
    );
    await user.clear(title);
    await user.type(title, 'The Dunnart in Spring');
    await user.click(within(form).getByRole('button', { name: 'Save version' }));
    expect(await screen.findByText('0.2')).toBeInTheDocument();
    expect(screen.getByText('The Dunnart in Spring')).toBeInTheDocument();
    expect(asked.find((each) => each.path.endsWith('/versions'))?.body).toEqual({
      openedFrom: VERSION,
      entry: { csl: { ...csl, title: 'The Dunnart in Spring' } },
    });
  });

  it('LIB-009 exports the entry alone as CSL-JSON, BibTeX or RIS, saved as a file', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    const saved: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved.push(blob);
      return 'blob:entry';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<EntryPage client={client} id={ENTRY} />);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Export as' }), 'BibTeX');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(asked.map((each) => each.path)).toContain(
      `/v1/spaces/${GENERAL}/bibliography-entries/export?format=bibtex&ids=${ENTRY}`,
    );
    expect(await saved[0]!.text()).toBe('@book{smith2020}');
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('smith2020.bib');
  });

  it('PUB-055 says what of the entry the format exported to did not carry, and nothing for CSL-JSON', async () => {
    const user = userEvent.setup();
    const { client } = service();
    URL.createObjectURL = vi.fn(() => 'blob:entry');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<EntryPage client={client} id={ENTRY} />);
    const format = await screen.findByRole('combobox', { name: 'Export as' });
    await user.selectOptions(format, 'BibTeX');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'BibTeX did not carry its abstract and medium.',
    );
    await user.selectOptions(format, 'CSL-JSON');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
