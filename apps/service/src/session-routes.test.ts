import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  migrate,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

describe('a session', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;

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
    const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
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

  it('says who is signed in, and to which environment', async () => {
    const cookie = await signIn(app, HOST, 'ada', idp.issuer);
    const me = await app.inject({ url: '/v1/me', headers: { host: HOST, cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      displayName: 'Ada',
      email: 'ada@example.com',
      environment: 'Production',
    });
  });

  it('is required: without one, the answer is unauthenticated', async () => {
    const me = await app.inject({ url: '/v1/me', headers: { host: HOST } });
    expect(me.statusCode).toBe(401);
    expect(me.json()).toMatchObject({ code: 'unauthenticated' });
  });

  it('ends on signing out, and the same cookie is refused from then on', async () => {
    const cookie = await signIn(app, HOST, 'grace', idp.issuer);
    const out = await app.inject({
      method: 'POST',
      url: '/v1/sign-out',
      headers: { host: HOST, cookie },
    });
    expect(out.statusCode).toBe(204);
    const cleared = out.cookies.find((candidate) => candidate.name === '__Host-aw_session');
    expect(cleared?.maxAge).toBe(0);
    const after = await app.inject({ url: '/v1/me', headers: { host: HOST, cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('refuses a token nobody issued', async () => {
    const me = await app.inject({
      url: '/v1/me',
      headers: { host: HOST, cookie: '__Host-aw_session=made-up' },
    });
    expect(me.statusCode).toBe(401);
  });
});
