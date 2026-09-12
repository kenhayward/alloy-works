import { Writable } from 'node:stream';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { createObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

describe('a sample of this environment', () => {
  let db: TestDatabase;
  let store: TestObjectStore;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let cookie = '';

  beforeAll(async () => {
    db = await freshDatabase();
    store = await testObjectStore();
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
    await store.setUp(db.adminUrl, tenant);
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'info',
      logStream: new Writable({
        write(_chunk: Buffer, _encoding, done) {
          done();
        },
      }),
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
      objects: createObjectStores(store.settings, store.sealingKey),
    });
    cookie = await signIn(app, HOST, 'ada', idp.issuer);
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await store.drop();
    await db.drop();
  });

  const ask = () =>
    app.inject({ method: 'POST', url: '/v1/samples', headers: { host: HOST, cookie } });
  const fetchSample = (id: string) =>
    app.inject({ url: `/v1/samples/${id}`, headers: { host: HOST, cookie } });

  it('queues the work and answers at once, without waiting for it', async () => {
    const asked = await ask();
    expect(asked.statusCode).toBe(202);
    expect(asked.json()).toMatchObject({ state: 'queued', download: null });
    const { rows } = await queryAs(
      db.adminUrl,
      `select kind, subject_id, tenant_id from platform.job where subject_id = $1`,
      [asked.json().id as string],
    );
    expect(rows).toEqual([
      { kind: 'sample_pdf', subject_id: asked.json().id, tenant_id: tenant.id },
    ]);
  });

  it('hands out a link that fetches the PDF once a worker has made it', async () => {
    const id = (await ask()).json().id as string;
    // What a worker would do, without running one: the service's half of this is the link.
    const stores = createObjectStores(store.settings, store.sealingKey);
    const stored = await tenantDb.withTenant(tenant, async (trx) => {
      const tenantStore = await stores.forTenant(trx, tenant);
      return tenantStore.put(Buffer.from('%PDF-1.7 a sample'), 'application/pdf');
    });
    await queryAs(
      db.adminUrl,
      `update ${tenant.schema}.sample
          set state = 'done', object_key = $2, sha256 = $3, bytes = $4, engine = '0.15.1', finished_at = now()
        where id = $1`,
      [id, stored.key, stored.sha256, stored.size],
    );
    const answer = await fetchSample(id);
    expect(answer.json()).toMatchObject({ id, state: 'done' });
    const link = answer.json().download as string;
    const downloaded = await fetch(link);
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe('%PDF-1.7 a sample');
  });

  it('has nothing to say about a sample this environment never had', async () => {
    const answer = await fetchSample('11111111-2222-4333-8444-555555555555');
    expect(answer.statusCode).toBe(404);
    expect(answer.json()).toMatchObject({ code: 'sample_not_found' });
  });

  it('asks for a session before it looks at anything in the request', async () => {
    const answer = await app.inject({ url: '/v1/samples/not-a-uuid', headers: { host: HOST } });
    expect(answer.statusCode).toBe(401);
    expect(answer.json()).toMatchObject({ code: 'unauthenticated' });
  });
});
