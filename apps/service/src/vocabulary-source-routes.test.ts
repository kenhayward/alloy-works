import { createHash } from 'node:crypto';
import {
  bootstrapCluster,
  createRole,
  createTenant,
  findRole,
  grant,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import {
  canonicalResultBytes,
  DEFINITION_SCHEMA_VERSION,
  type PostgresSettings,
} from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { FAKE_CONNECTOR_KEY, fakeConnector } from './test/fake-connector.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
type Json = Record<string, unknown>;

interface RefreshBody {
  answer: string;
  vocabulary: {
    version: { number: string };
    vocabulary: { values: { id: string; state: string; source?: string; labels: Json[] }[] };
  };
  report: Json;
}

const settings: PostgresSettings = {
  schemaVersion: 1,
  name: 'Sites',
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

/** The query a vocabulary takes its sites from: an id, a label and a description, no parameter. */
const sitesQuery = (connection: string) => ({
  schemaVersion: 1,
  title: 'Sites',
  description: 'Every site.',
  connection,
  parameters: [],
  fetch: { kind: 'sql', text: 'select code as id, name as label, note as description from site' },
  columns: [
    { name: 'id', from: { column: 'id' }, type: { base: 'text' } },
    { name: 'label', from: { column: 'label' }, type: { base: 'text' } },
    { name: 'description', from: { column: 'description' }, type: { base: 'text' } },
  ],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'valid',
  limits: { rows: 1000, bytes: 1_048_576, seconds: 30 },
  retired: false,
});

const ranOk = (rows: (string | null)[][]) => {
  const result = {
    columns: [
      ['id', 'text'],
      ['label', 'text'],
      ['description', 'text'],
    ] as [string, 'text'][],
    rows,
  };
  return {
    outcome: 'ok' as const,
    result,
    checksum: createHash('sha256').update(canonicalResultBytes(result), 'utf8').digest('hex'),
    rowCount: rows.length,
    ran: { sql: 'select code as id, name as label, note as description from site' },
    durationMs: 9,
  };
};

const TURTLE = `@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix ex: <https://terms.example/route/> .
ex:scheme a skos:ConceptScheme ; skos:prefLabel "Routes"@en .
ex:oral a skos:Concept ; skos:inScheme ex:scheme ; skos:notation "oral" ;
  skos:prefLabel "Oral"@en , "Orale"@fr ; skos:definition "By mouth"@en .
ex:IV-1 a skos:Concept ; skos:inScheme ex:scheme ; skos:prefLabel "Intravenous"@en .
ex:none a skos:Concept ; skos:prefLabel "Ohne"@de .
`;

describe('a vocabulary refreshed from its source (the VO plan, VO-J)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let general: string;
  const connector = fakeConnector();
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (as: string, method: 'GET' | 'POST' | 'PUT', url: string, payload?: Json) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[as]! },
      ...(payload ? { payload } : {}),
    });
  const allow = (principal: string, role: string, level: Json) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const answer = await grant(trx, {
        roleId: role,
        subject: { principal },
        level: level as never,
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      if ('refused' in answer) throw new Error(answer.refused);
    });
  const vocabulary = async (source?: Json) => {
    const made = await call('ada', 'POST', '/v1/definitions', {
      kind: 'vocabulary',
      definition: {
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        name: `Sites ${Object.keys(ids).length}${Math.random()}`,
        key: `site_${Math.floor(Math.random() * 1e9)}`,
        base: 'en',
        order: 'declared',
        ...(source ? { source } : {}),
        values: [],
      },
    });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ id: string }>().id;
  };
  const refresh = (as: string, id: string) => call(as, 'POST', `/v1/vocabularies/${id}/refresh`);

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
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
      connector: {
        url: 'http://connector.test:8090',
        key: FAKE_CONNECTOR_KEY,
        fetch: connector.fetch,
        waitMs: 300,
      },
    });
    for (const user of ['ada', 'grace']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    const roles: Record<string, string> = {};
    await tenantDb.withTenant(tenant, async (trx) => {
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      const user = await createRole(trx, 'Connection user', ['read', 'use_connection']);
      if (!('role' in user)) throw new Error(user.refused);
      roles.user = user.role.id;
      const writer = await createRole(trx, 'SQL writer', ['read', 'write_sql']);
      if (!('role' in writer)) throw new Error(writer.refused);
      roles.writer = writer.role.id;
      roles.administrator = (await findRole(trx, 'Administrator'))!.id;
      roles.author = (await findRole(trx, 'Author'))!.id;
      roles.manager = (await findRole(trx, 'Definitions manager'))!.id;
    });
    // Ada administers and uses the connections of General; Grace manages definitions and reads the
    // query, but uses no connection.
    await allow(ids.ada!, roles.administrator!, { kind: 'tenant' });
    await allow(ids.ada!, roles.manager!, { kind: 'tenant' });
    for (const role of [roles.author!, roles.user!, roles.writer!]) {
      await allow(ids.ada!, role, { kind: 'space', id: general });
    }
    await allow(ids.grace!, roles.manager!, { kind: 'tenant' });
    await allow(ids.grace!, roles.author!, { kind: 'space', id: general });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('LIB-058 refreshes a vocabulary from a query definition run as the administrator, recording a version and its run', async () => {
    const made = await call('ada', 'POST', `/v1/spaces/${general}/connections`, { settings });
    expect(made.statusCode, made.body).toBe(200);
    const connection = made.json<{ id: string }>().id;
    connector.test = { outcome: 'ok', findings: [] };
    const set = await call('ada', 'PUT', `/v1/connections/${connection}/credential`, {
      secret: 'an-invented-canary-password',
    });
    expect(set.statusCode, set.body).toBe(200);
    const query = await call('ada', 'POST', `/v1/spaces/${general}/query-definitions`, {
      definition: sitesQuery(connection),
    });
    expect(query.statusCode, query.body).toBe(200);
    const id = await vocabulary({ kind: 'query', query: query.json<{ id: string }>().id });

    connector.run = ranOk([
      ['N-1', 'North', 'The northern site'],
      ['S-1', 'South', null],
      ['', 'Nameless', null],
    ]);
    const first = await refresh('ada', id);
    expect(first.statusCode, first.body).toBe(200);
    const body = first.json<RefreshBody>();
    expect(body.answer).toBe('recorded');
    expect(
      body.vocabulary.vocabulary.values.map((each) => [each.id, each.source, each.state]),
    ).toEqual([
      ['n_1', 'N-1', 'active'],
      ['s_1', 'S-1', 'active'],
    ]);
    expect(body.report).toMatchObject({
      added: ['n_1', 's_1'],
      refused: [{ source: '', reason: 'no identifier' }],
    });
    // Run as Ada, recorded as any run is (DAT-053).
    const runs = await tenantDb.withTenant(tenant, (trx) =>
      trx.selectFrom('query_run').select(['act', 'principal_id']).execute(),
    );
    expect(runs).toContainEqual({ act: 'vocabulary', principal_id: ids.ada });

    // South gone from the source: retired, never removed.
    connector.run = ranOk([['N-1', 'Northern', 'The northern site']]);
    const second = (await refresh('ada', id)).json<RefreshBody>();
    expect(second.vocabulary.vocabulary.values.map((each) => [each.id, each.state])).toEqual([
      ['n_1', 'active'],
      ['s_1', 'retired'],
    ]);
    expect(second.report).toMatchObject({ relabelled: ['n_1'], retired: ['s_1'] });

    // Grace manages definitions but may not use the connection, so the query does not run as her.
    const asked = connector.asked.length;
    expect((await refresh('grace', id)).statusCode).toBe(403);
    expect(connector.asked.length).toBe(asked);
  });

  it('LIB-058 refreshes a vocabulary from a SKOS address the connector fetches, each concept kept by its identity', async () => {
    const url = 'https://terms.example/route.ttl';
    const id = await vocabulary({ kind: 'skos', url });
    connector.vocabularySourceFor = (asked) =>
      asked === url
        ? { type: 'fetched', body: TURTLE, contentType: 'text/turtle' }
        : { type: 'failed', code: 'source_refused' };
    const refreshed = await refresh('ada', id);
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    const body = refreshed.json<RefreshBody>();
    expect(body.vocabulary.vocabulary.values.map((each) => [each.id, each.source])).toEqual([
      ['oral', 'https://terms.example/route/oral'],
      ['iv_1', 'https://terms.example/route/IV-1'],
    ]);
    expect(body.report).toMatchObject({
      refused: [
        { source: 'https://terms.example/route/none', reason: 'no label in the base language, en' },
      ],
    });
    expect(connector.asked.at(-1)).toMatchObject({ path: '/v1/vocabulary-source', body: { url } });

    // Its values are its source's: a label changed by hand is refused.
    const stored = await call('ada', 'GET', `/v1/vocabularies/${id}`);
    const view = stored.json<{ version: { id: string }; vocabulary: Json & { values: Json[] } }>();
    const changed = await call('ada', 'POST', `/v1/definitions/${id}/versions`, {
      openedFrom: view.version.id,
      definition: {
        ...view.vocabulary,
        values: view.vocabulary.values.map((each, n) =>
          n === 0 ? { ...each, labels: [{ language: 'en', text: 'By mouth' }] } : each,
        ),
      },
    });
    expect(changed.statusCode, changed.body).toBe(400);

    // An address that fails is said to, by why.
    connector.vocabularySourceFor = () => ({ type: 'failed', code: 'source_too_large' });
    const failed = await refresh('ada', id);
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toMatchObject({
      code: 'vocabulary_source_failed',
      failure: 'source_too_large',
    });
    connector.vocabularySourceFor = () => ({ type: 'fetched', body: 'not SKOS {' });
    const unreadable = await refresh('ada', id);
    expect(unreadable.statusCode).toBe(422);
    expect(unreadable.json()).toMatchObject({ code: 'vocabulary_source_unreadable' });
  });

  it('refuses to refresh a vocabulary with no source', async () => {
    const id = await vocabulary();
    const answer = await refresh('ada', id);
    expect(answer.statusCode).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'vocabulary_unsourced' });
  });
});
