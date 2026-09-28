import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createDocument,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  recordPublication,
  requestPublication,
  seedDevelopmentContent,
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
  let tenant: Tenant;

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
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    // Grace reads General, where the seed's components, documents and templates are, and - for the
    // access listings, which only an administrator reads - administers the environment.
    cookie = await signIn(app, HOST, 'grace', idp.issuer);
    const grace = (await get('/v1/me')).json<{ id: string }>().id;
    await tenantDb.withTenant(tenant, async (trx) => {
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: grace },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: grace,
      });
      // Two documents in General, one published twice, so every content listing has pages to turn.
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      for (const title of ['Pump manual', 'Valve manual']) {
        const made = await createDocument(trx, {
          spaceId: general.id,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: grace,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        for (let times = 0; times < 2; times += 1) {
          const asked = await requestPublication(trx, {
            documentId: made.version.artifactId,
            version: made.version.id,
            formats: ['pdf'],
            requester: grace,
          });
          if (asked.answer !== 'requested') throw new Error(asked.answer);
          await recordPublication(trx, {
            requestId: asked.request.id,
            pipelineVersion: '2',
            fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
            dataSha256: 'b'.repeat(64),
            numbering: { scheme: 'default/1', entries: [] },
            outputs: [
              {
                format: 'pdf' as const,
                engineVersion: '0.15.1',
                templateVersion: 2,
                key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
                sha256: 'c'.repeat(64),
                bytes: 1,
              },
            ],
          });
        }
      }
    });
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

  it('API-007 pages every listing by an opaque cursor over a stable order', async () => {
    // Two waiting invitations, so the invitations listing has pages to turn.
    for (const email of ['ivy@example.com', 'joan@example.com']) {
      const sent = await app.inject({
        method: 'POST',
        url: '/v1/invitations',
        headers: { host: HOST, cookie },
        payload: { email },
      });
      expect(sent.statusCode, email).toBe(200);
    }
    const spaces = (await get('/v1/spaces?limit=100')).json<Page>();
    const general = spaces.items.find((each) => each.name === 'General')!.id;
    const documents = (await get('/v1/documents?limit=100')).json<Page>();
    const document = documents.items[0]?.id;
    expect(document, 'a document to list the publications of').toBeDefined();
    const components = (await get('/v1/components?limit=100')).json<Page>();
    const component = components.items[0]?.id;
    expect(component, 'a component to list the versions of').toBeDefined();
    // Two iterations of Grace's, saved from a session that holds the component, so the Recovery
    // listing has pages to turn: it answers only the caller's own, and only under the lock.
    const session = '22222222-2222-4222-8222-222222222222';
    const opened = (await get(`/v1/components/${component}`)).json<{
      version: { id: string };
      content: Record<string, unknown>;
    }>();
    const claimed = await app.inject({
      method: 'POST',
      url: `/v1/components/${component}/lock`,
      headers: { host: HOST, cookie },
      payload: { session },
    });
    expect(claimed.statusCode).toBe(200);
    for (const sequence of [1, 2]) {
      const saved = await app.inject({
        method: 'PUT',
        url: `/v1/components/${component}/iterations/${session}/${sequence}`,
        headers: { host: HOST, cookie },
        payload: {
          openedFrom: opened.version.id,
          content: { ...opened.content, title: `Draft ${sequence}` },
        },
      });
      expect(saved.statusCode, saved.body).toBe(200);
    }
    const addressed: Record<string, string> = {
      listComponents: '/v1/components',
      listComponentVersions: `/v1/components/${component}/versions`,
      listIterations: `/v1/components/${component}/iterations?session=${session}`,
      listSpaces: '/v1/spaces',
      listComponentTypes: `/v1/spaces/${general}/component-types`,
      listDocuments: '/v1/documents',
      listPublications: `/v1/documents/${document}/publications`,
      listPublicationsEverywhere: '/v1/publications',
      listGrants: '/v1/grants?level=tenant',
      listRoles: '/v1/roles?level=tenant',
      listPrincipals: '/v1/principals?level=tenant',
      listInvitations: '/v1/invitations',
      listTemplates: '/v1/templates',
      listDefinitions: '/v1/definitions',
      listPeople: '/v1/people',
    };
    // Every route that answers a list: a new one is listed here, and so paged, or this fails.
    const listings = allRoutes.filter(
      (route) =>
        route.method === 'GET' &&
        'items' in ((route.responses[200]?.schema as { shape?: object } | undefined)?.shape ?? {}),
    );
    expect(listings.map((route) => route.operationId).sort()).toEqual(
      Object.keys(addressed).sort(),
    );
    for (const route of listings) {
      // Each takes a cursor and a limit, and never an offset.
      const query = Object.keys((route as { query?: { shape: object } }).query?.shape ?? {});
      expect(query, route.operationId).toEqual(expect.arrayContaining(['cursor', 'limit']));
      expect(query, route.operationId).not.toContain('offset');
      // And a walk a page of one at a time is the listing read whole, each once, in one order.
      const path = addressed[route.operationId]!;
      const whole = (await get(`${path}${path.includes('?') ? '&' : '?'}limit=100`)).json<Page>();
      expect(whole.next, route.operationId).toBeNull();
      expect(whole.items.length, route.operationId).toBeGreaterThan(0);
      expect(await walk(path), route.operationId).toEqual(whole.items.map((each) => each.id));
    }
  });
});
