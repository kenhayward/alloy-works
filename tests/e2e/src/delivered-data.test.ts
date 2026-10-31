import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SERVICE, signIn, untilReady } from './session.js';
import { e2eTargets } from './targets.js';

/**
 * Delivered data read the way any source is (docs/design/ct-studio-sink.md, "Data tables"): turning
 * data delivery on for a space provisions the tenant's schema and read account on the stack's
 * `delivered-postgres` and makes the space's connection; an SQL definition sampled through that
 * connection is run by the connector, over TLS, on its own network. The table stands in for one a
 * delivery writes (the worker's suite covers the write), made by the store's owner over `docker exec`,
 * as a delivery's tables are, in the project ALLOY_E2E_COMPOSE_PROJECT names.
 */
const PROJECT = e2eTargets(process.env).composeProject;

type Json = Record<string, unknown>;

/** SQL run in the project's delivery store as its owner, by the socket its pg_hba admits by peer. */
function asOwner(sql: string): string {
  const ids = execFileSync(
    'docker',
    [
      'ps',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${PROJECT}`,
      '--filter',
      'label=com.docker.compose.service=delivered-postgres',
    ],
    { encoding: 'utf8', timeout: 60_000 },
  )
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length !== 1) throw new Error(`${PROJECT} runs ${ids.length} delivery stores`);
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      ids[0]!,
      'gosu',
      'postgres',
      'psql',
      '-d',
      'delivered',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: sql, encoding: 'utf8', timeout: 60_000 },
  ).trim();
}

describe('delivered data through the whole system', () => {
  let cookie = '';
  let table = '';

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVICE}${path}`, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as Json };
  };

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn('ada');
  }, 180_000);

  afterAll(() => {
    if (table !== '') asOwner(`drop table if exists ${table};`);
  });

  it('API-072 an SQL definition reads the delivered tables through the connection data delivery makes', async () => {
    const stamp = Date.now();
    const space = await call('POST', '/v1/spaces', { name: `Delivered ${stamp}` });
    expect(space.status, JSON.stringify(space.body)).toBe(200);
    const on = await call('PUT', `/v1/spaces/${space.body['id'] as string}/bridge-settings`, {
      componentType: null,
      template: null,
      propertyMap: {},
      data: true,
    });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    const connection = on.body['connection'] as string;
    const made = await call('GET', `/v1/connections/${connection}`);
    const account = (made.body['settings'] as { source: { account: string } }).source.account;

    // The tenant's schema, as the read account may use it; a table in it as a delivery makes one.
    const schema = asOwner(
      `select nspname from pg_namespace where nspname like 't\\_%' and has_schema_privilege('${account}', oid, 'usage');`,
    );
    expect(schema).toMatch(/^t_[a-z0-9_]+$/);
    table = `"${schema}".e2e_${stamp}_prices`;
    asOwner(
      `create table ${table} (item text, price numeric, ct_row bigint);
       insert into ${table} values ('Nets', 4.50, 1), ('Jars', 7.50, 2);`,
    );

    // SQL runs only on a connection tested and found read-only (DAT-103), as a person would first.
    const tested = await call('POST', `/v1/connections/${connection}/test`, {});
    expect(tested.body, JSON.stringify(tested.body)).toMatchObject({ outcome: 'ok' });

    const sampled = await call('POST', `/v1/connections/${connection}/sample`, {
      definition: {
        schemaVersion: 1,
        connection,
        parameters: [],
        fetch: { kind: 'sql', text: `select item, price from ${table} order by item` },
        columns: [
          { name: 'item', from: { column: 'item' }, type: { base: 'text' } },
          {
            name: 'price',
            from: { column: 'price' },
            type: { base: 'decimal', precision: 12, scale: 2 },
          },
        ],
        key: ['item'],
        order: [{ column: 'item', direction: 'ascending' }],
        empty: 'invalid',
        limits: { rows: 1000, bytes: 1_048_576, seconds: 30 },
      },
      values: {},
    });
    expect(sampled.status, JSON.stringify(sampled.body)).toBe(200);
    expect(sampled.body, JSON.stringify(sampled.body)).toMatchObject({
      outcome: 'ok',
      rows: [
        ['Jars', '7.5'],
        ['Nets', '4.5'],
      ],
    });
  }, 120_000);
});
