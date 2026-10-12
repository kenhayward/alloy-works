import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Home } from './Home.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service(answers: Record<string, () => Response>) {
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const answer = answers[new URL(request.url).pathname];
    return answer ? answer() : json(404, {});
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://home.test', fetch: fetching });
}

const everything = {
  '/v1/me': () => json(200, { id: 'p1', displayName: 'Ada Lovelace', email: null }),
  '/v1/tenant': () => json(200, { name: 'Development' }),
  '/v1/components': () => json(200, { items: [], next: null, total: 412, spaces: [] }),
  '/v1/documents': () => json(200, { items: [{}], next: 'more', total: 3 }),
  '/v1/publications': () => json(200, { items: [{}], next: null, total: 1 }),
  '/v1/me/attention': () => json(200, { items: [], total: 0 }),
};

const REPORT = 'eeeeeeee-0000-4000-8000-000000000001';
const AUDIT = 'eeeeeeee-0000-4000-8000-000000000002';
const PRINTER = 'cccccccc-0000-4000-8000-000000000001';
const READINGS = 'aaaaaaaa-0000-4000-8000-000000000001';

const waiting = {
  items: [
    {
      kind: 'publish_failed',
      artifact: { id: REPORT, kind: 'document', title: 'The dosing report' },
      reason: 'value_none',
    },
    {
      kind: 'changes_not_in_version',
      artifact: { id: PRINTER, kind: 'component', title: 'Install the printer' },
    },
    {
      kind: 'published_earlier',
      artifact: { id: AUDIT, kind: 'document', title: 'The audit' },
    },
    {
      kind: 'connection_untested',
      artifact: { id: READINGS, kind: 'connection', title: 'Readings' },
    },
  ],
  total: 6,
};

/** Each item in Needs your attention: its one link, what the link is described by, and where it goes. */
const attention = async () => {
  const section = await screen.findByRole('region', { name: 'Needs your attention' });
  const list = await within(section).findByRole('list');
  return within(list)
    .getAllByRole('listitem')
    .map((item) => {
      const [link, ...more] = within(item).getAllByRole('link');
      expect(more).toEqual([]);
      return {
        link: link!.textContent,
        said: (link!.getAttribute('aria-describedby') ?? '')
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent),
        href: link!.getAttribute('href'),
      };
    });
};

describe('Home', () => {
  it('greets the reader and offers every module in its group, with how many there are to read', async () => {
    render(<Home client={service(everything)} />);

    expect(await screen.findByRole('heading', { name: 'Welcome back, Ada' })).toBeInTheDocument();
    expect(await screen.findByText('Development')).toBeInTheDocument();
    const group = (name: string) => screen.getByRole('region', { name });
    expect(
      within(group('Author'))
        .getAllByRole('link')
        .map((each) => each.getAttribute('href')),
    ).toEqual(['#/components', '#/documents', '#/templates']);
    expect(within(group('Publish')).getAllByRole('link')).toHaveLength(1);
    expect(
      within(group('Data'))
        .getAllByRole('link')
        .map((each) => each.getAttribute('href')),
    ).toEqual(['#/connections', '#/query-definitions']);

    const components = screen.getByRole('link', { name: /^Components/ });
    expect(await within(components).findByText('412')).toBeInTheDocument();
    expect(within(components).getByText('components you may read')).toBeInTheDocument();
    expect(
      within(components).getByText(
        'Write and version the typed pieces documents are assembled from.',
      ),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByRole('link', { name: /^Documents/ })).findByText('3'),
    ).toBeInTheDocument();
    const publications = screen.getByRole('link', { name: /^Publications/ });
    expect(await within(publications).findByText('1')).toBeInTheDocument();
    expect(within(publications).getByText('publication you may read')).toBeInTheDocument();
  });

  it('shows no total where the service gives none, rather than a guess', async () => {
    render(<Home client={service(everything)} />);

    const templates = await screen.findByRole('link', { name: /^Templates/ });
    expect(
      await within(screen.getByRole('link', { name: /^Components/ })).findByText('412'),
    ).toBeInTheDocument();
    expect(within(templates).queryByText(/\d/)).not.toBeInTheDocument();
  });

  it("SCH-070 lists what waits on the reader, each with its reason in the product's words and one link to resolve it", async () => {
    render(
      <Home client={service({ ...everything, '/v1/me/attention': () => json(200, waiting) })} />,
    );

    expect(await attention()).toEqual([
      {
        link: 'Open publishing',
        said: [
          'The dosing report cannot publish',
          "This value's result has no row. Change the value, or resolve it again.",
        ],
        href: `#/documents/${REPORT}/publishing`,
      },
      {
        link: 'Open',
        said: [
          'Install the printer holds changes of yours not in a version',
          'Recover resumes them, or discards them.',
        ],
        href: `#/components/${PRINTER}`,
      },
      {
        link: 'Open publishing',
        said: [
          'The audit was published from an earlier version',
          'Its latest publication is of an older version than the document is now.',
        ],
        href: `#/documents/${AUDIT}/publishing`,
      },
      {
        link: 'Open',
        said: [
          'Readings has not been tested since its credential was set',
          'Test it with the credential it has now.',
        ],
        href: `#/connections/${READINGS}`,
      },
    ]);
    const section = screen.getByRole('region', { name: 'Needs your attention' });
    expect(within(section).getByText('6 items')).toBeInTheDocument();
    expect(within(section).getByText('2 more')).toBeInTheDocument();
  });

  it('SCH-070 says so when nothing waits on the reader', async () => {
    render(<Home client={service(everything)} />);

    const section = await screen.findByRole('region', { name: 'Needs your attention' });
    expect(await within(section).findByText('Nothing needs your attention.')).toBeInTheDocument();
    expect(within(section).queryByRole('list')).toBeNull();
  });

  it('says so when what waits could not be read, and keeps the rest of Home', async () => {
    render(<Home client={service({ ...everything, '/v1/me/attention': () => json(500, {}) })} />);

    const section = await screen.findByRole('region', { name: 'Needs your attention' });
    expect(
      await within(section).findByText('What needs your attention could not be read.'),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByRole('link', { name: /^Components/ })).findByText('412'),
    ).toBeInTheDocument();
  });

  it('leaves a total off when it could not be read', async () => {
    render(
      <Home
        client={service({
          ...everything,
          '/v1/me': () => json(200, { id: 'p1', displayName: null, email: null }),
          '/v1/documents': () => json(500, {}),
        })}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    const components = screen.getByRole('link', { name: /^Components/ });
    expect(await within(components).findByText('412')).toBeInTheDocument();
    const documents = screen.getByRole('link', { name: /^Documents/ });
    expect(within(documents).queryByText(/documents? you may read/)).not.toBeInTheDocument();
  });
});
