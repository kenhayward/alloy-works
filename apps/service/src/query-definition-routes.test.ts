import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
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
  type PostgresSettings,
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

const settings = (over: Partial<PostgresSettings> = {}): PostgresSettings => ({
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

/** The same question built rather than written (D4): one table, a filter on the parameter. */
const builtFetch = {
  kind: 'builder',
  format: 1,
  query: {
    sources: [{ alias: 's', table: { schema: 'sample', name: 'site' } }],
    joins: [],
    select: [
      { name: 'id', of: { source: 's', column: 'id' } },
      { name: 'name', of: { source: 's', column: 'name' } },
    ],
    where: { column: { source: 's', column: 'id' }, is: 'equal', to: { parameter: 'site' } },
    groupBy: [],
  },
};
const built = (connection: string, over: Json = {}) =>
  definition(connection, { title: 'Site built', fetch: builtFetch, ...over });

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

const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** An invented PNG, `width` by 2 pixels, every pixel one shade. */
const png = (width: number) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(2, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 90)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([row, row]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
    for (const user of ['ada', 'grace', 'alice', 'ivy']) {
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
    // Ivy authors in General and uses no connection.
    await allow(ids.ivy!, roles.Author!, { kind: 'space', id: general });
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
      'definition_unbindable',
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

  it("answers a sample's image cells with each image's format, size and pixels from its header, and refuses an image that is not what its hash says", async () => {
    const source = await connection('Photographed');
    connector.mode = 'answer';
    const [north, south] = [png(3), png(5)];
    const hashOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const result = {
      columns: [
        ['id', 'integer'],
        ['photo', 'image'],
      ] as [string, 'integer' | 'image'][],
      rows: [
        ['1', hashOf(north)],
        ['2', hashOf(south)],
        ['3', null],
      ],
    };
    const ran = {
      outcome: 'ok' as const,
      result,
      checksum: createHash('sha256').update(canonicalResultBytes(result), 'utf8').digest('hex'),
      rowCount: 3,
      ran: { sql: 'select id, photo from sample.site_photo order by id' },
      durationMs: 12,
      images: {
        [hashOf(north)]: north.toString('base64'),
        [hashOf(south)]: south.toString('base64'),
      },
    };
    connector.run = ran;
    const photo = draft(source.id, {
      parameters: [],
      fetch: { kind: 'sql', text: 'select id, photo from sample.site_photo order by id' },
      columns: [
        { name: 'id', from: { column: 'id' }, type: { base: 'integer' } },
        {
          name: 'photo',
          from: { column: 'photo' },
          type: { base: 'image', encoding: 'binary', description: 'decorative' },
        },
      ],
    });
    const answer = (await sample('ada', source.id, photo, {})).json<Json>();
    expect(answer).toMatchObject({ outcome: 'ok', rowCount: 3 });
    expect(answer.images).toEqual({
      [hashOf(north)]: { format: 'png', bytes: north.length, width: 3, height: 2 },
      [hashOf(south)]: { format: 'png', bytes: south.length, width: 5, height: 2 },
    });
    // Nothing of an image a sample ran is stored, and no upload is made for one.
    const uploads = await tenantDb.withTenant(tenant, (trx) =>
      trx.selectFrom('asset_upload').select('id').execute(),
    );
    expect(uploads).toEqual([]);

    // An image whose bytes are not what its hash says is the connector's error.
    connector.run = {
      ...ran,
      images: { ...ran.images, [hashOf(north)]: png(4).toString('base64') },
    };
    expect((await sample('ada', source.id, photo, {})).json()).toMatchObject({
      outcome: 'failed',
      failure: { code: 'connector_error', attribution: 'connector' },
    });
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
      expect.objectContaining({
        id,
        connection: { id: hidden.id, name: null, identity: 'service' },
      }),
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
      expect.objectContaining({
        connection: { id: hidden.id, name: 'Hidden Warehouse Name', identity: 'service' },
      }),
    ]);
  });

  describe('a built query (D4)', () => {
    const describeBuilt = (as: string, id: string, query: unknown = builtFetch.query) =>
      call(as, 'POST', `/v1/connections/${id}/describe`, {
        builder: {
          query,
          parameters: [{ name: 'site', type: { base: 'integer' }, required: true, list: false }],
        },
      });
    const describedColumns = {
      columns: [
        { name: 'id', sourceType: 'integer', proposed: { base: 'integer' } },
        { name: 'name', sourceType: 'text', proposed: { base: 'text' } },
      ],
      parameters: ['bigint'],
    } as const;

    it('is saved, described and sampled by an author holding use_connection alone, where the same as SQL is refused', async () => {
      const source = await connection('Built by Grace');
      connector.mode = 'answer';
      connector.run = ranOk([['1', 'North']]);
      connector.describeSql = describedColumns as never;

      // Grace uses the connection and writes no SQL against it: SQL is refused, as DAT-101 has it.
      expect((await create('grace', definition(source.id))).statusCode).toBe(403);
      expect((await sample('grace', source.id, draft(source.id))).statusCode).toBe(403);
      expect((await describeSql('grace', source.id)).statusCode).toBe(403);

      // The same question built needs no write_sql.
      const asked = connector.asked.length;
      const described = await describeBuilt('grace', source.id);
      expect(described.statusCode, described.body).toBe(200);
      expect(described.json()).toMatchObject({ columns: [{ name: 'id' }, { name: 'name' }] });
      // The connector is sent the tree, never SQL.
      const sent = connector.asked.slice(asked).find((each) => each.path === '/v1/describe');
      expect(sent?.body).toMatchObject({ builder: { query: builtFetch.query } });
      expect(sent?.body).not.toHaveProperty('sql');

      const sampled = await sample('grace', source.id, draft(source.id, { fetch: builtFetch }));
      expect(sampled.statusCode, sampled.body).toBe(200);
      expect(sampled.json()).toMatchObject({ outcome: 'ok' });

      const made = await create('grace', built(source.id));
      expect(made.statusCode, made.body).toBe(200);
      expect(made.json<DefinitionBody>()).toMatchObject({
        definition: { fetch: { kind: 'builder' } },
        mayEdit: true,
        mayRun: true,
      });

      // Ivy may edit in the space and uses no connection: a built query is refused her as well.
      const ivy = await create('ivy', built(source.id));
      expect(ivy.statusCode).toBe(403);
      expect(ivy.json<{ message: string }>().message).toContain('use connection');
      expect(ivy.json<{ message: string }>().message).not.toContain('SQL');
      const read = await call(
        'ivy',
        'GET',
        `/v1/query-definitions/${made.json<DefinitionBody>().id}`,
      );
      expect(read.json()).toMatchObject({ mayEdit: false, mayRun: false });
    });

    it('saves an HTTP request only on an HTTP connection, never naming its secret header, by an author holding use_connection alone', async () => {
      const database = await connection('Not for HTTP');
      const request = {
        method: 'GET',
        path: [{ fixed: 'sites' }, { parameter: 'site' }],
        query: [],
        headers: [],
      };
      const httpFetch = { kind: 'http', request, format: { kind: 'json', rows: '/items' } };
      const httpDefinition = (on: string, over: Json = {}) =>
        definition(on, {
          title: 'Sites by API',
          parameters: [{ name: 'site', type: { base: 'text' }, required: true, list: false }],
          fetch: httpFetch,
          columns: [
            { name: 'id', from: { pointer: '/id' }, type: { base: 'integer' } },
            { name: 'name', from: { pointer: '/name' }, type: { base: 'text' } },
          ],
          ...over,
        });
      const onDatabase = await create('grace', httpDefinition(database.id));
      expect(onDatabase.statusCode).toBe(400);
      expect(onDatabase.json()).toMatchObject({
        problems: [{ path: 'fetch', message: 'An HTTP request is sent on an HTTP connection' }],
      });
      const api = await call('ada', 'POST', `/v1/spaces/${general}/connections`, {
        settings: {
          ...settings({ name: 'Sites API' }),
          type: 'http',
          source: { baseUrl: 'https://api.example.test/v1', secretHeader: 'x-api-key' },
        },
      });
      expect(api.statusCode, api.body).toBe(200);
      const apiId = api.json<{ id: string }>().id;
      const named = await create(
        'grace',
        httpDefinition(apiId, {
          fetch: {
            ...httpFetch,
            request: { ...request, headers: [{ name: 'x-api-key', value: { fixed: 'mine' } }] },
          },
        }),
      );
      expect(named.statusCode).toBe(400);
      expect(named.json()).toMatchObject({ problems: [{ path: 'fetch.request.headers.0.name' }] });
      const made = await create('grace', httpDefinition(apiId));
      expect(made.statusCode, made.body).toBe(200);
      expect(made.json<DefinitionBody>()).toMatchObject({
        definition: { fetch: { kind: 'http' } },
        mayEdit: true,
        mayRun: true,
      });
    });

    it('saves a file only on an S3 connection, its key, format and filter whole, by an author holding use_connection alone', async () => {
      const database = await connection('Not for files');
      const fileFetch = {
        kind: 'file',
        key: [{ fixed: 'sites' }, { parameter: 'region' }, { fixed: 'sites.csv' }],
        format: { kind: 'csv', delimiter: 'semicolon', headerRow: true, null: 'never' },
        where: { column: 'name', is: 'startsWith', to: { parameter: 'prefix' } },
      };
      const fileDefinition = (on: string, over: Json = {}) =>
        definition(on, {
          title: 'Sites from a file',
          parameters: [
            { name: 'region', type: { base: 'text' }, required: true, list: false },
            { name: 'prefix', type: { base: 'text' }, required: false, list: false },
          ],
          fetch: fileFetch,
          columns: [
            { name: 'id', from: { letter: 'A' }, type: { base: 'integer' } },
            { name: 'name', from: { header: 'name' }, type: { base: 'text' } },
          ],
          key: ['id'],
          order: [{ column: 'id', direction: 'ascending' }],
          ...over,
        });
      const onDatabase = await create('grace', fileDefinition(database.id));
      expect(onDatabase.statusCode).toBe(400);
      expect(onDatabase.json()).toMatchObject({
        problems: [{ path: 'fetch', message: 'A file is read on an S3 connection' }],
      });
      const bucket = await call('ada', 'POST', `/v1/spaces/${general}/connections`, {
        settings: {
          ...settings({ name: 'Sites bucket' }),
          type: 's3',
          source: {
            endpoint: 'https://s3.example.test',
            region: 'eu-west-2',
            bucket: 'alloy-sites',
            pathStyle: true,
          },
        },
      });
      expect(bucket.statusCode, bucket.body).toBe(200);
      const bucketId = bucket.json<{ id: string }>().id;
      const unfiltered = await create(
        'grace',
        fileDefinition(bucketId, {
          fetch: {
            ...fileFetch,
            where: { column: 'river', is: 'equal', to: { parameter: 'prefix' } },
          },
        }),
      );
      expect(unfiltered.statusCode).toBe(400);
      expect(unfiltered.json()).toMatchObject({ problems: [{ path: 'fetch.where.column' }] });
      const made = await create('grace', fileDefinition(bucketId));
      expect(made.statusCode, made.body).toBe(200);
      expect(made.json<DefinitionBody>()).toMatchObject({
        definition: { fetch: fileFetch },
        mayEdit: true,
        mayRun: true,
      });
    });

    it('runs on a connection whose test found its account able to write, where SQL is refused sql_not_permitted', async () => {
      const writable = await connection('Writable', 'finding');
      connector.mode = 'answer';
      connector.run = ranOk([['1', 'North']]);
      connector.describeSql = describedColumns as never;

      const sql = await create('ada', definition(writable.id));
      expect(sql.statusCode).toBe(409);
      expect(sql.json()).toMatchObject({ code: 'sql_not_permitted', reason: 'not_read_only' });

      expect((await describeBuilt('ada', writable.id)).statusCode).toBe(200);
      expect(
        (await sample('ada', writable.id, draft(writable.id, { fetch: builtFetch }))).json(),
      ).toMatchObject({ outcome: 'ok' });
      const made = await create('ada', built(writable.id));
      expect(made.statusCode, made.body).toBe(200);
      expect(made.json<DefinitionBody>()).toMatchObject({ mayEdit: true, mayRun: true });
      // A connection never tested takes a built query too: DAT-103 is the SQL fallback's alone.
      const untested = await connection('Untested', 'none');
      expect((await create('ada', definition(untested.id))).statusCode).toBe(409);
      expect((await create('ada', built(untested.id))).statusCode).toBe(200);
    });

    it('lets somebody without write_sql turn a SQL definition into a built one, and not back', async () => {
      const source = await connection('Turned');
      connector.mode = 'answer';
      const made = await create('ada', definition(source.id));
      expect(made.statusCode).toBe(200);
      const { id, version } = made.json<DefinitionBody>();
      // Grace may not change SQL she may not write.
      expect((await call('grace', 'GET', `/v1/query-definitions/${id}`)).json()).toMatchObject({
        mayEdit: false,
        mayRun: false,
      });
      const turned = await call('grace', 'POST', `/v1/query-definitions/${id}/versions`, {
        openedFrom: version.id,
        definition: built(source.id),
      });
      expect(turned.statusCode, turned.body).toBe(200);
      const after = turned.json<DefinitionBody>();
      expect(after).toMatchObject({
        version: { number: '0.2' },
        definition: { fetch: { kind: 'builder' } },
        mayEdit: true,
        mayRun: true,
      });
      // Each version's need is its own fetch's: back to SQL is refused her.
      const back = await call('grace', 'POST', `/v1/query-definitions/${id}/versions`, {
        openedFrom: after.version.id,
        definition: definition(source.id),
      });
      expect(back.statusCode).toBe(403);
    });

    it('refuses a tree nested past its bound by name, at the door, and never fails on it', async () => {
      const source = await connection('Deep');
      const depth = 100_000;
      const leaf = '{"column":{"source":"s","column":"id"},"is":"isNull"}';
      const where = `${'{"not":'.repeat(depth)}${leaf}${'}'.repeat(depth)}`;
      const query = JSON.stringify({ ...builtFetch.query, where: 'WHERE' }).replace(
        '"WHERE"',
        where,
      );
      expect(query.length).toBeLessThan(1_000_000);
      const body = JSON.stringify({
        definition: built(source.id, { fetch: { ...builtFetch, query: 'QUERY' } }),
      }).replace('"QUERY"', query);
      const answer = await app.inject({
        method: 'POST',
        url: `/v1/spaces/${general}/query-definitions`,
        headers: { host: HOST, cookie: cookies.grace!, 'content-type': 'application/json' },
        payload: body,
      });
      expect(answer.statusCode, answer.body.slice(0, 500)).toBe(400);
      expect(answer.json<{ message: string }>().message).toContain(
        'A condition nests at most 8 deep',
      );

      const described = await app.inject({
        method: 'POST',
        url: `/v1/connections/${source.id}/describe`,
        headers: { host: HOST, cookie: cookies.grace!, 'content-type': 'application/json' },
        payload: `{"builder":{"query":${query},"parameters":[]}}`,
      });
      expect(described.statusCode, described.body.slice(0, 500)).toBe(400);
      expect(described.json<{ message: string }>().message).toContain(
        'A condition nests at most 8 deep',
      );
    });

    it("refuses a built query failing the builder's checks at describe by name, before the connector is asked", async () => {
      const source = await connection('Checked built');
      const asked = connector.asked.length;
      const unfiltered: Json = { ...builtFetch.query };
      delete unfiltered.where;
      const unused = await describeBuilt('grace', source.id, unfiltered);
      expect(unused.statusCode).toBe(400);
      expect(unused.json()).toMatchObject({
        code: 'definition_invalid',
        problems: [{ path: 'builder.parameters.0' }],
      });
      expect(connector.asked.slice(asked).some((each) => each.path === '/v1/describe')).toBe(false);
    });

    it("words a built query's commonest refusals by their SQLSTATE, and shows the source's message only to a holder of write_sql", async () => {
      const source = await connection('Worded');
      connector.mode = 'answer';
      const words: [string, string][] = [
        ['42P01', 'The source has no table or view the query names'],
        // A composite type or an index named as a source: a relation, but none a statement reads.
        ['42809', 'The source has no table or view the query names'],
        ['42703', 'The source has no column the query names'],
        ['42883', 'The source cannot compare two of the types the query compares'],
        ['42804', 'The source cannot compare two of the types the query compares'],
        ['42501', 'The connection account may not read a table or view the query names'],
      ];
      for (const [sqlstate, said] of words) {
        const secret = `relation "hidden_${sqlstate}" says something`;
        const failure = {
          code: 'source_refused' as const,
          attribution: 'query' as const,
          source: { sqlstate, message: secret },
        };
        connector.run = { outcome: 'failed', failure };
        connector.describeSql = { failure };
        const grace = await sample('grace', source.id, draft(source.id, { fetch: builtFetch }));
        const hers = grace.json<{ failure: { message: string; source: Json } }>().failure;
        expect(hers.message, sqlstate).toContain(said);
        expect(hers.message, sqlstate).toContain(sqlstate);
        expect(grace.body, sqlstate).not.toContain('hidden_');
        expect(hers.source).toEqual({ sqlstate });

        const graceDescribe = await describeBuilt('grace', source.id);
        expect(graceDescribe.statusCode).toBe(400);
        expect(graceDescribe.json<{ message: string }>().message, sqlstate).toContain(said);
        expect(graceDescribe.body, sqlstate).not.toContain('hidden_');

        // Ada holds write_sql here, and is told what the source said beside the product's words.
        const ada = await sample('ada', source.id, draft(source.id, { fetch: builtFetch }));
        const adas = ada.json<{ failure: { message: string; source: Json } }>().failure;
        expect(adas.message, sqlstate).toContain(said);
        expect(adas.message, sqlstate).toContain(secret);
        expect(adas.source).toEqual({ sqlstate, message: secret });
      }
      // A SQLSTATE without words of its own is named by its code alone.
      connector.run = {
        outcome: 'failed',
        failure: {
          code: 'source_refused',
          attribution: 'query',
          source: { sqlstate: '22012', message: 'division by zero' },
        },
      };
      const other = await sample('grace', source.id, draft(source.id, { fetch: builtFetch }));
      expect(other.json<{ failure: { message: string } }>().failure.message).toBe(
        'The source refused the statement (SQLSTATE 22012).',
      );
    });

    it('refuses Grace a column her table does not have at describe and at sample, naming the column she wrote', async () => {
      const source = await connection('Absent column');
      connector.mode = 'answer';
      // The connector's refusal of a table's column the source does not have: the source's own
      // message, and the column read from the generated text at the error's position (describe.ts).
      const failure = {
        code: 'source_refused' as const,
        attribution: 'query' as const,
        source: { sqlstate: '42703', message: 'column "row_to_json" does not exist' },
        column: 'row_to_json',
      };
      connector.run = { outcome: 'failed', failure };
      connector.describeSql = { failure };
      const query: Json = {
        ...builtFetch.query,
        select: [{ name: 'whole', of: { source: 's', column: 'row_to_json' } }],
      };
      const said = 'The source has no column the query names (SQLSTATE 42703): row_to_json.';

      const described = await describeBuilt('grace', source.id, query);
      expect(described.statusCode).toBe(400);
      expect(described.json<{ message: string }>().message).toBe(said);
      expect(described.body).not.toContain('does not exist');

      const sampled = await sample(
        'grace',
        source.id,
        draft(source.id, {
          fetch: { ...builtFetch, query },
          columns: [{ name: 'whole', from: { column: 'whole' }, type: { base: 'text' } }],
          key: ['whole'],
          order: [{ column: 'whole', direction: 'ascending' }],
        }),
      );
      const hers = sampled.json<{ failure: { message: string; column: string } }>().failure;
      expect(hers).toMatchObject({ message: said, column: 'row_to_json' });
      expect(sampled.body).not.toContain('does not exist');
    });
  });
});
