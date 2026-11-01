import {
  bootstrapCluster,
  createSpace,
  createTenant,
  findRole,
  grant,
  migrate,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { DEFINITION_SCHEMA_VERSION } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

type Json = Record<string, unknown>;
const licence = (name: string, key: string, permits: string[]) => ({
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  name,
  key,
  base: 'en',
  names: [{ language: 'en', text: name }],
  permits,
  attribution: { required: true, wording: 'Photograph by Ada' },
});

describe('licences through the service (the AL plan, AL-B)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (as: string | null, method: 'GET' | 'POST', url: string, payload?: Json) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as === null ? {} : { cookie: cookies[as]! }) },
      ...(payload ? { payload } : {}),
    });
  const make = async (definition: Json) => {
    const made = await call('grace', 'POST', '/v1/definitions', { kind: 'licence', definition });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ id: string }>().id;
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
    await configureStandIn(db.adminUrl, tenant, { issuer: idp.issuer, clientId: 'alloy' });
    tenantDb = testTenantDatabase(db.serviceUrl);
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    // Alice is from outside the organisation and may read nothing but what is shared with her.
    await tenantDb.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: idp.issuer,
          subject: 'alice',
          email: null,
          display_name: 'Alice',
          kind: 'external',
        })
        .execute(),
    );
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    // Grace manages definitions; Ada holds roles in General and nothing at the tenant.
    await tenantDb.withTenant(tenant, async (trx) => {
      const manager = await findRole(trx, 'Definitions manager');
      await grant(trx, {
        roleId: manager!.id,
        subject: { principal: ids.grace! },
        level: { kind: 'tenant' },
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

  it('AST-022 lets anyone signed in read the licences an image may be held under, written by whoever manages definitions', async () => {
    const id = await make(licence('CC BY 4.0', 'cc_by_4', ['internal', 'publication']));
    expect((await call('ada', 'GET', '/v1/definitions')).statusCode).toBe(403);
    const listed = await call('ada', 'GET', '/v1/licences');
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ items: Json[] }>().items).toEqual([
      {
        id,
        version: { id: expect.any(String), number: '0.1' },
        licence: { ...licence('CC BY 4.0', 'cc_by_4', ['internal', 'publication']), id },
      },
    ]);
    const one = await call('ada', 'GET', `/v1/licences/${id}`);
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json()).toMatchObject({
      id,
      licence: { permits: ['internal', 'publication'], attribution: { required: true } },
    });
    // Ada may not write one; nobody from outside reads one; nor anybody unsigned.
    const refused = await call('ada', 'POST', '/v1/definitions', {
      kind: 'licence',
      definition: licence('Stock', 'stock', ['internal']),
    });
    expect(refused.statusCode).toBe(403);
    expect((await call('alice', 'GET', '/v1/licences')).json()).toEqual({ items: [] });
    expect((await call('alice', 'GET', `/v1/licences/${id}`)).statusCode).toBe(404);
    expect((await call(null, 'GET', '/v1/licences')).statusCode).toBe(401);
    // A definition of another kind is no licence.
    const field = await call('grace', 'POST', '/v1/definitions', {
      kind: 'field',
      definition: {
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        name: 'Credit',
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      },
    });
    expect(field.statusCode, field.body).toBe(200);
    const notOne = await call('ada', 'GET', `/v1/licences/${field.json<{ id: string }>().id}`);
    expect(notOne.statusCode).toBe(404);
  });
});
