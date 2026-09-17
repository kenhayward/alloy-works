import {
  bootstrapCluster,
  closeSignInRoute,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  inviteFirstAdministrator,
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

type Explained = { permissions: { permission: string; allowed: boolean }[] };

describe('the first administrator, arriving by invitation', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let organisation: Tenant;
  let google: Tenant;

  /** Whether `cookie`'s holder administers the environment at `host`, asked of the service itself. */
  const administers = async (host: string, cookie: string) => {
    const me = await app.inject({ url: '/v1/me', headers: { host, cookie } });
    const id = me.json<{ id: string }>().id;
    const response = await app.inject({
      url: `/v1/access/explain?principal=${id}&target=tenant`,
      headers: { host, cookie },
    });
    if (response.statusCode !== 200) return false;
    return response
      .json<Explained>()
      .permissions.some((answer) => answer.permission === 'administer' && answer.allowed);
  };

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
    if (!session) throw new Error(`Google sign-in did not finish: ${done.statusCode}`);
    return `${session.name}=${session.value}`;
  }

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
        {
          clientId: 'alloy-google',
          clientSecret: 'google-secret',
          redirectUris: [`http://${GOOGLE_SIGN_IN}/v1/sign-in/google/callback`],
        },
      ],
      users: [
        ...STAND_IN_USERS,
        { id: 'ada-unverified', name: 'Ada', email: 'ada@example.com', emailVerified: false },
      ],
    });
    organisation = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    google = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Demonstration' },
      hostnames: [GOOGLE_HOST],
    });
    // Invited before any route is permitted, as provisioning does it.
    for (const tenant of [organisation, google]) {
      await expect(
        inviteFirstAdministrator(db.adminUrl, tenant, {
          email: 'ada@example.com',
          namedBy: 'provisioning',
        }),
      ).resolves.toEqual({ invited: true, renewed: false });
    }
    await configureOrganisationSignIn(db.adminUrl, organisation, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    await permitGoogleSignIn(db.adminUrl, google);
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({
        SECRET_STAND_IN: 'stand-in-secret',
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

  it('IAM-059 arrives by an invitation to a named address, through a sign-in route the environment permits', async () => {
    // Through the organisation's provider: somebody else first, then the address unverified, then Ada.
    expect(await administers(HOST, await signIn(app, HOST, 'grace', idp.issuer))).toBe(false);
    expect(await administers(HOST, await signIn(app, HOST, 'ada-unverified', idp.issuer))).toBe(
      false,
    );
    expect(await administers(HOST, await signIn(app, HOST, 'ada', idp.issuer))).toBe(true);

    // Through Google, in an environment that permits only Google: the same invitation's shape.
    expect(await administers(GOOGLE_HOST, await signInWithGoogle('ada'))).toBe(true);

    // Nothing left to claim: the invitation was used, and a second invitation is refused.
    await expect(
      inviteFirstAdministrator(db.adminUrl, organisation, {
        email: 'grace@example.com',
        namedBy: 'provisioning',
      }),
    ).resolves.toEqual({ refused: 'first_administrator.administrator_exists' });
  });

  it('refuses to start a sign-in through a closed route, leaving the invitation waiting', async () => {
    const closed = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Sandbox' },
      hostnames: ['sandbox.acme.alloy.test'],
    });
    await inviteFirstAdministrator(db.adminUrl, closed, {
      email: 'ada@example.com',
      namedBy: 'provisioning',
    });
    await configureOrganisationSignIn(db.adminUrl, closed, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    await closeSignInRoute(db.adminUrl, closed, 'organisation');
    const started = await app.inject({
      url: '/v1/sign-in/organisation',
      headers: { host: 'sandbox.acme.alloy.test' },
    });
    expect(started.statusCode).toBe(404);
    const waiting = await tenantDb.withTenant(closed, (trx) =>
      trx.selectFrom('invitation').select('accepted_at').execute(),
    );
    expect(waiting).toEqual([{ accepted_at: null }]);
  });
});
