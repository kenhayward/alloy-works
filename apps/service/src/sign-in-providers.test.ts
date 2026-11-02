import { randomUUID } from 'node:crypto';
import {
  bootstrapCluster,
  closeProvider,
  createGroup,
  createTenant,
  inviteToTenant,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
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

const HOST = 'many.acme.alloy.test';
const CALLBACK = `http://${HOST}/v1/sign-in/organisation/callback`;

describe('more than one identity provider', () => {
  let db: TestDatabase;
  let staff: StandInProvider;
  let contractors: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let staffId: string;
  let contractorsId: string;

  const standIn = (users: Parameters<typeof startStandInProvider>[0]['users']) =>
    startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: STAND_IN_SECRET, redirectUris: [CALLBACK] }],
      ...(users === undefined ? {} : { users }),
    });

  /** Signs in through one provider, returning the cookie, or the status it was refused with. */
  async function through(providerId: string, at: StandInProvider, user: string) {
    const started = await app.inject({
      url: `/v1/sign-in/organisation?provider=${providerId}`,
      headers: { host: HOST },
    });
    if (started.statusCode !== 302) return { status: started.statusCode };
    const attempt = started.cookies.find((cookie) => cookie.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, user, at.issuer);
    const finished = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: HOST, cookie: `${attempt.name}=${attempt.value}` },
    });
    const session = finished.cookies.find((cookie) => cookie.name === '__Host-aw_session');
    return session
      ? { status: finished.statusCode, cookie: `${session.name}=${session.value}` }
      : { status: finished.statusCode };
  }

  const me = (cookie: string) => app.inject({ url: '/v1/me', headers: { host: HOST, cookie } });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    staff = await standIn([
      { id: 'ada', name: 'Ada', email: 'ada@example.com', groups: ['admins'] },
    ]);
    contractors = await standIn([
      { id: 'grace', name: 'Grace', email: 'grace@example.org', groups: ['admins'] },
      { id: 'mallory', name: 'Mallory', email: 'invited@example.com' },
    ]);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Many' },
      hostnames: [HOST],
    });
    staffId = await configureStandIn(db.adminUrl, tenant, {
      issuer: staff.issuer,
      clientId: 'alloy',
      name: 'Staff',
    });
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await staff.close();
    await contractors.close();
    await db.drop();
  });

  it('IAM-011 an invitation made before a provider was added is not claimed through it', async () => {
    await inviteToTenant(db.adminUrl, tenant, 'invited@example.com');
    contractorsId = await configureStandIn(db.adminUrl, tenant, {
      issuer: contractors.issuer,
      clientId: 'alloy',
      name: 'Contractors',
    });

    const signedIn = await through(contractorsId, contractors, 'mallory');
    expect(signedIn.cookie).toBeDefined();

    const [invitation] = await tenantDb.withTenant(tenant, (trx) =>
      trx.selectFrom('invitation').select('accepted_at').execute(),
    );
    expect(invitation?.accepted_at).toBeNull();
  });

  it('IAM-011 offers each open provider by name, and signs in through each, the session recording which', async () => {
    const offered = await app.inject({ url: '/v1/tenant', headers: { host: HOST } });
    expect(offered.json<{ providers: { name: string }[] }>().providers.map((p) => p.name)).toEqual([
      'Contractors',
      'Staff',
    ]);

    const ada = await through(staffId, staff, 'ada');
    const grace = await through(contractorsId, contractors, 'grace');
    expect((await me(ada.cookie!)).statusCode).toBe(200);
    expect((await me(grace.cookie!)).statusCode).toBe(200);

    const sessions = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('session as s')
        .innerJoin('principal as p', 'p.id', 's.principal_id')
        .select(['p.email', 's.provider_id'])
        .where('p.email', 'in', ['ada@example.com', 'grace@example.org'])
        .orderBy('p.email')
        .execute(),
    );
    expect(sessions).toEqual([
      { email: 'ada@example.com', provider_id: staffId },
      { email: 'grace@example.org', provider_id: contractorsId },
    ]);
  });

  it('IAM-011 sends a sign-in naming no provider to the page offering them, once more than one is open', async () => {
    const started = await app.inject({ url: '/v1/sign-in/organisation', headers: { host: HOST } });
    expect(started.statusCode).toBe(302);
    expect(started.headers.location).toBe('/');
  });

  it('IAM-011 a second provider asserting a value the first holds a group for joins nothing', async () => {
    await tenantDb.withTenant(tenant, (trx) =>
      createGroup(trx, 'Administrators', { providerValue: 'admins', providerId: staffId }),
    );
    await through(staffId, staff, 'ada');
    await through(contractorsId, contractors, 'grace');

    const members = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('group_member as m')
        .innerJoin('access_group as g', 'g.id', 'm.group_id')
        .innerJoin('principal as p', 'p.id', 'm.principal_id')
        .select('p.email')
        .where('g.name', '=', 'Administrators')
        .execute(),
    );
    expect(members).toEqual([{ email: 'ada@example.com' }]);
  });

  it("IAM-011 closing one provider ends only its sessions and its people's tokens, and signs nobody in through it again", async () => {
    const ada = await through(staffId, staff, 'ada');
    const grace = await through(contractorsId, contractors, 'grace');
    const tokenOf = async (cookie: string) => {
      const made = await app.inject({
        method: 'POST',
        url: '/v1/tokens',
        headers: { host: HOST, cookie, 'idempotency-key': randomUUID() },
        payload: {
          name: 'Automation',
          scopes: [],
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      });
      expect(made.statusCode, made.body).toBe(200);
      return made.json<{ secret: string }>().secret;
    };
    const adaToken = await tokenOf(ada.cookie!);
    const graceToken = await tokenOf(grace.cookie!);
    const bearing = (token: string) =>
      app.inject({
        url: '/v1/me',
        headers: { host: HOST, authorization: `Bearer ${token}` },
      });

    await closeProvider(db.adminUrl, tenant, contractorsId);

    expect((await me(grace.cookie!)).statusCode).toBe(401);
    expect((await me(ada.cookie!)).statusCode).toBe(200);
    expect((await bearing(graceToken)).statusCode).toBe(401);
    expect((await bearing(adaToken)).statusCode).toBe(200);
    expect((await through(contractorsId, contractors, 'grace')).status).toBe(404);
    const offered = await app.inject({ url: '/v1/tenant', headers: { host: HOST } });
    expect(offered.json<{ providers: { name: string }[] }>().providers.map((p) => p.name)).toEqual([
      'Staff',
    ]);
  });
});
