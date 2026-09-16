import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  migrate,
  nameFirstAdministrator,
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
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

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
