import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueryDefinitionPage } from './QueryDefinitionPage.js';
import { QueryDefinitions } from './QueryDefinitions.js';

const GENERAL = '11111111-1111-4111-8111-111111111111';
const READINGS = '33333333-3333-4333-8333-333333333333';
const DEFINITION = '44444444-4444-4444-8444-444444444444';
const FIRST = '55555555-5555-4555-8555-555555555555';
const SECOND = '66666666-6666-4666-8666-666666666666';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const stored = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  title: 'Site by id',
  description: 'One site, by its id.',
  connection: READINGS,
  parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
  fetch: { kind: 'sql', text: 'select id, name from sample.site where id = {{site}} order by id' },
  columns: [
    { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
    { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
  ],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'valid',
  limits: { rows: 10_000, bytes: 5_242_880, seconds: 30 },
  retired: false,
  ...over,
});

const view = (
  over: Record<string, unknown> = {},
  version = FIRST,
  number = version === FIRST ? '0.1' : '0.2',
) => ({
  id: DEFINITION,
  space: { id: GENERAL, name: 'General' },
  version: {
    id: version,
    number,
    author: 'ada',
    createdAt: '2026-09-30T09:00:00.000Z',
    note: null,
  },
  definition: stored(over),
  connection: { id: READINGS, name: 'Readings', identity: 'service', retired: false },
  mayEdit: true,
  mayRun: true,
});

interface Asked {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/**
 * The service as far as query definitions are concerned: one space, one connection the person may
 * write SQL against, one definition, and an answer for each act that a test may replace.
 */
function service(
  options: {
    sqlWriter?: boolean;
    describe?: () => Response;
    sample?: () => Response;
    version?: (body: { openedFrom: string; definition: Record<string, unknown> }) => Response;
  } = {},
) {
  const asked: Asked[] = [];
  let held = view();
  let cuts = 0;
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = await request.text();
    const body = text === '' ? undefined : (JSON.parse(text) as unknown);
    asked.push({ method: request.method, path: url.pathname, body });
    const path = url.pathname;
    if (request.method === 'GET' && path === '/v1/spaces') {
      return json(200, { items: [{ id: GENERAL, name: 'General', mayCreate: true }], next: null });
    }
    if (request.method === 'GET' && path === '/v1/connections') {
      return json(200, {
        items: [
          {
            id: READINGS,
            name: 'Readings',
            space: { id: GENERAL, name: 'General' },
            type: 'postgres',
            retired: false,
            version: { id: FIRST, number: '0.1' },
            credentialSet: true,
            lastTest: null,
            changedAt: '2026-09-30T09:00:00.000Z',
          },
        ],
        next: null,
        total: 1,
        facets: { spaces: [] },
      });
    }
    if (request.method === 'GET' && path === '/v1/access') {
      const target = url.searchParams.get('target') ?? '';
      const sql = options.sqlWriter ?? true;
      return json(200, {
        target,
        permissions: [
          { permission: 'read', allowed: true },
          { permission: 'edit', allowed: target === `space:${GENERAL}` },
          { permission: 'use_connection', allowed: target === `artifact:${READINGS}` },
          { permission: 'write_sql', allowed: sql && target === `artifact:${READINGS}` },
        ],
      });
    }
    if (request.method === 'GET' && path === '/v1/query-definitions') {
      return json(200, {
        items: [
          {
            id: DEFINITION,
            title: 'Site by id',
            space: { id: GENERAL, name: 'General' },
            connection: { id: READINGS, name: 'Readings' },
            retired: false,
            version: { id: FIRST, number: '0.1' },
            changedAt: '2026-09-30T09:00:00.000Z',
          },
        ],
        next: null,
        total: 1,
        facets: { spaces: [{ value: GENERAL, label: 'General', count: 1 }] },
      });
    }
    if (request.method === 'GET' && path === `/v1/query-definitions/${DEFINITION}`) {
      return json(200, held);
    }
    if (request.method === 'POST' && path === `/v1/spaces/${GENERAL}/query-definitions`) {
      held = view((body as { definition: Record<string, unknown> }).definition);
      return json(200, held);
    }
    if (request.method === 'POST' && path === `/v1/query-definitions/${DEFINITION}/versions`) {
      const sent = body as { openedFrom: string; definition: Record<string, unknown> };
      const answer = options.version?.(sent);
      if (answer) return answer;
      // Each version cut is a version of its own, as the service's are.
      cuts += 1;
      held = view(sent.definition, crypto.randomUUID(), `0.${cuts + 2}`);
      return json(200, held);
    }
    if (request.method === 'POST' && path === `/v1/connections/${READINGS}/describe`) {
      return (
        options.describe?.() ??
        json(200, {
          columns: [
            { name: 'id', sourceType: 'integer', proposed: { base: 'integer' } },
            { name: 'name', sourceType: 'text', proposed: { base: 'text' } },
            { name: 'depth', sourceType: 'double precision', proposed: null },
          ],
          parameters: ['bigint'],
        })
      );
    }
    if (request.method === 'POST' && path === `/v1/connections/${READINGS}/sample`) {
      return (
        options.sample?.() ??
        json(200, {
          outcome: 'ok',
          columns: [
            ['id', 'integer'],
            ['name', 'text'],
          ],
          rows: [
            ['1', 'North'],
            ['2', 'South'],
          ],
          rowCount: 2,
          checksum: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          ran: { sql: 'select id, name from sample.site where id = $1::int8 order by id' },
          durationMs: 12,
        })
      );
    }
    return json(404, { code: 'not_found', message: 'There is nothing at this address.' });
  }) as unknown as typeof fetch;
  return {
    client: createApiClient({ baseUrl: 'http://definitions.test', fetch: fetching }),
    asked,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('the Query definitions list', () => {
  it('lists the definitions the person may read, and offers New query definition where they may write SQL', async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<QueryDefinitions client={client} />);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((each) => each.textContent),
    ).toEqual(['Title', 'Space', 'Connection', 'Changed']);
    expect(within(rows[1]!).getByRole('link', { name: 'Site by id' })).toHaveAttribute(
      'href',
      `#/query-definitions/${DEFINITION}`,
    );
    expect(within(rows[1]!).getByRole('link', { name: 'Readings' })).toHaveAttribute(
      'href',
      `#/connections/${READINGS}`,
    );
    expect(screen.getByRole('group', { name: 'Space' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'New query definition' }));
    expect(window.location.hash).toBe('#/query-definitions/new');
  });

  it('offers no New query definition to somebody who writes SQL on no connection', async () => {
    const { client, asked } = service({ sqlWriter: false });
    render(<QueryDefinitions client={client} />);
    await screen.findByRole('table');
    await waitFor(() =>
      expect(asked.filter((each) => each.path === '/v1/access').length).toBeGreaterThan(1),
    );
    expect(screen.queryByRole('button', { name: 'New query definition' })).toBeNull();
  });
});

