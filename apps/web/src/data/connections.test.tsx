import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectionPage } from './ConnectionPage.js';
import { Connections } from './Connections.js';

const GENERAL = '11111111-1111-4111-8111-111111111111';
const QUALITY = '22222222-2222-4222-8222-222222222222';
const READINGS = '33333333-3333-4333-8333-333333333333';
const FIRST = '44444444-4444-4444-8444-444444444444';
const SECOND = '55555555-5555-4555-8555-555555555555';
const CANARY = 'an-invented-canary-password';
const SHELVED = '66666666-6666-4666-8666-666666666666';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const settings = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  name: 'Readings',
  description: 'The sites and their readings.',
  type: 'postgres',
  source: {
    host: 'source-postgres',
    port: 5432,
    database: 'readings',
    account: 'reader',
    tls: 'require',
  },
  identity: { kind: 'service' },
  retired: false,
  ...over,
});

type View = Record<string, unknown> & { settings: ReturnType<typeof settings> };

const view = (over: Partial<View> = {}): View => ({
  id: READINGS,
  space: { id: GENERAL, name: 'General' },
  version: {
    id: FIRST,
    number: '0.1',
    author: 'ada',
    createdAt: '2026-09-30T09:00:00.000Z',
    note: null,
  },
  settings: settings(),
  credential: { set: false },
  lastTest: null,
  mayAdminister: true,
  mayUse: true,
  ...over,
});

interface Asked {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/**
 * The service as far as connections are concerned: one connection, held here and changed by what the
 * page sends, and an answer for each act that a test may replace.
 */
function service(
  options: {
    connection?: View;
    administers?: readonly string[];
    test?: () => Response;
    describe?: () => Response;
    credential?: () => Response;
    version?: (body: {
      openedFrom: string;
      settings: ReturnType<typeof settings>;
    }) => Response | undefined;
    uses?: () => Response;
  } = {},
) {
  const asked: Asked[] = [];
  let held = options.connection ?? view();
  let cuts = 0;
  const administers = options.administers ?? [GENERAL];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    const text = await request.text();
    const body = text === '' ? undefined : (JSON.parse(text) as unknown);
    asked.push({ method: request.method, path: url.pathname, body });
    const path = url.pathname;
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
            lastTest: {
              outcome: 'ok',
              at: '2026-09-30T09:00:00.000Z',
              version: FIRST,
              credentialCurrent: true,
            },
            changedAt: '2026-09-30T09:00:00.000Z',
          },
          {
            id: '77777777-7777-4777-8777-777777777777',
            name: 'Moved',
            space: { id: GENERAL, name: 'General' },
            type: 'postgres',
            retired: false,
            version: { id: SECOND, number: '0.2' },
            credentialSet: true,
            lastTest: {
              outcome: 'ok',
              at: '2026-09-30T09:00:00.000Z',
              version: FIRST,
              credentialCurrent: true,
            },
            changedAt: '2026-09-30T10:00:00.000Z',
          },
          {
            id: '66666666-6666-4666-8666-666666666666',
            name: 'Old ledger',
            space: { id: QUALITY, name: 'Quality' },
            type: 'postgres',
            retired: true,
            version: { id: SECOND, number: '0.3' },
            credentialSet: false,
            lastTest: null,
            changedAt: '2026-09-29T09:00:00.000Z',
          },
          {
            id: '55555555-5555-4555-8555-555555555555',
            name: 'Rotated',
            space: { id: GENERAL, name: 'General' },
            type: 'postgres',
            retired: false,
            version: { id: FIRST, number: '0.1' },
            credentialSet: true,
            lastTest: {
              outcome: 'ok',
              at: '2026-09-30T09:00:00.000Z',
              version: FIRST,
              credentialCurrent: false,
            },
            changedAt: '2026-09-28T09:00:00.000Z',
          },
        ],
        next: null,
        total: 2,
        facets: {
          spaces: [
            { value: GENERAL, label: 'General', count: 1 },
            { value: QUALITY, label: 'Quality', count: 1 },
          ],
        },
      });
    }
    if (request.method === 'GET' && path === '/v1/spaces') {
      return json(200, {
        items: [
          { id: GENERAL, name: 'General', archived: false, mayCreate: false },
          { id: QUALITY, name: 'Quality', archived: false, mayCreate: false },
          // Archived: listed only to a reader who does not ask for it to be left out.
          ...(url.searchParams.get('archived') === 'false'
            ? []
            : [{ id: SHELVED, name: 'Shelved', archived: true, mayCreate: false }]),
        ],
        next: null,
      });
    }
    if (request.method === 'GET' && path === '/v1/access') {
      const target = url.searchParams.get('target') ?? '';
      const allowed = administers.some((space) => target === `space:${space}`);
      return json(200, {
        target,
        permissions: [
          { permission: 'read', allowed: true },
          { permission: 'administer', allowed: allowed },
        ],
      });
    }
    if (request.method === 'POST' && path.endsWith('/connections')) {
      const made = view({
        settings: (body as { settings: ReturnType<typeof settings> }).settings,
      });
      held = made;
      return json(200, made);
    }
    if (request.method === 'GET' && path === `/v1/connections/${READINGS}`) {
      return json(200, held);
    }
    if (request.method === 'POST' && path === `/v1/connections/${READINGS}/versions`) {
      const sent = body as { openedFrom: string; settings: ReturnType<typeof settings> };
      const answer = options.version?.(sent);
      if (answer) return answer;
      held = {
        ...held,
        settings: sent.settings,
        // Each version cut is a version of its own, as the service's are.
        version: {
          ...(held.version as object),
          id: cuts++ === 0 ? SECOND : crypto.randomUUID(),
          number: `0.${cuts + 1}`,
        },
      };
      return json(200, held);
    }
    if (request.method === 'PUT' && path === `/v1/connections/${READINGS}/credential`) {
      const answer = options.credential?.();
      if (answer) return answer;
      const credential = {
        set: true,
        setBy: { id: 'ada', name: 'Ada' },
        setAt: '2026-09-30T10:00:00.000Z',
        targetChanged: false,
      };
      held = { ...held, credential };
      return json(200, {
        credential,
        test: { outcome: 'ok', findings: [], at: '2026-09-30T10:00:01.000Z' },
      });
    }
    if (request.method === 'GET' && path === `/v1/connections/${READINGS}/uses`) {
      return (
        options.uses?.() ??
        json(200, {
          definitions: { readable: [], others: 0 },
          documents: { readable: [], others: 0 },
        })
      );
    }
    if (request.method === 'POST' && path === `/v1/connections/${READINGS}/test`) {
      return (
        options.test?.() ??
        json(200, { outcome: 'ok', findings: [], at: '2026-09-30T10:00:00.000Z' })
      );
    }
    if (request.method === 'POST' && path === `/v1/connections/${READINGS}/describe`) {
      return (
        options.describe?.() ??
        json(200, {
          relations: [
            {
              schema: 'sample',
              name: 'site',
              kind: 'table',
              columns: [
                { name: 'id', sourceType: 'int4', nullable: false, proposed: { base: 'integer' } },
                { name: 'name', sourceType: 'text', nullable: false, proposed: { base: 'text' } },
              ],
            },
            {
              schema: 'sample',
              name: 'site_summary',
              kind: 'view',
              columns: [{ name: 'readings', sourceType: 'int8', nullable: true, proposed: null }],
            },
          ],
          truncated: false,
          leftOut: { relations: 0, columns: 0 },
        })
      );
    }
    return json(404, { code: 'not_found', message: 'There is nothing at this address.' });
  }) as unknown as typeof fetch;
  return {
    client: createApiClient({ baseUrl: 'http://connections.test', fetch: fetching }),
    asked,
    fetching,
  };
}

