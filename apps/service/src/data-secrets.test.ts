import { Writable } from 'node:stream';
import {
  bootstrapCluster,
  createRole,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import type { ConnectionSettings } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { FAKE_CONNECTOR_KEY, fakeConnector } from './test/fake-connector.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
/** A canary whose three spellings differ: raw, URL-encoded and base64. */
const CANARY = 'Ada canary/pass+word=42&x?';
const SPELLINGS = [
  CANARY,
  encodeURIComponent(CANARY),
  Buffer.from(CANARY, 'utf8').toString('base64'),
  Buffer.from(CANARY, 'utf8').toString('base64url'),
];

const settings: ConnectionSettings = {
  schemaVersion: 1,
  name: 'Readings',
  description: '',
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
};

describe("the service's handling of a credential", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let cookie = '';
  let connection = '';
  const lines: string[] = [];
  const connector = fakeConnector();

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
        },
      ],
    });
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureStandIn(db.adminUrl, tenant, { issuer: idp.issuer, clientId: 'alloy' });
    tenantDb = createTenantDatabase(db.serviceUrl);
    // Every line the service writes, at its most talkative.
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    app = buildApp({
      db: tenantDb,
      logLevel: 'trace',
      logStream,
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
      connector: {
        url: 'http://connector.test:8090',
        key: FAKE_CONNECTOR_KEY,
        fetch: connector.fetch,
      },
    });
    cookie = await signIn(app, HOST, 'ada', idp.issuer);
    const ada = (await app.inject({ url: '/v1/me', headers: { host: HOST, cookie } })).json<{
      id: string;
    }>().id;
    await tenantDb.withTenant(tenant, async (trx) => {
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const made = await createRole(trx, 'Connection user', ['read', 'use_connection']);
      if (!('role' in made)) throw new Error(made.refused);
      const administrator = await findRole(trx, 'Administrator');
      for (const role of [administrator!.id, made.role.id]) {
        await grant(trx, {
          roleId: role,
          subject: { principal: ada },
          level: { kind: 'space', id: general.id },
          effect: 'allow',
          grantedBy: ada,
        });
      }
    });
    const general = (
      await app.inject({ url: '/v1/spaces', headers: { host: HOST, cookie } })
    ).json<{ items: { id: string; name: string }[] }>().items[0]!.id;
    const created = await app.inject({
      method: 'POST',
      url: `/v1/spaces/${general}/connections`,
      headers: { host: HOST, cookie },
      payload: { settings },
    });
    connection = created.json<{ id: string }>().id;
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('DAT-005 keeps a credential out of every response, log line, error and idempotency record of the service', async () => {
    const responses: string[] = [];
    const put = async (payload: string, headers: Record<string, string> = {}): Promise<number> => {
      const answer = await app.inject({
        method: 'PUT',
        url: `/v1/connections/${connection}/credential`,
        headers: { host: HOST, cookie, 'content-type': 'application/json', ...headers },
        payload,
      });
      responses.push(JSON.stringify(answer.headers), answer.body);
      return answer.statusCode;
    };
    const secret = (value: string) => JSON.stringify({ secret: value });

    // Set, with an idempotency key the route does not take, and answered by a test that passed.
    connector.mode = 'answer';
    connector.test = { outcome: 'ok', findings: [] };
    expect(await put(secret(CANARY), { 'idempotency-key': 'the-canary-key' })).toBe(200);
    // Set again, and the test after it fails.
    connector.test = {
      outcome: 'failed',
      failure: { code: 'connection_failed', attribution: 'connector' },
    };
    expect(await put(secret(CANARY))).toBe(200);
    // The connector unreachable when it is asked to seal, full, broken, and talking nonsense.
    for (const mode of ['unreachable', 'busy', 'broken', 'nonsense'] as const) {
      connector.mode = mode;
      expect(await put(secret(CANARY)), mode).toBe(503);
    }
    connector.mode = 'answer';
    // A body the contract refuses: too long, holding U+0000, and not JSON at all.
    expect(await put(secret(`${CANARY}${'x'.repeat(5000)}`))).toBe(400);
    expect(await put(secret(`${CANARY}\u0000`))).toBe(400);
    expect(await put(`{"secret": "${CANARY}`)).toBe(400);
    // A member the contract does not name, beside it.
    expect(await put(JSON.stringify({ secret: CANARY, password: CANARY }))).toBe(400);

    // What the service answered, what it logged, and what it stored anywhere in the environment.
    const stored = await queryAs(
      db.adminUrl,
      `select table_name from information_schema.tables where table_schema = $1`,
      [tenant.schema],
    );
    const rows: string[] = [];
    for (const { table_name: table } of stored.rows as { table_name: string }[]) {
      const dumped = await queryAs(
        db.adminUrl,
        `select t::text as row from ${tenant.schema}.${table} t`,
      );
      rows.push(...(dumped.rows as { row: string }[]).map((each) => `${table} ${each.row}`));
    }
    const records = await queryAs(
      db.adminUrl,
      `select operation from ${tenant.schema}.idempotency_record`,
    );
    // No record of the credential's request at all: a record keeps a digest of its body (D1-S).
    expect(records.rows).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
    for (const spelling of SPELLINGS) {
      for (const text of [...responses, ...lines, ...rows]) {
        expect(text.includes(spelling), `${spelling} in ${text.slice(0, 200)}`).toBe(false);
      }
    }
    // It did reach the connector, which is the one place it is meant to go.
    expect(JSON.stringify(connector.asked)).toContain(JSON.stringify(CANARY));
  });
});
