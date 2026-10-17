import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { GraphNeighbour } from './graph.js';
import { RelationshipsButton, saidFrom, type OfferedType } from './Relationships.js';

const PROCEDURE = 'aaaaaaaa-0000-4000-8000-000000000001';
const SUPERSEDES = 'bbbbbbbb-0000-4000-8000-000000000001';
const BASIS = 'bbbbbbbb-0000-4000-8000-000000000002';
const GROUNDS = 'bbbbbbbb-0000-4000-8000-000000000003';
const doc = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Procedure supersedes Older; Newer supersedes Procedure; Older supersedes `many` more. */
const edge = (n: number, from: string, to: string, title: string): GraphNeighbour => ({
  relationship: {
    id: `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`,
    type: SUPERSEDES,
    from: { artifact: from, kind: 'document', version: null },
    to: { artifact: to, kind: 'document', version: null },
    values: {},
    createdBy: PROCEDURE,
    createdAt: '2026-10-16T00:00:00.000Z',
    changedAt: '2026-10-16T00:00:00.000Z',
  },
  direction: 'out',
  other: { id: to, kind: 'document', title },
});

function service({ many = 0 }: { many?: number } = {}) {
  const asked: { method: string; url: URL; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined);
    asked.push({ method: request.method, url, body });
    const path = url.pathname;
    if (path === '/v1/definitions') {
      return json(200, {
        items: [
          {
            id: SUPERSEDES,
            kind: 'relationshipType',
            name: 'Supersedes',
            version: { id: SUPERSEDES, number: '0.1' },
          },
          { id: BASIS, kind: 'field', name: 'Basis', version: { id: BASIS, number: '0.1' } },
        ],
        next: null,
      });
    }
    if (path === `/v1/definitions/${SUPERSEDES}`) {
      return json(200, {
        definition: {
          name: 'Supersedes',
          inverseName: 'Superseded by',
          directed: true,
          from: { kinds: ['document'] },
          to: { kinds: ['document'] },
          schemas: [{ schema: GROUNDS, requires: [] }],
        },
      });
    }
    if (path === `/v1/definitions/${GROUNDS}`) {
      return json(200, { definition: { entries: [{ field: BASIS }] } });
    }
    if (path === `/v1/artifacts/${PROCEDURE}/relationships`) {
      const out = edge(1, PROCEDURE, doc(1), 'Older');
      const into: GraphNeighbour = {
        ...edge(2, doc(2), PROCEDURE, 'Procedure'),
        direction: 'in',
        other: { id: doc(2), kind: 'document', title: 'Newer' },
      };
      const relationships = url.searchParams.get('direction') === 'out' ? [out] : [out, into];
      return json(200, { relationships, cut: true, more: false });
    }
    if (path === `/v1/artifacts/${doc(1)}/relationships`) {
      return json(200, {
        relationships: Array.from({ length: many }, (_, at) =>
          edge(10 + at, doc(1), doc(10 + at), `Oldest ${at + 1}`),
        ),
        cut: false,
        more: false,
      });
    }
    if (path === '/v1/search') {
      return json(200, {
        outcome: 'results',
        count: 1,
        capped: false,
        facetsBounded: false,
        items: [{ kind: 'document', artifactId: doc(3), title: 'Draft manual' }],
        facets: {},
      });
    }
    if (path === '/v1/relationships' && request.method === 'POST') {
      return json(200, edge(3, PROCEDURE, doc(3), 'Draft manual').relationship);
    }
    if (path.startsWith('/v1/relationships/') && request.method === 'DELETE') {
      return json(200, edge(1, PROCEDURE, doc(1), 'Older').relationship);
    }
    return json(404, { code: 'not_found', message: 'Not found' });
  });
  return {
    client: createApiClient({ baseUrl: 'http://relationships.test', fetch: fetching }),
    asked,
  };
}

const open = async (client: ReturnType<typeof createApiClient>) => {
  render(<RelationshipsButton client={client} id={PROCEDURE} kind="document" title="Procedure" />);
  await userEvent.click(screen.getByRole('button', { name: 'Relationships' }));
  const dialog = await screen.findByRole('dialog', { name: 'Relationships of Procedure' });
  await within(dialog).findByRole('link', { name: 'Older' });
  return dialog;
};

