import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createDocument,
  createSpace,
  createTenant,
  createTenantDatabase,
  defaultTheme,
  migrate,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { readTheme } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

interface Presentation {
  theme: {
    versionId: string;
    number: string;
    content: unknown;
    catalogues: { versionId: string; content: unknown }[];
  };
  frame: { measure: number; textHeight: number };
}

describe("the theme and layout the editor sets a component's text in", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let cookie: string;
  let general: string;
  let hidden: string;

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
    cookie = await signIn(app, HOST, 'grace', idp.issuer);
    const grace = (await get('/v1/me')).json<{ id: string }>().id;
    await tenantDb.withTenant(tenant, async (trx) => {
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      // A space nobody has granted Grace anything in, and a document in it.
      const secret = await createSpace(trx, 'Board');
      const made = await createDocument(trx, {
        spaceId: secret.id,
        title: 'Minutes',
        language: 'en-GB',
        direction: 'ltr',
        author: grace,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      hidden = made.version.artifactId;
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it("STY-035 hands the renderer the theme the publisher reads, which the same reader resolves to the same styles", async () => {
    const response = await get('/v1/presentation');
    expect(response.statusCode).toBe(200);
    const { theme } = response.json<Presentation>();
    const stored = await tenantDb.withTenant(tenant, (trx) => defaultTheme(trx));
    expect(theme.versionId).toBe(stored.versionId);
    expect(theme.number).toBe(stored.number);

    const read = readTheme(
      theme.content,
      new Map(theme.catalogues.map((each) => [each.versionId, each.content])),
    );
    if (!read.ok) throw new Error(JSON.stringify(read.refusals));
    // What the renderer reads is what `assemble` is handed, style for style.
    expect([...read.theme.paragraphStyles]).toEqual([...stored.theme.paragraphStyles]);
    expect(read.theme.characterStyles).toEqual(stored.theme.characterStyles);
    expect([...read.theme.tableStyles]).toEqual([...stored.theme.tableStyles]);
    expect([...read.theme.imageStyles]).toEqual([...stored.theme.imageStyles]);
    expect([...read.theme.typefaces]).toEqual([...stored.theme.typefaces]);
    expect(read.theme.places).toEqual(stored.theme.places);
    expect(read.theme.roles).toEqual(stored.theme.roles);
  });

  it("gives the default layout's measure and text block height, the two lengths of a page an image style is a share of", async () => {
    // A4, 595.28 by 841.89 points, with an inch margin each way and no gutter.
    const { frame } = (await get('/v1/presentation')).json<Presentation>();
    expect(frame.measure).toBeCloseTo(451.28, 5);
    expect(frame.textHeight).toBeCloseTo(697.89, 5);
  });

  it("gives a document's presentation to whoever may read the document, and nobody else", async () => {
    const made = await app.inject({
      method: 'POST',
      url: `/v1/spaces/${general}/documents`,
      headers: { host: HOST, cookie },
      payload: { title: 'Report', language: 'en-GB', direction: 'ltr' },
    });
    const id = made.json<{ id: string }>().id;
    const response = await get(`/v1/documents/${id}/presentation`);
    expect(response.statusCode).toBe(200);
    // A document made blank takes the environment's theme and layout.
    expect(response.json()).toEqual((await get('/v1/presentation')).json());

    expect((await get(`/v1/documents/${hidden}/presentation`)).statusCode).toBe(404);
  });

  it('answers nobody who is not signed in', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/presentation',
      headers: { host: HOST },
    });
    expect(response.statusCode).toBe(401);
  });
});
