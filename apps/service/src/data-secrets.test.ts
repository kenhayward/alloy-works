import { Writable } from 'node:stream';
import {
  bootstrapCluster,
  createComponent,
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
import { createObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { ranOk } from './test/bindings-harness.js';
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
  let store: TestObjectStore;
  let space = '';
  let adaId = '';
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
    store = await testObjectStore();
    await store.setUp(db.adminUrl, tenant);
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
      objects: createObjectStores(store.settings, store.sealingKey),
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
      const made = await createRole(trx, 'Connection user', [
        'read',
        'use_connection',
        'write_sql',
      ]);
      if (!('role' in made)) throw new Error(made.refused);
      const administrator = await findRole(trx, 'Administrator');
      // And an author there, who may make a definition, a component and a document to bind in (D3).
      const author = await findRole(trx, 'Author');
      for (const role of [administrator!.id, made.role.id, author!.id]) {
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
    space = general;
    adaId = ada;
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await store?.drop();
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
    // A SQL describe and a sample with that credential, each answered, failing, and meeting a
    // connector that cannot answer (D2): the sealed credential goes to the connector, and nothing of
    // the secret comes back.
    const ask = async (path: 'describe' | 'sample', payload: unknown): Promise<number> => {
      const answer = await app.inject({
        method: 'POST',
        url: `/v1/connections/${connection}/${path}`,
        headers: { host: HOST, cookie, 'idempotency-key': 'the-canary-key' },
        payload: payload as Record<string, unknown>,
      });
      responses.push(JSON.stringify(answer.headers), answer.body);
      return answer.statusCode;
    };
    const site = { name: 'site', type: { base: 'integer' }, required: true, list: false };
    const statement = {
      sql: { text: 'select id from sample.site where id = {{site}}', parameters: [site] },
    };
    const draft = {
      schemaVersion: 1,
      connection,
      parameters: [site],
      fetch: { kind: 'sql', text: 'select id from sample.site where id = {{site}} order by id' },
      columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
      key: ['id'],
      order: [{ column: 'id', direction: 'ascending' }],
      empty: 'valid',
      limits: { rows: 100, bytes: 65_536, seconds: 10 },
    };
    connector.describeSql = {
      columns: [{ name: 'id', sourceType: 'integer', proposed: { base: 'integer' } }],
      parameters: ['bigint'],
    };
    connector.run = {
      outcome: 'failed',
      failure: {
        code: 'source_refused',
        attribution: 'query',
        source: { sqlstate: '42501', message: 'permission denied for table site' },
      },
    };
    expect(await ask('describe', statement)).toBe(200);
    expect(await ask('sample', { definition: draft, values: { site: '1' } })).toBe(200);
    connector.describeSql = { failure: { code: 'connection_failed', attribution: 'connector' } };
    expect(await ask('describe', statement)).toBe(502);
    for (const mode of ['unreachable', 'busy', 'broken', 'nonsense'] as const) {
      connector.mode = mode;
      expect(await ask('describe', statement), mode).toBe(503);
      expect(await ask('sample', { definition: draft, values: { site: '1' } }), mode).toBe(503);
    }
    connector.mode = 'answer';
    // A document's binding resolved and checked with that credential (D3), each answered, failing,
    // and meeting a connector that cannot answer: the sealed credential goes to the connector, and
    // nothing of the secret comes back or is kept with what is recorded.
    const as = { host: HOST, cookie };
    const definition = await app.inject({
      method: 'POST',
      url: `/v1/spaces/${space}/query-definitions`,
      headers: as,
      payload: {
        definition: { ...draft, title: 'Sites', description: '', retired: false },
      },
    });
    expect(definition.statusCode, definition.body).toBe(200);
    const made = await tenantDb.withTenant(tenant, (trx) =>
      createComponent(trx, {
        spaceId: space,
        title: 'Sites',
        language: 'en-GB',
        direction: 'ltr',
        author: adaId,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    const component = made.version.artifactId;
    const session = '00000000-0000-4000-8000-0000000000dd';
    for (const [method, url, payload] of [
      ['POST', `/v1/components/${component}/lock`, { session }],
      [
        'PUT',
        `/v1/components/${component}/iterations/${session}/1`,
        {
          openedFrom: made.version.id,
          content: {
            schemaVersion: 1,
            title: 'Sites',
            language: 'en-GB',
            direction: 'ltr',
            content: [
              {
                type: 'paragraph',
                id: 'p1',
                style: 'body',
                content: [
                  {
                    type: 'binding',
                    id: 'b1',
                    query: definition.json<{ id: string }>().id,
                    parameters: { site: { literal: '1' } },
                    mode: 'checked',
                    take: { column: 'id' },
                  },
                ],
              },
            ],
          },
        },
      ],
      [
        'DELETE',
        `/v1/components/${component}/lock?session=${session}&openedFrom=${made.version.id}`,
        undefined,
      ],
    ] as const) {
      const answer = await app.inject({
        method,
        url,
        headers: as,
        ...(payload ? { payload } : {}),
      });
      expect(answer.statusCode, answer.body).toBe(200);
    }
    const document = (
      await app.inject({
        method: 'POST',
        url: `/v1/spaces/${space}/documents`,
        headers: as,
        payload: { title: 'Sites', language: 'en-GB', direction: 'ltr' },
      })
    ).json<{ id: string; version: { id: string } }>();
    const outline = await app.inject({
      method: 'POST',
      url: `/v1/documents/${document.id}/outline`,
      headers: as,
      payload: {
        openedFrom: document.version.id,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'reference', component, mode: { kind: 'latest' } },
        },
      },
    });
    expect(outline.statusCode, outline.body).toBe(200);
    const node = outline.json<{ outline: { nodes: { id: string }[] } }>().outline.nodes[0]!.id;
    const bindingAct = async (act: 'resolve' | 'check'): Promise<number> => {
      const answer = await app.inject({
        method: 'POST',
        url: `/v1/documents/${document.id}/bindings/${act}`,
        headers: { ...as, 'idempotency-key': 'the-canary-key' },
        payload: act === 'resolve' ? { bindings: [{ node, binding: 'b1' }] } : {},
      });
      responses.push(JSON.stringify(answer.headers), answer.body);
      return answer.statusCode;
    };
    const refusedAtTheSource = connector.run;
    connector.run = ranOk([['1', 'North']]);
    expect(await bindingAct('resolve')).toBe(200);
    connector.run = ranOk([['1', 'South']]);
    expect(await bindingAct('check')).toBe(200);
    connector.run = refusedAtTheSource;
    expect(await bindingAct('resolve')).toBe(200);
    expect(await bindingAct('check')).toBe(200);
    for (const mode of ['unreachable', 'busy', 'broken', 'nonsense'] as const) {
      connector.mode = mode;
      expect(await bindingAct('resolve'), mode).toBe(200);
      expect(await bindingAct('check'), mode).toBe(200);
    }
    connector.mode = 'answer';
    // And a value its declaration refuses, named as it was sent.
    expect(await ask('sample', { definition: draft, values: { site: 'x' } })).toBe(400);
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
