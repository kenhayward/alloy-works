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
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

describe('a mutating request with an idempotency key', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let cookie: string;
  let grace: string;
  let general: string;
  let quality: string;

  const post = (url: string, payload: object, key?: string) =>
    app.inject({
      method: 'POST',
      url,
      headers: { host: HOST, cookie, ...(key === undefined ? {} : { 'idempotency-key': key }) },
      payload,
    });
  const titles = async () =>
    (
      await app.inject({
        method: 'GET',
        url: '/v1/documents?limit=100',
        headers: { host: HOST, cookie },
      })
    )
      .json<{ items: { title: string }[] }>()
      .items.map((each) => each.title);
  const document = (title: string) => ({ title, language: 'en-GB', direction: 'ltr' });

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
    tenantDb = testTenantDatabase(db.serviceUrl);
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    // Grace authors in General; Quality she may read and not create in, until she is granted it.
    cookie = await signIn(app, HOST, 'grace', idp.issuer);
    grace = (
      await app.inject({ method: 'GET', url: '/v1/me', headers: { host: HOST, cookie } })
    ).json<{ id: string }>().id;
    await tenantDb.withTenant(tenant, async (trx) => {
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: grace },
        level: { kind: 'space', id: quality },
        effect: 'allow',
        grantedBy: grace,
      });
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('API-008 answers a retried request from its record, never doing the work twice', async () => {
    const first = await post(`/v1/spaces/${general}/documents`, document('Keyed report'), 'k-1');
    expect(first.statusCode).toBe(200);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    // The same request again with the same key - a retry after a lost answer - is the first's answer.
    const again = await post(`/v1/spaces/${general}/documents`, document('Keyed report'), 'k-1');
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect(again.headers['idempotent-replayed']).toBe('true');
    // And one document was made, not two.
    expect((await titles()).filter((title) => title === 'Keyed report')).toHaveLength(1);
    // Without a key, a request is its own: two make two.
    await post(`/v1/spaces/${general}/documents`, document('Unkeyed report'));
    await post(`/v1/spaces/${general}/documents`, document('Unkeyed report'));
    expect((await titles()).filter((title) => title === 'Unkeyed report')).toHaveLength(2);
  });

  it('refuses a key used for a different request, and keeps no refusal', async () => {
    await post(`/v1/spaces/${general}/documents`, document('First use'), 'k-2');
    const reused = await post(`/v1/spaces/${general}/documents`, document('Something else'), 'k-2');
    expect(reused.statusCode).toBe(422);
    expect(reused.json()).toMatchObject({ code: 'idempotency_key_reused', rule: 'API-008' });
    expect(await titles()).not.toContain('Something else');

    // Refused, and so nothing kept: the same request with the key, once she may, is done.
    const refused = await post(`/v1/spaces/${quality}/documents`, document('Quality plan'), 'k-3');
    expect(refused.statusCode).toBe(403);
    await tenantDb.withTenant(tenant, async (trx) => {
      const author = await findRole(trx, 'Author');
      await grant(trx, {
        roleId: author!.id,
        subject: { principal: grace },
        level: { kind: 'space', id: quality },
        effect: 'allow',
        grantedBy: grace,
      });
    });
    const done = await post(`/v1/spaces/${quality}/documents`, document('Quality plan'), 'k-3');
    expect(done.statusCode).toBe(200);
    expect(await titles()).toContain('Quality plan');
  });

  it('refuses a key that is not one', async () => {
    for (const key of ['', 'has a space', 'x'.repeat(256), 'café']) {
      const response = await post(`/v1/spaces/${general}/documents`, document('Bad key'), key);
      expect(response.statusCode, JSON.stringify(key)).toBe(400);
    }
    expect(await titles()).not.toContain('Bad key');
  });
});
