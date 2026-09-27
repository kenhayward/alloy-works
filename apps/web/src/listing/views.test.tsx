import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ComponentList } from '../editor/ComponentList.js';
import { PublicationList } from '../publishing/PublicationList.js';
import { DocumentList } from '../structure/DocumentList.js';
import { TemplateList } from '../structure/TemplateList.js';

const GENERAL = 'aaaaaaaa-0000-4000-8000-000000000001';
const PROCEDURE = 'bbbbbbbb-0000-4000-8000-000000000001';
const MANUAL = 'cccccccc-0000-4000-8000-000000000001';
const WHEN = '2026-09-27T09:00:00.000Z';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const facet = (value: string, label: string, count: number) => ({ value, label, count });

/** Each listing's one page, as the service answers it: a row, its total and its facets. */
const answers: Record<string, unknown> = {
  '/v1/components': {
    items: [
      {
        id: 'dddddddd-0000-4000-8000-000000000001',
        title: 'Calibrate the scanner',
        space: { id: GENERAL, name: 'General' },
        version: '0.1',
        type: 'Procedure',
        language: 'en-GB',
        changedAt: WHEN,
        changedBy: null,
      },
    ],
    next: null,
    total: 1,
    spaces: [{ id: GENERAL, name: 'General', count: 1 }],
    facets: {
      spaces: [facet(GENERAL, 'General', 1)],
      types: [facet(PROCEDURE, 'Procedure', 1)],
    },
  },
  '/v1/documents': {
    items: [
      {
        id: MANUAL,
        title: 'Operator manual',
        space: { id: GENERAL, name: 'General' },
        version: '0.2',
        changedAt: WHEN,
        sections: 3,
        components: 2,
        publishing: 'published',
      },
    ],
    next: null,
    total: 1,
    facets: {
      spaces: [facet(GENERAL, 'General', 1)],
      publishing: [facet('published', 'published', 1)],
    },
  },
  '/v1/publications': {
    items: [
      {
        id: 'eeeeeeee-0000-4000-8000-000000000001',
        document: MANUAL,
        version: { id: 'v2', number: '0.2' },
        title: 'Operator manual',
        publisher: { id: 'p1', displayName: 'Grace' },
        publishedAt: WHEN,
        approval: 'none',
        formats: ['pdf'],
      },
    ],
    next: null,
    total: 1,
    facets: {
      spaces: [facet(GENERAL, 'General', 1)],
      documents: [facet(MANUAL, 'Operator manual', 1)],
    },
  },
  '/v1/templates': {
    items: [
      {
        id: 'ffffffff-0000-4000-8000-000000000001',
        name: 'Procedure manual',
        space: { id: GENERAL, name: 'General' },
        version: { id: 'v1', number: '0.1' },
        changedAt: WHEN,
      },
    ],
    next: null,
    total: 1,
    facets: { spaces: [facet(GENERAL, 'General', 1)] },
  },
};

/** The service as the views meet it, and each listing's query as it was last asked. */
function service() {
  const asked: Record<string, URLSearchParams> = {};
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/v1/spaces') return json(200, { items: [], next: null });
    const answer = answers[url.pathname];
    if (answer === undefined) return json(404, {});
    asked[url.pathname] = url.searchParams;
    return json(200, answer);
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://views.test', fetch: fetching }), asked };
}

describe('the listing views', () => {
  it('SCH-064 lists documents, components, publications and templates, sorted and filtered', async () => {
    const views = [
      {
        path: '/v1/components',
        view: (client: ReturnType<typeof service>['client']) => <ComponentList client={client} />,
        row: 'Calibrate the scanner',
        sort: ['Newest changed first', 'changed', 'desc'],
        filter: ['Type', 'Procedure', 'types', PROCEDURE],
      },
      {
        path: '/v1/documents',
        view: (client: ReturnType<typeof service>['client']) => (
          <DocumentList client={client} onOpen={vi.fn()} />
        ),
        row: 'Operator manual',
        sort: ['Title, Z to A', 'title', 'desc'],
        filter: ['Publishing', 'Published', 'publishing', 'published'],
      },
      {
        path: '/v1/publications',
        view: (client: ReturnType<typeof service>['client']) => <PublicationList client={client} />,
        row: 'Operator manual',
        sort: ['Title, A to Z', 'title', 'asc'],
        filter: ['Document', 'Operator manual', 'documents', MANUAL],
      },
      {
        path: '/v1/templates',
        view: (client: ReturnType<typeof service>['client']) => <TemplateList client={client} />,
        row: 'Procedure manual',
        sort: ['Newest changed first', 'changed', 'desc'],
        filter: ['Space', 'General', 'spaces', GENERAL],
      },
    ] as const;
    for (const { path, view, row, sort, filter } of views) {
      const { client, asked } = service();
      const { unmount } = render(view(client));
      // The view lists what the service answered.
      expect(await screen.findByText(row, { selector: 'a, td' })).toBeInTheDocument();

      // Sorted: the chosen sort is the service's to apply.
      const [label, key, order] = sort;
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), label);
      await waitFor(() => expect(asked[path]?.get('sort'), path).toBe(key));
      expect(asked[path]?.get('order'), path).toBe(order);

      // Filtered: a facet's value is the service's filter, the sort kept beside it.
      const [legend, value, parameter, sent] = filter;
      const facet = screen.getByRole('group', { name: legend });
      await userEvent.click(within(facet).getByRole('checkbox', { name: new RegExp(value) }));
      await waitFor(() => expect(asked[path]?.get(parameter), path).toBe(sent));
      expect(asked[path]?.get('sort'), path).toBe(key);
      unmount();
    }
  });
});
