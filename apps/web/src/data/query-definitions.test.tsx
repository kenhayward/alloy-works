import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueryDefinitionPage } from './QueryDefinitionPage.js';
import { QueryDefinitions } from './QueryDefinitions.js';
import { isRecord } from './shapes.js';

const GENERAL = '11111111-1111-4111-8111-111111111111';
const READINGS = '33333333-3333-4333-8333-333333333333';
const DEFINITION = '44444444-4444-4444-8444-444444444444';
const FIRST = '55555555-5555-4555-8555-555555555555';
const SECOND = '66666666-6666-4666-8666-666666666666';
const WAREHOUSE = '77777777-7777-4777-8777-777777777777';
const API = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BUCKET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COMPONENT = '88888888-8888-4888-8888-888888888888';
const DOCUMENT = '99999999-9999-4999-8999-999999999999';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A name written decomposed: an e and a combining acute accent, which a definition cannot hold. */
const DECOMPOSED = `Cafe${String.fromCharCode(0x301)}`;

/** The source's tables and views, as a describe lists them (D1). */
const RELATIONS = {
  relations: [
    {
      schema: 'sample',
      name: 'site',
      kind: 'table',
      columns: [
        { name: 'id', sourceType: 'bigint', nullable: false, proposed: { base: 'integer' } },
        { name: 'name', sourceType: 'text', nullable: false, proposed: { base: 'text' } },
        {
          name: 'depth',
          sourceType: 'numeric(8,2)',
          nullable: true,
          proposed: { base: 'decimal', precision: 8, scale: 2 },
        },
      ],
    },
    {
      schema: 'sample',
      name: DECOMPOSED,
      kind: 'view',
      columns: [
        { name: 'id', sourceType: 'bigint', nullable: false, proposed: { base: 'integer' } },
      ],
    },
  ],
  truncated: false,
  leftOut: { relations: 0, columns: 0 },
};

