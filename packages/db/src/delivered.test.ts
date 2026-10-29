import { randomBytes } from 'node:crypto';
import type { bridge } from '@alloy-works/domain';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeliveredStore, tenantNames, type DeliveredStore } from './delivered.js';

// The throwaway server only (never 5432); the database is made here if it is absent.
const SERVER = new URL(
  process.env.ALLOY_TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5436/postgres',
);
const DATABASE = 'delivered_test';

const urlFor = (user?: { name: string; password: string }): string => {
  const url = new URL(SERVER);
  url.pathname = `/${DATABASE}`;
  if (user) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
};

const PROVENANCE: bridge.TablePlan['columns'] = [
  { name: 'ct_source_sha256', type: 'text' },
  { name: 'ct_source_filename', type: 'text' },
  { name: 'ct_job_id', type: 'text' },
  { name: 'ct_recipe_id', type: 'text' },
  { name: 'ct_recipe_version', type: 'bigint' },
  { name: 'ct_approved_by', type: 'text' },
  { name: 'ct_published_at', type: 'timestamptz' },
  { name: 'ct_row', type: 'bigint' },
];

const provenanceCells = (sha: string, recipe: string, version: number, row: number) => [
  sha,
  'Report.pdf',
  'job-1',
  recipe,
  String(version),
  'Pat',
  '2026-10-29T10:00:00.000Z',
  String(row),
];

const plan = (
  columns: bridge.TablePlan['columns'],
  rows: (string | null)[][],
  name = 'rates_prices',
): bridge.TablePlan => ({ name, columns: [...columns, ...PROVENANCE], rows });

const suffix = randomBytes(4).toString('hex');
const tenants: string[] = [];
const tenant = (label: string): string => {
  const id = `${label}${suffix}`;
  tenants.push(id);
  return id;
};

