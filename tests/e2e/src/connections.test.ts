import { beforeAll, describe, expect, it } from 'vitest';
import { SERVICE, signIn, untilReady } from './session.js';

/**
 * A connection to the development source through the whole system: the service, the connector on its
 * own networks, and `source-postgres` in the `sources` profile, whose seed names the two accounts and
 * their invented passwords (deploy/sources/postgres.sql). Ada administers the development environment
 * and may use connections in General by the development role `pnpm dev:setup` gives her.
 */
const READER = { account: 'reader', password: 'source-reader-dev-password' };
const WRITER = { account: 'writer', password: 'source-writer-dev-password' };

type Json = Record<string, unknown>;

describe('a connection over the whole system', () => {
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

  const make = async (account: string, name: string) => {
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
          account,
          tls: 'require',
        },
        identity: { kind: 'service' },
        retired: false,
      },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    return made.body['id'] as string;
  };

  beforeAll(async () => {
    await untilReady();
    cookie = await signIn('ada');
    const spaces = await call('GET', '/v1/spaces');
    general = (spaces.body['items'] as { id: string; name: string }[]).find(
      (space) => space.name === 'General',
    )!.id;
  }, 180_000);

  it('DAT-075 tests a connection to a real source through the connector, over the whole system', async () => {
    const reader = await make(READER.account, `Readings ${Date.now()}`);
    // Setting the credential tests the connection straight after, and it signs in.
    const set = await call('PUT', `/v1/connections/${reader}/credential`, {
      secret: READER.password,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({ credential: { set: true }, test: { outcome: 'ok' } });
    expect(JSON.stringify(set.body)).not.toContain(READER.password);

    const tested = await call('POST', `/v1/connections/${reader}/test`, {});
    expect(tested.body).toMatchObject({ outcome: 'ok', findings: [] });

    const described = await call('POST', `/v1/connections/${reader}/describe`, {});
    expect(described.status, JSON.stringify(described.body)).toBe(200);
    const relations = described.body['relations'] as { schema: string; name: string }[];
    expect(relations.map((each) => `${each.schema}.${each.name}`)).toEqual(
      expect.arrayContaining(['sample.site', 'sample.reading', 'sample.site_summary']),
    );
    expect(relations.map((each) => each.name)).not.toContain('restricted');

    // An account that may write is found so, once it has signed in.
    const writer = await make(WRITER.account, `Readings as writer ${Date.now()}`);
    await call('PUT', `/v1/connections/${writer}/credential`, { secret: WRITER.password });
    expect((await call('POST', `/v1/connections/${writer}/test`, {})).body).toMatchObject({
      outcome: 'ok',
      findings: ['account_not_read_only'],
    });

    // And a wrong password is one reason, naming nothing, no sooner than the connect timeout.
    const wrong = await call('PUT', `/v1/connections/${reader}/credential`, {
      secret: 'not-the-reader-password',
    });
    expect(wrong.body).toMatchObject({ test: { outcome: 'failed' } });
    const started = Date.now();
    const failed = await call('POST', `/v1/connections/${reader}/test`, {});
    const took = Date.now() - started;
    expect(failed.body).toMatchObject({
      outcome: 'failed',
      failure: { code: 'connection_failed', attribution: 'connector' },
    });
    expect(took).toBeGreaterThanOrEqual(4500);
    expect(JSON.stringify(failed.body)).not.toMatch(/source-postgres|5432|not-the-reader/);
  }, 120_000);
});
