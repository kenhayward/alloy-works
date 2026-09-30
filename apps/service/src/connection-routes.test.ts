import {
  bootstrapCluster,
  createRole,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  usableCredentialOf,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { dataFailureCodes, dataFailures, type ConnectionSettings } from '@alloy-works/domain';
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

interface ConnectionBody {
  id: string;
  space: { id: string; name: string };
  version: { id: string; number: string };
  settings: ConnectionSettings;
  credential:
    | { set: false }
    | { set: true; setBy: { id: string; name: string }; setAt: string; targetChanged: boolean };
  lastTest: null | {
    outcome: 'ok' | 'failed';
    findings: string[];
    failure?: { code: string; attribution: string; message: string };
    at: string;
    by: { id: string; name: string };
    version: string;
  };
  mayAdminister: boolean;
  mayUse: boolean;
}

const settings = (over: Partial<ConnectionSettings> = {}): ConnectionSettings => ({
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

describe('connections through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  /** The same service with no connector configured. */
  let bare: FastifyInstance;
  let tenant: Tenant;
  let general: string;
  let quality: string;
  const connector = fakeConnector();
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let connectionUser: string;

  const call = (
    as: string,
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: Json,
    on: FastifyInstance = app,
  ) =>
    on.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[as]! },
      ...(payload ? { payload } : {}),
    });
  const make = async (over: Partial<ConnectionSettings> = {}, space = general) => {
    const made = await call('ada', 'POST', `/v1/spaces/${space}/connections`, {
      settings: settings(over),
    });
    if (made.statusCode !== 200) throw new Error(`${made.statusCode} ${made.body}`);
    return made.json<ConnectionBody>();
  };
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
  const recordedTests = (connection: string) =>
    tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('connection_test')
        .select(['connection_version_id', 'outcome', 'findings', 'failure', 'tested_by'])
        .where('connection_id', '=', connection)
        .orderBy('id')
        .execute(),
    );

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
    const options = {
      db: tenantDb,
      logLevel: 'silent' as const,
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    };
    app = buildApp({
      ...options,
      connector: {
        url: 'http://connector.test:8090',
        key: FAKE_CONNECTOR_KEY,
        fetch: connector.fetch,
      },
    });
    bare = buildApp(options);
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
      const made = await createRole(trx, 'Connection user', ['read', 'use_connection']);
      if (!('role' in made)) throw new Error(made.refused);
      connectionUser = made.role.id;
    });
    // Ada administers General and Quality; Grace authors in General. Nobody uses a connection yet.
    const administrator = await tenantDb.withTenant(tenant, (trx) =>
      findRole(trx, 'Administrator'),
    );
    const author = await tenantDb.withTenant(tenant, (trx) => findRole(trx, 'Author'));
    await allow(ids.ada!, administrator!.id, { kind: 'space', id: general });
    await allow(ids.ada!, administrator!.id, { kind: 'space', id: quality });
    await allow(ids.grace!, author!.id, { kind: 'space', id: general });
  });

  afterAll(async () => {
    await app?.close();
    await bare?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('DAT-004 answers whether a credential is set, by whom and when, and never the credential or its sealed value', async () => {
    const connection = await make();
    expect(connection.credential).toEqual({ set: false });
    const answers: string[] = [JSON.stringify(connection)];

    const set = await call('ada', 'PUT', `/v1/connections/${connection.id}/credential`, {
      secret: SECRET,
    });
    expect(set.statusCode, set.body).toBe(200);
    answers.push(set.body);
    const setBody = set.json<{ credential: ConnectionBody['credential']; test: Json }>();
    expect(setBody.credential).toMatchObject({ set: true, setBy: { id: ids.ada, name: 'Ada' } });

    const read = await call('grace', 'GET', `/v1/connections/${connection.id}`);
    expect(read.statusCode, read.body).toBe(200);
    answers.push(read.body);
    const body = read.json<ConnectionBody>();
    expect(body.credential).toEqual({
      set: true,
      setBy: { id: ids.ada, name: 'Ada' },
      setAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      targetChanged: false,
    });
    const listed = await call('grace', 'GET', '/v1/connections');
    answers.push(listed.body);
    expect(listed.json<{ items: Json[] }>().items).toContainEqual(
      expect.objectContaining({ id: connection.id, credentialSet: true }),
    );

    // Nothing answered holds the credential, or the sealed value the service keeps for it.
    const usable = await tenantDb.withTenant(tenant, (trx) =>
      usableCredentialOf(trx, connection.id),
    );
    const sealed = usable.answer === 'usable' ? usable.sealed : undefined;
    expect(sealed).toMatch(/^v1\./);
    for (const answer of answers) {
      expect(answer).not.toContain(SECRET);
      expect(answer).not.toContain(sealed);
      expect(answer).not.toContain(sealed!.split('.')[3]);
    }
  });

  it('DAT-075 tests a connection through the API and records each test against the version it tested', async () => {
    const connection = await make({ name: 'Tested' });
    await allow(ids.ada!, connectionUser, { kind: 'artifact', id: connection.id });
    connector.mode = 'answer';
    connector.test = { outcome: 'ok', findings: [] };
    expect(
      (await call('ada', 'PUT', `/v1/connections/${connection.id}/credential`, { secret: SECRET }))
        .statusCode,
    ).toBe(200);

    const ok = await call('ada', 'POST', `/v1/connections/${connection.id}/test`, {});
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toEqual({ outcome: 'ok', findings: [], at: expect.any(String) });

    // A version later, a failure: one reason, naming nothing of the source.
    const moved = await call('ada', 'POST', `/v1/connections/${connection.id}/versions`, {
      openedFrom: connection.version.id,
      settings: settings({ name: 'Tested', source: { ...settings().source, port: 5433 } }),
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const second = moved.json<ConnectionBody>();
    connector.test = {
      outcome: 'failed',
      failure: { code: 'connection_failed', attribution: 'connector' },
    };
    // A new port is somewhere else to sign in, so the password is set again for it first.
    expect(
      (await call('ada', 'PUT', `/v1/connections/${connection.id}/credential`, { secret: SECRET }))
        .statusCode,
    ).toBe(200);
    const failed = await call('ada', 'POST', `/v1/connections/${connection.id}/test`, {});
    expect(failed.statusCode, failed.body).toBe(200);
    expect(failed.json()).toEqual({
      outcome: 'failed',
      failure: {
        code: 'connection_failed',
        attribution: 'connector',
        message: expect.any(String),
      },
      at: expect.any(String),
    });
    expect(failed.body).not.toContain('source-postgres');
    expect(failed.body).not.toContain('5433');

    // The connector was asked with each version's settings and the sealed credential, and each
    // test is a row against the version it tested: each credential's own test, and the two here.
    const asked = connector.asked.filter((each) => each.path === '/v1/test').slice(-3);
    expect(asked.map((each) => (each.body as { connection: Json }).connection)).toEqual([
      { id: connection.id, version: connection.version.id },
      { id: connection.id, version: second.version.id },
      { id: connection.id, version: second.version.id },
    ]);
    expect(await recordedTests(connection.id)).toEqual([
      expect.objectContaining({ connection_version_id: connection.version.id, outcome: 'ok' }),
      expect.objectContaining({ connection_version_id: connection.version.id, outcome: 'ok' }),
      expect.objectContaining({ connection_version_id: second.version.id, outcome: 'failed' }),
      expect.objectContaining({
        connection_version_id: second.version.id,
        outcome: 'failed',
        failure: 'connection_failed',
        tested_by: ids.ada,
      }),
    ]);
    const read = (
      await call('ada', 'GET', `/v1/connections/${connection.id}`)
    ).json<ConnectionBody>();
    expect(read.lastTest).toMatchObject({
      outcome: 'failed',
      failure: { code: 'connection_failed', attribution: 'connector' },
      version: second.version.id,
      by: { id: ids.ada, name: 'Ada' },
    });
    // And a finding is reported by name once the source has signed the account in.
    connector.test = { outcome: 'ok', findings: ['account_not_read_only'] };
    expect(
      (await call('ada', 'POST', `/v1/connections/${connection.id}/test`, {})).json(),
    ).toMatchObject({ outcome: 'ok', findings: ['account_not_read_only'] });
  });

  it('DAT-049 answers every data failure with its attribution', async () => {
    const connection = await make({ name: 'Failing' });
    await allow(ids.ada!, connectionUser, { kind: 'artifact', id: connection.id });
    connector.mode = 'answer';
    await call('ada', 'PUT', `/v1/connections/${connection.id}/credential`, { secret: SECRET });

    // A test's four failures, each answered with the attribution its code fixes.
    for (const code of [
      'connection_failed',
      'timeout',
      'connector_error',
      'source_unsupported',
    ] as const) {
      connector.test = { outcome: 'failed', failure: { code, attribution: dataFailures[code] } };
      const answer = await call('ada', 'POST', `/v1/connections/${connection.id}/test`, {});
      expect(answer.json(), code).toMatchObject({
        outcome: 'failed',
        failure: { code, attribution: dataFailures[code] },
      });
    }
    // A describe's, as refusals by D1-Q's status, each with its attribution.
    const statuses = { connection_failed: 502, connector_error: 502, timeout: 504 } as const;
    for (const [code, status] of Object.entries(statuses) as [keyof typeof statuses, number][]) {
      connector.describe = { failure: { code, attribution: dataFailures[code] } };
      const answer = await call('ada', 'POST', `/v1/connections/${connection.id}/describe`, {});
      expect(answer.statusCode, code).toBe(status);
      expect(answer.json(), code).toMatchObject({ code, attribution: dataFailures[code] });
    }
    // The product's own: a connector that is full, one that cannot be reached, and none at all.
    connector.mode = 'busy';
    const busy = await call('ada', 'POST', `/v1/connections/${connection.id}/describe`, {});
    expect(busy.statusCode).toBe(503);
    expect(busy.json()).toMatchObject({ code: 'connector_busy', attribution: 'product' });
    connector.mode = 'unreachable';
    const unreachable = await call('ada', 'POST', `/v1/connections/${connection.id}/test`, {});
    expect(unreachable.statusCode).toBe(503);
    expect(unreachable.json()).toMatchObject({
      code: 'connector_unavailable',
      attribution: 'product',
    });
    connector.mode = 'answer';
    const none = await call('ada', 'POST', `/v1/connections/${connection.id}/test`, {}, bare);
    expect(none.json()).toMatchObject({ code: 'connector_unavailable', attribution: 'product' });
    // Every code named is one the domain attributes.
    for (const code of [...Object.keys(statuses), 'connector_busy', 'connector_unavailable']) {
      expect(dataFailureCodes).toContain(code);
    }
  });

  it('makes and changes a connection only with administer, and tests or describes it only with use_connection, each decided at the connection', async () => {
    // Grace authors in General, and may neither make a connection there nor test one.
    const byAuthor = await call('grace', 'POST', `/v1/spaces/${general}/connections`, {
      settings: settings(),
    });
    expect(byAuthor.statusCode).toBe(403);
    const connection = await make({ name: 'Guarded' });
    expect(connection).toMatchObject({ mayAdminister: true, mayUse: false });
    expect(
      (await call('grace', 'GET', `/v1/connections/${connection.id}`)).json<ConnectionBody>(),
    ).toMatchObject({ mayAdminister: false, mayUse: false });
    expect(
      (
        await call('grace', 'POST', `/v1/connections/${connection.id}/versions`, {
          openedFrom: connection.version.id,
          settings: settings({ name: 'Renamed' }),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call('grace', 'PUT', `/v1/connections/${connection.id}/credential`, {
          secret: SECRET,
        })
      ).statusCode,
    ).toBe(403);
    // Ada administers the space, and administering is not using: she may not test it either.
    for (const as of ['grace', 'ada']) {
      expect((await call(as, 'POST', `/v1/connections/${connection.id}/test`, {})).statusCode).toBe(
        403,
      );
      expect(
        (await call(as, 'POST', `/v1/connections/${connection.id}/describe`, {})).statusCode,
      ).toBe(403);
    }
    // Alice holds nothing: the connection is not there for her.
    expect((await call('alice', 'GET', `/v1/connections/${connection.id}`)).statusCode).toBe(404);
    // A grant on the connection alone lets Alice read, test and describe it, and nothing else.
    await allow(ids.alice!, connectionUser, { kind: 'artifact', id: connection.id });
    connector.mode = 'answer';
    await call('ada', 'PUT', `/v1/connections/${connection.id}/credential`, { secret: SECRET });
    connector.test = { outcome: 'ok', findings: [] };
    connector.describe = { relations: [], truncated: false, leftOut: { relations: 0, columns: 0 } };
    expect(
      (await call('alice', 'GET', `/v1/connections/${connection.id}`)).json<ConnectionBody>(),
    ).toMatchObject({ mayAdminister: false, mayUse: true });
    expect(
      (await call('alice', 'POST', `/v1/connections/${connection.id}/test`, {})).statusCode,
    ).toBe(200);
    expect(
      (await call('alice', 'POST', `/v1/connections/${connection.id}/describe`, {})).json(),
    ).toEqual({ relations: [], truncated: false, leftOut: { relations: 0, columns: 0 } });
    // Another connection in the same space stays out of her reach.
    const other = await make({ name: 'Other' });
    expect((await call('alice', 'POST', `/v1/connections/${other.id}/test`, {})).statusCode).toBe(
      404,
    );
    // A connection's routes answer nothing for an artifact of another kind.
    const component = await call('grace', 'POST', `/v1/spaces/${general}/components`, {
      title: 'Not a connection',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(component.statusCode, component.body).toBe(200);
    const id = component.json<{ id: string }>().id;
    expect((await call('ada', 'GET', `/v1/connections/${id}`)).statusCode).toBe(404);
  });

  it('binds a credential to where its connection signs in: a version changing the host, port, database, account or TLS leaves it unusable, says so, and asks the connector nothing until it is set again', async () => {
    const connection = await make({ name: 'Bound' });
    await allow(ids.ada!, connectionUser, { kind: 'artifact', id: connection.id });
    connector.mode = 'answer';
    connector.test = { outcome: 'ok', findings: [] };
    const put = () =>
      call('ada', 'PUT', `/v1/connections/${connection.id}/credential`, { secret: SECRET });
    expect((await put()).statusCode).toBe(200);
    // Sealed for the connection and the settings it will be used with.
    const sealing = connector.asked.filter((each) => each.path === '/v1/seal').at(-1)!;
    expect((sealing.body as { settings: unknown }).settings).toEqual(connection.settings);
    expect((sealing.body as { connection: unknown }).connection).toBe(connection.id);

    // A new name keeps it.
    const renamed = await call('ada', 'POST', `/v1/connections/${connection.id}/versions`, {
      openedFrom: connection.version.id,
      settings: settings({ name: 'Bound, renamed' }),
    });
    expect(renamed.json<ConnectionBody>().credential).toMatchObject({
      set: true,
      targetChanged: false,
    });
    expect(
      (await call('ada', 'POST', `/v1/connections/${connection.id}/test`, {})).statusCode,
    ).toBe(200);

    // Pointed at a server of somebody else's: the credential is still set, and says it must be set
    // again, and neither a test nor a describe reaches the connector with it.
    const moved = await call('ada', 'POST', `/v1/connections/${connection.id}/versions`, {
      openedFrom: renamed.json<ConnectionBody>().version.id,
      settings: settings({
        name: 'Bound, renamed',
        source: { ...settings().source, host: 'elsewhere.example' },
      }),
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json<ConnectionBody>().credential).toMatchObject({
      set: true,
      targetChanged: true,
    });
    const before = connector.asked.length;
    const tests = (await recordedTests(connection.id)).length;
    for (const path of ['test', 'describe']) {
      const answer = await call('ada', 'POST', `/v1/connections/${connection.id}/${path}`, {});
      expect(answer.statusCode, path).toBe(409);
      expect(answer.json(), path).toMatchObject({
        code: 'credential_target_changed',
        message: expect.stringMatching(/set .*password again/i),
      });
    }
    expect(connector.asked.length).toBe(before);
    expect(await recordedTests(connection.id)).toHaveLength(tests);
    const listed = await call('ada', 'GET', '/v1/connections');
    expect(listed.json<{ items: Json[] }>().items).toContainEqual(
      expect.objectContaining({ id: connection.id, credentialSet: false }),
    );

    // Set again, for where it now points, it is used again.
    expect((await put()).statusCode).toBe(200);
    const read = await call('ada', 'GET', `/v1/connections/${connection.id}`);
    expect(read.json<ConnectionBody>().credential).toMatchObject({
      set: true,
      targetChanged: false,
    });
    expect(
      (await call('ada', 'POST', `/v1/connections/${connection.id}/test`, {})).statusCode,
    ).toBe(200);
  });

  it('records a credential against the target it was sealed for, where a version moving the connection is saved while it is sealed, and says it must be set again', async () => {
    const connection = await make({ name: 'Raced' });
    await allow(ids.ada!, connectionUser, { kind: 'artifact', id: connection.id });
    connector.mode = 'answer';
    connector.test = { outcome: 'ok', findings: [] };
    let release!: () => void;
    connector.sealHold = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const before = connector.asked.length;
      const putting = call('ada', 'PUT', `/v1/connections/${connection.id}/credential`, {
        secret: SECRET,
      });
      const until = Date.now() + 5000;
      while (
        !connector.asked.slice(before).some((each) => each.path === '/v1/seal') &&
        Date.now() < until
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      // Somebody points the connection elsewhere while the connector seals for where it was.
      const moved = await call('ada', 'POST', `/v1/connections/${connection.id}/versions`, {
        openedFrom: connection.version.id,
        settings: settings({
          name: 'Raced',
          source: { ...settings().source, host: 'elsewhere.example' },
        }),
      });
      expect(moved.statusCode, moved.body).toBe(200);
      release();
      const put = await putting;
      expect(put.statusCode, put.body).toBe(200);
      expect(put.json<{ credential: Json }>().credential).toMatchObject({
        set: true,
        targetChanged: true,
      });
      const read = await call('ada', 'GET', `/v1/connections/${connection.id}`);
      expect(read.json<ConnectionBody>().credential).toMatchObject({
        set: true,
        targetChanged: true,
      });
      const tested = await call('ada', 'POST', `/v1/connections/${connection.id}/test`, {});
      expect(tested.statusCode).toBe(409);
      expect(tested.json()).toMatchObject({ code: 'credential_target_changed' });
    } finally {
      release();
      connector.sealHold = undefined;
    }
  });

  it('holds nothing of access while the connector works: a grant is made at once while a test and a describe wait on a slow source, and the test is recorded against the version it tested', async () => {
    const connection = await make({ name: 'Slow' });
    await allow(ids.ada!, connectionUser, { kind: 'artifact', id: connection.id });
    connector.mode = 'answer';
    connector.test = { outcome: 'ok', findings: [] };
    expect(
      (await call('ada', 'PUT', `/v1/connections/${connection.id}/credential`, { secret: SECRET }))
        .statusCode,
    ).toBe(200);
    const before = connector.asked.length;
    let release!: () => void;
    connector.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const testing = call('ada', 'POST', `/v1/connections/${connection.id}/test`, {});
      const describing = call('ada', 'POST', `/v1/connections/${connection.id}/describe`, {});
      // Both have reached the connector, and wait there.
      const until = Date.now() + 5000;
      while (connector.asked.length < before + 2 && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(
        connector.asked
          .slice(before)
          .map((each) => each.path)
          .sort(),
      ).toEqual(['/v1/describe', '/v1/test']);

      // A change to access lands now, not when the source answers.
      const granting = call('ada', 'POST', '/v1/grants', {
        role: connectionUser,
        subject: { principal: ids.grace },
        level: `artifact:${connection.id}`,
        effect: 'allow',
      });
      const first = await Promise.race([
        granting,
        new Promise<'waited'>((resolve) => setTimeout(() => resolve('waited'), 3000)),
      ]);
      expect(first, 'the grant waited behind the connector').not.toBe('waited');
      expect((await granting).statusCode).toBe(200);

      // And a version cut while the test is in flight.
      const renamed = await call('ada', 'POST', `/v1/connections/${connection.id}/versions`, {
        openedFrom: connection.version.id,
        settings: settings({ name: 'Slow, renamed' }),
      });
      expect(renamed.statusCode, renamed.body).toBe(200);

      release();
      const [tested, described] = await Promise.all([testing, describing]);
      expect(tested.statusCode, tested.body).toBe(200);
      expect(described.statusCode, described.body).toBe(200);
      // The test is of the version it was asked of, and says so; the newer one is untested.
      expect((await recordedTests(connection.id)).at(-1)).toMatchObject({
        connection_version_id: connection.version.id,
        outcome: 'ok',
      });
      const read = (
        await call('ada', 'GET', `/v1/connections/${connection.id}`)
      ).json<ConnectionBody>();
      expect(read.version.id).toBe(renamed.json<ConnectionBody>().version.id);
      expect(read.lastTest?.version).toBe(connection.version.id);
      // The listing says which version its last test was of, too.
      const listed = await call('ada', 'GET', '/v1/connections');
      expect(listed.json<{ items: Json[] }>().items).toContainEqual(
        expect.objectContaining({
          id: connection.id,
          version: expect.objectContaining({ id: read.version.id }),
          lastTest: expect.objectContaining({ outcome: 'ok', version: connection.version.id }),
        }),
      );
    } finally {
      release();
      connector.hold = undefined;
    }
  });

  it('answers connection_retired, credential_missing and connector_unavailable before the connector is asked, and records nothing', async () => {
    const connection = await make({ name: 'Unready' });
    await allow(ids.ada!, connectionUser, { kind: 'artifact', id: connection.id });
    connector.mode = 'answer';
    const before = connector.asked.length;

    // No credential: nothing to test with.
    for (const path of ['test', 'describe']) {
      const answer = await call('ada', 'POST', `/v1/connections/${connection.id}/${path}`, {});
      expect(answer.statusCode, path).toBe(409);
      expect(answer.json(), path).toMatchObject({ code: 'credential_missing' });
    }
    // No connector: nothing to test or seal with.
    const unset = await call(
      'ada',
      'PUT',
      `/v1/connections/${connection.id}/credential`,
      { secret: SECRET },
      bare,
    );
    expect(unset.statusCode).toBe(503);
    expect(unset.json()).toMatchObject({ code: 'connector_unavailable' });
    expect(connector.asked.length).toBe(before);

    // Retired: it runs nothing and takes no credential.
    const retired = await call('ada', 'POST', `/v1/connections/${connection.id}/versions`, {
      openedFrom: connection.version.id,
      settings: settings({ name: 'Unready', retired: true }),
    });
    expect(retired.statusCode, retired.body).toBe(200);
    for (const [method, path, payload] of [
      ['POST', 'test', {}],
      ['POST', 'describe', {}],
      ['PUT', 'credential', { secret: SECRET }],
    ] as const) {
      const answer = await call('ada', method, `/v1/connections/${connection.id}/${path}`, payload);
      expect(answer.statusCode, path).toBe(409);
      expect(answer.json(), path).toMatchObject({ code: 'connection_retired' });
    }
    expect(connector.asked.length).toBe(before);
    expect(await recordedTests(connection.id)).toEqual([]);
    expect(
      await tenantDb.withTenant(tenant, (trx) => usableCredentialOf(trx, connection.id)),
    ).toEqual({ answer: 'missing' });

    // Reinstated, it takes one again.
    const current = retired.json<ConnectionBody>();
    const reinstated = await call('ada', 'POST', `/v1/connections/${connection.id}/versions`, {
      openedFrom: current.version.id,
      settings: settings({ name: 'Unready' }),
    });
    expect(reinstated.json<ConnectionBody>().settings.retired).toBe(false);
    expect(
      (await call('ada', 'PUT', `/v1/connections/${connection.id}/credential`, { secret: SECRET }))
        .statusCode,
    ).toBe(200);
  });

  it('refuses settings by rule and a stale version with the current one, and lists what the caller may read by space', async () => {
    const invalid = await call('ada', 'POST', `/v1/spaces/${general}/connections`, {
      settings: { ...settings(), source: { ...settings().source, host: '127.1' } },
    });
    expect(invalid.statusCode).toBe(400);
    // A shape the contract refuses at the door, naming the member and never the value.
    expect(invalid.json()).toMatchObject({ code: 'invalid_request' });
    expect(invalid.json<{ message: string }>().message).toContain('settings.source.host');
    expect(invalid.body).not.toContain('127.1');
    // A string Postgres cannot store is the caller's mistake too, wherever it is: never a 500.
    for (const [member, over] of [
      ['settings.name', { name: 'Read\uD800ings' }],
      ['settings.description', { description: 'The \uDC00 sites.' }],
      ['settings.source.database', { source: { ...settings().source, database: 'read\uD800' } }],
      ['settings.source.account', { source: { ...settings().source, account: 'rea\uDC00der' } }],
    ] as const) {
      const unstorable = await call('ada', 'POST', `/v1/spaces/${general}/connections`, {
        settings: settings(over as Partial<ConnectionSettings>),
      });
      expect(unstorable.statusCode, member).toBe(400);
      expect(unstorable.json<{ message: string }>().message, member).toContain(member);
    }
    const asserted = await call('ada', 'POST', `/v1/spaces/${general}/connections`, {
      settings: settings({
        identity: { kind: 'endUser', mechanism: 'asserted', attribute: 'email' },
      }),
    });
    expect(asserted.statusCode).toBe(400);
    expect(asserted.json()).toMatchObject({
      code: 'identity_not_supported',
      rule: 'DAT-078',
      problems: [{ rule: 'identity_not_supported', type: 'postgres', mechanism: 'asserted' }],
    });
    const retired = await call('ada', 'POST', `/v1/spaces/${general}/connections`, {
      settings: settings({ retired: true }),
    });
    expect(retired.statusCode).toBe(400);
    expect(retired.json()).toMatchObject({
      code: 'connection_invalid',
      problems: [{ rule: 'connection_invalid', path: 'retired' }],
    });

    const connection = await make({ name: 'Versioned' }, quality);
    const changed = await call('ada', 'POST', `/v1/connections/${connection.id}/versions`, {
      openedFrom: connection.version.id,
      settings: settings({ name: 'Versioned', description: 'Moved.' }),
    });
    expect(changed.json<ConnectionBody>().version.number).toBe('0.2');
    const stale = await call('ada', 'POST', `/v1/connections/${connection.id}/versions`, {
      openedFrom: connection.version.id,
      settings: settings({ name: 'Versioned', description: 'Again.' }),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'version_precondition',
      current: { version: { number: '0.2' } },
    });

    const listed = await call('ada', 'GET', `/v1/connections?spaces=${quality}`);
    expect(listed.statusCode, listed.body).toBe(200);
    const page = listed.json<{ items: Json[]; total: number; facets: { spaces: Json[] } }>();
    expect(page.items.map((item) => item['name'])).toEqual(['Versioned']);
    expect(page.items[0]).toMatchObject({
      space: { id: quality, name: 'Quality' },
      type: 'postgres',
      retired: false,
      version: { number: '0.2' },
      credentialSet: false,
      lastTest: null,
    });
    expect(page.facets.spaces).toContainEqual(
      expect.objectContaining({ value: general, label: 'General' }),
    );
    // Grace reads General alone.
    const hers = (await call('grace', 'GET', '/v1/connections')).json<{ items: Json[] }>();
    expect(hers.items.every((item) => (item['space'] as Json)['id'] === general)).toBe(true);
  });
});