describe('the delivery store', () => {
  let store: DeliveredStore;
  let admin: pg.Client;

  beforeAll(async () => {
    const bootstrap = new pg.Client({ connectionString: SERVER.toString() });
    await bootstrap.connect();
    try {
      const found = await bootstrap.query('select 1 from pg_database where datname = $1', [
        DATABASE,
      ]);
      if (found.rowCount === 0) await bootstrap.query(`create database ${DATABASE}`);
    } finally {
      await bootstrap.end();
    }
    store = createDeliveredStore(urlFor());
    admin = new pg.Client({ connectionString: urlFor() });
    await admin.connect();
  });

  afterAll(async () => {
    for (const id of tenants) {
      const schema = `t_${id}`;
      await admin.query(`drop schema if exists "${schema}" cascade`);
      const role = `${schema}_read`;
      const found = await admin.query('select 1 from pg_roles where rolname = $1', [role]);
      if (found.rowCount === 0) continue;
      // Revokes the grants (connect, schema, default privileges) the role holds.
      await admin.query(`drop owned by "${role}"`);
      await admin.query(`drop role "${role}"`);
    }
    await admin.end();
    await store.close();
  });

  const read = async (access: { account: string; password: string }, text: string) => {
    const client = new pg.Client({
      connectionString: urlFor({ name: access.account, password: access.password }),
    });
    await client.connect();
    try {
      return await client.query(text);
    } finally {
      await client.end();
    }
  };

  it("API-072 a data package becomes rows in a real table read by the tenant's read role", async () => {
    const access = await store.provision(tenant('rows'));
    const columns: bridge.TablePlan['columns'] = [
      { name: 'item', type: 'text' },
      { name: 'price', type: 'numeric' },
      { name: 'qty', type: 'bigint' },
      { name: 'day', type: 'date' },
      { name: 'ok', type: 'boolean' },
    ];
    const result = await store.write(
      access.schema,
      [
        plan(columns, [
          ['a', '1.50', '3', '2026-01-02', 'true', ...provenanceCells('s1', 'rate', 1, 1)],
          ["b'; drop table x; --", null, null, null, null, ...provenanceCells('s1', 'rate', 1, 2)],
        ]),
      ],
      { sha256: 's1', recipeId: 'rate' },
    );
    expect(result).toEqual({ written: [`${access.schema}.rates_prices`] });

    const rows = await read(
      access,
      `select item, price, qty, day::text as day, ok, ct_row, ct_published_at from "${access.schema}"."rates_prices" order by ct_row`,
    );
    expect(rows.rows).toEqual([
      {
        item: 'a',
        price: '1.50',
        qty: '3',
        day: '2026-01-02',
        ok: true,
        ct_row: '1',
        ct_published_at: new Date('2026-10-29T10:00:00.000Z'),
      },
      {
        item: "b'; drop table x; --",
        price: null,
        qty: null,
        day: null,
        ok: null,
        ct_row: '2',
        ct_published_at: new Date('2026-10-29T10:00:00.000Z'),
      },
    ]);
  });

  it("API-072 a later recipe version replaces only that source's rows", async () => {
    const access = await store.provision(tenant('replace'));
    const columns: bridge.TablePlan['columns'] = [{ name: 'item', type: 'text' }];
    const write = (sha: string, version: number, items: string[]) =>
      store.write(
        access.schema,
        [
          plan(
            columns,
            items.map((item, index) => [item, ...provenanceCells(sha, 'rate', version, index + 1)]),
          ),
        ],
        { sha256: sha, recipeId: 'rate' },
      );
    await write('one', 1, ['a1', 'a2']);
    await write('two', 1, ['b1']);
    await write('one', 2, ['a3']);

    const rows = await read(
      access,
      `select item, ct_source_sha256 as sha, ct_recipe_version as version from "${access.schema}"."rates_prices" order by item`,
    );
    expect(rows.rows).toEqual([
      { item: 'a3', sha: 'one', version: '2' },
      { item: 'b1', sha: 'two', version: '1' },
    ]);
  });

  it('a new column is added, a missing one kept null', async () => {
    const access = await store.provision(tenant('cols'));
    await store.write(
      access.schema,
      [
        plan(
          [
            { name: 'a', type: 'text' },
            { name: 'b', type: 'text' },
          ],
          [['x', 'y', ...provenanceCells('s', 'r', 1, 1)]],
        ),
      ],
      { sha256: 's', recipeId: 'r' },
    );
    await store.write(
      access.schema,
      [
        plan(
          [
            { name: 'a', type: 'text' },
            { name: 'c', type: 'numeric' },
          ],
          [['z', '2', ...provenanceCells('t', 'r', 1, 1)]],
        ),
      ],
      { sha256: 't', recipeId: 'r' },
    );
    const rows = await read(
      access,
      `select a, b, c from "${access.schema}"."rates_prices" order by a`,
    );
    expect(rows.rows).toEqual([
      { a: 'x', b: 'y', c: null },
      { a: 'z', b: null, c: '2' },
    ]);
  });

  it('a changed column type is refused, changing nothing', async () => {
    const access = await store.provision(tenant('type'));
    await store.write(
      access.schema,
      [plan([{ name: 'a', type: 'text' }], [['x', ...provenanceCells('s', 'r', 1, 1)]])],
      { sha256: 's', recipeId: 'r' },
    );
    const result = await store.write(
      access.schema,
      [
        plan([{ name: 'a', type: 'text' }], [['y', ...provenanceCells('s', 'r', 2, 1)]], 'other'),
        plan(
          [
            { name: 'a', type: 'numeric' },
            { name: 'extra', type: 'text' },
          ],
          [['1', 'e', ...provenanceCells('s', 'r', 2, 1)]],
        ),
      ],
      { sha256: 's', recipeId: 'r' },
    );
    expect(result).toEqual({ refused: 'type_changed', table: 'rates_prices', column: 'a' });

    const rows = await read(access, `select a from "${access.schema}"."rates_prices"`);
    expect(rows.rows).toEqual([{ a: 'x' }]);
    const columns = await admin.query(
      `select column_name from information_schema.columns where table_schema = $1 and table_name = 'rates_prices'`,
      [access.schema],
    );
    expect(columns.rows.map((row: { column_name: string }) => row.column_name)).not.toContain(
      'extra',
    );
    const other = await admin.query(`select to_regclass($1) as found`, [`${access.schema}.other`]);
    expect(other.rows[0].found).toBeNull();
  });

  it('the read role cannot write', async () => {
    const access = await store.provision(tenant('ro'));
    const stranger = await store.provision(tenant('stranger'));
    await store.write(
      access.schema,
      [plan([{ name: 'a', type: 'text' }], [['x', ...provenanceCells('s', 'r', 1, 1)]])],
      { sha256: 's', recipeId: 'r' },
    );
    await store.write(
      stranger.schema,
      [plan([{ name: 'a', type: 'text' }], [['secret', ...provenanceCells('s', 'r', 1, 1)]])],
      { sha256: 's', recipeId: 'r' },
    );
    const table = `"${access.schema}"."rates_prices"`;
    await expect(read(access, `insert into ${table} (a) values ('y')`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(read(access, `delete from ${table}`)).rejects.toThrow(/permission denied/);
    await expect(read(access, `drop table ${table}`)).rejects.toThrow(/must be owner/);
    await expect(read(access, `create table "${access.schema}"."mine" (a text)`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(read(access, `select a from "${stranger.schema}"."rates_prices"`)).rejects.toThrow(
      /permission denied/,
    );
    // A table written after the grant is readable too (default privileges).
    expect((await read(access, `select a from ${table}`)).rows).toEqual([{ a: 'x' }]);
  });

  it('provisioning twice keeps the schema', async () => {
    const id = tenant('twice');
    const first = await store.provision(id);
    await store.write(
      first.schema,
      [plan([{ name: 'a', type: 'text' }], [['kept', ...provenanceCells('s', 'r', 1, 1)]])],
      { sha256: 's', recipeId: 'r' },
    );
    const second = await store.provision(id);
    const third = await store.provision(id);
    // Two at once for one tenant neither fail nor leave a half-made role.
    await Promise.all([store.provision(id), store.provision(id)]);
    const last = await store.provision(id);
    expect(second.schema).toBe(first.schema);
    expect(second.account).toBe(first.account);
    expect(second.password).not.toBe(first.password);
    expect(third.password).not.toBe(second.password);
    expect(first.password).toMatch(/^[0-9a-f]{48}$/);

    // The schema and its rows survive; the newest password works and the first no longer does.
    const rows = await read(last, `select a from "${first.schema}"."rates_prices"`);
    expect(rows.rows).toEqual([{ a: 'kept' }]);
    await expect(read(third, 'select 1')).rejects.toThrow(/password authentication failed/);
  });

  it('an empty value is null for a non-text column and kept as the empty string in text', async () => {
    const access = await store.provision(tenant('empty'));
    await store.write(
      access.schema,
      [
        plan(
          [
            { name: 't', type: 'text' },
            { name: 'n', type: 'numeric' },
            { name: 'i', type: 'bigint' },
            { name: 'd', type: 'date' },
            { name: 'ts', type: 'timestamptz' },
            { name: 'b', type: 'boolean' },
          ],
          [['', '', '', '', '', '', ...provenanceCells('s', 'r', 1, 1)]],
        ),
      ],
      { sha256: 's', recipeId: 'r' },
    );
    const rows = await read(
      access,
      `select t, n, i, d, ts, b from "${access.schema}"."rates_prices"`,
    );
    expect(rows.rows).toEqual([{ t: '', n: null, i: null, d: null, ts: null, b: null }]);
  });

  it('a value that will not cast is refused with its table, column and row, changing nothing', async () => {
    const access = await store.provision(tenant('invalid'));
    await store.write(
      access.schema,
      [plan([{ name: 'a', type: 'text' }], [['kept', ...provenanceCells('s', 'r', 1, 1)]])],
      { sha256: 's', recipeId: 'r' },
    );
    const result = await store.write(
      access.schema,
      [
        plan([{ name: 'a', type: 'text' }], [['y', ...provenanceCells('s', 'r', 2, 1)]], 'fresh'),
        plan(
          [
            { name: 'a', type: 'text' },
            { name: 'n', type: 'bigint' },
          ],
          [
            ['ok', '1', ...provenanceCells('s', 'r', 2, 1)],
            ['bad', '3.5', ...provenanceCells('s', 'r', 2, 2)],
          ],
        ),
      ],
      { sha256: 's', recipeId: 'r' },
    );
    expect(result).toEqual({
      refused: 'value_invalid',
      table: 'rates_prices',
      column: 'n',
      row: 2,
    });
    const rows = await read(access, `select a from "${access.schema}"."rates_prices"`);
    expect(rows.rows).toEqual([{ a: 'kept' }]);
    const columns = await admin.query(
      `select column_name from information_schema.columns where table_schema = $1 and table_name = 'rates_prices'`,
      [access.schema],
    );
    expect(columns.rows.map((row: { column_name: string }) => row.column_name)).not.toContain('n');
    const fresh = await admin.query(`select to_regclass($1) as found`, [`${access.schema}.fresh`]);
    expect(fresh.rows[0].found).toBeNull();
  });

  it('a read role can still connect once public may not', async () => {
    const access = await store.provision(tenant('connect'));
    await store.provision(tenant('connect2'));
    const rows = await read(access, 'select current_user as me');
    expect(rows.rows).toEqual([{ me: access.account }]);
    const privilege = await admin.query(
      `select has_database_privilege('public', current_database(), 'connect') as open`,
    );
    expect(privilege.rows[0].open).toBe(false);
  });

  it('a zone-less timestamp lands as UTC whatever the server is set to', async () => {
    await admin.query(`alter database ${DATABASE} set timezone = 'America/New_York'`);
    const zoned = createDeliveredStore(urlFor());
    try {
      const access = await zoned.provision(tenant('utc'));
      await zoned.write(
        access.schema,
        [
          plan(
            [{ name: 'ts', type: 'timestamptz' }],
            [['2026-01-02 03:04:05', ...provenanceCells('s', 'r', 1, 1)]],
          ),
        ],
        { sha256: 's', recipeId: 'r' },
      );
      const rows = await read(access, `select ts from "${access.schema}"."rates_prices"`);
      expect(rows.rows[0].ts).toEqual(new Date('2026-01-02T03:04:05.000Z'));
    } finally {
      await zoned.close();
      await admin.query(`alter database ${DATABASE} reset timezone`);
    }
  });

  it('hostile table and column names are quoted, not interpreted', async () => {
    const access = await store.provision(tenant('hostile'));
    const table = 'x"; drop schema ' + access.schema + ' cascade; --';
    const column = 'c"; select 1; --';
    const result = await store.write(
      access.schema,
      [plan([{ name: column, type: 'text' }], [['v', ...provenanceCells('s', 'r', 1, 1)]], table)],
      { sha256: 's', recipeId: 'r' },
    );
    expect(result).toEqual({ written: [`${access.schema}.${table}`] });
    const rows = await read(
      access,
      `select "${column.replaceAll('"', '""')}" as v from "${access.schema}"."${table.replaceAll('"', '""')}"`,
    );
    expect(rows.rows).toEqual([{ v: 'v' }]);
  });

  it('replace keeps the same source rows under another recipe id', async () => {
    const access = await store.provision(tenant('recipes'));
    const write = (recipe: string, item: string) =>
      store.write(
        access.schema,
        [plan([{ name: 'item', type: 'text' }], [[item, ...provenanceCells('s', recipe, 1, 1)]])],
        { sha256: 's', recipeId: recipe },
      );
    await write('one', 'a');
    await write('two', 'b');
    await write('one', 'c');
    const rows = await read(
      access,
      `select item from "${access.schema}"."rates_prices" order by item`,
    );
    expect(rows.rows).toEqual([{ item: 'b' }, { item: 'c' }]);
  });
});

describe('the names a tenant takes', () => {
  const SAFE = /^t_[a-z0-9_]+$/;

  it('lower-cases and replaces what is not [a-z0-9_], marking the change with a hash', () => {
    for (const id of ['Acme', 'a-b', 'a b']) {
      const { schema, account } = tenantNames(id);
      expect(schema).toMatch(SAFE);
      expect(account).toMatch(SAFE);
      expect(schema).toMatch(/__[0-9a-f]{8}$/);
    }
    expect(tenantNames('acme').schema).toBe('t_acme');
    expect(tenantNames('acme').account).toBe('t_acme_read');
  });

  it('cuts a long id so schema and role stay within 63 bytes', () => {
    const long = tenantNames('a'.repeat(200));
    expect(Buffer.byteLength(long.schema)).toBeLessThanOrEqual(63);
    expect(Buffer.byteLength(long.account)).toBeLessThanOrEqual(63);
    const exactMax = tenantNames('a'.repeat(40));
    expect(Buffer.byteLength(exactMax.account)).toBeLessThanOrEqual(63);
    expect(tenantNames('a'.repeat(200)).schema).not.toBe(tenantNames('a'.repeat(201)).schema);
  });

  it('gives the empty id a defined, safe name', () => {
    expect(tenantNames('').schema).toMatch(/^t___[0-9a-f]{8}$/);
  });

  it('is deterministic, and different odd ids give different names', () => {
    expect(tenantNames('A-b')).toEqual(tenantNames('A-b'));
    const ids = ['A-b', 'a-b', 'a_b', 'a b', 'A B', 'ab', '', '-', '_'];
    expect(new Set(ids.map((id) => tenantNames(id).schema)).size).toBe(ids.length);
    expect(new Set(ids.map((id) => tenantNames(id).account)).size).toBe(ids.length);
  });

  it('no exact id can equal a hashed name', () => {
    const hashed = tenantNames('ABC').schema.slice(2);
    expect(hashed).toContain('__');
    expect(tenantNames(hashed).schema).not.toBe(tenantNames('ABC').schema);
    expect(tenantNames(hashed).schema).toMatch(/__[0-9a-f]{8}$/);
  });
});
