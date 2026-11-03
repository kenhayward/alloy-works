import { allRoutes } from '@alloy-works/api-contract';
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

const HOST = 'risk.acme.alloy.test';
const CALLBACK = `http://${HOST}/v1/sign-in/organisation/callback`;
const USERS = ['ada', 'grace', 'hedy', 'mary', 'joan', 'ivy', 'rosalind', 'emmy'].map((id) => ({
  id,
  name: id,
  email: `${id}@acme.example`,
}));

/** Which permission decides each route split out of `administer`: pinned by literal (identity.md). */
const SPLIT: Readonly<Record<string, readonly string[]>> = {
  export_environment: [
    'requestTenantExport',
    'listTenantExports',
    'getTenantExport',
    'downloadTenantExport',
  ],
  export_audit: ['requestAuditExport', 'getAuditExport', 'downloadAuditExport'],
  hold: ['placeHold', 'releaseHold', 'listHolds'],
  rotate_secrets: [
    'setConnectionCredential',
    'setModelEndpointKey',
    'rotateWebhookSecret',
    'replaceProviderSecret',
    'issueScimToken',
  ],
  configure_services: [
    'createConnection',
    'recordConnectionVersion',
    'listModelEndpoints',
    'makeModelEndpoint',
    'getModelEndpoint',
    'changeModelEndpoint',
    'retireModelEndpoint',
    'testModelEndpoint',
    'listModelRoutes',
    'setModelRoute',
    'setReferenceSource',
    'getCtStudio',
    'disconnectCtStudio',
    'getBridgeSettings',
    'putBridgeSettings',
    'getSignInSettings',
    'addProvider',
    'changeProvider',
    'closeProvider',
    'setGoogleSignIn',
    'setSessionSettings',
    'turnScimOn',
    'turnScimOff',
  ],
  configure_webhooks: [
    'listWebhooks',
    'createWebhook',
    'getWebhook',
    'changeWebhook',
    'removeWebhook',
    'listWebhookDeliveries',
    'getWebhookDelivery',
  ],
};

