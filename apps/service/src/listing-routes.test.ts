import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  migrate,
  seedDevelopmentContent,
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

interface Page {
  items: { id: string; title?: string; name?: string }[];
  next: string | null;
}

describe('the listings through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let cookie: string;

  const get = (url: string) => app.inject({ method: 'GET', url, headers: { host: HOST, cookie } });

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
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    // Grace reads General, where the seed's components, documents and templates are.
    cookie = await signIn(app, HOST, 'grace', idp.issuer);
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  /** Every page of a listing, a page of one at a time, by the cursor each gives. */
  async function walk(path: string): Promise<string[]> {
    const seen: string[] = [];
    let url = `${path}${path.includes('?') ? '&' : '?'}limit=1`;
    for (let turned = 0; turned < 50; turned += 1) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(200);
      const page = response.json<Page>();
      seen.push(...page.items.map((each) => each.id));
      if (page.next === null) return seen;
      url = `${path}${path.includes('?') ? '&' : '?'}limit=1&cursor=${page.next}`;
    }
    throw new Error('The walk never ended');
  }

  it('pages each content listing by its cursor, in each sort, to what it lists whole', async () => {
    for (const [path, sorts] of [
      ['/v1/components', ['title', 'changed']],
      ['/v1/documents', ['title', 'changed']],
      ['/v1/publications', ['published', 'title']],
      ['/v1/templates', ['name', 'changed']],
    ] as const) {
      for (const sort of sorts) {
        for (const order of ['asc', 'desc']) {
          const query = `${path}?sort=${sort}&order=${order}`;
          const whole = (await get(`${query}&limit=100`)).json<Page>();
          expect(whole.next, query).toBeNull();
          expect(await walk(query), query).toEqual(whole.items.map((each) => each.id));
        }
      }
    }
  });

  it('sorts by the sort asked for, its default when none is', async () => {
    const titles = (await get('/v1/components?limit=100'))
      .json<Page>()
      .items.map((each) => each.title);
    expect(titles).toEqual(
      [...titles].sort((a, b) => a!.localeCompare(b!, 'en', { sensitivity: 'base' })),
    );
    const names = (await get('/v1/templates?order=desc&limit=100'))
      .json<Page>()
      .items.map((each) => each.name);
    expect(names).toEqual(
      [...names].sort((a, b) => b!.localeCompare(a!, 'en', { sensitivity: 'base' })),
    );
  });

  it("refuses a cursor that is another listing's, another sort's, or none any listing gave out", async () => {
    const first = (await get('/v1/components?sort=title&limit=1')).json<Page>();
    expect(first.next).not.toBeNull();
    for (const url of [
      `/v1/documents?cursor=${first.next}`,
      `/v1/components?sort=changed&cursor=${first.next}`,
      `/v1/components?sort=title&order=desc&cursor=${first.next}`,
      '/v1/components?cursor=bm90LWEtY3Vyc29y',
      '/v1/templates?cursor=%7B%7D',
    ]) {
      const response = await get(url);
      expect(response.statusCode, url).toBe(400);
      expect(response.json(), url).toMatchObject({ code: 'invalid_request' });
    }
    // Nor one made to look like a cursor, whose snapshot or key Postgres would not read: each is
    // refused as the caller's, never failed as the service's.
    const forged = (sort: string, snapshot: string, keys: string[]) =>
      Buffer.from(
        JSON.stringify({
          v: 1,
          l: 'components',
          s: sort,
          o: sort === 'title' ? 'asc' : 'desc',
          n: snapshot,
          k: keys,
          i: '00000000-0000-4000-8000-000000000001',
        }),
      ).toString('base64url');
    for (const [sort, snapshot, keys] of [
      ['title', '99999999999999999999:99999999999999999999:', ['Anything']],
      ['title', '9:3:', ['Anything']],
      ['title', '3:9:12', ['Anything']],
      ['title', '3:9:7,5', ['Anything']],
      ['changed', '3:9:', ['2026-13-45 99:99:99+00']],
      ['changed', '3:9:', ['2026-09-27 10:00:00+00', 'one key too many']],
    ] as const) {
      const url = `/v1/components?sort=${sort}&cursor=${forged(sort, snapshot, [...keys])}`;
      const response = await get(url);
      expect(response.statusCode, `${snapshot} ${keys.join()}`).toBe(400);
    }
    // Its own listing, sort and order take it.
    expect((await get(`/v1/components?sort=title&cursor=${first.next}`)).statusCode).toBe(200);
  });
});
