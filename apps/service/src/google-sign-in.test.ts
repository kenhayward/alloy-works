import { Writable } from 'node:stream';
import {
  bootstrapCluster,
  createTenant,
  createTenantDatabase,
  inviteToTenant,
  migrate,
  permitGoogleSignIn,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import {
  STAND_IN_USERS,
  startStandInProvider,
  type StandInProvider,
} from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { verifyState } from './sign-in-state.js';

const SIGN_IN = 'signin.alloy.test';
const DEV = 'dev.acme.alloy.test';
const PRODUCTION = 'acme.alloy.test';
const OTHER = 'other.alloy.test';
const STATE_KEY = 'test-only-state-key-0123456789abcdef';

describe('signing in with a Google account', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let dev: Tenant;
  let other: Tenant;
  const lines: string[] = [];

  const options = (extra: Partial<AppOptions>): AppOptions => ({
    db: tenantDb,
    logLevel: 'info',
    logStream: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    }),
    oidc: createOidcClient({ allowInsecureIssuers: true }),
    secrets: environmentSecrets({
      SECRET_GOOGLE: 'google-secret',
      SECRET_SIGN_IN_STATE: STATE_KEY,
    }),
    ...extra,
  });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    // The stand-in plays Google: one client, returning only to the sign-in address.
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy-google',
          clientSecret: 'google-secret',
          redirectUris: [`http://${SIGN_IN}/v1/sign-in/google/callback`],
        },
      ],
      users: [
        ...STAND_IN_USERS,
        { id: 'eve', name: 'Eve', email: 'eve@example.com', emailVerified: false },
        { id: 'second-ada', name: 'Ada', email: 'ada@example.com' },
      ],
    });
    const acme = { id: 'acme', name: 'Acme' };
    dev = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: acme,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: [DEV],
    });
    await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: acme,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [PRODUCTION],
    });
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'other', name: 'Other' },
      tenant: { id: db.newTenantId(), name: 'Demonstration' },
      hostnames: [OTHER],
    });
    await permitGoogleSignIn(db.adminUrl, dev, { domains: ['example.org'] });
    await inviteToTenant(db.adminUrl, dev, 'Ada@Example.com');
    await inviteToTenant(db.adminUrl, dev, 'eve@example.com');
    await permitGoogleSignIn(db.adminUrl, other, { domains: ['example.org'] });
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp(
      options({ google: { issuer: idp.issuer, clientId: 'alloy-google', signInHost: SIGN_IN } }),
    );
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  const start = (host: string, target: FastifyInstance = app) =>
    target.inject({ url: '/v1/sign-in/google', headers: { host } });

  it('sends the browser to Google by way of the one sign-in address, bound to this browser', async () => {
    const response = await start(DEV);
    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location!);
    expect(location.origin).toBe(idp.issuer);
    expect(location.searchParams.get('redirect_uri')).toBe(
      `http://${SIGN_IN}/v1/sign-in/google/callback`,
    );
    const cookie = response.cookies.find((candidate) => candidate.name === '__Host-aw_signin');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  });

  it('names the environment, its address and the attempt, in a state only the service can sign', async () => {
    for (const [host, tenant] of [
      [DEV, dev],
      [OTHER, other],
    ] as const) {
      const response = await start(host);
      const state = new URL(response.headers.location!).searchParams.get('state')!;
      const attempt = response.cookies.find((c) => c.name === '__Host-aw_signin')!.value;
      expect(verifyState(STATE_KEY, state)).toEqual({ tenant: tenant.id, host, attempt });
    }
  });

  it('refuses to start where the environment does not permit Google (IAM-043)', async () => {
    const response = await start(PRODUCTION);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'sign_in_route_closed', rule: 'IAM-043' });
  });

  it('refuses to start when the service has no Google client', async () => {
    const without = buildApp(options({}));
    try {
      const response = await start(DEV, without);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'sign_in_route_closed' });
    } finally {
      await without.close();
    }
  });
});
