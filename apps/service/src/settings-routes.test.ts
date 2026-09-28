// apps/service/src/settings-routes.test.ts
import {
  bootstrapCluster,
  createSpace,
  createTenant,
  createTenantDatabase,
  editingPolicy,
  findRole,
  grant,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const PATH = '/v1/settings/editing';

describe("the environment's editing settings through the service", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (as: string | undefined, method: 'GET' | 'PUT', payload?: object) =>
    app.inject({
      method,
      url: PATH,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

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
    await configureStandIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({
        SECRET_SIGN_IN_STATE: 'test-only-state-key-0123456789abcdef',
      }),
      sealingKey: TEST_SEALING_KEY,
    });
    for (const user of ['ada', 'grace', 'alice', 'ivy']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (
        await app.inject({ url: '/v1/me', headers: { host: HOST, cookie: cookies[user]! } })
      ).json<{ id: string }>().id;
    }
    // Ada administers the environment; Grace administers one space only; Ivy authors across the
    // whole environment, which is no administering of it; Alice holds nothing.
    await tenantDb.withTenant(tenant, async (trx) => {
      const administrator = (await findRole(trx, 'Administrator'))!.id;
      const clinical = (await createSpace(trx, 'Clinical')).id;
      await grant(trx, {
        roleId: administrator,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      await grant(trx, {
        roleId: (await findRole(trx, 'Author'))!.id,
        subject: { principal: ids.ivy! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      await grant(trx, {
        roleId: administrator,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('VER-004 states the window, 30 days by default, to anybody signed in, and to nobody else', async () => {
    for (const user of ['ada', 'grace', 'alice', 'ivy']) {
      const answer = await call(user, 'GET');
      expect(answer.statusCode, user).toBe(200);
      expect(answer.json(), user).toEqual({ iterationRetentionDays: 30 });
    }
    expect((await call(undefined, 'GET')).statusCode).toBe(401);
  });

  it("VER-004 lets an administrator of the environment change the window, and refuses anybody else's change", async () => {
    for (const user of ['grace', 'alice', 'ivy']) {
      const refused = await call(user, 'PUT', { iterationRetentionDays: 7 });
      expect(refused.statusCode, user).toBe(403);
      expect(refused.json(), user).toMatchObject({ code: 'forbidden' });
    }
    expect((await call(undefined, 'PUT', { iterationRetentionDays: 7 })).statusCode).toBe(401);
    expect(await tenantDb.withTenant(tenant, (trx) => editingPolicy(trx))).toEqual({
      iterationRetentionDays: 30,
    });

    const changed = await call('ada', 'PUT', { iterationRetentionDays: 90 });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ iterationRetentionDays: 90 });
    expect((await call('alice', 'GET')).json()).toEqual({ iterationRetentionDays: 90 });
    expect(await tenantDb.withTenant(tenant, (trx) => editingPolicy(trx))).toEqual({
      iterationRetentionDays: 90,
    });
  });

  it('answers a window outside 1 to 365 whole days as a bad request, and changes nothing', async () => {
    for (const payload of [
      { iterationRetentionDays: 0 },
      { iterationRetentionDays: 366 },
      { iterationRetentionDays: 2.5 },
      {},
    ]) {
      const answer = await call('ada', 'PUT', payload);
      expect(answer.statusCode, JSON.stringify(payload)).toBe(400);
      expect(answer.json(), JSON.stringify(payload)).toMatchObject({ code: 'invalid_request' });
    }
    expect((await call('ada', 'GET')).json()).toEqual({ iterationRetentionDays: 90 });
  });
});
