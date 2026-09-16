// apps/service/src/cross-tenant.test.ts
import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
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
import { signIn } from './test/sign-in.js';

const A = 'acme.alloy.test';
const B = 'dev.acme.alloy.test';

const authenticated = allRoutes.filter((route) => route.access.check !== 'none');

/**
 * For each route with path parameters: how to name, in its path, something belonging to environment
 * B. A route with parameters must have an entry here, or the harness fails - the case this table
 * exists for is the one a filter would forget (IAM-004).
 */
const OTHER_TENANT_IDS: Readonly<
  Record<string, (tenant: Tenant, db: TenantDatabase) => Promise<Record<string, string>>>
> = {
  getSample: async (tenant, db) => ({
    sampleId: await db.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'grace',
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sample = await trx
        .insertInto('sample')
        .values({ requested_by: principal.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      return sample.id;
    }),
  }),
};

/** A component in environment B's General space, as a query's target names it. */
const componentIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const artifact = await trx
      .insertInto('artifact')
      .values({ kind: 'component', space_id: general.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    return `artifact:${artifact.id}`;
  });

/**
 * For each route whose permission's target is a query member: the query naming something belonging to
 * environment B. As with path parameters, a route missing here fails the harness.
 */
const OTHER_TENANT_QUERIES: Readonly<
  Record<string, (tenant: Tenant, db: TenantDatabase) => Promise<string>>
> = {
  getAccess: async (tenant, db) => `target=${await componentIn(tenant, db)}`,
  explainAccess: async (tenant, db) => {
    const principal = await db.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'alice',
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    return `principal=${principal.id}&target=${await componentIn(tenant, db)}`;
  },
};

const withParameters = authenticated.filter((route) => route.path.includes('{'));
const withQueryTargets = allRoutes.filter(
  (route) => route.access.check === 'permission' && 'query' in route.access.target,
);
const fill = (path: string, ids: Record<string, string>) =>
  path.replace(/\{(\w+)\}/g, (_match, name: string) => ids[name] ?? '');

describe("no environment accepts another environment's session (IAM-004)", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let fromA = '';
  let a: Tenant;
  let b: Tenant;
  const othersIds: Record<string, Record<string, string>> = {};
  const othersQueries: Record<string, string> = {};

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [A, B].map((host) => `http://${host}/v1/sign-in/organisation/callback`),
        },
      ],
    });
    for (const [host, name] of [
      [A, 'Production'],
      [B, 'Development'],
    ] as const) {
      const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id: db.newTenantId(), name },
        hostnames: [host],
      });
      if (host === A) a = tenant;
      if (host === B) b = tenant;
      await configureOrganisationSignIn(db.adminUrl, tenant, {
        issuer: idp.issuer,
        clientId: 'alloy',
        secretName: 'stand_in',
      });
    }
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    fromA = await signIn(app, A, 'ada', idp.issuer);
    for (const route of withParameters) {
      othersIds[route.operationId] = await OTHER_TENANT_IDS[route.operationId]!(b, tenantDb);
    }
    // Ada administers environment A, so a refusal below is the other environment's, not her own lack.
    const me = await app.inject({ url: '/v1/me', headers: { host: A, cookie: fromA } });
    const ada = me.json<{ id: string }>().id;
    await tenantDb.withTenant(a, async (trx) => {
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
    });
    for (const route of withQueryTargets) {
      const query = OTHER_TENANT_QUERIES[route.operationId];
      if (query) othersQueries[route.operationId] = await query(b, tenantDb);
    }
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('has authenticated routes to test', () => {
    expect(authenticated.length).toBeGreaterThan(0);
  });

  it('knows how to address the other environment for every route with path parameters', () => {
    for (const route of withParameters) {
      expect(OTHER_TENANT_IDS[route.operationId], route.operationId).toBeDefined();
    }
  });

  it.each(authenticated.map((route) => [route.operationId, route] as const))(
    '%s refuses a session from another environment',
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        url: fill(route.path, othersIds[name] ?? {}),
        headers: { host: B, cookie: fromA },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'unauthenticated' });
    },
  );

  it.each(withParameters.map((route) => [route.operationId, route] as const))(
    "%s will not reach another environment's data through this one's address",
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        url: fill(route.path, othersIds[name] ?? {}),
        headers: { host: A, cookie: fromA },
      });
      expect(response.statusCode).toBe(404);
    },
  );

  it('knows how to address the other environment for every route whose target is in its query', () => {
    expect(withQueryTargets.length).toBeGreaterThan(0);
    for (const route of withQueryTargets) {
      expect(OTHER_TENANT_QUERIES[route.operationId], route.operationId).toBeDefined();
    }
  });

  it.each(withQueryTargets.map((route) => [route.operationId, route] as const))(
    "%s will not reach another environment's target through this one's address",
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        url: `${route.path}?${othersQueries[name]}`,
        headers: { host: A, cookie: fromA },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'not_found' });
    },
  );

  it('leaves the session working where it was issued, whatever was tried elsewhere', async () => {
    const me = await app.inject({ url: '/v1/me', headers: { host: A, cookie: fromA } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ environment: 'Production' });
  });
});