describe('the query definition page', () => {
  it("DAT-105 proposes each column from the source's metadata and saves none until the author has confirmed every one", async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<QueryDefinitionPage client={client} id="new" />);
    const connection = await screen.findByLabelText('Connection');
    await waitFor(() =>
      expect(
        within(connection)
          .getAllByRole('option')
          .map((each) => each.textContent),
      ).toContain('Readings'),
    );
    await user.selectOptions(connection, READINGS);
    await user.type(screen.getByLabelText('Title'), 'Site depths');
    await user.type(
      screen.getByLabelText('SQL'),
      'select id, name, depth from sample.site where id = {{{{site}}',
    );
    await user.click(screen.getByRole('button', { name: 'Add parameter' }));
    const parameter = screen.getByRole('group', { name: 'Parameter 1' });
    await user.type(within(parameter).getByLabelText('Name'), 'site');
    await user.selectOptions(within(parameter).getByLabelText('Type'), 'integer');

    // Nothing is offered to save before the columns are proposed.
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Describe' }));
    const columns = await screen.findByRole('table', { name: 'Columns' });
    expect(asked.find((each) => each.path.endsWith('/describe'))?.body).toEqual({
      sql: {
        text: 'select id, name, depth from sample.site where id = {{site}}',
        parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
      },
    });
    // Each proposed from the source, and one the source proposes nothing for, to be declared.
    const [, id, name, depth] = within(columns).getAllByRole('row');
    expect(within(id!).getByLabelText('Type of id')).toHaveValue('integer');
    expect(within(name!).getByLabelText('Type of name')).toHaveValue('text');
    expect(within(depth!).getByText('Declare a type for this column')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();

    await user.click(within(id!).getByRole('button', { name: 'Confirm id' }));
    await user.click(within(name!).getByRole('button', { name: 'Confirm name' }));
    // Two of three confirmed saves nothing.
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    expect(screen.getByText('Confirm every column to save.')).toBeInTheDocument();
    await user.selectOptions(within(depth!).getByLabelText('Type of depth'), 'decimal');
    await user.type(within(depth!).getByLabelText('Digits of depth'), '8');
    await user.type(within(depth!).getByLabelText('Places of depth'), '2');
    await user.click(within(depth!).getByRole('button', { name: 'Confirm depth' }));

    await user.click(await screen.findByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/query-definitions/${DEFINITION}`));
    const made = asked.find((each) => each.path.endsWith('/query-definitions'));
    expect(made?.body).toMatchObject({
      definition: {
        title: 'Site depths',
        connection: READINGS,
        columns: [
          { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
          { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
          {
            name: 'depth',
            from: { column: 'depth' },
            type: { base: 'decimal', precision: 8, scale: 2 },
          },
        ],
      },
    });
  });

  it('DAT-014 runs a definition against sample values from its page and shows the result or the one reason it failed', async () => {
    const user = userEvent.setup();
    let failing = false;
    const { client, asked } = service({
      sample: () =>
        failing
          ? json(200, {
              outcome: 'failed',
              failure: {
                code: 'result_mismatch',
                attribution: 'query',
                row: 12,
                message:
                  'Rows are not in the declared order: row 12 comes before row 11, or repeats the key of an earlier row. Order text columns with COLLATE "C".',
              },
            })
          : undefined!,
    });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    const sample = await screen.findByRole('region', { name: 'Sample' });
    await user.type(within(sample).getByLabelText('site'), '1');
    await user.click(within(sample).getByRole('button', { name: 'Run sample' }));

    const rows = await within(sample).findByRole('table', { name: 'The first rows' });
    expect(
      within(rows)
        .getAllByRole('row')
        .map((each) => each.textContent),
    ).toEqual(['idname', '1North', '2South']);
    expect(within(sample).getByText('2 rows.')).toBeInTheDocument();
    expect(within(sample).getByText('Checksum 0123456789ab.')).toBeInTheDocument();
    expect(
      within(sample).getByText('select id, name from sample.site where id = $1::int8 order by id'),
    ).toBeInTheDocument();
    expect(asked.find((each) => each.path.endsWith('/sample'))?.body).toMatchObject({
      definition: { connection: READINGS, fetch: { kind: 'sql' } },
      values: { site: '1' },
    });

    // A failure is the one reason, in words.
    failing = true;
    await user.click(within(sample).getByRole('button', { name: 'Run sample' }));
    expect(
      await within(sample).findByText(
        'Rows are not in the declared order: row 12 comes before row 11, or repeats the key of an earlier row. Order text columns with COLLATE "C".',
      ),
    ).toBeInTheDocument();
    expect(within(sample).queryByRole('table', { name: 'The first rows' })).toBeNull();
  });

  it('says in words when SQL may not run on the connection, and what a value refused was', async () => {
    const user = userEvent.setup();
    let answer = json(409, {
      code: 'sql_not_permitted',
      message:
        "This connection's account can write at the source, so SQL may not run on it. Use an account that can only read.",
      reason: 'not_read_only',
      attribution: 'product',
    });
    const { client } = service({ sample: () => answer });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    const sample = await screen.findByRole('region', { name: 'Sample' });
    await user.type(within(sample).getByLabelText('site'), '1');
    await user.click(within(sample).getByRole('button', { name: 'Run sample' }));
    expect(
      await within(sample).findByText(
        "This connection's account can write at the source, so SQL may not run on it. Use an account that can only read.",
      ),
    ).toBeInTheDocument();
    answer = json(400, {
      code: 'parameter_invalid',
      message: 'A value does not fit its parameter.',
      problems: [{ parameter: 'site', rule: 'type', value: 'x' }],
    });
    await user.click(within(sample).getByRole('button', { name: 'Run sample' }));
    expect(await within(sample).findByText('site: x is not of its type.')).toBeInTheDocument();
  });

  it('saves a version from the one shown, and says so when somebody else saved one first', async () => {
    const user = userEvent.setup();
    let stale = true;
    const { client, asked } = service({
      version: () => {
        if (!stale) return undefined!;
        stale = false;
        return json(409, {
          code: 'version_precondition',
          message: 'This query definition has a newer version than the one this page opened.',
          current: view({ title: 'Renamed elsewhere' }, SECOND),
        });
      },
    });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Site by its id');
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    expect(
      await screen.findByText(
        'Somebody saved a newer version of this query definition. It is shown now; make your change again.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Renamed elsewhere');
    expect(asked.filter((each) => each.path.endsWith('/versions'))[0]?.body).toMatchObject({
      openedFrom: FIRST,
      definition: { title: 'Site by its id' },
    });
    // Saved again, from the version now shown.
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Site by its id');
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    expect(await screen.findByText('Saved as version 0.3.')).toBeInTheDocument();
    expect(asked.filter((each) => each.path.endsWith('/versions'))[1]?.body).toMatchObject({
      openedFrom: SECOND,
    });
  });

  it('retires a definition and reinstates it, each a version', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    await user.click(await screen.findByRole('button', { name: 'Retire' }));
    expect(await screen.findByText('Retired. It runs nothing now.')).toBeInTheDocument();
    expect(asked.filter((each) => each.path.endsWith('/versions'))[0]?.body).toMatchObject({
      definition: { retired: true },
    });
    await user.click(await screen.findByRole('button', { name: 'Reinstate' }));
    expect(await screen.findByText('Reinstated.')).toBeInTheDocument();
  });

  it('shows a definition to somebody who may read it and change nothing', async () => {
    const { client } = service();
    const readOnly = view();
    readOnly.mayEdit = false;
    readOnly.mayRun = false;
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname === `/v1/query-definitions/${DEFINITION}`) {
        return json(200, readOnly);
      }
      return json(200, { items: [], next: null, total: 0, facets: { spaces: [] } });
    }) as unknown as typeof fetch;
    void client;
    render(
      <QueryDefinitionPage
        client={createApiClient({ baseUrl: 'http://definitions.test', fetch: fetching })}
        id={DEFINITION}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'Site by id' })).toBeInTheDocument();
    expect(
      screen.getByText('select id, name from sample.site where id = {{site}} order by id'),
    ).toBeInTheDocument();
    for (const name of ['Save version', 'Describe', 'Run sample', 'Retire']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
});
