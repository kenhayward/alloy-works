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

describe('searching through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  const cookies: Record<string, string> = {};

  const search = (as: string | undefined, query: string) =>
    app.inject({
      method: 'GET',
      url: `/v1/search${query}`,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
    });

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
    // Grace reads General, where the seed's components are; Alice reads nothing.
    for (const user of ['grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
    }
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('answers with each result, where it matched and a passage from there', async () => {
    const response = await search('grace', '?q=scanner');
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      outcome: string;
      count: number;
      items: { kind: string; title: string; space: { name: string }; place: string }[];
      message: string;
    }>();
    expect(body).toMatchObject({ outcome: 'results', message: expect.any(String) });
    expect(body.items).toContainEqual(
      expect.objectContaining({
        kind: 'component',
        title: 'Calibrate the scanner',
        space: expect.objectContaining({ name: 'General' }),
        place: 'title',
      }),
    );
    expect(body.count).toBe(body.items.length);
  });

  it('SCH-039 names an empty or malformed query rather than answering it', async () => {
    const answer = async (query: string) => {
      const response = await search('grace', query);
      expect(response.statusCode, query).toBe(200);
      return response.json<Record<string, unknown>>();
    };
    // Nothing: never the whole corpus.
    expect(await answer('')).toEqual({ outcome: 'empty', message: 'Type what to look for.' });
    expect(await answer('?q=%20%20')).toEqual({
      outcome: 'empty',
      message: 'Type what to look for.',
    });
    // Only exclusions: said, never everything but them.
    expect(await answer('?q=-scanner')).toEqual({
      outcome: 'nothing_to_match',
      excluded: ['scanner'],
      message: 'Nothing to look for: the search only leaves out scanner. Add a word to look for.',
    });
    // Nothing a search can use.
    expect(await answer('?q=%21%3F')).toEqual({
      outcome: 'nothing_to_match',
      excluded: [],
      message: 'Nothing to look for: the search holds no words.',
    });
    // A scope naming no field: said by name, never a page that looks like no matches.
    expect(await answer('?q=Colour:red')).toEqual({
      outcome: 'unknown_field',
      name: 'Colour',
      message: 'No field you can see is called Colour, so nothing can be looked for in it.',
    });
    // And a search that matches nothing says so, rather than showing an empty page.
    expect(await answer('?q=quagga')).toMatchObject({
      outcome: 'results',
      count: 0,
      capped: false,
      items: [],
      message: 'Nothing you can see matches this search.',
    });
  });

  it('narrows by the filters a query string names, and counts each facet without its own', async () => {
    const answer = async (query: string) => {
      const response = await search('grace', query);
      expect(response.statusCode, query).toBe(200);
      return response.json<{
        count: number;
        items: { kind: string }[];
        facets: Record<string, { value: string; count: number }[]>;
      }>();
    };
    const all = await answer('?q=scanner');
    const components = all.items.filter((each) => each.kind === 'component').length;
    expect(components).toBeGreaterThan(0);
    // Narrowed to documents, of which none say scanner, the kind facet still offers components.
    const documents = await answer('?q=scanner&kind=document,section');
    expect(documents.count).toBe(0);
    expect(documents.facets.kinds).toContainEqual(
      expect.objectContaining({ value: 'component', count: components }),
    );
    // A named range, and a range of days reaching today.
    expect((await answer('?q=scanner&changed=today')).count).toBe(all.count);
    expect((await answer('?q=scanner&changedFrom=2000-01-01')).count).toBe(all.count);
    expect((await answer('?q=scanner&changed=earlier')).count).toBe(0);
    // A filter of the wrong shape is refused as the caller's.
    for (const query of [
      '?q=scanner&kind=image',
      '?q=scanner&space=general',
      '?q=x&value=Reviewer',
    ]) {
      expect((await search('grace', query)).statusCode, query).toBe(400);
    }
  });

  it('finds nothing for a reader who may read nothing, and is refused without a session', async () => {
    expect((await search('alice', '?q=scanner')).json()).toMatchObject({
      outcome: 'results',
      count: 0,
      items: [],
    });
    expect((await search(undefined, '?q=scanner')).statusCode).toBe(401);
    expect((await search('grace', '?q=scanner&limit=51')).statusCode).toBe(400);
  });
});
