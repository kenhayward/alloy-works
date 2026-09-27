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
    changed: ['today', 'week', 'month', 'year', 'earlier'].map((value) =>
      facet(value, value, value === 'earlier' ? 0 : 2),
    ),
    fields: [
      {
        field: REVIEWER,
        name: 'Reviewer',
        dataType: 'text',
        values: [facet('Grace Hopper', 'Grace Hopper', 1000, true)],
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
      name: 'Grace Hopper (at least 1,000)',
    });
    await userEvent.click(capped);
    await waitFor(() =>
      expect(asked.at(-1)?.getAll('value')).toEqual([`${REVIEWER}:Grace Hopper`]),
    );
    expect(asked.at(-1)?.get('kind')).toBe('section');
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
