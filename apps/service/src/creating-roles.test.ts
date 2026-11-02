import { bootstrapCluster, createTenant, migrate, type Tenant } from '@alloy-works/db';
import type { TenantDatabase } from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, STAND_IN_SECRET, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'roles.acme.alloy.test';
const CALLBACK = `http://${HOST}/v1/sign-in/organisation/callback`;
const USERS = ['ada', 'ivy'].map((id) => ({ id, name: id, email: `${id}@acme.example` }));

describe('making a role', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let ada: string;
  let adaId: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: STAND_IN_SECRET, redirectUris: [CALLBACK] }],
      users: USERS,
    });
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Roles' },
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
    });
    await app.ready();
    ada = await signIn('ada');
    adaId = (await call('GET', '/v1/me', ada)).json<{ id: string }>().id;
    await tenantDb.withTenant(tenant, async (trx) => {
      const role = await trx
        .selectFrom('role')
        .select('id')
        .where('name', '=', 'Administrator')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('access_grant')
        .values({
          principal_id: adaId,
          role_id: role.id,
          level: 'tenant',
          effect: 'allow',
          granted_by: adaId,
        })
        .execute();
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  async function signIn(user: string) {
    const started = await app.inject({ url: '/v1/sign-in/organisation', headers: { host: HOST } });
    const attempt = started.cookies.find((cookie) => cookie.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, user, idp.issuer);
    const finished = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: HOST, cookie: `${attempt.name}=${attempt.value}` },
    });
    const session = finished.cookies.find((cookie) => cookie.name === '__Host-aw_session')!;
    return `${session.name}=${session.value}`;
  }

  function call(method: 'GET' | 'POST', url: string, cookie: string, payload?: object) {
    return app.inject({
      method,
      url,
      headers: { host: HOST, cookie },
      ...(payload ? { payload } : {}),
    });
  }

  it('IAM-021 an administrator defines a role, which is listed and can be granted', async () => {
    const made = await call('POST', '/v1/roles', ada, {
      name: '  Proofreader ',
      permissions: ['read', 'comment'],
    });
    expect(made.statusCode, made.body).toBe(200);
    const { role } = made.json<{ role: { id: string; name: string; permissions: string[] } }>();
    expect(role).toMatchObject({ name: 'Proofreader', permissions: ['read', 'comment'] });

    const listed = await call('GET', '/v1/roles?level=tenant', ada);
    expect(listed.json<{ items: { id: string }[] }>().items.map((each) => each.id)).toContain(
      role.id,
    );
    const granted = await call('POST', '/v1/grants', ada, {
      role: role.id,
      subject: { principal: adaId },
      level: 'tenant',
      effect: 'allow',
    });
    expect(granted.statusCode, granted.body).toBe(200);
  });

  it('records who made it and what it holds', async () => {
    await call('POST', '/v1/roles', ada, { name: 'Commenter', permissions: ['read', 'comment'] });
    const events = await call('GET', '/v1/audit?kind=role.made&limit=100', ada);
    expect(events.statusCode, events.body).toBe(200);
    const items = events.json<{ items: { detail: unknown; labels: unknown }[] }>().items;
    expect(items.map((each) => each.detail)).toContainEqual({ permissions: ['read', 'comment'] });
  });

  it('refuses a name already taken, whatever else it says', async () => {
    const taken = await call('POST', '/v1/roles', ada, { name: 'Author', permissions: ['read'] });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ code: 'role_name_taken' });
  });

  it('refuses a permission twice, none, or one the product does not have', async () => {
    const twice = await call('POST', '/v1/roles', ada, {
      name: 'Twice',
      permissions: ['read', 'read'],
    });
    expect(twice.statusCode).toBe(409);
    expect(twice.json()).toMatchObject({ code: 'role_repeated_permission' });
    for (const permissions of [[], ['fly']]) {
      const refused = await call('POST', '/v1/roles', ada, { name: 'Nothing', permissions });
      expect(refused.statusCode, JSON.stringify(permissions)).toBe(400);
    }
  });

  it('is not for somebody who does not administer the environment', async () => {
    const ivy = await signIn('ivy');
    const refused = await call('POST', '/v1/roles', ivy, { name: 'Mine', permissions: ['read'] });
    expect(refused.statusCode).toBe(403);
  });
});
