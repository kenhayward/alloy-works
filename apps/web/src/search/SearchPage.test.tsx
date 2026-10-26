import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SearchPage } from './SearchPage.js';

const GUIDE = 'aaaaaaaa-0000-4000-8000-000000000001';
const REPORT = 'aaaaaaaa-0000-4000-8000-000000000002';
const SPACE = 'bbbbbbbb-0000-4000-8000-000000000001';
const REVIEWER = 'cccccccc-0000-4000-8000-000000000001';
const NODE = 'abcdefghijklmnopqrstuvwxyz';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const none = { value: '', label: '', count: 0, capped: false };
const facet = (value: string, label: string, count: number, capped = false) => ({
  ...none,
  value,
  label,
  count,
  capped,
});

const results = {
  outcome: 'results',
  count: 2,
  capped: false,
  message: '2 results.',
  items: [
    {
      kind: 'component',
      artifactId: GUIDE,
      node: null,
      title: 'Lever guide',
      space: { id: SPACE, name: 'General' },
      changedAt: '2026-09-27T09:00:00.000Z',
      place: 'block:b2',
      passage: [
        { text: 'Hold the ', matched: false },
        { text: 'lever', matched: true },
        { text: ' until it clicks.', matched: false },
      ],
      state: { key: 'in_review', name: 'In review' },
    },
    {
      kind: 'section',
      artifactId: REPORT,
      node: NODE,
      title: 'Findings',
      space: { id: SPACE, name: 'General' },
      changedAt: '2026-09-27T09:00:00.000Z',
      place: `field:${REVIEWER}`,
      passage: [{ text: 'Lever', matched: true }],
    },
  ],
  facets: {
    kinds: [facet('component', 'component', 1), facet('section', 'section', 1)],
    spaces: [facet(SPACE, 'General', 2)],
    componentTypes: [],
    owners: [],
    states: [facet('in_review', 'In review', 1), facet('draft', 'Draft', 1)],
    changed: ['today', 'week', 'month', 'year', 'earlier'].map((value) =>
      facet(value, value, value === 'earlier' ? 0 : 2),
    ),
    fields: [
      {
        field: REVIEWER,
        name: 'Reviewer',
        dataType: 'text',
        values: [facet('Grace Moss', 'Grace Moss', 1000, true)],
      },
    ],
  },
};

/** The service as the page meets it, answering every search with `answer`, and what it was asked. */
function service(answer: (query: URLSearchParams) => Response | Promise<Response>) {
  const asked: URLSearchParams[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname !== '/v1/search') return json(404, {});
    asked.push(url.searchParams);
    return answer(url.searchParams);
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://search.test', fetch: fetching }), asked };
}