describe('the high-risk permissions', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let ada: { cookie: string; id: string };

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
      tenant: { id: db.newTenantId(), name: 'Risk' },
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
    ada = await holding('ada', 'Administrator');
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

  /** Signs somebody in, holding a role at the environment: `name`, made with `permissions` if given. */
  async function holding(user: string, name: string, permissions?: readonly string[]) {
    const cookie = await signIn(user);
    const { id } = (await get('/v1/me', cookie)).json<{ id: string }>();
    const grant = await tenantDb.withTenant(tenant, async (trx) => {
      const role = permissions
        ? await trx
            .insertInto('role')
            .values({ name, permissions: permissions as never })
            .returning('id')
            .executeTakeFirstOrThrow()
        : await trx
            .selectFrom('role')
            .select('id')
            .where('name', '=', name)
            .executeTakeFirstOrThrow();
      return trx
        .insertInto('access_grant')
        .values({
          principal_id: id,
          role_id: role.id,
          level: 'tenant',
          effect: 'allow',
          granted_by: id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    });
    return { cookie, id, grant: grant.id };
  }

  const get = (url: string, cookie: string) => app.inject({ url, headers: { host: HOST, cookie } });
  const post = (url: string, cookie: string, payload: object) =>
    app.inject({ method: 'POST', url, headers: { host: HOST, cookie }, payload });

  it('decides each route split out of administer by its own permission', () => {
    for (const [permission, operations] of Object.entries(SPLIT)) {
      for (const operation of operations) {
        const route = allRoutes.find((each) => each.operationId === operation);
        expect(route?.access, operation).toMatchObject({ permission });
      }
    }
  });

  it('IMP-023 refuses a whole-tenant export and its download to one holding export_environment without export_audit', async () => {
    const without = await holding('rosalind', 'Exporter, no log', ['read', 'export_environment']);
    const both = await holding('emmy', 'Exporter', ['read', 'export_environment', 'export_audit']);
    expect((await post('/v1/exports', without.cookie, {})).statusCode).toBe(403);
    const asked = await post('/v1/exports', both.cookie, {});
    expect(asked.statusCode).toBe(200);
    // The archive holds the log, so downloading one asks the same of its holder.
    const { id } = asked.json<{ export: { id: string } }>().export;
    const download = `/v1/exports/${id}/download`;
    expect((await get(download, without.cookie)).statusCode).toBe(403);
    expect((await get(download, both.cookie)).json()).toMatchObject({ code: 'export_not_ready' });
    // A part holds no log, so needs only export_environment (EI-R).
    expect((await post('/v1/exports', without.cookie, { scope: 'configuration' })).statusCode).toBe(
      200,
    );
  });

  it('leaves what grants access or makes a token that edits with administer', () => {
    for (const operation of ['connectCtStudio', 'issueCtStudioToken']) {
      const route = allRoutes.find((each) => each.operationId === operation);
      expect(route?.access, operation).toMatchObject({ permission: 'administer' });
    }
  });

  it('an Administrator keeps every act after the migration; a role without export_audit cannot export the audit', async () => {
    const auditor = await holding('grace', 'Audit exporter', ['read', 'export_audit']);
    const admin = await holding('hedy', 'Plain administrator', ['read', 'administer']);

    expect((await post('/v1/audit/exports', ada.cookie, {})).statusCode).toBe(200);
    expect((await post('/v1/audit/exports', auditor.cookie, {})).statusCode).toBe(200);
    expect((await post('/v1/audit/exports', admin.cookie, {})).statusCode).toBe(403);

    // Each holds its own and not the rest: administer alone grants no split act.
    for (const url of ['/v1/holds', '/v1/exports', '/v1/webhooks', '/v1/model-endpoints']) {
      expect((await get(url, ada.cookie)).statusCode, url).toBe(200);
      expect((await get(url, auditor.cookie)).statusCode, url).toBe(403);
      expect((await get(url, admin.cookie)).statusCode, url).toBe(403);
    }
    // What stayed administer's stays out of the narrower role's reach.
    expect((await get('/v1/audit', auditor.cookie)).statusCode).toBe(403);
    expect((await get('/v1/audit', admin.cookie)).statusCode).toBe(200);

    const token = await post('/v1/tokens', ada.cookie, {
      name: 'Holds alone',
      scopes: ['hold'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const bearer = {
      host: HOST,
      authorization: `Bearer ${token.json<{ secret: string }>().secret}`,
    };
    expect((await app.inject({ url: '/v1/holds', headers: bearer })).statusCode).toBe(200);
    expect((await app.inject({ url: '/v1/exports', headers: bearer })).statusCode).toBe(403);
  });

  it("IAM-032 explains another person's permissions to an administrator without a session of theirs, and a disabled person's as refused", async () => {
    const mary = await holding('mary', 'Webhook keeper', ['read', 'configure_webhooks']);
    const explain = async () =>
      (await get(`/v1/access/explain?principal=${mary.id}&target=tenant`, ada.cookie)).json<{
        disabled: boolean;
        permissions: { permission: string; allowed: boolean; reason: string }[];
      }>();
    const open = await explain();
    expect(open.disabled).toBe(false);
    expect(open.permissions.find((each) => each.permission === 'configure_webhooks')).toMatchObject(
      { allowed: true, reason: 'allowed' },
    );
    expect(open.permissions.find((each) => each.permission === 'hold')).toMatchObject({
      allowed: false,
      reason: 'not_granted',
    });

    const disabled = await post(`/v1/principals/${mary.id}/disablement`, ada.cookie, {});
    expect(disabled.statusCode, disabled.body).toBe(200);
    const shut = await explain();
    expect(shut.disabled).toBe(true);
    expect(shut.permissions.length).toBeGreaterThan(0);
    for (const each of shut.permissions) {
      expect(each).toMatchObject({ allowed: false, reason: 'disabled' });
    }
  });

  it('counts configure_services, not administer, as who can configure sign-in', async () => {
    const joan = await holding('joan', 'Services alone', ['read', 'configure_services']);
    expect((await get('/v1/sign-in-settings', joan.cookie)).statusCode).toBe(200);
    const denied = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('role')
        .select('id')
        .where('name', '=', 'Services alone')
        .executeTakeFirstOrThrow(),
    );
    const refused = await post('/v1/grants', ada.cookie, {
      role: denied.id,
      subject: { principal: joan.id },
      level: 'tenant',
      effect: 'deny',
    });
    expect(refused.json()).toMatchObject({ code: 'grant_administer_denied_at_tenant' });

    // Joan is left the only one who can configure sign-in, though Ivy administers.
    const ivy = await holding('ivy', 'Bare administrator', ['read', 'administer']);
    await tenantDb.withTenant(tenant, (trx) =>
      trx.deleteFrom('access_grant').where('principal_id', '=', ada.id).execute(),
    );
    const removing = await app.inject({
      method: 'DELETE',
      url: `/v1/grants/${joan.grant}`,
      headers: { host: HOST, cookie: ivy.cookie },
    });
    expect(removing.json()).toMatchObject({ code: 'last_way_in' });
  });
});
