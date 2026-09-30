import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE, signIn, untilReady } from './session.js';

/**
 * A query definition through the whole system (the D2 plan, task 6): written against the development
 * source by the service, described and sampled by the connector on its own networks, and saved. Ada
 * administers the development environment and may use connections and write SQL in General by the
 * development role `pnpm dev:setup` gives her (D2-T). The accounts and their invented passwords are
 * the seed's (deploy/sources/postgres.sql).
 */
const READER = { account: 'reader', password: 'source-reader-dev-password' };
const WRITER = { account: 'writer', password: 'source-writer-dev-password' };

type Json = Record<string, unknown>;

/** A site's depth in the unit asked for, from a first id on: a value and a fragment. */
const definition = (connection: string) => ({
  schemaVersion: 1,
  title: `Site depths ${Date.now()}`,
  description: 'Each site from an id on, its depth in metres or feet.',
  connection,
  parameters: [
    { name: 'from', type: { base: 'integer' }, required: true, list: false },
    {
      name: 'unit',
      type: { base: 'text' },
      required: true,
      list: false,
      variation: [
        { key: 'metres', sql: 'depth' },
        { key: 'feet', sql: 'round(depth * 3.28084, 2)' },
      ],
    },
  ],
  fetch: {
    kind: 'sql',
    text: 'select id, name, {{#unit}} as depth from sample.site where id >= {{from}} order by id',
  },
  columns: [
    { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
    { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
    {
      name: 'depth',
      from: { column: 'depth' },
      type: { base: 'decimal', precision: 12, scale: 2 },
    },
  ],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'invalid',
  limits: { rows: 1000, bytes: 1_048_576, seconds: 30 },
  retired: false,
});

/** The draft a sample runs: the definition less its title, description and retired. */
const draftOf = (whole: Json) => {
  const draft: Json = { ...whole };
  delete draft.title;
  delete draft.description;
  delete draft.retired;
  return draft;
};

describe('a query definition over the whole system', () => {
  let cookie = '';
  let general = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVICE}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Json };
  };

  /** A connection to the development source as `account`, its password set and so tested. */
  const connect = async (account: { account: string; password: string }, name: string) => {
    const made = await call('POST', `/v1/spaces/${general}/connections`, {
      settings: {
        schemaVersion: 1,
        name,
        description: 'The development source.',
        type: 'postgres',
        source: {
          host: 'source-postgres',
          port: 5432,
          database: 'readings',
          account: account.account,
          tls: 'require',
        },
        identity: { kind: 'service' },
        retired: false,
      },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const id = made.body['id'] as string;
    const set = await call('PUT', `/v1/connections/${id}/credential`, {
      secret: account.password,
    });
    expect(set.body, JSON.stringify(set.body)).toMatchObject({ test: { outcome: 'ok' } });
    return { id, test: set.body['test'] as Json };
  };

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn('ada');
    const spaces = await call('GET', '/v1/spaces');
    general = (spaces.body['items'] as { id: string; name: string }[]).find(
      (space) => space.name === 'General',
    )!.id;
  }, 180_000);

  it('runs a definition against a real source through the connector, over the whole system', async () => {
    const { id: reader, test } = await connect(READER, `Readings for SQL ${Date.now()}`);
    expect(test).toMatchObject({ outcome: 'ok', findings: [] });
    const whole = definition(reader);

    // Described by the source without running it: each column with its type proposed.
    const described = await call('POST', `/v1/connections/${reader}/describe`, {
      sql: { text: whole.fetch.text, parameters: whole.parameters },
    });
    expect(described.status, JSON.stringify(described.body)).toBe(200);
    expect(described.body).toMatchObject({
      columns: [
        { name: 'id', proposed: { base: 'integer' } },
        { name: 'name', proposed: { base: 'text' } },
        { name: 'depth', proposed: { base: 'decimal', precision: 8, scale: 2 } },
      ],
    });

    // Sampled with a value and a fragment: the rows, their checksum, and the SQL that ran, in which
    // the value is a bound parameter and the fragment stands where its marker did, never its key.
    const sampled = await call('POST', `/v1/connections/${reader}/sample`, {
      definition: draftOf(whole),
      values: { from: '1', unit: 'feet' },
    });
    expect(sampled.status, JSON.stringify(sampled.body)).toBe(200);
    expect(sampled.body, JSON.stringify(sampled.body)).toMatchObject({ outcome: 'ok' });
    expect(sampled.body['checksum']).toMatch(/^[0-9a-f]{64}$/);
    expect(sampled.body['rowCount']).toBeGreaterThan(0);
    const rows = sampled.body['rows'] as (string | null)[][];
    expect(rows[0]![0]).toBe('1');
    const ran = (sampled.body['ran'] as { sql: string }).sql;
    expect(ran).toContain('round(depth * 3.28084, 2)');
    expect(ran).toContain('$1::int8');
    expect(ran).not.toContain('feet');

    // The same run again reads to the same checksum.
    const again = await call('POST', `/v1/connections/${reader}/sample`, {
      definition: draftOf(whole),
      values: { from: '1', unit: 'feet' },
    });
    expect(again.body['checksum']).toBe(sampled.body['checksum']);

    // A value that fails its declaration is refused by name before anything runs.
    const refused = await call('POST', `/v1/connections/${reader}/sample`, {
      definition: draftOf(whole),
      values: { from: 'one', unit: 'feet' },
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      code: 'parameter_invalid',
      problems: [{ parameter: 'from', rule: 'type', value: 'one' }],
    });

    // Saved, and read back with its connection.
    const saved = await call('POST', `/v1/spaces/${general}/query-definitions`, {
      definition: whole,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({
      version: { number: '0.1' },
      connection: { id: reader, retired: false },
      mayEdit: true,
      mayRun: true,
    });
    const read = await call('GET', `/v1/query-definitions/${saved.body['id'] as string}`);
    expect(read.body).toMatchObject({ definition: { title: whole.title } });
    const uses = await call('GET', `/v1/connections/${reader}/uses`);
    expect(uses.body).toMatchObject({
      definitions: { readable: [{ id: saved.body['id'], retired: false }] },
    });
  }, 120_000);

  it('DAT-103 refuses SQL on a connection whose account can write at the source, over the whole system', async () => {
    const { id: writer, test } = await connect(WRITER, `Readings as writer ${Date.now()}`);
    // The test found the account able to write.
    expect(test).toMatchObject({ outcome: 'ok', findings: ['account_not_read_only'] });
    const whole = definition(writer);
    for (const [what, answer] of [
      [
        'save',
        await call('POST', `/v1/spaces/${general}/query-definitions`, { definition: whole }),
      ],
      [
        'sample',
        await call('POST', `/v1/connections/${writer}/sample`, {
          definition: draftOf(whole),
          values: { from: '1', unit: 'metres' },
        }),
      ],
      [
        'describe',
        await call('POST', `/v1/connections/${writer}/describe`, {
          sql: { text: whole.fetch.text, parameters: whole.parameters },
        }),
      ],
    ] as const) {
      expect(answer.status, what).toBe(409);
      expect(answer.body, what).toMatchObject({
        code: 'sql_not_permitted',
        reason: 'not_read_only',
        attribution: 'product',
      });
    }
  }, 120_000);
});
