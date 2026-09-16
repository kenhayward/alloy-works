import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  inviteToTenant,
  migrate,
  nameFirstAdministrator,
  permitGoogleSignIn,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const GOOGLE_HOST = 'acme-google.alloy.test';
const GOOGLE_SIGN_IN = 'signin.acme-google.alloy.test';

describe('signing in as the named first administrator', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;

  const explainTenant = async (user: string) => {
    const cookie = await signIn(app, HOST, user, idp.issuer);
    const me = await app.inject({ url: '/v1/me', headers: { host: HOST, cookie } });
    const id = me.json<{ id: string }>().id;
    return app.inject({
      url: `/v1/access/explain?principal=${id}&target=tenant`,
      headers: { host: HOST, cookie },
    });
  };

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
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('leaves a tenant nobody has been named for with nobody who administers it', async () => {
    const response = await explainTenant('grace');
    expect(response.statusCode).toBe(403);
  });

  it('makes the named identity administrator at their sign-in, and nobody else', async () => {
    await expect(
      nameFirstAdministrator(db.adminUrl, tenant, {
        issuer: idp.issuer,
        subject: 'ada',
        namedBy: 'provisioning',
      }),
    ).resolves.toEqual({ named: true });

    expect((await explainTenant('alice')).statusCode).toBe(403);
    const ada = await explainTenant('ada');
    expect(ada.statusCode).toBe(200);
    expect(
      ada.json<{ permissions: { permission: string; allowed: boolean }[] }>().permissions,
    ).toContainEqual(expect.objectContaining({ permission: 'administer', allowed: true }));

    // A second sign-in finds the naming used, and makes no second grant.
    expect((await explainTenant('ada')).statusCode).toBe(200);
    const grants = await tenantDb.withTenant(tenant, (trx) =>
      trx.selectFrom('access_grant').select('id').execute(),
    );
    expect(grants).toHaveLength(1);
  });
});

describe('signing in through Google as the named first administrator', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy-google',
          clientSecret: 'google-secret',
          redirectUris: [`http://${GOOGLE_SIGN_IN}/v1/sign-in/google/callback`],
        },
      ],
    });
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [GOOGLE_HOST],
    });
    await permitGoogleSignIn(db.adminUrl, tenant);
    await inviteToTenant(db.adminUrl, tenant, 'ada@example.com');
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({
        SECRET_GOOGLE: 'google-secret',
        SECRET_SIGN_IN_STATE: 'test-only-state-key-0123456789abcdef',
      }),
      google: { issuer: idp.issuer, clientId: 'alloy-google', signInHost: GOOGLE_SIGN_IN },
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  /** Signs `user` in to `tenant` through the Google route, and returns the session cookie. */
  async function signInWithGoogle(user: string): Promise<string> {
    const started = await app.inject({ url: '/v1/sign-in/google', headers: { host: GOOGLE_HOST } });
    const attempt = started.cookies.find((cookie) => cookie.name === '__Host-aw_signin');
    if (started.statusCode !== 302 || !attempt || !started.headers.location) {
      throw new Error(`Starting Google sign-in did not redirect: ${started.statusCode}`);
    }
    const back = await completeAtStandIn(started.headers.location, user, idp.issuer);
    const handedOff = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: GOOGLE_SIGN_IN },
    });
    if (handedOff.statusCode !== 302 || !handedOff.headers.location) {
      throw new Error(`Google hand-off did not redirect: ${handedOff.statusCode}`);
    }
    const next = new URL(handedOff.headers.location);
    const done = await app.inject({
      url: `${next.pathname}${next.search}`,
      headers: { host: next.host, cookie: `${attempt.name}=${attempt.value}` },
    });
    const session = done.cookies.find((cookie) => cookie.name === '__Host-aw_session');
    if (!session) throw new Error(`Google sign-in did not finish: ${done.statusCode} ${done.body}`);
    return `${session.name}=${session.value}`;
  }

  it('makes the named identity administrator at their sign-in through Google too', async () => {
    await expect(
      nameFirstAdministrator(db.adminUrl, tenant, {
        issuer: idp.issuer,
        subject: 'ada',
        namedBy: 'provisioning',
      }),
    ).resolves.toEqual({ named: true });

    const cookie = await signInWithGoogle('ada');
    const me = await app.inject({ url: '/v1/me', headers: { host: GOOGLE_HOST, cookie } });
    const id = me.json<{ id: string }>().id;
    const explanation = await app.inject({
      url: `/v1/access/explain?principal=${id}&target=tenant`,
      headers: { host: GOOGLE_HOST, cookie },
    });
    expect(explanation.statusCode).toBe(200);
    expect(
      explanation.json<{ permissions: { permission: string; allowed: boolean }[] }>().permissions,
    ).toContainEqual(expect.objectContaining({ permission: 'administer', allowed: true }));
  });
});