describe('the search page', () => {
  it('shows each result with its kind, space, where it matched and a passage, linked there', async () => {
    const { client, asked } = service(() => json(200, results));
    render(<SearchPage client={client} query="lever" onSearch={() => undefined} />);

    expect(await screen.findByRole('status')).toHaveTextContent('2 results.');
    expect(asked[0]?.get('q')).toBe('lever');
    const [guide, findings] = screen.getAllByRole('article');
    // A component's block, through the component's page; a section, through its document's node.
    expect(within(guide!).getByRole('link', { name: 'Lever guide' })).toHaveAttribute(
      'href',
      `#/components/${GUIDE}/blocks/b2`,
    );
    expect(within(findings!).getByRole('link', { name: 'Findings' })).toHaveAttribute(
      'href',
      `#/documents/${REPORT}/nodes/${NODE}`,
    );
    expect(guide).toHaveTextContent('Component in General');
    expect(guide).toHaveTextContent('In its text');
    expect(findings).toHaveTextContent('In Reviewer');
    // The words it matched, marked in the passage.
    const marked = within(guide!).getByText('lever', { selector: 'mark' });
    expect(marked.closest('p')).toHaveTextContent('Hold the lever until it clicks.');
  });

  it('SCH-014 says which results meaning found, alone or with the words, and when meaning is unavailable', async () => {
    const [guide, findings] = results.items;
    const { client } = service(() =>
      json(200, {
        ...results,
        meaning: 'used',
        items: [
          { ...guide, found: 'both' },
          { ...findings, found: 'meaning' },
        ],
      }),
    );
    const { unmount } = render(
      <SearchPage client={client} query="lever" onSearch={() => undefined} />,
    );
    const [both, meant] = await screen.findAllByRole('article');
    expect(within(both!).getByText('Found by words and meaning')).toBeInTheDocument();
    expect(within(meant!).getByText('Found by meaning')).toBeInTheDocument();
    unmount();

    const words = service(() =>
      json(200, { ...results, meaning: 'unavailable', items: [{ ...guide, found: 'words' }] }),
    );
    render(<SearchPage client={words.client} query="lever" onSearch={() => undefined} />);
    expect(
      await screen.findByText(
        'Searching by meaning is unavailable just now: these are found by their words alone.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Found by/)).toBeNull();
  });

  it('SCH-053 shows a section with its document and the components it places, and offers to place it in a document', async () => {
    const PUMP = 'cccccccc-0000-4000-8000-0000000000aa';
    const { client } = service(() =>
      json(200, {
        ...results,
        count: 1,
        message: '1 result.',
        items: [
          {
            ...results.items[1],
            section: {
              document: { id: REPORT, title: 'Lever report' },
              components: [{ id: PUMP, title: 'Prime the pump' }],
            },
          },
        ],
      }),
    );
    render(<SearchPage client={client} query="lever" onSearch={() => undefined} />);
    const [findings] = await screen.findAllByRole('article');
    expect(within(findings!).getByRole('link', { name: 'Lever report' })).toHaveAttribute(
      'href',
      `#/documents/${REPORT}`,
    );
    const places = within(findings!).getByRole('list', { name: 'It places' });
    expect(within(places).getByRole('link', { name: 'Prime the pump' })).toHaveAttribute(
      'href',
      `#/components/${PUMP}`,
    );
    await userEvent.click(within(findings!).getByRole('button', { name: 'Place in a document' }));
    expect(await screen.findByRole('dialog', { name: 'Place in a document' })).toBeVisible();
  });

  it('LIF-046 says a component found has diverged, naming its lines', async () => {
    const { client } = service(() =>
      json(200, {
        ...results,
        count: 1,
        message: '1 result.',
        items: [{ ...results.items[0], lines: ['US'] }],
      }),
    );
    render(<SearchPage client={client} query="lever" onSearch={() => undefined} />);
    const [found] = await screen.findAllByRole('article');
    expect(within(found!).getByText('Diverged: US')).toBeInTheDocument();
  });

  it('shows a thread found by a message, resolved, linked to the message', async () => {
    const THREAD = 'ffffffff-0000-4000-8000-000000000001';
    const COMMENT = 'ffffffff-0000-4000-8000-000000000002';
    const { client } = service(() =>
      json(200, {
        ...results,
        count: 2,
        message: '2 results.',
        items: [
          results.items[0],
          {
            kind: 'thread',
            artifactId: GUIDE,
            node: null,
            title: 'Which lever?',
            space: { id: SPACE, name: 'General' },
            changedAt: '2026-09-27T09:00:00.000Z',
            place: `message:${COMMENT}`,
            passage: [{ text: 'lever', matched: true }],
            version: null,
            baseline: null,
            thread: { id: THREAD, on: 'component', resolved: true },
          },
        ],
      }),
    );
    render(<SearchPage client={client} query="lever" onSearch={() => undefined} />);
    const [, thread] = await screen.findAllByRole('article');
    expect(thread).toHaveTextContent('Thread in General');
    expect(thread).toHaveTextContent('Resolved');
    expect(thread).toHaveTextContent('In a message');
    expect(within(thread!).getByRole('link', { name: 'Which lever?' })).toHaveAttribute(
      'href',
      `#/components/${GUIDE}/threads/${THREAD}/comments/${COMMENT}`,
    );
  });

  it('says in a sentence why a query has nothing to show, and asks nothing for no query', async () => {
    const { client, asked } = service(() =>
      json(200, {
        outcome: 'nothing_to_match',
        excluded: ['brake'],
        message: 'Nothing to look for: the search only leaves out brake. Add a word to look for.',
      }),
    );
    const { rerender } = render(<SearchPage client={client} query="" onSearch={() => undefined} />);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('');
    expect(asked).toEqual([]);
    rerender(<SearchPage client={client} query="-brake" onSearch={() => undefined} />);
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Nothing to look for: the search only leaves out brake. Add a word to look for.',
    );
    expect(screen.queryAllByRole('article')).toEqual([]);
  });

  it('searches what is typed, and narrows by a facet, showing a capped count as at least', async () => {
    const { client, asked } = service(() => json(200, results));
    const searched = vi.fn();
    render(<SearchPage client={client} query="lever" onSearch={searched} />);
    await screen.findByRole('status');

    const box = screen.getByRole('searchbox', { name: 'Search' });
    await userEvent.clear(box);
    await userEvent.type(box, 'clutch{Enter}');
    expect(searched).toHaveBeenCalledWith('clutch');

    const kinds = screen.getByRole('group', { name: 'Kind' });
    await userEvent.click(within(kinds).getByRole('checkbox', { name: 'Section (1)' }));
    await waitFor(() => expect(asked.at(-1)?.get('kind')).toBe('section'));

    const reviewer = screen.getByRole('group', { name: 'Reviewer' });
    const capped = within(reviewer).getByRole('checkbox', {
      name: 'Grace Moss (at least 1,000)',
    });
    await userEvent.click(capped);
    await waitFor(() => expect(asked.at(-1)?.getAll('value')).toEqual([`${REVIEWER}:Grace Moss`]));
    expect(asked.at(-1)?.get('kind')).toBe('section');
  });

  it('SCH-061 SCH-063 narrows by a condition and by a relationship field, each under its own heading', async () => {
    const SUPERSEDES = 'dddddddd-0000-4000-8000-000000000001';
    const BASIS = 'dddddddd-0000-4000-8000-000000000002';
    const { client, asked } = service(() =>
      json(200, {
        ...results,
        facets: {
          ...results.facets,
          conditions: [{ axis: 'market', values: [facet('market:eu', 'market:eu', 1)] }],
          relations: [
            {
              type: SUPERSEDES,
              typeName: 'Supersedes',
              field: BASIS,
              name: 'Basis',
              dataType: 'text',
              values: [facet('Recall', 'Recall', 2)],
            },
          ],
        },
      }),
    );
    render(<SearchPage client={client} query="lever" onSearch={() => undefined} />);
    const market = await screen.findByRole('group', { name: 'Conditioned on market' });
    await userEvent.click(within(market).getByRole('checkbox', { name: 'eu (1)' }));
    await waitFor(() => expect(asked.at(-1)?.getAll('condition')).toEqual(['market:eu']));
    const basis = screen.getByRole('group', { name: 'Supersedes: Basis' });
    await userEvent.click(within(basis).getByRole('checkbox', { name: 'Recall (2)' }));
    await waitFor(() =>
      expect(asked.at(-1)?.getAll('related')).toEqual([`${SUPERSEDES}:${BASIS}:Recall`]),
    );
    expect(asked.at(-1)?.getAll('condition')).toEqual(['market:eu']);
  });

  it('shows more results a page at a time, once however often it is asked', async () => {
    const third = {
      ...results.items[0]!,
      artifactId: 'aaaaaaaa-0000-4000-8000-000000000003',
      title: 'Lever cleaning',
    };
    // The next page is held until both clicks are in, as a slow connection would hold it.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const { client, asked } = service(async (query) => {
      if (query.get('offset') !== '2') return json(200, { ...results, count: 3 });
      await held;
      return json(200, { ...results, count: 3, items: [third] });
    });
    render(<SearchPage client={client} query="lever" onSearch={() => undefined} />);
    await screen.findByRole('status');
    const more = screen.getByRole('button', { name: 'Show more results' });
    await userEvent.click(more);
    await userEvent.click(more);
    release();
    expect(await screen.findByRole('link', { name: 'Lever cleaning' })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(asked.filter((each) => each.get('offset') === '2')).toHaveLength(1);
    // Everything shown, nothing more to ask for.
    expect(screen.queryByRole('button', { name: 'Show more results' })).toBeNull();
  });

  it('offers Try again when the search could not be made', async () => {
    let fail = true;
    const { client } = service(() =>
      fail ? json(500, { code: 'failed', message: 'no', traceId: 't' }) : json(200, results),
    );
    render(<SearchPage client={client} query="lever" onSearch={() => undefined} />);
    expect(await screen.findByText('The search could not be made.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('status')).toHaveTextContent('2 results.');
  });
});

describe('the search page, over earlier versions and baselines', () => {
  const VERSION = 'dddddddd-0000-4000-8000-000000000001';
  const BASELINE = 'eeeeeeee-0000-4000-8000-000000000001';
  const earlier = {
    ...results,
    count: 1,
    message: '1 result.',
    items: [
      {
        ...results.items[0]!,
        version: { id: VERSION, number: '0.2', latest: false },
        baseline: null,
      },
    ],
  };

  /** The service answering a search with `answer`, and the baseline by its name. */
  function withBaseline(answer: unknown) {
    const asked: URLSearchParams[] = [];
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname === `/v1/baselines/${BASELINE}`) {
        return json(200, { id: BASELINE, document: REPORT, name: 'Approved' });
      }
      if (url.pathname !== '/v1/search') return json(404, {});
      asked.push(url.searchParams);
      return json(200, answer);
    }) as unknown as typeof fetch;
    return { client: createApiClient({ baseUrl: 'http://search.test', fetch: fetching }), asked };
  }

  it('SCH-003 SCH-058 searches every version when asked, saying which a result is from and linking to it', async () => {
    const { client, asked } = withBaseline(earlier);
    const scoped = vi.fn();
    render(
      <SearchPage
        client={client}
        query="lever"
        scope={{ versions: 'all', baseline: null }}
        onSearch={() => undefined}
        onScope={scoped}
      />,
    );
    const [found] = await screen.findAllByRole('article');
    expect(asked[0]?.get('versions')).toBe('all');
    expect(found).toHaveTextContent('Version 0.2, earlier');
    expect(within(found!).getByRole('link', { name: 'Lever guide' })).toHaveAttribute(
      'href',
      `#/components/${GUIDE}/versions/${VERSION}/blocks/b2`,
    );
    const versions = screen.getByRole('combobox', { name: 'Versions' });
    expect(versions).toHaveValue('all');
    await userEvent.selectOptions(versions, 'latest');
    expect(scoped).toHaveBeenCalledWith({ versions: 'latest', baseline: null });
  });

  it('SCH-003 searches one baseline, named in a chip that takes it off again', async () => {
    const { client, asked } = withBaseline({
      ...earlier,
      items: [
        {
          ...earlier.items[0]!,
          baseline: { id: BASELINE, name: 'Approved', document: REPORT, node: NODE },
        },
      ],
    });
    const scoped = vi.fn();
    render(
      <SearchPage
        client={client}
        query="lever"
        scope={{ versions: 'latest', baseline: BASELINE }}
        onSearch={() => undefined}
        onScope={scoped}
      />,
    );
    const [found] = await screen.findAllByRole('article');
    expect(asked[0]?.get('baseline')).toBe(BASELINE);
    expect(asked[0]?.get('versions')).toBeNull();
    expect(found).toHaveTextContent('In baseline Approved');
    expect(within(found!).getByRole('link', { name: 'Lever guide' })).toHaveAttribute(
      'href',
      `#/documents/${REPORT}/baselines/${BASELINE}/nodes/${NODE}`,
    );
    expect(await screen.findByText('In baseline Approved', { selector: 'span' })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Versions' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Search without the baseline' }));
    expect(scoped).toHaveBeenCalledWith({ versions: 'latest', baseline: null });
  });

  it('SCH-060 shows each result’s workflow state, and narrows by state', async () => {
    const { client, asked } = service(() => json(200, results));
    render(<SearchPage client={client} query="lever" onSearch={vi.fn()} />);
    const guide = await screen.findByRole('link', { name: 'Lever guide' });
    expect(within(guide.closest('article')!).getByText('In review')).toHaveAttribute(
      'data-kind',
      'inReview',
    );

    const states = screen.getByRole('group', { name: 'State' });
    await userEvent.click(within(states).getByRole('checkbox', { name: 'In review (1)' }));
    await waitFor(() => expect(asked.at(-1)?.get('state')).toBe('in_review'));
  });
});
