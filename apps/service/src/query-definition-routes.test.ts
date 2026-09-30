import { createHash } from 'node:crypto';
import {
  bootstrapCluster,
  createRole,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  setConnectionCredential,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import {
  canonicalResultBytes,
  DEFINITION_MAX_BYTES,
  dataFailureCodes,
  dataFailures,
  limitCeilings,
  type ConnectionSettings,
  type DataFailureCode,
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
const SECRET = 'an-invented-canary-password';

type Json = Record<string, unknown>;

interface DefinitionBody {
  id: string;
  space: { id: string; name: string };
  version: { id: string; number: string };
  definition: Json & { title: string; retired: boolean; connection: string };
  connection: { id: string; name: string; identity: string; retired: boolean } | null;
  mayEdit: boolean;
  mayRun: boolean;
}

const settings = (over: Partial<ConnectionSettings> = {}): ConnectionSettings => ({
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
  ...over,
});

/** A definition as the page writes one: a site's name by its id, ordered by the id. */
const definition = (connection: string, over: Json = {}) => ({
  schemaVersion: 1,
  title: 'Site by id',
  description: 'One site, by its id.',
  connection,
  parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
  fetch: { kind: 'sql', text: 'select id, name from sample.site where id = {{site}} order by id' },
  columns: [
    { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
    { name: 'name', from: { column: 'name' }, type: { base: 'text' } },
  ],
  key: ['id'],
  order: [{ column: 'id', direction: 'ascending' }],
  empty: 'valid',
  limits: { rows: 1000, bytes: 1_048_576, seconds: 30 },
  retired: false,
  ...over,
});

/** The draft a sample runs: the definition less its title, description and retired. */
const draft = (connection: string, over: Json = {}) => {
  const whole: Json = definition(connection, over);
  delete whole.title;
  delete whole.description;
  delete whole.retired;
  return whole;
};

/** A run's answer as the connector gives one, its checksum over the canonical bytes. */
const ranOk = (rows: (string | boolean | null)[][]) => {
  const result = {
    columns: [
      ['id', 'integer'],
      ['name', 'text'],
    ] as [string, 'integer' | 'text'][],
    rows,
  };
  return {
    outcome: 'ok' as const,
    result,
    checksum: createHash('sha256').update(canonicalResultBytes(result), 'utf8').digest('hex'),
    rowCount: rows.length,
    ran: { sql: 'select id, name from sample.site where id = $1::int8 order by id' },
    durationMs: 12,
  };
};

describe('query definitions through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let general: string;
  let quality: string;
  const connector = fakeConnector();
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roles: Record<string, string> = {};

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
  /** A connection Ada makes, with its credential set and its test's answer as `tested` says. */
  const connection = async (
    name: string,
    tested: 'clean' | 'finding' | 'failed' | 'none' = 'clean',
    space = general,
  ) => {
    const made = await call('ada', 'POST', `/v1/spaces/${space}/connections`, {
      settings: settings({ name }),
    });
    if (made.statusCode !== 200) throw new Error(`${made.statusCode} ${made.body}`);
    const { id, version } = made.json<{ id: string; version: { id: string } }>();
    if (tested !== 'none') {
      connector.mode = 'answer';
      connector.test =
        tested === 'failed'
          ? { outcome: 'failed', failure: { code: 'connection_failed', attribution: 'connector' } }
          : { outcome: 'ok', findings: tested === 'finding' ? ['account_not_read_only'] : [] };
      const set = await call('ada', 'PUT', `/v1/connections/${id}/credential`, { secret: SECRET });
      if (set.statusCode !== 200) throw new Error(`${set.statusCode} ${set.body}`);
    }
    return { id, version: version.id };
  };
  const create = (as: string, body: Json, space = general) =>
    call(as, 'POST', `/v1/spaces/${space}/query-definitions`, { definition: body });
  const sample = (as: string, id: string, body: Json, values: Json = { site: '1' }) =>
    call(as, 'POST', `/v1/connections/${id}/sample`, { definition: body, values });
  const describeSql = (as: string, id: string) =>
    call(as, 'POST', `/v1/connections/${id}/describe`, {
      sql: {
        text: 'select id, name from sample.site where id = {{site}}',
        parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
      },
    });
  const runsAsked = () => connector.asked.filter((each) => each.path === '/v1/run').length;

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
      },
    });
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      for (const [name, permissions] of [
        ['Connection user', ['read', 'use_connection']],
        ['SQL writer', ['read', 'write_sql']],
      ] as const) {
        const made = await createRole(trx, name, [...permissions]);
        if (!('role' in made)) throw new Error(made.refused);
        roles[name] = made.role.id;
      }
      roles.Administrator = (await findRole(trx, 'Administrator'))!.id;
      roles.Author = (await findRole(trx, 'Author'))!.id;
    });
    // Ada administers the environment, authors in General, and uses and writes SQL against every
    // connection there.
    // Grace authors in General and uses its connections, but writes no SQL until she is granted it.
    await allow(ids.ada!, roles.Administrator!, { kind: 'tenant' });
    await allow(ids.ada!, roles.Author!, { kind: 'space', id: general });
    await allow(ids.ada!, roles['Connection user']!, { kind: 'space', id: general });
    await allow(ids.ada!, roles['SQL writer']!, { kind: 'space', id: general });
    await allow(ids.grace!, roles.Author!, { kind: 'space', id: general });
    await allow(ids.grace!, roles['Connection user']!, { kind: 'space', id: general });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('DAT-101 lets only a principal holding write_sql on the connection save or run SQL against it, decided at the connection', async () => {
    const granted = await connection('Granted');
    const other = await connection('Other');
    connector.mode = 'answer';
    connector.run = ranOk([['1', 'North']]);
    connector.describeSql = {
      columns: [
        { name: 'id', sourceType: 'integer', proposed: { base: 'integer' } },
        { name: 'name', sourceType: 'text', proposed: { base: 'text' } },
      ],
      parameters: ['bigint'],
    };

    // Grace authors in the space and uses both connections, and writes no SQL against either.
    for (const each of [granted, other]) {
      const refused = await create('grace', definition(each.id));
      expect(refused.statusCode, 'save').toBe(403);
      expect(refused.json<{ message: string }>().message).toContain('write SQL');
      expect((await sample('grace', each.id, draft(each.id))).statusCode, 'sample').toBe(403);
      expect((await describeSql('grace', each.id)).statusCode, 'describe').toBe(403);
    }
    // Listing a connection's tables is using it, which she may: SQL is what she may not write.
    expect(
      (await call('grace', 'POST', `/v1/connections/${granted.id}/describe`, {})).statusCode,
    ).toBe(200);
    expect(runsAsked()).toBe(0);

    // A grant of write_sql on the one connection alone lets her save and run SQL against it.
    await allow(ids.grace!, roles['SQL writer']!, { kind: 'artifact', id: granted.id });
    const made = await create('grace', definition(granted.id));
    expect(made.statusCode).toBe(200);
    const body = made.json<DefinitionBody>();
    expect(body).toMatchObject({
      space: { id: general, name: 'General' },
      version: { number: '0.1' },
      connection: { id: granted.id, name: 'Granted', identity: 'service', retired: false },
      mayEdit: true,
      mayRun: true,
    });
    expect((await sample('grace', granted.id, draft(granted.id))).json()).toMatchObject({
      outcome: 'ok',
    });
    expect((await describeSql('grace', granted.id)).json()).toMatchObject({
      columns: [{ name: 'id' }, { name: 'name' }],
    });

    // And on the other it still does not: neither a new definition, nor moving this one to it.
    expect((await create('grace', definition(other.id))).statusCode).toBe(403);
    expect((await sample('grace', other.id, draft(other.id))).statusCode).toBe(403);
    expect((await describeSql('grace', other.id)).statusCode).toBe(403);
    const moved = await call('grace', 'POST', `/v1/query-definitions/${body.id}/versions`, {
      openedFrom: body.version.id,
      definition: definition(other.id),
    });
    expect(moved.statusCode).toBe(403);

    // Ada holds write_sql on the space's connections, and so reads this one as hers to run too; Alice
    // holds nothing, and the definition is not there for her.
    expect(
      (await call('ada', 'GET', `/v1/query-definitions/${body.id}`)).json<DefinitionBody>(),
    ).toMatchObject({ mayEdit: true, mayRun: true });
    expect((await call('alice', 'GET', `/v1/query-definitions/${body.id}`)).statusCode).toBe(404);
  });

  it('DAT-103 refuses SQL on a connection whose latest test did not find its account read-only', async () => {
    connector.mode = 'answer';
    connector.run = ranOk([['1', 'North']]);
    connector.describeSql = {
      columns: [{ name: 'id', sourceType: 'integer', proposed: { base: 'integer' } }],
      parameters: ['bigint'],
    };
    const refusedEachWay = async (id: string, reason: string, what: string) => {
      const before = runsAsked();
      for (const answer of [
        await create('ada', definition(id)),
        await sample('ada', id, draft(id)),
        await describeSql('ada', id),
      ]) {
        expect(answer.statusCode, `${what} ${answer.body}`).toBe(409);
        expect(answer.json(), what).toMatchObject({
          code: 'sql_not_permitted',
          reason,
          rule: 'DAT-103',
          attribution: 'product',
        });
      }
      expect(runsAsked(), what).toBe(before);
    };

    // Never tested; tested and failed; tested and found writable.
    await refusedEachWay((await connection('Untested', 'none')).id, 'untested', 'untested');
    await refusedEachWay((await connection('Failed', 'failed')).id, 'untested', 'failed');
    await refusedEachWay((await connection('Writable', 'finding')).id, 'not_read_only', 'finding');

    // Tested clean, then a version cut: the test was of an earlier version.
    const moved = await connection('Moved');
    const renamed = await call('ada', 'POST', `/v1/connections/${moved.id}/versions`, {
      openedFrom: moved.version,
      settings: settings({ name: 'Moved again' }),
    });
    expect(renamed.statusCode).toBe(200);
    await refusedEachWay(moved.id, 'untested', 'earlier version');

    // Tested clean, then a credential set with no test of its own: the test was of an earlier one.
    const rotated = await connection('Rotated');
    await tenantDb.withTenant(tenant, async (trx) => {
      const row = await trx
        .selectFrom('connection_credential')
        .select('sealed')
        .where('connection_id', '=', rotated.id)
        .executeTakeFirstOrThrow();
      await setConnectionCredential(trx, {
        id: rotated.id,
        sealed: row.sealed,
        by: ids.ada!,
        sealedFor: settings({ name: 'Rotated' }),
      });
    });
    await refusedEachWay(rotated.id, 'untested', 'earlier credential');

    // A current, clean test of the latest version and credential allows all three.
    const clean = await connection('Clean');
    expect((await create('ada', definition(clean.id))).statusCode).toBe(200);
    expect((await sample('ada', clean.id, draft(clean.id))).json()).toMatchObject({
      outcome: 'ok',
    });
    expect((await describeSql('ada', clean.id)).statusCode).toBe(200);
  });

  it('DAT-020 refuses a sample whose values fail their declaration by name before the connector is asked', async () => {
    const source = await connection('Values');
    connector.mode = 'answer';
    connector.run = ranOk([['1', 'North']]);
    const before = runsAsked();
    const cases: [Json, { parameter: string; rule: string; value: string }][] = [
      [{}, { parameter: 'site', rule: 'required', value: '' }],
      [{ site: '1.5' }, { parameter: 'site', rule: 'type', value: '1.5' }],
      [{ site: ['1'] }, { parameter: 'site', rule: 'list', value: '["1"]' }],
      [
        { site: '99999999999999999999' },
        { parameter: 'site', rule: 'range', value: '99999999999999999999' },
      ],
      [
        { site: '1', depth: '2' },
        { parameter: 'depth', rule: 'type', value: '2' },
      ],
    ];
    for (const [values, problem] of cases) {
      const answer = await sample('ada', source.id, draft(source.id), values);
      expect(answer.statusCode, JSON.stringify(values)).toBe(400);
      expect(answer.json(), JSON.stringify(values)).toMatchObject({
        code: 'parameter_invalid',
        rule: 'DAT-020',
        attribution: 'product',
        problems: [problem],
      });
    }
    expect(runsAsked()).toBe(before);
    // A value that passes is run.
    expect((await sample('ada', source.id, draft(source.id))).json()).toMatchObject({
      outcome: 'ok',
    });
    expect(runsAsked()).toBe(before + 1);
  });

  it("DAT-050 runs a sample under the least of the definition's limits and the tenant's", async () => {
    const source = await connection('Limited');
    connector.mode = 'answer';
    connector.run = ranOk([['1', 'North']]);

    // Anybody signed in reads the tenant's limits, with the ceilings; nothing is lowered yet.
    const unset = await call('grace', 'GET', '/v1/settings/data');
    expect(unset.json()).toEqual({
      rows: null,
      bytes: null,
      seconds: null,
      ceilings: { ...limitCeilings },
    });
    // Only an administrator of the environment lowers them, and never past a ceiling.
    expect((await call('grace', 'PUT', '/v1/settings/data', { rows: 500 })).statusCode).toBe(403);
    expect(
      (await call('ada', 'PUT', '/v1/settings/data', { rows: limitCeilings.rows + 1 })).statusCode,
    ).toBe(400);
    const lowered = await call('ada', 'PUT', '/v1/settings/data', {
      rows: 500,
      bytes: 2_097_152,
      seconds: null,
    });
    expect(lowered.statusCode).toBe(200);
    expect(lowered.json()).toMatchObject({ rows: 500, bytes: 2_097_152, seconds: null });

    // The run takes the least of each: the tenant's rows, the definition's bytes and seconds.
    connector.asked.length = 0;
    expect((await sample('ada', source.id, draft(source.id))).json()).toMatchObject({
      outcome: 'ok',
    });
    const asked = connector.asked.find((each) => each.path === '/v1/run')!.body as Json;
    expect(asked.limits).toEqual({ rows: 500, bytes: 1_048_576, seconds: 30 });
    expect(asked.deadlineMs).toBe(30_000);

    // And the tenant lowering the time below the definition's shortens the deadline with it.
    await call('ada', 'PUT', '/v1/settings/data', { rows: null, bytes: null, seconds: 5 });
    connector.asked.length = 0;
    await sample('ada', source.id, draft(source.id));
    const shorter = connector.asked.find((each) => each.path === '/v1/run')!.body as Json;
    expect(shorter.limits).toEqual({ rows: 1000, bytes: 1_048_576, seconds: 5 });
    expect(shorter.deadlineMs).toBe(5000);
    await call('ada', 'PUT', '/v1/settings/data', { rows: null, bytes: null, seconds: null });
  });

  it("DAT-049 answers a run's failure with its attribution", async () => {
    const source = await connection('Failing runs');
    connector.mode = 'answer';
    // Every failure a run can answer, as a failed outcome naming who it is laid at.
    const runFailures: DataFailureCode[] = [
      'connection_failed',
      'timeout',
      'row_limit',
      'byte_limit',
      'result_mismatch',
      'precision_lost',
      'value_unrepresentable',
      'empty_result',
      'source_refused',
      'connector_error',
    ];
    for (const code of runFailures) {
      connector.run = {
        outcome: 'failed',
        failure: {
          code,
          attribution: dataFailures[code],
          ...(code === 'source_refused'
            ? { source: { sqlstate: '42601', message: 'syntax error at or near "form"' } }
            : {}),
        },
      };
      const answer = await sample('ada', source.id, draft(source.id));
      expect(answer.statusCode, code).toBe(200);
      const body = answer.json<{ outcome: string; failure: Json }>();
      expect(body, code).toMatchObject({
        outcome: 'failed',
        failure: { code, attribution: dataFailures[code] },
      });
      expect(typeof body.failure.message, code).toBe('string');
      expect(dataFailureCodes).toContain(code);
    }
    // What the source said is carried for its author, who holds write_sql to have asked.
    connector.run = {
      outcome: 'failed',
      failure: {
        code: 'source_refused',
        attribution: 'query',
        source: { sqlstate: '22012', message: 'division by zero' },
      },
    };
    expect((await sample('ada', source.id, draft(source.id))).json()).toMatchObject({
      failure: { source: { sqlstate: '22012', message: 'division by zero' } },
    });
    // The product's own: the connector full or unreachable, refused as a test's are.
    connector.mode = 'busy';
    const busy = await sample('ada', source.id, draft(source.id));
    expect(busy.statusCode).toBe(503);
    expect(busy.json()).toMatchObject({ code: 'connector_busy', attribution: 'product' });
    connector.mode = 'answer';
  });

  it("names the row and the column a run's mismatch found, and tells an author to order text by code point", async () => {
    const source = await connection('Mismatched');
    connector.mode = 'answer';
    connector.run = {
      outcome: 'failed',
      failure: { code: 'result_mismatch', attribution: 'query', row: 12 },
    };
    const ordered = await sample('ada', source.id, draft(source.id));
    expect(ordered.json()).toMatchObject({ failure: { code: 'result_mismatch', row: 12 } });
    const message = ordered.json<{ failure: { message: string } }>().failure.message;
    expect(message).toContain('row 12');
    expect(message).toContain('COLLATE "C"');
    connector.run = {
      outcome: 'failed',
      failure: { code: 'result_mismatch', attribution: 'query', column: 'depth' },
    };
    const column = (await sample('ada', source.id, draft(source.id))).json<{
      failure: { message: string; column: string };
    }>();
    expect(column.failure.column).toBe('depth');
    expect(column.failure.message).toContain('depth');
  });

  it('answers a sample with the first hundred rows, the count, the checksum and the SQL that ran, and refuses a checksum that does not match the rows', async () => {
    const source = await connection('Sampled');
    connector.mode = 'answer';
    const rows = Array.from({ length: 150 }, (_, at) => [String(at + 1), `Site ${at + 1}`]);
    connector.run = ranOk(rows);
    const answer = (await sample('ada', source.id, draft(source.id))).json<Json>();
    expect(answer).toMatchObject({
      outcome: 'ok',
      columns: [
        ['id', 'integer'],
        ['name', 'text'],
      ],
      rowCount: 150,
      checksum: connector.run.outcome === 'ok' ? connector.run.checksum : '',
      ran: { sql: 'select id, name from sample.site where id = $1::int8 order by id' },
      durationMs: 12,
    });
    expect((answer.rows as unknown[]).length).toBe(100);
    expect((answer.rows as unknown[])[99]).toEqual(['100', 'Site 100']);

    // The rows as they arrived, their checksum another's: the connector's error, not the author's.
    connector.run = { ...ranOk([['1', 'North']]), checksum: 'f'.repeat(64) };
    expect((await sample('ada', source.id, draft(source.id))).json()).toMatchObject({
      outcome: 'failed',
      failure: { code: 'connector_error', attribution: 'connector' },
    });
    // Nothing a sample ran is stored: no dataset, no version, no record of the request.
    const stored = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select('kind')
        .where('kind', '=', 'queryDefinition')
        .execute(),
    );
    const before = stored.length;
    await sample('ada', source.id, draft(source.id));
    const after = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select('kind')
        .where('kind', '=', 'queryDefinition')
        .execute(),
    );
    expect(after.length).toBe(before);
  });

  it("refuses a sample of a definition for another connection, a draft that fails its checks, and a statement that describes by the source's failure", async () => {
    const source = await connection('Checked');
    const elsewhere = await connection('Elsewhere');
    connector.mode = 'answer';
    const other = await sample('ada', source.id, draft(elsewhere.id));
    expect(other.statusCode).toBe(400);
    expect(other.json()).toMatchObject({
      code: 'definition_invalid',
      problems: [{ path: 'connection' }],
    });
    const unmarked = await sample(
      'ada',
      source.id,
      draft(source.id, { fetch: { kind: 'sql', text: 'select id, name from sample.site' } }),
    );
    expect(unmarked.statusCode).toBe(400);
    expect(unmarked.json()).toMatchObject({
      code: 'definition_invalid',
      problems: [{ path: 'parameters.0' }],
    });

    // A statement the source refused is the author's to fix: its SQLSTATE and message, and 400.
    connector.describeSql = {
      failure: {
        code: 'source_refused',
        attribution: 'query',
        source: { sqlstate: '42P01', message: 'relation "sample.sites" does not exist' },
      },
    };
    const refused = await describeSql('ada', source.id);
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      code: 'source_refused',
      attribution: 'query',
      source: { sqlstate: '42P01' },
    });
    connector.describeSql = {
      failure: { code: 'connection_failed', attribution: 'connector' },
    };
    expect((await describeSql('ada', source.id)).statusCode).toBe(502);
  });

  it('lists the definitions a person may read, by space and by connection, and refuses a stale version, a retired connection, and a definition failing its checks', async () => {
    const first = await connection('Listed');
    const second = await connection('Listed too');
    const one = (
      await create('ada', definition(first.id, { title: 'Alpha' }))
    ).json<DefinitionBody>();
    const two = (
      await create('ada', definition(second.id, { title: 'Beta' }))
    ).json<DefinitionBody>();

    const listed = await call('ada', 'GET', `/v1/query-definitions?connection=${first.id}`);
    expect(listed.json()).toMatchObject({
      items: [
        {
          id: one.id,
          title: 'Alpha',
          space: { id: general, name: 'General' },
          connection: { id: first.id, name: 'Listed' },
          retired: false,
        },
      ],
      total: 1,
    });
    const bySpace = await call('ada', 'GET', `/v1/query-definitions?spaces=${quality}`);
    expect(bySpace.json()).toMatchObject({ items: [], total: 0 });
    const all = (await call('ada', 'GET', `/v1/query-definitions?spaces=${general}`)).json<{
      items: { id: string }[];
    }>();
    expect(all.items.map((each) => each.id)).toEqual(expect.arrayContaining([one.id, two.id]));
    expect((await call('alice', 'GET', '/v1/query-definitions')).json()).toMatchObject({
      items: [],
    });

    // A version from the latest, then one from the version before: refused with the current one.
    const next = await call('ada', 'POST', `/v1/query-definitions/${one.id}/versions`, {
      openedFrom: one.version.id,
      definition: definition(first.id, { title: 'Alpha, renamed' }),
    });
    expect(next.json<DefinitionBody>()).toMatchObject({ version: { number: '0.2' } });
    const stale = await call('ada', 'POST', `/v1/query-definitions/${one.id}/versions`, {
      openedFrom: one.version.id,
      definition: definition(first.id, { title: 'Alpha, again' }),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'version_precondition',
      current: { version: { number: '0.2' } },
    });

    // Retired and reinstated as versions like any other.
    const latest = next.json<DefinitionBody>();
    const retired = await call('ada', 'POST', `/v1/query-definitions/${one.id}/versions`, {
      openedFrom: latest.version.id,
      definition: { ...latest.definition, retired: true },
    });
    expect(retired.json<DefinitionBody>().definition.retired).toBe(true);

    // A definition failing its checks is refused by rule, each problem named.
    const invalid = await create('ada', definition(first.id, { key: ['nowhere'] }));
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      code: 'definition_invalid',
      problems: expect.arrayContaining([
        expect.objectContaining({ rule: 'definition_invalid', path: 'key.0' }),
      ]),
    });
    // One naming a retired connection is refused, by the connection.
    const gone = await connection('Gone');
    const read = (await call('ada', 'GET', `/v1/connections/${gone.id}`)).json<{
      version: { id: string };
    }>();
    await call('ada', 'POST', `/v1/connections/${gone.id}/versions`, {
      openedFrom: read.version.id,
      settings: settings({ name: 'Gone', retired: true }),
    });
    const naming = await create('ada', definition(gone.id));
    expect(naming.statusCode).toBe(409);
    expect(naming.json()).toMatchObject({ code: 'connection_retired' });
    // And a definition in a space that does not exist, or none the caller may read, is not found.
    expect((await create('alice', definition(first.id))).statusCode).toBe(404);
  });

  it('lets a definition be retired whatever its connection last found, so that the connection can be retired after it', async () => {
    const source = await connection('Retiring');
    const made = (await create('ada', definition(source.id))).json<DefinitionBody>();
    // The account is found writable once the definition is saved: SQL is refused on it from then.
    connector.mode = 'answer';
    connector.test = { outcome: 'ok', findings: ['account_not_read_only'] };
    await call('ada', 'POST', `/v1/connections/${source.id}/test`, {});
    const changed = await call('ada', 'POST', `/v1/query-definitions/${made.id}/versions`, {
      openedFrom: made.version.id,
      definition: definition(source.id, { title: 'Changed' }),
    });
    expect(changed.json(), changed.body).toMatchObject({
      code: 'sql_not_permitted',
      reason: 'not_read_only',
    });
    // Retiring it is not SQL that will run, and is allowed; reinstating it would be SQL again.
    const retired = await call('ada', 'POST', `/v1/query-definitions/${made.id}/versions`, {
      openedFrom: made.version.id,
      definition: { ...made.definition, retired: true },
    });
    expect(retired.statusCode).toBe(200);
    const reinstated = await call('ada', 'POST', `/v1/query-definitions/${made.id}/versions`, {
      openedFrom: retired.json<DefinitionBody>().version.id,
      definition: { ...made.definition, retired: false },
    });
    expect(reinstated.json()).toMatchObject({ code: 'sql_not_permitted' });
    const read = (await call('ada', 'GET', `/v1/connections/${source.id}`)).json<{
      version: { id: string };
    }>();
    const retiring = await call('ada', 'POST', `/v1/connections/${source.id}/versions`, {
      openedFrom: read.version.id,
      settings: settings({ name: 'Retiring', retired: true }),
    });
    expect(retiring.statusCode).toBe(200);
  });

  it('samples a definition at the size bound, with its values, through the connector', async () => {
    const source = await connection('At the bound');
    connector.mode = 'answer';
    connector.run = ranOk([['1', 'North']]);
    const values: string[] = [];
    const made = () =>
      draft(source.id, {
        parameters: [
          { name: 'site', type: { base: 'integer' }, required: true, list: false },
          {
            name: 'label',
            type: { base: 'text' },
            required: false,
            list: false,
            permitted: { values },
          },
        ],
        fetch: {
          kind: 'sql',
          text: 'select id, name from sample.site where id = {{site}} and {{label}} is not null order by id',
        },
      });
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
    // Permitted values of three-byte characters up to the bound exactly.
    for (;;) {
      values.push(`${values.length}${'一'.repeat(980)}`);
      if (bytes(made()) > DEFINITION_MAX_BYTES - 16) break;
    }
    values.pop();
    values.push(`${values.length}`);
    const left = DEFINITION_MAX_BYTES - bytes(made());
    values[values.length - 1] += '一'.repeat(Math.floor(left / 3)) + 'a'.repeat(left % 3);
    const atBound = made();
    expect(bytes(atBound)).toBe(DEFINITION_MAX_BYTES);

    const before = runsAsked();
    const answer = await sample('ada', source.id, atBound, { site: '1', label: values[0]! });
    expect(answer.json()).toMatchObject({ outcome: 'ok', rowCount: 1 });
    expect(runsAsked()).toBe(before + 1);
    // One byte more is the author's to fix, refused before the connector is asked.
    values[values.length - 1] += 'a';
    const over = await sample('ada', source.id, made(), { site: '1' });
    expect(over.statusCode).toBe(400);
    expect(over.json()).toMatchObject({ code: 'definition_invalid' });
    expect(runsAsked()).toBe(before + 1);
  });

  it("names a definition's connection only to a caller who may read the connection, and shows its identity to every reader", async () => {
    const hidden = await connection('Hidden Warehouse Name');
    await allow(ids.ada!, roles.Author!, { kind: 'space', id: quality });
    const made = await create('ada', definition(hidden.id, { title: 'Quality counts' }), quality);
    expect(made.statusCode, made.body).toBe(200);
    const { id } = made.json<DefinitionBody>();
    // Alice reads Quality alone: the definition is hers to read, the connection in General is not.
    const reader = await tenantDb.withTenant(
      tenant,
      async (trx) => (await findRole(trx, 'Reader'))!,
    );
    await allow(ids.alice!, reader.id, { kind: 'space', id: quality });
    expect((await call('alice', 'GET', `/v1/connections/${hidden.id}`)).statusCode).toBe(404);

    const read = await call('alice', 'GET', `/v1/query-definitions/${id}`);
    expect(read.statusCode).toBe(200);
    expect(read.json<DefinitionBody>().connection).toEqual({
      id: hidden.id,
      name: null,
      identity: 'service',
      retired: false,
    });
    const listed = await call('alice', 'GET', '/v1/query-definitions');
    expect(listed.json<{ items: { id: string; connection: unknown }[] }>().items).toEqual([
      expect.objectContaining({ id, connection: { id: hidden.id, name: null } }),
    ]);
    const searched = await call('alice', 'GET', '/v1/search?q=Warehouse');
    expect(searched.statusCode).toBe(200);
    expect(searched.body).not.toContain('Hidden');
    expect(searched.json<{ items?: unknown[] }>().items ?? []).toEqual([]);
    // Nothing Alice was answered names it.
    expect(`${read.body}${listed.body}`).not.toContain('Hidden');

    // Ada may read the connection, and is told its name.
    expect(
      (await call('ada', 'GET', `/v1/query-definitions/${id}`)).json<DefinitionBody>().connection,
    ).toMatchObject({ name: 'Hidden Warehouse Name' });
    expect(
      (await call('ada', 'GET', `/v1/query-definitions?spaces=${quality}`)).json<{
        items: { connection: unknown }[];
      }>().items,
    ).toEqual([
      expect.objectContaining({ connection: { id: hidden.id, name: 'Hidden Warehouse Name' } }),
    ]);
  });
});
