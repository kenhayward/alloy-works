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
const REQUEST = 'ffffffff-0000-4000-8000-000000000001';

const waiting = {
  items: [
    {
      kind: 'publish_failed',
      artifact: { id: REPORT, kind: 'document', title: 'The dosing report' },
      reason: 'glyph_missing',
      request: REQUEST,
      state: { key: 'in_review', name: 'In review' },
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
      state: null,
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
    ).toEqual(['#/components', '#/documents', '#/templates', '#/prompts']);
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
          'It holds a character that no typeface it can use has.',
        ],
        href: `#/documents/${REPORT}/publishing/requests/${REQUEST}`,
      },
      {
        link: 'Open',
        said: [
          'Install the printer holds changes of yours not in a version',
          'Open it to recover them, or to discard them.',
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

  it('LIF-017 LIF-059 tells an owner a review falls due, and whoever a lapsed one was escalated to that it is overdue', async () => {
    const answer = {
      items: [
        {
          kind: 'review_overdue',
          artifact: { id: AUDIT, kind: 'document', title: 'The audit' },
          reviewBy: '2026-10-01',
        },
        {
          kind: 'review_due',
          artifact: { id: PRINTER, kind: 'component', title: 'Install the printer' },
          reviewBy: '2026-11-20',
        },
      ],
      total: 2,
    };
    render(
      <Home client={service({ ...everything, '/v1/me/attention': () => json(200, answer) })} />,
    );
    expect(await attention()).toEqual([
      {
        link: 'Open',
        said: ['The audit is overdue for review', 'It was to be reviewed by 1 October 2026.'],
        href: `#/documents/${AUDIT}`,
      },
      {
        link: 'Open',
        said: ['Install the printer is due for review', 'Review it by 20 November 2026.'],
        href: `#/components/${PRINTER}`,
      },
    ]);
  });

  it('LIF-005 shows the state of each thing waiting that has one', async () => {
    render(
      <Home client={service({ ...everything, '/v1/me/attention': () => json(200, waiting) })} />,
    );
    const section = await screen.findByRole('region', { name: 'Needs your attention' });
    const items = within(await within(section).findByRole('list')).getAllByRole('listitem');
    expect(within(items[0]!).getByText('In review')).toBeInTheDocument();
    // A connection has no workflow, and says no state.
    expect(within(items[3]!).queryByText(/In review|Draft|Approved/)).toBeNull();
  });

  it('lists nothing of a kind it does not know, and the rest as ever', async () => {
    const [failed, ...rest] = waiting.items;
    const answer = {
      items: [{ ...failed!, kind: 'something_new' }, ...rest],
      total: rest.length + 1,
    };
    render(
      <Home client={service({ ...everything, '/v1/me/attention': () => json(200, answer) })} />,
    );

    expect((await attention()).map((item) => item.said[0])).toEqual([
      'Install the printer holds changes of yours not in a version',
      'The audit was published from an earlier version',
      'Readings has not been tested since its credential was set',
    ]);
  });

  it('says so when nothing waits on the reader', async () => {
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