/** A built query of one table, as the page writes one: a site's name by its id. */
const builtFetch = (over: Record<string, unknown> = {}) => ({
  kind: 'builder',
  format: 1,
  query: {
    sources: [{ alias: 't', table: { schema: 'sample', name: 'site' } }],
    joins: [],
    select: [
      { name: 'id', of: { source: 't', column: 'id' } },
      { name: 'name', of: { source: 't', column: 'name' } },
    ],
    where: { column: { source: 't', column: 'id' }, is: 'equal', to: { parameter: 'site' } },
    groupBy: [],
    ...over,
  },
});

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
    /** Whether the person may use the connections; they may unless told. */
    user?: boolean;
    /** A second connection the person may write SQL against, Warehouse. */
    warehouse?: boolean;
    /** An HTTP connection the person may use, Readings API, listed first (the D6 plan). */
    api?: boolean;
    /** An S3 connection the person may use, Readings bucket, listed first (the D6 plan, task 2). */
    bucket?: boolean;
    /** The definition the service holds at first. */
    held?: ReturnType<typeof view>;
    describe?: (body: unknown) => Response | Promise<Response>;
    sample?: () => Response;
    version?: (body: { openedFrom: string; definition: Record<string, unknown> }) => Response;
    /** Where the definition is used (D3-M); used nowhere unless told. */
    uses?: unknown;
  } = {},
) {
  const asked: Asked[] = [];
  let held = options.held ?? view();
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
          ...(options.bucket
            ? [
                {
                  id: BUCKET,
                  name: 'Readings bucket',
                  space: { id: GENERAL, name: 'General' },
                  type: 's3',
                  retired: false,
                  version: { id: FIRST, number: '0.1' },
                  credentialSet: true,
                  lastTest: null,
                  changedAt: '2026-09-30T09:00:00.000Z',
                },
              ]
            : []),
          ...(options.api
            ? [
                {
                  id: API,
                  name: 'Readings API',
                  space: { id: GENERAL, name: 'General' },
                  type: 'http',
                  retired: false,
                  version: { id: FIRST, number: '0.1' },
                  credentialSet: true,
                  lastTest: null,
                  changedAt: '2026-09-30T09:00:00.000Z',
                },
              ]
            : []),
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
          ...(options.warehouse
            ? [
                {
                  id: WAREHOUSE,
                  name: 'Warehouse',
                  space: { id: GENERAL, name: 'General' },
                  type: 'postgres',
                  retired: false,
                  version: { id: FIRST, number: '0.1' },
                  credentialSet: true,
                  lastTest: null,
                  changedAt: '2026-09-30T09:00:00.000Z',
                },
              ]
            : []),
        ],
        next: null,
        total: options.warehouse ? 2 : 1,
        facets: { spaces: [] },
      });
    }
    if (request.method === 'GET' && path === '/v1/access') {
      const target = url.searchParams.get('target') ?? '';
      const sql = options.sqlWriter ?? true;
      const uses = options.user ?? true;
      return json(200, {
        target,
        permissions: [
          { permission: 'read', allowed: true },
          { permission: 'edit', allowed: target === `space:${GENERAL}` },
          {
            permission: 'use_connection',
            allowed:
              uses &&
              (target === `artifact:${READINGS}` ||
                target === `artifact:${WAREHOUSE}` ||
                target === `artifact:${API}` ||
                target === `artifact:${BUCKET}`),
          },
          {
            permission: 'write_sql',
            allowed:
              sql && (target === `artifact:${READINGS}` || target === `artifact:${WAREHOUSE}`),
          },
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
    if (request.method === 'GET' && path === `/v1/query-definitions/${DEFINITION}/uses`) {
      return json(
        200,
        options.uses ?? {
          components: { readable: [], others: 0 },
          documents: { readable: [], others: 0 },
        },
      );
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
    if (
      request.method === 'POST' &&
      (path === `/v1/connections/${READINGS}/describe` ||
        path === `/v1/connections/${WAREHOUSE}/describe` ||
        path === `/v1/connections/${API}/describe` ||
        path === `/v1/connections/${BUCKET}/describe`)
    ) {
      // Sent nothing, a describe lists the source's tables and views (D1).
      if (
        isRecord(body) &&
        !('sql' in body) &&
        !('builder' in body) &&
        !('http' in body) &&
        !('file' in body)
      ) {
        return json(200, RELATIONS);
      }
      return (
        options.describe?.(body) ??
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
  it('lists the definitions the person may read, and offers New query definition where they may edit a space and use a connection', async () => {
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

  it('offers New query definition to somebody who may use a connection and write no SQL', async () => {
    const { client } = service({ sqlWriter: false });
    render(<QueryDefinitions client={client} />);
    await screen.findByRole('table');
    expect(await screen.findByRole('button', { name: 'New query definition' })).toBeInTheDocument();
  });

  it('offers no New query definition to somebody who may use no connection', async () => {
    const { client, asked } = service({ sqlWriter: false, user: false });
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
    await user.click(screen.getByRole('radio', { name: 'SQL' }));
    await user.type(
      screen.getByLabelText('SQL text'),
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

  it('withdraws Save version once the SQL or a parameter changes, until every column is confirmed again', async () => {
    const user = userEvent.setup();
    const { client } = service();
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    await screen.findByRole('heading', { name: 'Site by id' });
    expect(screen.getByRole('button', { name: 'Save version' })).toBeInTheDocument();
    const confirmAll = async () => {
      const columns = screen.getByRole('table', { name: 'Columns' });
      for (const name of ['id', 'name']) {
        await user.click(within(columns).getByRole('button', { name: `Confirm ${name}` }));
      }
    };

    // The SQL changed: what it returns may have too, so each column is to be confirmed again.
    await user.type(screen.getByLabelText('SQL text'), ' ');
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    expect(screen.getByText('Confirm every column to save.')).toBeInTheDocument();
    await confirmAll();
    expect(screen.getByRole('button', { name: 'Save version' })).toBeInTheDocument();

    // And so with a parameter.
    const parameter = screen.getByRole('group', { name: 'Parameter 1' });
    await user.click(within(parameter).getByLabelText('Required'));
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    await confirmAll();
    expect(screen.getByRole('button', { name: 'Save version' })).toBeInTheDocument();
  });

  it('asks again about a column whose type the source now proposes otherwise, and keeps the rest confirmed', async () => {
    const user = userEvent.setup();
    const { client } = service({
      describe: () =>
        json(200, {
          columns: [
            { name: 'id', sourceType: 'integer', proposed: { base: 'integer' } },
            { name: 'name', sourceType: 'date', proposed: { base: 'date' } },
          ],
          parameters: ['bigint'],
        }),
    });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    await screen.findByRole('heading', { name: 'Site by id' });
    await user.click(screen.getByRole('button', { name: 'Describe' }));
    await screen.findByText('2 columns proposed. Confirm the type of each.');
    const [, id, name] = within(screen.getByRole('table', { name: 'Columns' })).getAllByRole('row');
    expect(within(id!).getByText('Confirmed')).toBeInTheDocument();
    expect(within(name!).getByRole('button', { name: 'Confirm name' })).toBeInTheDocument();
    expect(within(name!).getByLabelText('Type of name')).toHaveValue('date');
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
  });

  it("merges a describe's answer into the columns as they are when it arrives, and drops one for SQL since changed", async () => {
    const user = userEvent.setup();
    const answers: ((response: Response) => void)[] = [];
    const { client } = service({
      describe: () => new Promise<Response>((resolve) => answers.push(resolve)),
    });
    const proposal = () =>
      json(200, {
        columns: [
          { name: 'id', sourceType: 'integer', proposed: { base: 'integer' } },
          { name: 'name', sourceType: 'text', proposed: { base: 'text' } },
        ],
        parameters: ['bigint'],
      });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    await screen.findByRole('heading', { name: 'Site by id' });
    const sql = screen.getByLabelText('SQL text');
    await user.type(sql, ' ');

    // A confirmation made while a describe is on its way is kept when it arrives.
    await user.click(screen.getByRole('button', { name: 'Describe' }));
    await waitFor(() => expect(answers).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Confirm id' }));
    answers[0]!(proposal());
    await screen.findByText('2 columns proposed. Confirm the type of each.');
    const columns = screen.getByRole('table', { name: 'Columns' });
    const [, id, name] = within(columns).getAllByRole('row');
    expect(within(id!).getByText('Confirmed')).toBeInTheDocument();
    expect(within(name!).getByRole('button', { name: 'Confirm name' })).toBeInTheDocument();

    // One answering for SQL changed since it was sent is dropped, and says so.
    await user.click(screen.getByRole('button', { name: 'Describe' }));
    await waitFor(() => expect(answers).toHaveLength(2));
    await user.type(sql, 'x');
    answers[1]!(
      json(200, {
        columns: [{ name: 'other', sourceType: 'text', proposed: { base: 'text' } }],
        parameters: [],
      }),
    );
    expect(
      await screen.findByText('The SQL changed while it was described. Describe it again.'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Columns' }))
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]!.textContent),
    ).toEqual(['id', 'name']);
  });

  it('keeps a declared type the source proposes nothing for, to be confirmed again, after the SQL changes', async () => {
    const user = userEvent.setup();
    const depth = view({
      fetch: {
        kind: 'sql',
        text: 'select id, depth from sample.site where id = {{site}} order by id',
      },
      columns: [
        { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
        {
          name: 'depth',
          from: { column: 'depth' },
          type: { base: 'decimal', precision: 8, scale: 2 },
        },
      ],
    });
    const { client } = service({
      held: depth,
      describe: () =>
        json(200, {
          columns: [
            { name: 'id', sourceType: 'integer', proposed: { base: 'integer' } },
            { name: 'depth', sourceType: 'numeric', proposed: null },
          ],
          parameters: ['bigint'],
        }),
    });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    await screen.findByRole('heading', { name: 'Site by id' });
    await user.type(screen.getByLabelText('SQL text'), ' ');
    await user.click(screen.getByRole('button', { name: 'Describe' }));
    await screen.findByText('2 columns proposed. Confirm the type of each.');
    const [, , row] = within(screen.getByRole('table', { name: 'Columns' })).getAllByRole('row');
    expect(within(row!).getByLabelText('Type of depth')).toHaveValue('decimal');
    expect(within(row!).getByLabelText('Digits of depth')).toHaveValue('8');
    expect(within(row!).getByLabelText('Places of depth')).toHaveValue('2');
    expect(within(row!).queryByText('Declare a type for this column')).toBeNull();
    expect(within(row!).getByRole('button', { name: 'Confirm depth' })).toBeInTheDocument();
  });

  it('gives back the confirmations when the SQL, its parameters and its connection are as they were confirmed', async () => {
    const user = userEvent.setup();
    const { client } = service({ warehouse: true });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    await screen.findByRole('heading', { name: 'Site by id' });
    const sql = screen.getByLabelText('SQL text');
    await user.type(sql, ' x');
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    await user.type(sql, '{Backspace}{Backspace}');
    expect(screen.getByRole('button', { name: 'Save version' })).toBeInTheDocument();

    // A parameter changed and changed back.
    const parameter = screen.getByRole('group', { name: 'Parameter 1' });
    await user.click(within(parameter).getByLabelText('Required'));
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    await user.click(within(parameter).getByLabelText('Required'));
    expect(screen.getByRole('button', { name: 'Save version' })).toBeInTheDocument();

    // A connection is part of what the columns were confirmed for.
    const connection = screen.getByLabelText('Connection');
    await waitFor(() =>
      expect(
        within(connection)
          .getAllByRole('option')
          .map((each) => each.textContent),
      ).toContain('Warehouse'),
    );
    await user.selectOptions(connection, WAREHOUSE);
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    await user.selectOptions(connection, READINGS);
    expect(screen.getByRole('button', { name: 'Save version' })).toBeInTheDocument();
  });

  it('gives back no confirmation where a describe since has changed the columns, in their names or their order', async () => {
    for (const described of [['id'], ['name', 'id']]) {
      const user = userEvent.setup();
      const { client } = service({
        describe: () =>
          json(200, {
            columns: described.map((name) => ({
              name,
              sourceType: name === 'id' ? 'integer' : 'text',
              proposed: { base: name === 'id' ? 'integer' : 'text' },
            })),
            parameters: ['bigint'],
          }),
      });
      const { unmount } = render(<QueryDefinitionPage client={client} id={DEFINITION} />);
      await screen.findByRole('heading', { name: 'Site by id' });
      const sql = screen.getByLabelText('SQL text');
      await user.type(sql, ' x');
      await user.click(screen.getByRole('button', { name: 'Describe' }));
      await screen.findByText(
        `${described.length} ${described.length === 1 ? 'column' : 'columns'} proposed. Confirm the type of each.`,
      );
      // The SQL as the columns were confirmed for, and the columns not as they were: asked again.
      await user.type(sql, '{Backspace}{Backspace}');
      expect(screen.queryByRole('button', { name: 'Save version' }), described.join()).toBeNull();
      expect(screen.getByText('Confirm every column to save.')).toBeInTheDocument();
      unmount();
    }
  });

  it('drops a describe answering for a connection changed since it was sent', async () => {
    const user = userEvent.setup();
    const answers: ((response: Response) => void)[] = [];
    const { client } = service({
      warehouse: true,
      describe: () => new Promise<Response>((resolve) => answers.push(resolve)),
    });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    await screen.findByRole('heading', { name: 'Site by id' });
    const connection = screen.getByLabelText('Connection');
    await waitFor(() =>
      expect(
        within(connection)
          .getAllByRole('option')
          .map((each) => each.textContent),
      ).toContain('Warehouse'),
    );
    await user.click(screen.getByRole('button', { name: 'Describe' }));
    await waitFor(() => expect(answers).toHaveLength(1));
    await user.selectOptions(connection, WAREHOUSE);
    answers[0]!(
      json(200, {
        columns: [{ name: 'other', sourceType: 'text', proposed: { base: 'text' } }],
        parameters: [],
      }),
    );
    expect(
      await screen.findByText('The SQL changed while it was described. Describe it again.'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Columns' }))
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getAllByRole('cell')[0]!.textContent),
    ).toEqual(['id', 'name']);
  });

  it('DAT-016 shows where a definition is used before a version is saved', async () => {
    const { client } = service({
      uses: {
        components: {
          readable: [{ id: COMPONENT, title: 'Harbour readings' }],
          others: 2,
        },
        documents: { readable: [{ id: DOCUMENT, title: 'The readings report' }], others: 0 },
      },
    });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    const used = await screen.findByRole('region', { name: 'Used by' });
    expect(await within(used).findByRole('link', { name: 'Harbour readings' })).toHaveAttribute(
      'href',
      `#/components/${COMPONENT}`,
    );
    expect(within(used).getByRole('link', { name: 'The readings report' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}`,
    );
    expect(within(used).getByText('And 2 more you may not read.')).toBeInTheDocument();
    // Shown before the act it warns of: the region comes before Save version on the page.
    const save = screen.getByRole('button', { name: 'Save version' });
    expect(used.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('counts the uses a reader may not read, and names none of them', async () => {
    const { client } = service({
      uses: {
        components: { readable: [], others: 1 },
        documents: { readable: [], others: 3 },
      },
    });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    const used = await screen.findByRole('region', { name: 'Used by' });
    expect(
      await within(used).findByText('Bound by 1 component you may not read.'),
    ).toBeInTheDocument();
    expect(within(used).getByText('Held by 3 documents you may not read.')).toBeInTheDocument();
    expect(within(used).queryAllByRole('link')).toEqual([]);
  });

  it('says so when nothing uses a definition yet', async () => {
    const { client } = service();
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    const used = await screen.findByRole('region', { name: 'Used by' });
    expect(
      await within(used).findByText('No component binds this query definition yet.'),
    ).toBeInTheDocument();
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

  it('says a connection its reader may not read is one, and links to nothing', async () => {
    const hidden = {
      ...view(),
      mayEdit: false,
      mayRun: false,
      connection: { id: READINGS, name: null, identity: 'service', retired: false },
    };
    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      const path = new URL(request.url).pathname;
      if (path === `/v1/query-definitions/${DEFINITION}`) return json(200, hidden);
      if (path === '/v1/query-definitions') {
        return json(200, {
          items: [
            {
              id: DEFINITION,
              title: 'Site by id',
              space: { id: GENERAL, name: 'General' },
              connection: { id: READINGS, name: null },
              retired: false,
              version: { id: FIRST, number: '0.1' },
              changedAt: '2026-09-30T09:00:00.000Z',
            },
          ],
          next: null,
          total: 1,
          facets: { spaces: [] },
        });
      }
      return json(200, { items: [], next: null, total: 0, facets: { spaces: [] } });
    }) as unknown as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://definitions.test', fetch: fetching });
    const { unmount } = render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    expect(await screen.findByRole('heading', { name: 'Site by id' })).toBeInTheDocument();
    expect(screen.getByText(/Runs against a connection you may not read/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /connection/i })).toBeNull();
    unmount();

    render(<QueryDefinitions client={client} />);
    const table = await screen.findByRole('table');
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByText('A connection you may not read')).toBeInTheDocument();
    expect(
      within(row)
        .getAllByRole('link')
        .map((each) => each.textContent),
    ).toEqual(['Site by id']);
  });
});

describe('an image column (the D8 plan, D8-A and D8-G)', () => {
  /** A site's photographs: its id, a caption, and the photograph. */
  const PHOTO_SQL = 'select id, caption, photo from sample.site_photo order by id';
  const photoColumns = [
    { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
    { name: 'caption', from: { column: 'caption' }, type: { base: 'text' } },
    {
      name: 'photo',
      from: { column: 'photo' },
      type: { base: 'image', encoding: 'base64', description: 'decorative' },
    },
  ];
  const HASH = 'ab'.repeat(32);

  it('proposes a binary column as an image and saves it only with its description column or decorative', async () => {
    const user = userEvent.setup();
    const { client, asked } = service({
      describe: () =>
        json(200, {
          columns: [
            { name: 'id', sourceType: 'integer', proposed: { base: 'integer' } },
            { name: 'caption', sourceType: 'text', proposed: { base: 'text' } },
            {
              name: 'photo',
              sourceType: 'bytea',
              proposed: { base: 'image', encoding: 'binary' },
            },
          ],
          parameters: [],
        }),
    });
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
    await user.type(screen.getByLabelText('Title'), 'Site photographs');
    await user.click(screen.getByRole('radio', { name: 'SQL' }));
    await user.type(screen.getByLabelText('SQL text'), PHOTO_SQL);
    await user.click(screen.getByRole('button', { name: 'Describe' }));
    const columns = await screen.findByRole('table', { name: 'Columns' });
    const photo = within(columns).getAllByRole('row')[3]!;
    expect(within(photo).getByLabelText('Type of photo')).toHaveValue('image');
    expect(within(photo).getByLabelText('Encoding of photo')).toHaveValue('binary');
    // Its description is one of the definition's text columns, or none: decorative.
    const description = within(photo).getByLabelText('Description of photo');
    expect(
      within(description)
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual(['Choose its description', 'caption', 'Decorative, with no description']);

    for (const name of ['id', 'caption', 'photo']) {
      await user.click(within(columns).getByRole('button', { name: `Confirm ${name}` }));
    }
    await user.click(await screen.findByRole('button', { name: 'Save version' }));
    expect(
      await screen.findByText(
        'The column photo: Choose the text column that describes it, or mark it decorative.',
      ),
    ).toBeInTheDocument();
    expect(asked.some((each) => each.path.endsWith('/query-definitions'))).toBe(false);

    // Choosing withdraws the confirmation, as any change of type does.
    await user.selectOptions(description, 'column:caption');
    await user.click(within(columns).getByRole('button', { name: 'Confirm photo' }));
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/query-definitions/${DEFINITION}`));
    expect(asked.find((each) => each.path.endsWith('/query-definitions'))?.body).toMatchObject({
      definition: {
        columns: [
          { name: 'id', type: { base: 'integer' } },
          { name: 'caption', type: { base: 'text' } },
          {
            name: 'photo',
            from: { column: 'photo' },
            type: { base: 'image', encoding: 'binary', description: { column: 'caption' } },
          },
        ],
      },
    });
  });

  it('declares a text column an image held as base64, which the source never proposes, and never a parameter', async () => {
    const user = userEvent.setup();
    const { client } = service({
      held: view({
        parameters: [],
        fetch: { kind: 'sql', text: PHOTO_SQL },
        columns: photoColumns.slice(0, 2),
        key: ['id'],
      }),
    });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    const columns = await screen.findByRole('table', { name: 'Columns' });
    const caption = within(columns).getAllByRole('row')[2]!;
    await user.selectOptions(within(caption).getByLabelText('Type of caption'), 'image');
    const encoding = within(caption).getByLabelText('Encoding of caption');
    expect(encoding).toHaveValue('');
    expect(
      within(encoding)
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).toEqual(['Choose how the source holds it', 'Binary', 'Base64 text']);
    await user.selectOptions(encoding, 'base64');
    await user.selectOptions(
      within(caption).getByLabelText('Description of caption'),
      'decorative',
    );
    expect(within(caption).getByLabelText('Encoding of caption')).toHaveValue('base64');
    expect(within(caption).getByLabelText('Description of caption')).toHaveValue('decorative');
    // A parameter is never an image (DAT-010).
    await user.click(screen.getByRole('button', { name: 'Add parameter' }));
    const parameter = screen.getByRole('group', { name: 'Parameter 1' });
    expect(
      within(within(parameter).getByLabelText('Type'))
        .getAllByRole('option')
        .map((each) => each.textContent),
    ).not.toContain('Image');
  });

  it('opens a stored image column as declared, and shows one in words to somebody who may only read it', async () => {
    const stored = view({
      parameters: [],
      fetch: { kind: 'sql', text: PHOTO_SQL },
      columns: photoColumns,
    });
    const { client } = service({ held: stored });
    const { unmount } = render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    const columns = await screen.findByRole('table', { name: 'Columns' });
    const photo = within(columns).getAllByRole('row')[3]!;
    expect(within(photo).getByLabelText('Type of photo')).toHaveValue('image');
    expect(within(photo).getByLabelText('Encoding of photo')).toHaveValue('base64');
    expect(within(photo).getByLabelText('Description of photo')).toHaveValue('decorative');
    expect(within(photo).getByText('Confirmed')).toBeInTheDocument();
    unmount();

    const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init);
      if (new URL(request.url).pathname === `/v1/query-definitions/${DEFINITION}`) {
        return json(200, {
          ...stored,
          mayEdit: false,
          mayRun: false,
          definition: {
            ...stored.definition,
            columns: [
              ...photoColumns.slice(0, 2),
              {
                name: 'photo',
                from: { column: 'photo' },
                type: { base: 'image', encoding: 'binary', description: { column: 'caption' } },
              },
            ],
          },
        });
      }
      return json(200, { items: [], next: null, total: 0, facets: { spaces: [] } });
    }) as unknown as typeof fetch;
    render(
      <QueryDefinitionPage
        client={createApiClient({ baseUrl: 'http://definitions.test', fetch: fetching })}
        id={DEFINITION}
      />,
    );
    const shown = await screen.findByRole('table', { name: 'Columns' });
    expect(
      within(shown)
        .getAllByRole('row')
        .map((each) => each.textContent),
    ).toEqual(['NameType', 'idInteger', 'captionText', 'photoImage, binary, described by caption']);
  });

  it("shows a sample's image cells as the image, its format, size and pixels, from its header", async () => {
    const user = userEvent.setup();
    const { client } = service({
      held: view({
        parameters: [],
        fetch: { kind: 'sql', text: PHOTO_SQL },
        columns: photoColumns,
      }),
      sample: () =>
        json(200, {
          outcome: 'ok',
          columns: [
            ['id', 'integer'],
            ['caption', 'text'],
            ['photo', 'image'],
          ],
          rows: [
            ['1', 'North quay', HASH],
            ['2', 'South quay', null],
          ],
          rowCount: 2,
          checksum: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          ran: { sql: PHOTO_SQL },
          durationMs: 12,
          images: { [HASH]: { format: 'png', bytes: 1536, width: 640, height: 480 } },
        }),
    });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    const sample = await screen.findByRole('region', { name: 'Sample' });
    await user.click(within(sample).getByRole('button', { name: 'Run sample' }));
    const rows = await within(sample).findByRole('table', { name: 'The first rows' });
    expect(
      within(rows)
        .getAllByRole('row')
        .slice(1)
        .map((each) =>
          within(each)
            .getAllByRole('cell')
            .map((cell) => cell.textContent),
        ),
    ).toEqual([
      ['1', 'North quay', 'Image: PNG, 1.5 KB, 640 by 480 pixels'],
      ['2', 'South quay', 'Empty'],
    ]);
  });
});

describe('the builder (D4)', () => {
  /** The SQL a built query runs, as the page shows it. */
  const shownSql = () => screen.getByRole('figure', { name: 'The SQL it runs' }).textContent ?? '';

  /** A new definition with sample.site chosen: the source described, its table picked. */
  const begun = async (options: Parameters<typeof service>[0] = {}) => {
    const user = userEvent.setup();
    const made = service(options);
    render(<QueryDefinitionPage client={made.client} id="new" />);
    const connection = await screen.findByLabelText('Connection');
    await waitFor(() =>
      expect(
        within(connection)
          .getAllByRole('option')
          .map((each) => each.textContent),
      ).toContain('Readings'),
    );
    await user.click(screen.getByRole('button', { name: 'Describe the source' }));
    await user.selectOptions(await screen.findByLabelText('Table or view'), 'sample.site');
    return { user, ...made };
  };
  const pick = async (user: ReturnType<typeof userEvent.setup>, ...names: string[]) => {
    const columns = screen.getByRole('group', { name: 'Columns to return' });
    for (const name of names) {
      await user.click(within(columns).getByRole('checkbox', { name }));
    }
  };
  const addParameter = async (
    user: ReturnType<typeof userEvent.setup>,
    name: string,
    base: string,
  ) => {
    await user.click(screen.getByRole('button', { name: 'Add parameter' }));
    const all = screen.getAllByRole('group', { name: /^Parameter \d+$/ });
    const parameter = all[all.length - 1]!;
    await user.type(within(parameter).getByLabelText('Name'), name);
    await user.selectOptions(within(parameter).getByLabelText('Type'), base);
    return parameter;
  };

  it("DAT-105 proposes each column of a built query from the source's metadata and saves none until the author has confirmed every one", async () => {
    const { user, asked } = await begun({
      sqlWriter: false,
      describe: () =>
        json(200, {
          columns: [
            { name: 'id', sourceType: 'bigint', proposed: { base: 'integer' } },
            { name: 'site_name', sourceType: 'text', proposed: { base: 'text' } },
          ],
          parameters: ['bigint'],
        }),
    });
    await user.type(screen.getByLabelText('Title'), 'Site built');
    await pick(user, 'id', 'name');
    const named = screen.getByLabelText('Name of name');
    await user.clear(named);
    await user.type(named, 'site_name');
    await addParameter(user, 'site', 'integer');
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    const filter = screen.getByRole('group', { name: 'Filter 1' });
    await user.selectOptions(within(filter).getByLabelText('Column'), 'id');
    await user.selectOptions(within(filter).getByLabelText('Compared with'), 'site');
    await user.selectOptions(within(filter).getByLabelText('Comparison'), 'equal');

    // Nothing is offered to save before the columns are proposed.
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Describe' }));
    const columns = await screen.findByRole('table', { name: 'Columns' });
    const query = {
      sources: [{ alias: 't', table: { schema: 'sample', name: 'site' } }],
      joins: [],
      select: [
        { name: 'id', of: { source: 't', column: 'id' } },
        { name: 'site_name', of: { source: 't', column: 'name' } },
      ],
      where: { column: { source: 't', column: 'id' }, is: 'equal', to: { parameter: 'site' } },
      groupBy: [],
    };
    // The tree is described, never SQL.
    expect(
      asked.filter((each) => each.path.endsWith('/describe')).map((each) => each.body),
    ).toEqual([
      {},
      {
        builder: {
          query,
          parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
        },
      },
    ]);
    const [, id, name] = within(columns).getAllByRole('row');
    expect(within(id!).getByLabelText('Type of id')).toHaveValue('integer');
    expect(within(name!).getByLabelText('Type of site_name')).toHaveValue('text');
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    await user.click(within(id!).getByRole('button', { name: 'Confirm id' }));
    // One of two confirmed saves nothing.
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    expect(screen.getByText('Confirm every column to save.')).toBeInTheDocument();
    await user.click(within(name!).getByRole('button', { name: 'Confirm site_name' }));

    await user.click(await screen.findByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/query-definitions/${DEFINITION}`));
    const made = asked.find((each) => each.path.endsWith('/query-definitions'));
    expect(made?.body).toMatchObject({
      definition: {
        title: 'Site built',
        fetch: { kind: 'builder', format: 1, query },
        columns: [
          { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
          { name: 'site_name', from: { column: 'site_name' }, type: { base: 'text' } },
        ],
      },
    });
    expect(JSON.stringify(made?.body)).not.toContain('"text":');
  });

  it('offers the builder to an author who may not write SQL on the connection, and SQL only to one who may', async () => {
    const { unmount } = render(
      <QueryDefinitionPage client={service({ sqlWriter: false }).client} id="new" />,
    );
    expect(await screen.findByRole('button', { name: 'Describe the source' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Connection')).toHaveDisplayValue('Readings'));
    expect(screen.queryByRole('radio', { name: 'SQL' })).toBeNull();
    expect(screen.queryByLabelText('SQL text')).toBeNull();
    unmount();

    render(<QueryDefinitionPage client={service().client} id="new" />);
    const sql = await screen.findByRole('radio', { name: 'SQL' });
    expect(screen.getByRole('radio', { name: 'Builder' })).toBeChecked();
    await userEvent.setup().click(sql);
    expect(screen.getByLabelText('SQL text')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Describe the source' })).toBeNull();
  });

  it("offers a filter the comparisons its parameter's type allows", async () => {
    const { user } = await begun();
    await pick(user, 'id');
    const parameter = await addParameter(user, 'site', 'integer');
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    const filter = screen.getByRole('group', { name: 'Filter 1' });
    await user.selectOptions(within(filter).getByLabelText('Compared with'), 'site');
    const offered = () =>
      within(within(filter).getByLabelText('Comparison'))
        .getAllByRole('option')
        .map((each) => each.textContent);
    expect(offered()).toEqual([
      'is',
      'is not',
      'is less than',
      'is at most',
      'is greater than',
      'is at least',
      'is empty',
      'is not empty',
    ]);
    await user.selectOptions(within(parameter).getByLabelText('Type'), 'text');
    expect(offered()).toEqual([
      'is',
      'is not',
      'contains',
      'starts with',
      'is empty',
      'is not empty',
    ]);
    await user.click(within(parameter).getByRole('checkbox', { name: 'A list of values' }));
    expect(offered()).toEqual(['is one of', 'is empty', 'is not empty']);
    // A fixed value is compared as its column's type, and needs no parameter.
    await user.selectOptions(within(filter).getByLabelText('Column'), 'depth');
    await user.selectOptions(within(filter).getByLabelText('Compared with'), 'A fixed value');
    expect(offered()).toContain('is at least');
    expect(within(filter).getByLabelText('Value')).toBeInTheDocument();
  });

  it('groups by the columns returned and summarises each group, each summary named', async () => {
    const { user, asked } = await begun();
    await pick(user, 'name');
    await user.click(screen.getByRole('checkbox', { name: 'Group and summarise' }));
    await user.click(screen.getByRole('button', { name: 'Add a summary' }));
    const count = screen.getByRole('group', { name: 'Summary 1' });
    expect(within(count).getByLabelText('Summary')).toHaveValue('count');
    expect(within(count).getByLabelText('Of')).toHaveDisplayValue('Every row');
    await user.click(screen.getByRole('button', { name: 'Add a summary' }));
    const average = screen.getByRole('group', { name: 'Summary 2' });
    await user.selectOptions(within(average).getByLabelText('Summary'), 'average');
    await user.selectOptions(within(average).getByLabelText('Of'), 'depth');
    await user.clear(within(average).getByLabelText('Name'));
    await user.type(within(average).getByLabelText('Name'), 'mean_depth');
    await user.clear(within(average).getByLabelText('Places'));
    await user.type(within(average).getByLabelText('Places'), '2');
    expect(shownSql()).toContain(
      'pg_catalog.round(pg_catalog.avg("t"."depth"), 2) AS "mean_depth"',
    );
    expect(shownSql()).toContain('GROUP BY');

    await user.click(screen.getByRole('button', { name: 'Describe' }));
    await screen.findByRole('table', { name: 'Columns' });
    expect(asked.filter((each) => each.path.endsWith('/describe')).at(-1)?.body).toMatchObject({
      builder: {
        query: {
          select: [
            { name: 'name', of: { source: 't', column: 'name' } },
            { name: 'count', of: { aggregate: 'count' } },
            {
              name: 'mean_depth',
              of: { aggregate: 'average', of: { source: 't', column: 'depth' }, places: 2 },
            },
          ],
          groupBy: [{ source: 't', column: 'name' }],
        },
      },
    });
  });

  it('offers Return at most only beside a declared order', async () => {
    const { user } = await begun({
      describe: () =>
        json(200, {
          columns: [
            { name: 'id', sourceType: 'bigint', proposed: { base: 'integer' } },
            { name: 'name', sourceType: 'text', proposed: { base: 'text' } },
          ],
          parameters: [],
        }),
    });
    await pick(user, 'id', 'name');
    await user.click(screen.getByRole('button', { name: 'Describe' }));
    const columns = await screen.findByRole('table', { name: 'Columns' });
    for (const name of ['id', 'name']) {
      await user.click(within(columns).getByRole('button', { name: `Confirm ${name}` }));
    }
    expect(screen.queryByLabelText('Return at most')).toBeNull();
    expect(
      screen.getByText(/Return at most is offered beside a declared order/),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('group', { name: 'Key' })).getByRole('checkbox', { name: 'id' }),
    );
    await user.click(screen.getByRole('radio', { name: 'Return the rows in a declared order' }));
    await user.type(screen.getByLabelText('Return at most'), '5');
    expect(shownSql()).toMatch(/ORDER BY "t"\."id" ASC NULLS LAST\s+LIMIT 5$/);
    // Limiting changes no column, so nothing is to be confirmed again.
    expect(screen.getByRole('button', { name: 'Save version' })).toBeInTheDocument();
  });

  it('shows the SQL the tree generates, changing as the tree does', async () => {
    const { user } = await begun();
    expect(shownSql()).toContain('Choose a column to return');
    await pick(user, 'id');
    expect(shownSql()).toContain('SELECT "t"."id" AS "id"');
    expect(shownSql()).toContain('FROM (SELECT "id" FROM "sample"."site") AS "t"');
    await pick(user, 'name');
    expect(shownSql()).toContain('"t"."name" AS "name"');
    expect(shownSql()).toContain('FROM (SELECT "id", "name" FROM "sample"."site") AS "t"');
    await addParameter(user, 'site', 'integer');
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    const filter = screen.getByRole('group', { name: 'Filter 1' });
    await user.selectOptions(within(filter).getByLabelText('Compared with'), 'site');
    expect(shownSql()).toContain('WHERE "t"."id" OPERATOR(pg_catalog.=) ($1::pg_catalog.int8)');
    // The SQL is shown, never edited.
    expect(screen.queryByLabelText('SQL text')).toBeNull();
  });

  it('opens a definition that joins sources read-only, with its SQL and why', async () => {
    const joined = builtFetch({
      sources: [
        { alias: 's', table: { schema: 'sample', name: 'site' } },
        { alias: 'r', table: { schema: 'sample', name: 'reading' } },
      ],
      joins: [
        {
          kind: 'inner',
          source: 'r',
          on: {
            column: { source: 'r', column: 'site' },
            is: 'equal',
            to: { column: { source: 's', column: 'id' } },
          },
        },
      ],
      select: [
        { name: 'id', of: { source: 's', column: 'id' } },
        { name: 'name', of: { source: 's', column: 'name' } },
      ],
      where: { column: { source: 's', column: 'id' }, is: 'equal', to: { parameter: 'site' } },
    });
    const { client, asked } = service({ held: view({ fetch: joined }) });
    const user = userEvent.setup();
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    expect(
      await screen.findByText(
        'This query definition can be read here and not changed: it joins more than one source, which this page does not offer yet. Change it through the API.',
      ),
    ).toBeInTheDocument();
    expect(shownSql()).toContain('INNER JOIN (SELECT "site" FROM "sample"."reading") AS "r"');
    for (const name of ['Save version', 'Describe', 'Describe the source']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByLabelText('SQL text')).toBeNull();
    // It can still be sampled as it stands, and retired.
    const sample = screen.getByRole('region', { name: 'Sample' });
    await user.type(within(sample).getByLabelText('site'), '1');
    await user.click(within(sample).getByRole('button', { name: 'Run sample' }));
    await within(sample).findByRole('table', { name: 'The first rows' });
    expect(asked.find((each) => each.path.endsWith('/sample'))?.body).toMatchObject({
      definition: { fetch: joined },
    });
    expect(screen.getByRole('button', { name: 'Retire' })).toBeInTheDocument();
  });

  it('opens a built definition in the builder, never as SQL to edit', async () => {
    const { client } = service({ held: view({ fetch: builtFetch() }) });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    expect(await screen.findByRole('radio', { name: 'Builder' })).toBeChecked();
    expect(screen.queryByLabelText('SQL text')).toBeNull();
    expect(screen.getByRole('group', { name: 'Filter 1' })).toBeInTheDocument();
    expect(shownSql()).toContain(' FROM "sample"."site") AS "t"');
    // Turned to SQL by somebody who may write it, it starts empty: the generated SQL is not its.
    await userEvent.setup().click(screen.getByRole('radio', { name: 'SQL' }));
    expect(screen.getByLabelText('SQL text')).toHaveValue('');
  });

  it('lists a name the builder cannot hold and does not offer it', async () => {
    await begun();
    const table = screen.getByLabelText('Table or view');
    const option = within(table).getByRole('option', {
      name: new RegExp(`^sample\\.${DECOMPOSED}`),
    });
    expect(option).toBeDisabled();
    expect(
      screen.getByText(
        `Not offered, as its name is not in the composed form a query definition holds: sample.${DECOMPOSED}. A view at the source under a composed name reaches it.`,
      ),
    ).toBeInTheDocument();
  });
});

describe('a query definition on an HTTP connection (the D6 plan)', () => {
  it('DAT-105 writes a request template, proposes its columns by pointer from a sample, and saves them only once each is confirmed', async () => {
    const user = userEvent.setup();
    const { client, asked } = service({
      api: true,
      sqlWriter: false,
      describe: () =>
        json(200, {
          columns: [
            { name: 'id', sourceType: 'number', proposed: { base: 'integer' }, pointer: '/id' },
            {
              name: 'site/name',
              sourceType: 'string',
              proposed: { base: 'text' },
              pointer: '/site~1name',
            },
          ],
          parameters: [],
        }),
    });
    render(<QueryDefinitionPage client={client} id="new" />);
    const connection = await screen.findByLabelText('Connection');
    await waitFor(() => expect(connection).toHaveValue(API));
    // An HTTP connection's query is a request: no builder, no SQL.
    expect(screen.queryByRole('button', { name: 'Describe the source' })).toBeNull();
    expect(screen.queryByLabelText('SQL text')).toBeNull();
    await user.type(screen.getByLabelText('Title'), 'Sites by API');
    await user.click(screen.getByRole('button', { name: 'Add parameter' }));
    await user.type(
      within(screen.getByRole('group', { name: 'Parameter 1' })).getByLabelText('Name'),
      'site',
    );
    await user.click(screen.getByRole('button', { name: 'Add segment' }));
    await user.type(screen.getByLabelText('Segment 1'), 'sites');
    await user.click(screen.getByRole('button', { name: 'Add segment' }));
    await user.selectOptions(screen.getByLabelText('Segment 2: fixed or a parameter'), 'parameter');
    await user.selectOptions(screen.getByLabelText('Segment 2 parameter'), 'site');
    await user.type(screen.getByLabelText('Rows at'), '/items');
    await user.type(screen.getByLabelText('site'), 'north');
    await user.click(screen.getByRole('button', { name: 'Sample for columns' }));
    const columns = await screen.findByRole('table', { name: 'Columns' });
    const request = {
      method: 'GET',
      path: [{ fixed: 'sites' }, { parameter: 'site' }],
      query: [],
      headers: [],
    };
    // The request is sent with the sample's values, its rows read to propose the columns.
    expect(asked.find((each) => each.path.endsWith('/describe'))?.body).toEqual({
      http: {
        request,
        format: { kind: 'json', rows: '/items' },
        parameters: [{ name: 'site', type: { base: 'text' }, required: true, list: false }],
        values: { site: 'north' },
      },
    });
    expect(screen.queryByRole('button', { name: 'Save version' })).toBeNull();
    for (const name of ['id', 'site/name']) {
      await user.click(within(columns).getByRole('button', { name: `Confirm ${name}` }));
    }
    await user.click(await screen.findByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/query-definitions/${DEFINITION}`));
    expect(asked.find((each) => each.path.endsWith('/query-definitions'))?.body).toMatchObject({
      definition: {
        connection: API,
        fetch: { kind: 'http', request, format: { kind: 'json', rows: '/items' } },
        columns: [
          { name: 'id', from: { pointer: '/id' }, type: { base: 'integer' } },
          { name: 'site/name', from: { pointer: '/site~1name' }, type: { base: 'text' } },
        ],
      },
    });
  });

  it('shows the request an HTTP definition sends to somebody who may only read it, never a URL', async () => {
    const { client } = service({
      held: {
        ...view({
          parameters: [{ name: 'site', type: { base: 'text' }, required: true, list: false }],
          fetch: {
            kind: 'http',
            request: {
              method: 'GET',
              path: [{ fixed: 'sites' }, { parameter: 'site' }],
              query: [{ name: 'since', value: { fixed: '2026-01-01' } }],
              headers: [],
            },
            format: { kind: 'jsonLines' },
          },
          columns: [{ name: 'id', from: { pointer: '/id' }, type: { base: 'integer' } }],
          key: [],
          order: 'multiset',
        }),
        mayEdit: false,
      },
    });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    expect(
      await screen.findByText('GET /sites/{site}?since=2026-01-01', { exact: false }),
    ).toBeInTheDocument();
  });

  it('DAT-105 reads a file by its key, proposes its columns by header from a sample, and saves its filter over them', async () => {
    const user = userEvent.setup();
    const { client, asked } = service({
      bucket: true,
      sqlWriter: false,
      describe: () =>
        json(200, {
          columns: [
            { name: 'id', sourceType: 'text', proposed: { base: 'integer' }, header: 'id' },
            { name: 'site', sourceType: 'text', proposed: { base: 'text' }, header: 'site' },
          ],
          parameters: [],
        }),
    });
    render(<QueryDefinitionPage client={client} id="new" />);
    const connection = await screen.findByLabelText('Connection');
    await waitFor(() => expect(connection).toHaveValue(BUCKET));
    // An S3 connection's query is a file: no builder, no SQL, no request.
    expect(screen.queryByLabelText('SQL text')).toBeNull();
    expect(screen.queryByLabelText('Method')).toBeNull();
    await user.type(screen.getByLabelText('Title'), 'Sites from a file');
    await user.click(screen.getByRole('button', { name: 'Add parameter' }));
    await user.type(
      within(screen.getByRole('group', { name: 'Parameter 1' })).getByLabelText('Name'),
      'year',
    );
    await user.click(screen.getByRole('button', { name: 'Add segment' }));
    await user.type(screen.getByLabelText('Segment 1'), 'readings');
    await user.click(screen.getByRole('button', { name: 'Add segment' }));
    await user.selectOptions(screen.getByLabelText('Segment 2: fixed or a parameter'), 'parameter');
    await user.selectOptions(screen.getByLabelText('Segment 2 parameter'), 'year');
    await user.click(screen.getByRole('button', { name: 'Add segment' }));
    await user.type(screen.getByLabelText('Segment 3'), 'sites.csv');
    // A file is CSV unless said; its convention for an empty field is declared.
    expect(screen.getByLabelText('The file is')).toHaveValue('csv');
    await user.selectOptions(screen.getByLabelText('An empty field'), 'never');
    await user.type(screen.getByLabelText('year'), '2026');
    await user.click(screen.getByRole('button', { name: 'Sample for columns' }));
    const columns = await screen.findByRole('table', { name: 'Columns' });
    const key = [{ fixed: 'readings' }, { parameter: 'year' }, { fixed: 'sites.csv' }];
    const format = { kind: 'csv', delimiter: 'comma', headerRow: true, null: 'never' };
    expect(asked.find((each) => each.path.endsWith('/describe'))?.body).toEqual({
      file: {
        key,
        format,
        parameters: [{ name: 'year', type: { base: 'text' }, required: true, list: false }],
        values: { year: '2026' },
      },
    });
    for (const name of ['id', 'site']) {
      await user.click(within(columns).getByRole('button', { name: `Confirm ${name}` }));
    }
    // A filter over a confirmed column, compared with a fixed value of its type.
    await user.click(screen.getByRole('button', { name: 'Add a filter' }));
    const filter = screen.getByRole('group', { name: 'Filter 1' });
    await user.selectOptions(within(filter).getByLabelText('Column'), 'site');
    await user.selectOptions(within(filter).getByLabelText('Compared with'), 'value');
    await user.selectOptions(within(filter).getByLabelText('Comparison'), 'startsWith');
    await user.type(within(filter).getByLabelText('Value'), 'North');
    // Filtering changes which rows, never which columns: the confirmations stand.
    await user.click(await screen.findByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/query-definitions/${DEFINITION}`));
    expect(asked.find((each) => each.path.endsWith('/query-definitions'))?.body).toMatchObject({
      definition: {
        connection: BUCKET,
        fetch: {
          kind: 'file',
          key,
          format,
          where: {
            column: 'site',
            is: 'startsWith',
            to: { literal: 'North', type: { base: 'text' } },
          },
        },
        columns: [
          { name: 'id', from: { header: 'id' }, type: { base: 'integer' } },
          { name: 'site', from: { header: 'site' }, type: { base: 'text' } },
        ],
      },
    });
  });

  it('shows the object a file definition reads to somebody who may only read it', async () => {
    const { client } = service({
      held: {
        ...view({
          parameters: [{ name: 'year', type: { base: 'text' }, required: true, list: false }],
          fetch: {
            kind: 'file',
            key: [{ fixed: 'readings' }, { parameter: 'year' }, { fixed: 'sites.csv' }],
            format: { kind: 'csv', delimiter: 'comma', headerRow: false, null: 'empty' },
          },
          columns: [{ name: 'id', from: { letter: 'A' }, type: { base: 'integer' } }],
          key: [],
          order: 'multiset',
        }),
        mayEdit: false,
      },
    });
    render(<QueryDefinitionPage client={client} id={DEFINITION} />);
    expect(await screen.findByText('readings/{year}/sites.csv')).toBeInTheDocument();
  });
});