describe('the relationships of an artifact, in the page (the R8 plan, R8-G)', () => {
  it('REL-025 REL-028 draws and lists them centred on the artifact, each read from its end, expandable a ring at a time, naming the query that answers it', async () => {
    const { client, asked } = service({ many: 2 });
    const dialog = await open(client);
    expect(
      within(dialog).getByRole('img', { name: /A graph of 2 related artifacts/ }),
    ).toBeVisible();
    const items = within(within(dialog).getByRole('region', { name: 'Relationships of Procedure' }))
      .getAllByRole('listitem')
      .map((each) => each.textContent);
    expect(items).toEqual([
      expect.stringContaining('SupersedesOlder'),
      expect.stringContaining('Superseded byNewer'),
    ]);
    expect(
      within(dialog).getByText('Some relationships lead to artifacts you may not read.'),
    ).toBeVisible();
    expect(within(dialog).getByText(`GET /v1/artifacts/${PROCEDURE}/relationships`)).toBeVisible();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Expand Older' }));
    const ring = await within(dialog).findByRole('region', { name: 'Relationships of Older' });
    expect(
      within(ring)
        .getAllByRole('link')
        .map((each) => each.textContent),
    ).toEqual(['Oldest 1', 'Oldest 2']);
    expect(
      asked.some((each) => each.url.pathname === `/v1/artifacts/${doc(1)}/relationships`),
    ).toBe(true);
  });

  it('REL-026 REL-051 filters by type, direction and a field value, asking the service and naming the query', async () => {
    const { client, asked } = service();
    const dialog = await open(client);
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), SUPERSEDES);
    await userEvent.selectOptions(within(dialog).getByLabelText('Direction'), 'out');
    await userEvent.type(within(dialog).getByLabelText('Value'), 'Revised{Enter}');
    await waitFor(() =>
      expect(
        within(dialog).getByText(
          `GET /v1/artifacts/${PROCEDURE}/relationships?type=${SUPERSEDES}&direction=out&field=${BASIS}&value=Revised`,
        ),
      ).toBeVisible(),
    );
    const last = asked.filter((each) => each.url.pathname.endsWith('/relationships')).at(-1)!;
    expect(Object.fromEntries(last.url.searchParams)).toEqual({
      type: SUPERSEDES,
      direction: 'out',
      field: BASIS,
      value: 'Revised',
    });
    await waitFor(() => expect(within(dialog).queryByRole('link', { name: 'Newer' })).toBeNull());
  });

  it('REL-027 draws more than twenty of one kind from one artifact as a count, opened as a list', async () => {
    const { client } = service({ many: 21 });
    const dialog = await open(client);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Expand Older' }));
    const count = await within(dialog).findByRole('button', { name: '21 documents' });
    expect(within(dialog).queryByRole('link', { name: 'Oldest 1' })).toBeNull();
    await userEvent.click(count);
    expect(count).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('link', { name: 'Oldest 21' })).toBeVisible();
  });

  it('relates the artifact to one found, by a type it may take, and removes a relationship', async () => {
    const { client, asked } = service();
    const dialog = await open(client);
    const relate = within(dialog).getByRole('region', { name: 'Relate' });
    expect(
      within(within(relate).getByLabelText('Relationship'))
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual(['Procedure Supersedes', 'Procedure Superseded by']);
    await userEvent.type(within(relate).getByLabelText('Find'), 'manual');
    await userEvent.click(within(relate).getByRole('button', { name: 'Find' }));
    await userEvent.click(await within(relate).findByRole('radio', { name: 'Draft manual' }));
    await userEvent.click(within(relate).getByRole('button', { name: 'Relate' }));
    await within(dialog).findByText('The relationship is made.');
    expect(asked.find((each) => each.method === 'POST')!.body).toEqual({
      type: SUPERSEDES,
      from: { artifact: PROCEDURE },
      to: { artifact: doc(3) },
    });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove supersedes Older' }));
    await within(dialog).findByText('The relationship is removed.');
    expect(asked.find((each) => each.method === 'DELETE')!.url.pathname).toBe(
      `/v1/relationships/${edge(1, PROCEDURE, doc(1), 'Older').relationship.id}`,
    );
  });

  it("REL-004 reads a relationship by its type's name from its from end and its inverse name from its far end, and an undirected one alike from both", () => {
    const supersedes: OfferedType = {
      id: SUPERSEDES,
      name: 'Supersedes',
      inverseName: 'Superseded by',
      directed: true,
      from: ['document'],
      to: ['document'],
      deprecated: false,
      fields: [],
    };
    const related = edge(1, PROCEDURE, doc(1), 'Older').relationship;
    expect(saidFrom({ relationship: related, from: PROCEDURE, to: doc(1) }, [supersedes])).toBe(
      'Supersedes',
    );
    expect(saidFrom({ relationship: related, from: doc(1), to: PROCEDURE }, [supersedes])).toBe(
      'Superseded by',
    );
    const alike = { ...supersedes, name: 'Relates to', inverseName: 'Relates to', directed: false };
    expect(saidFrom({ relationship: related, from: doc(1), to: PROCEDURE }, [alike])).toBe(
      'Relates to',
    );
  });
});