const failure = (code: string, attribution: string, message: string) =>
  json(200, {
    outcome: 'failed',
    failure: { code, attribution, message },
    at: '2026-09-30T10:00:00.000Z',
  });

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('the Connections list', () => {
  it('lists the connections the person may read, by space, with whether each is ready', async () => {
    const { client } = service();
    render(<Connections client={client} />);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((each) => each.textContent),
    ).toEqual(['Name', 'Space', 'Credential', 'Last test', 'Changed']);
    expect(within(rows[1]!).getByRole('link', { name: 'Readings' })).toHaveAttribute(
      'href',
      `#/connections/${READINGS}`,
    );
    expect(within(rows[1]!).getByText('Set')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Connected')).toBeInTheDocument();
    // A pass of an earlier version is not this version's.
    expect(within(rows[2]!).getByText('Moved')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Not tested since this version')).toBeInTheDocument();
    expect(within(rows[2]!).queryByText('Connected')).toBeNull();
    expect(within(rows[3]!).getByText(/Old ledger/)).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Retired')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Not set')).toBeInTheDocument();
    // Nor is a pass with an earlier credential the credential's set now.
    expect(
      within(rows[4]!).getByText('Not tested since the credential was set'),
    ).toBeInTheDocument();
    expect(within(rows[4]!).queryByText('Connected')).toBeNull();
    expect(screen.getByRole('group', { name: 'Space' })).toBeInTheDocument();
  });

  it('offers New connection where the person may administer a space, and makes one there', async () => {
    const user = userEvent.setup();
    const { client, asked } = service({ administers: [QUALITY] });
    render(<Connections client={client} />);
    await user.click(await screen.findByRole('button', { name: 'New connection' }));
    const dialog = screen.getByRole('dialog', { name: 'New connection' });
    // Only the space the person administers is offered.
    const where = within(dialog).getByLabelText('Space');
    await waitFor(() =>
      expect(
        within(where)
          .getAllByRole('option')
          .map((each) => each.textContent),
      ).toEqual(['Quality']),
    );
    await user.type(within(dialog).getByLabelText('Name'), 'Plant data');
    await user.type(within(dialog).getByLabelText('Host'), 'db.example.test');
    await user.clear(within(dialog).getByLabelText('Port'));
    await user.type(within(dialog).getByLabelText('Port'), '5433');
    await user.type(within(dialog).getByLabelText('Database'), 'plant');
    await user.type(within(dialog).getByLabelText('Account'), 'reader');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/connections/${READINGS}`));
    expect(asked.find((each) => each.method === 'POST')).toEqual({
      method: 'POST',
      path: `/v1/spaces/${QUALITY}/connections`,
      body: {
        settings: settings({
          name: 'Plant data',
          description: '',
          source: {
            host: 'db.example.test',
            port: 5433,
            database: 'plant',
            account: 'reader',
            tls: 'require',
          },
        }),
      },
    });
  });

  it('makes an HTTP connection: a base URL and the header its secret is sent in, running as its own secret', async () => {
    const user = userEvent.setup();
    const { client, asked } = service({ administers: [QUALITY] });
    render(<Connections client={client} />);
    await user.click(await screen.findByRole('button', { name: 'New connection' }));
    const dialog = screen.getByRole('dialog', { name: 'New connection' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'http');
    // A database's fields give way to the API's, and no choice of whom it runs as.
    expect(within(dialog).queryByLabelText('Host')).toBeNull();
    expect(within(dialog).queryByLabelText('Runs as')).toBeNull();
    await user.type(within(dialog).getByLabelText('Name'), 'Readings API');
    await user.type(within(dialog).getByLabelText('Base URL'), 'api.example.test/v1');
    await user.clear(within(dialog).getByLabelText('Secret header'));
    await user.type(within(dialog).getByLabelText('Secret header'), 'x-api-key');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/connections/${READINGS}`));
    expect(asked.find((each) => each.method === 'POST')?.body).toEqual({
      settings: {
        schemaVersion: 1,
        name: 'Readings API',
        description: '',
        type: 'http',
        source: { baseUrl: 'https://api.example.test/v1', secretHeader: 'x-api-key' },
        identity: { kind: 'service' },
        retired: false,
      },
    });
  });

  it('makes an S3 connection: an endpoint, a region, a bucket and how it is addressed', async () => {
    const user = userEvent.setup();
    const { client, asked } = service({ administers: [QUALITY] });
    render(<Connections client={client} />);
    await user.click(await screen.findByRole('button', { name: 'New connection' }));
    const dialog = screen.getByRole('dialog', { name: 'New connection' });
    await user.selectOptions(within(dialog).getByLabelText('Type'), 's3');
    expect(within(dialog).queryByLabelText('Host')).toBeNull();
    expect(within(dialog).queryByLabelText('Runs as')).toBeNull();
    await user.type(within(dialog).getByLabelText('Name'), 'Readings bucket');
    await user.type(within(dialog).getByLabelText('Endpoint'), 'minio.example.test:9000');
    await user.clear(within(dialog).getByLabelText('Region'));
    await user.type(within(dialog).getByLabelText('Region'), 'eu-west-2');
    await user.type(within(dialog).getByLabelText('Bucket'), 'alloy-readings');
    await user.selectOptions(within(dialog).getByLabelText('Addressed'), 'path');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/connections/${READINGS}`));
    expect(asked.find((each) => each.method === 'POST')?.body).toEqual({
      settings: {
        schemaVersion: 1,
        name: 'Readings bucket',
        description: '',
        type: 's3',
        source: {
          endpoint: 'https://minio.example.test:9000',
          region: 'eu-west-2',
          bucket: 'alloy-readings',
          pathStyle: true,
        },
        identity: { kind: 'service' },
        retired: false,
      },
    });
  });

  it('leaves an archived space out of where a new connection may be made', async () => {
    const user = userEvent.setup();
    const { client } = service({ administers: [QUALITY, SHELVED] });
    render(<Connections client={client} />);
    await user.click(await screen.findByRole('button', { name: 'New connection' }));
    const where = within(screen.getByRole('dialog', { name: 'New connection' })).getByLabelText(
      'Space',
    );
    await waitFor(() =>
      expect(
        within(where)
          .getAllByRole('option')
          .map((each) => each.textContent),
      ).toEqual(['Quality']),
    );
  });

  it('offers no New connection to somebody who administers no space', async () => {
    const { client, asked } = service({ administers: [] });
    render(<Connections client={client} />);
    await screen.findByRole('table');
    // Every space has been asked about, and none may be administered.
    await waitFor(() => expect(asked.filter((each) => each.path === '/v1/access')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'New connection' })).toBeNull();
  });
});

describe('an HTTP connection on its own page', () => {
  const http = settings({
    name: 'Readings API',
    type: 'http',
    source: { baseUrl: 'https://api.example.test/v1', secretHeader: 'x-api-key' },
  });

  it('shows its base URL and secret header, sets its secret, and lists no tables', async () => {
    const user = userEvent.setup();
    const { client, asked } = service({ connection: view({ settings: http }) });
    render(<ConnectionPage client={client} id={READINGS} />);
    await screen.findByRole('heading', { name: 'Readings API' });
    expect(screen.getByText('HTTPS API, in General')).toBeInTheDocument();
    // Its type is not offered to change; its fields are the API's.
    expect(screen.queryByLabelText('Type')).toBeNull();
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.example.test/v1');
    expect(screen.getByLabelText('Secret header')).toHaveValue('x-api-key');
    expect(screen.queryByRole('button', { name: 'List tables' })).toBeNull();
    await user.type(screen.getByLabelText('Secret'), CANARY);
    await user.click(screen.getByRole('button', { name: 'Set' }));
    await waitFor(() =>
      expect(asked.some((each) => each.method === 'PUT' && each.path.endsWith('/credential'))).toBe(
        true,
      ),
    );
    expect(screen.getByLabelText('Secret')).toHaveValue('');
    expect(document.body.textContent).not.toContain(CANARY);
  });
});

describe('an S3 connection on its own page', () => {
  const s3 = settings({
    name: 'Readings bucket',
    type: 's3',
    source: {
      endpoint: 'https://s3.example.test',
      region: 'eu-west-2',
      bucket: 'alloy-readings',
      pathStyle: false,
    },
  });

  it('shows its endpoint, region and bucket, sets its key pair write-only, and lists no tables', async () => {
    const user = userEvent.setup();
    const { client, asked } = service({ connection: view({ settings: s3 }) });
    render(<ConnectionPage client={client} id={READINGS} />);
    await screen.findByRole('heading', { name: 'Readings bucket' });
    expect(screen.getByText('S3 bucket, in General')).toBeInTheDocument();
    expect(screen.queryByLabelText('Type')).toBeNull();
    expect(screen.getByLabelText('Endpoint')).toHaveValue('https://s3.example.test');
    expect(screen.getByLabelText('Bucket')).toHaveValue('alloy-readings');
    expect(screen.queryByRole('button', { name: 'List tables' })).toBeNull();
    await user.type(screen.getByLabelText('Access key id'), 'AKIAINVENTED');
    await user.type(screen.getByLabelText('Secret access key'), CANARY);
    await user.click(screen.getByRole('button', { name: 'Set' }));
    await waitFor(() =>
      expect(asked.some((each) => each.method === 'PUT' && each.path.endsWith('/credential'))).toBe(
        true,
      ),
    );
    expect(asked.find((each) => each.method === 'PUT')?.body).toEqual({
      accessKeyId: 'AKIAINVENTED',
      secretAccessKey: CANARY,
    });
    expect(screen.getByLabelText('Secret access key')).toHaveValue('');
    expect(screen.getByLabelText('Access key id')).toHaveValue('');
    expect(document.body.textContent).not.toContain(CANARY);
  });
});

describe('a connection on its own page', () => {
  it('DAT-075 tests a connection from its page and says it connected, or the one reason it did not', async () => {
    const user = userEvent.setup();
    let answer = () => json(200, { outcome: 'ok', findings: [], at: '2026-09-30T10:00:00.000Z' });
    const { client, asked } = service({
      connection: view({
        credential: {
          set: true,
          setBy: { id: 'ada', name: 'Ada' },
          setAt: '2026-09-30T09:00:00Z',
          targetChanged: false,
        },
      }),
      test: () => answer(),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    const test = await screen.findByRole('button', { name: 'Test' });
    await user.click(test);
    const result = await screen.findByText('Connected.');
    expect(asked.filter((each) => each.path.endsWith('/test'))).toHaveLength(1);

    // A failure is one reason, the service's own words, beside "Could not connect."
    answer = () =>
      failure(
        'connection_failed',
        'connector',
        'Could not connect to the source or sign in to it. Check its settings and its credential.',
      );
    await user.click(test);
    expect(await screen.findByText('Could not connect.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Could not connect to the source or sign in to it. Check its settings and its credential.',
      ),
    ).toBeInTheDocument();
    expect(result).not.toBeInTheDocument();

    // A finding about the account, once it signed in.
    answer = () =>
      json(200, {
        outcome: 'ok',
        findings: ['account_not_read_only'],
        at: '2026-09-30T10:00:00.000Z',
      });
    await user.click(test);
    expect(await screen.findByText('Connected.')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This account can change data at the source, so SQL written by hand will not be allowed on this connection.',
      ),
    ).toBeInTheDocument();
  });

  it('DAT-004 shows whether a credential is set, by whom and when, and never shows one', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    const { container } = render(<ConnectionPage client={client} id={READINGS} />);
    const credential = await screen.findByRole('region', { name: 'Credential' });
    expect(within(credential).getByText('Not set.')).toBeInTheDocument();
    const field = within(credential).getByLabelText('Password');
    expect(field).toHaveAttribute('type', 'password');
    await user.type(field, CANARY);
    await user.click(within(credential).getByRole('button', { name: 'Set' }));
    expect(
      await within(credential).findByText('Set by Ada on 30 September 2026.'),
    ).toBeInTheDocument();
    // Emptied once sent, offered again as a replacement, and tested straight after.
    expect(field).toHaveValue('');
    expect(within(credential).getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(await screen.findByText('Connected.')).toBeInTheDocument();
    expect(asked.find((each) => each.method === 'PUT')?.body).toEqual({ secret: CANARY });
    // Nothing the page holds carries it: not its text, its attributes or its fields.
    expect(container.innerHTML).not.toContain(CANARY);
    expect(
      [...container.querySelectorAll('input')].map((input) => (input as HTMLInputElement).value),
    ).not.toContain(CANARY);
  });

  it('says a password set before this version of the product must be set again, without saying anything changed', async () => {
    const { client } = service({
      connection: view({
        credential: {
          set: true,
          setBy: { id: 'ada', name: 'Ada' },
          setAt: '2026-09-30T09:00:00Z',
          targetChanged: true,
          setBeforeBinding: true,
        },
      }),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    expect(
      await screen.findByText(
        'Set by Ada on 30 September 2026, before this version of the product. Set the password again to use this connection.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/host, port, database/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Set again' })).toBeInTheDocument();
  });

  it('says the password must be set again once a version changes where the connection signs in', async () => {
    const user = userEvent.setup();
    const setBy = { id: 'ada', name: 'Ada' };
    const { client } = service({
      connection: view({
        credential: { set: true, setBy, setAt: '2026-09-30T09:00:00Z', targetChanged: false },
      }),
      version: (sent) =>
        json(
          200,
          view({
            settings: sent.settings,
            version: { id: SECOND, number: '0.2' } as never,
            credential: { set: true, setBy, setAt: '2026-09-30T09:00:00Z', targetChanged: true },
          }),
        ),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    const credential = await screen.findByRole('region', { name: 'Credential' });
    expect(within(credential).getByText('Set by Ada on 30 September 2026.')).toBeInTheDocument();
    const saving = screen.getByRole('region', { name: 'Settings' });
    const host = within(saving).getByLabelText('Host');
    await user.clear(host);
    await user.type(host, 'db2.example.test');
    await user.click(within(saving).getByRole('button', { name: 'Save version' }));
    expect(
      await within(credential).findByText(
        'Set by Ada on 30 September 2026, before the host, port, database, account or TLS changed. Set the password again to use this connection.',
      ),
    ).toBeInTheDocument();
    expect(within(credential).getByRole('button', { name: 'Set again' })).toBeInTheDocument();
  });

  it("says a connection's last test was of an earlier version, and forgets an answer on the page once a version is cut", async () => {
    const user = userEvent.setup();
    const credential = {
      set: true,
      setBy: { id: 'ada', name: 'Ada' },
      setAt: '2026-09-30T09:00:00Z',
      targetChanged: false,
    };
    const lastTest = {
      outcome: 'ok',
      findings: [],
      at: '2026-09-30T09:30:00.000Z',
      by: { id: 'ada', name: 'Ada' },
      version: '88888888-8888-4888-8888-888888888888',
      credentialCurrent: true,
    };
    const { client } = service({ connection: view({ credential, lastTest }) });
    render(<ConnectionPage client={client} id={READINGS} />);
    const testing = await screen.findByRole('region', { name: 'Test' });
    expect(
      within(testing).getByText(
        'Not tested since this version. The last test, of an earlier version, was on 30 September 2026 by Ada.',
      ),
    ).toBeInTheDocument();
    expect(within(testing).queryByText(/connected/i)).toBeNull();

    // Tested now, then a version cut: the answer on the page was the earlier version's, so it goes.
    await user.click(within(testing).getByRole('button', { name: 'Test' }));
    expect(await within(testing).findByText('Connected.')).toBeInTheDocument();
    const saving = screen.getByRole('region', { name: 'Settings' });
    await user.type(within(saving).getByLabelText('Description'), ' Again.');
    await user.click(within(saving).getByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(screen.queryByText('Connected.')).toBeNull());

    // And across Retire and Reinstate, with what the credential's own test said.
    await user.type(
      within(screen.getByRole('region', { name: 'Credential' })).getByLabelText('Password'),
      CANARY,
    );
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    expect(await screen.findByText('Connected.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retire' }));
    await user.click(await screen.findByRole('button', { name: 'Reinstate' }));
    await screen.findByRole('button', { name: 'Retire' });
    expect(screen.queryByText('Connected.')).toBeNull();
  });

  it('saves a version, and says so when somebody else saved one first', async () => {
    const user = userEvent.setup();
    let stale = false;
    const current = view({
      settings: settings({ description: 'Moved to the new server.' }),
      version: {
        id: SECOND,
        number: '0.2',
        author: 'grace',
        createdAt: '2026-09-30T11:00:00.000Z',
        note: null,
      },
    });
    const { client, asked } = service({
      version: () =>
        stale
          ? json(409, {
              code: 'version_precondition',
              message: 'This connection has a newer version than the one this page opened.',
              traceId: 't',
              current,
            })
          : undefined!,
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    const saving = await screen.findByRole('region', { name: 'Settings' });
    const host = within(saving).getByLabelText('Host');
    await user.clear(host);
    await user.type(host, 'db2.example.test');
    await user.click(within(saving).getByRole('button', { name: 'Save version' }));
    await waitFor(() => expect(screen.getByText(/Version 0\.2/)).toBeInTheDocument());
    expect(asked.find((each) => each.path.endsWith('/versions'))?.body).toMatchObject({
      openedFrom: FIRST,
      settings: { source: { host: 'db2.example.test' } },
    });

    stale = true;
    await user.type(within(saving).getByLabelText('Description'), ' Again.');
    await user.click(within(saving).getByRole('button', { name: 'Save version' }));
    expect(
      await screen.findByText(
        'Somebody saved a newer version of this connection. It is shown now; make your change again.',
      ),
    ).toBeInTheDocument();
    expect(within(saving).getByLabelText('Description')).toHaveValue('Moved to the new server.');
  });

  it('keeps a change typed into the settings while the connection is tested', async () => {
    const user = userEvent.setup();
    const { client } = service({
      connection: view({
        credential: {
          set: true,
          setBy: { id: 'ada', name: 'Ada' },
          setAt: '2026-09-30T09:00:00Z',
          targetChanged: false,
        },
      }),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    const saving = await screen.findByRole('region', { name: 'Settings' });
    await user.type(within(saving).getByLabelText('Description'), ' Unsaved.');
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText('Connected.')).toBeInTheDocument();
    expect(within(saving).getByLabelText('Description')).toHaveValue(
      'The sites and their readings. Unsaved.',
    );
  });

  it('retires a connection and reinstates it, each a version', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<ConnectionPage client={client} id={READINGS} />);
    await user.click(await screen.findByRole('button', { name: 'Retire' }));
    expect(await screen.findByRole('button', { name: 'Reinstate' })).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
    // A retired connection runs nothing, so nothing offers to run it.
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reinstate' }));
    expect(await screen.findByRole('button', { name: 'Retire' })).toBeInTheDocument();
    const versions = asked.filter((each) => each.path.endsWith('/versions'));
    expect(
      versions.map((each) => (each.body as { settings: { retired: boolean } }).settings.retired),
    ).toEqual([true, false]);
  });

  it('heads a connection with a trail back to the connections and its facts as chips, and sets what uses it beside its parts', async () => {
    const { client } = service({
      uses: () =>
        json(200, {
          definitions: { readable: [], others: 0 },
          documents: { readable: [], others: 0 },
        }),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    const trail = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(trail).getByRole('link', { name: 'Connections' })).toHaveAttribute(
      'href',
      '#/connections',
    );
    const beside = screen.getByRole('complementary', { name: 'Beside the connection' });
    expect(await within(beside).findByRole('region', { name: 'Used by' })).toBeInTheDocument();
    expect(screen.getByText(/^Version /, { selector: '[data-tone]' })).toBeInTheDocument();
  });

  it('says which query definitions use a connection, and why retiring it was refused', async () => {
    const user = userEvent.setup();
    const naming = {
      readable: [
        { id: '88888888-8888-4888-8888-888888888888', title: 'Site by id', retired: false },
      ],
      others: 2,
    };
    const { client } = service({
      version: (body) =>
        body.settings.retired
          ? json(409, {
              code: 'connection_in_use',
              message: 'This connection is used by a query definition that is not retired.',
              definitions: naming,
            })
          : undefined,
      uses: () => json(200, { definitions: naming, documents: { readable: [], others: 0 } }),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    const used = await screen.findByRole('region', { name: 'Used by' });
    expect(await within(used).findByRole('link', { name: 'Site by id' })).toHaveAttribute(
      'href',
      '#/query-definitions/88888888-8888-4888-8888-888888888888',
    );
    expect(within(used).getByText('And 2 more you may not read.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retire' }));
    const retiring = screen.getByRole('region', { name: 'Retiring' });
    expect(
      await within(retiring).findByText(
        'This connection is used by a query definition that is not retired.',
      ),
    ).toBeInTheDocument();
    expect(
      within(retiring).getByText('Retire these first: Site by id, and 2 more you may not read.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retire' })).toBeInTheDocument();
  });

  it('DAT-064 shows the documents holding results from a connection beside its definitions, above Retire', async () => {
    const { client } = service({
      uses: () =>
        json(200, {
          definitions: {
            readable: [
              { id: '88888888-8888-4888-8888-888888888888', title: 'Site by id', retired: false },
            ],
            others: 0,
          },
          documents: {
            readable: [{ id: '99999999-9999-4999-8999-999999999999', title: 'Harbour report' }],
            others: 3,
          },
        }),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    const used = await screen.findByRole('region', { name: 'Used by' });
    const documents = await within(used).findByRole('heading', { name: 'Documents' });
    expect(within(used).getByRole('heading', { name: 'Query definitions' })).toBeInTheDocument();
    expect(within(used).getByRole('link', { name: 'Harbour report' })).toHaveAttribute(
      'href',
      '#/documents/99999999-9999-4999-8999-999999999999',
    );
    expect(within(used).getByText('And 3 more you may not read.')).toBeInTheDocument();
    // Shown before Retire, so what retiring leaves is seen before it is asked for.
    const retire = screen.getByRole('button', { name: 'Retire' });
    expect(
      documents.compareDocumentPosition(retire) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('counts the documents holding results from a connection that the person may not read, never naming them', async () => {
    const { client } = service({
      uses: () =>
        json(200, {
          definitions: { readable: [], others: 0 },
          documents: { readable: [], others: 1 },
        }),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    const used = await screen.findByRole('region', { name: 'Used by' });
    expect(
      await within(used).findByText('Held by 1 document you may not read.'),
    ).toBeInTheDocument();
    expect(within(used).queryByRole('link')).toBeNull();
  });

  it('keeps a change typed into the settings, unsaved, across Retire and Reinstate', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<ConnectionPage client={client} id={READINGS} />);
    const saving = await screen.findByRole('region', { name: 'Settings' });
    await user.type(within(saving).getByLabelText('Description'), ' Unsaved.');
    await user.click(screen.getByRole('button', { name: 'Retire' }));
    await screen.findByRole('button', { name: 'Reinstate' });
    expect(within(saving).getByLabelText('Description')).toHaveValue(
      'The sites and their readings. Unsaved.',
    );
    await user.click(screen.getByRole('button', { name: 'Reinstate' }));
    await screen.findByRole('button', { name: 'Retire' });
    expect(within(saving).getByLabelText('Description')).toHaveValue(
      'The sites and their readings. Unsaved.',
    );
    // Retiring saved the version as it was, never the unsaved change.
    const versions = asked.filter((each) => each.path.endsWith('/versions'));
    for (const each of versions) {
      expect((each.body as { settings: { description: string } }).settings.description).toBe(
        'The sites and their readings.',
      );
    }
  });

  it("lists the source's tables and views, and says so when no connector is configured", async () => {
    const user = userEvent.setup();
    const unavailable = () =>
      json(503, {
        code: 'connector_unavailable',
        attribution: 'product',
        message: 'No connector is available to reach the source. Try again later.',
        traceId: 't',
      });
    let none = false;
    const { client } = service({
      connection: view({
        credential: {
          set: true,
          setBy: { id: 'ada', name: 'Ada' },
          setAt: '2026-09-30T09:00:00Z',
          targetChanged: false,
        },
      }),
      describe: () => (none ? unavailable() : undefined!),
      test: () => (none ? unavailable() : undefined!),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    await user.click(await screen.findByRole('button', { name: 'List tables' }));
    const tables = await screen.findByRole('table', { name: 'Tables and views' });
    expect(within(tables).getByText('sample.site')).toBeInTheDocument();
    expect(within(tables).getByText('id, name')).toBeInTheDocument();
    expect(within(tables).getByText('sample.site_summary')).toBeInTheDocument();

    none = true;
    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(
      await screen.findAllByText('No connector is available to reach the source. Try again later.'),
    ).not.toHaveLength(0);
  });

  it('says a pass made with an earlier credential is no test of the one set now', async () => {
    const { client } = service({
      connection: view({
        credential: {
          set: true,
          setBy: { id: 'ada', name: 'Ada' },
          setAt: '2026-09-30T10:00:00Z',
          targetChanged: false,
        },
        lastTest: {
          outcome: 'ok',
          findings: [],
          at: '2026-09-30T10:30:00.000Z',
          by: { id: 'ada', name: 'Ada' },
          version: FIRST,
          credentialCurrent: false,
        },
      }),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    const testing = await screen.findByRole('region', { name: 'Test' });
    expect(
      within(testing).getByText(
        'Not tested since the credential was set. The last test, with an earlier credential, was on 30 September 2026 by Ada.',
      ),
    ).toBeInTheDocument();
    expect(within(testing).queryByText(/connected/i)).toBeNull();
  });

  it('says when the list of tables was cut short, and how many tables and columns were left out', async () => {
    const user = userEvent.setup();
    const { client } = service({
      connection: view({
        credential: {
          set: true,
          setBy: { id: 'ada', name: 'Ada' },
          setAt: '2026-09-30T09:00:00Z',
          targetChanged: false,
        },
      }),
      describe: () =>
        json(200, {
          relations: [
            {
              schema: 'sample',
              name: 'site',
              kind: 'table',
              columns: [{ name: 'id', sourceType: 'int4', nullable: false, proposed: null }],
            },
          ],
          truncated: true,
          leftOut: { relations: 2, columns: 1 },
        }),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    await user.click(await screen.findByRole('button', { name: 'List tables' }));
    await screen.findByRole('table', { name: 'Tables and views' });
    expect(
      screen.getByText(
        'The list was cut short: the source has more tables and views than the connector lists at once.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Left out because their names or types cannot be shown here: 2 tables or views, and 1 column.',
      ),
    ).toBeInTheDocument();
  });

  it('offers a reader none of what changes or uses a connection', async () => {
    const { client } = service({ connection: view({ mayAdminister: false, mayUse: false }) });
    render(<ConnectionPage client={client} id={READINGS} />);
    expect(await screen.findByRole('heading', { name: 'Readings', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('source-postgres')).toBeInTheDocument();
    for (const name of ['Save version', 'Set', 'Test', 'List tables', 'Retire']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByLabelText('Password')).toBeNull();
  });
});

describe('a connection that runs as each person (the D7 plan, D7.3)', () => {
  const asserted = (attribute: 'email' | 'subject') => ({
    kind: 'endUser',
    mechanism: 'asserted',
    attribute,
  });

  it('declares on its page that it runs as each person, by email or by subject, and saves that as a version', async () => {
    const user = userEvent.setup();
    const { client, asked } = service();
    render(<ConnectionPage client={client} id={READINGS} />);
    const saving = await screen.findByRole('region', { name: 'Settings' });
    const runsAs = within(saving).getByLabelText('Runs as');
    expect(runsAs).toHaveValue('service');
    await user.selectOptions(runsAs, 'email');
    expect(
      within(saving).getByText(/Each person's role at the source is named by this/),
    ).toBeInTheDocument();
    await user.click(within(saving).getByRole('button', { name: 'Save version' }));
    await waitFor(() =>
      expect(asked.find((each) => each.path.endsWith('/versions'))?.body).toMatchObject({
        settings: { identity: asserted('email') },
      }),
    );

    await user.selectOptions(within(saving).getByLabelText('Runs as'), 'subject');
    await user.click(within(saving).getByRole('button', { name: 'Save version' }));
    await waitFor(() =>
      expect(asked.filter((each) => each.path.endsWith('/versions')).at(-1)?.body).toMatchObject({
        settings: { identity: asserted('subject') },
      }),
    );
  });

  it('says to a reader whom the connection runs as', async () => {
    const { client } = service({
      connection: view({
        mayAdminister: false,
        settings: settings({ identity: asserted('subject') }),
      }),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    const shown = await screen.findByRole('region', { name: 'Settings' });
    expect(shown).toHaveTextContent(
      "Runs asEach person, by their identifier at the organisation's sign-in",
    );
  });

  it("words the account check's findings, and a person's unsafe role, for the source's administrator", async () => {
    const user = userEvent.setup();
    const { client } = service({
      connection: view({
        settings: settings({ identity: asserted('email') }),
        credential: {
          set: true,
          setBy: { id: 'ada', name: 'Ada' },
          setAt: '2026-09-30T09:00:00Z',
          targetChanged: false,
        },
      }),
      test: () =>
        json(200, {
          outcome: 'ok',
          findings: ['account_holds_privilege'],
          at: '2026-09-30T10:00:00.000Z',
        }),
      describe: () =>
        json(409, {
          code: 'identity_role_unsafe',
          attribution: 'connector',
          message:
            "Your role at the source can sign in, create objects or owns objects of its own, so nothing runs as you on it. Ask the source's administrator.",
          traceId: 't',
        }),
    });
    render(<ConnectionPage client={client} id={READINGS} />);
    await user.click(await screen.findByRole('button', { name: 'Test' }));
    expect(
      await screen.findByText(
        "This account can read data, create objects, or owns functions, procedures or views of its own, so nothing runs as each person until the source's administrator removes those privileges.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'List tables' }));
    expect(
      await screen.findByText(/Your role at the source can sign in, create objects/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "For the source's administrator: each person's role must be NOLOGIN, create in no schema or database, and own nothing.",
      ),
    ).toBeInTheDocument();
  });
});
