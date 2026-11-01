import {
  bootstrapCluster,
  createTenant,
  DEFAULT_THEME_ID,
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

type Json = Record<string, unknown>;
const warning = {
  id: 'warning',
  name: 'Warning',
  basedOn: 'body',
  appliesTo: ['text'],
  properties: { bold: true },
};

describe('themes through the service (the SY plan, SY-C)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (
    as: string | null,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: Json,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as === null ? {} : { cookie: cookies[as]! }) },
      ...(payload ? { payload } : {}),
    });
  const latest = async () =>
    (await call('grace', 'GET', `/v1/themes/${DEFAULT_THEME_ID}`)).json<{
      version: { id: string };
    }>().version.id;

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
    for (const user of ['ada', 'grace']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    // Grace manages definitions; Ada holds roles in General and nothing at the tenant.
    await tenantDb.withTenant(tenant, async (trx) => {
      await grant(trx, {
        roleId: (await findRole(trx, 'Definitions manager'))!.id,
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

  it('lets anyone signed in read the themes and the catalogues they name', async () => {
    const listed = await call('ada', 'GET', '/v1/themes');
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json<{ items: Json[] }>().items).toEqual([
      expect.objectContaining({ id: DEFAULT_THEME_ID, isDefault: true }),
    ]);
    const one = await call('ada', 'GET', `/v1/themes/${DEFAULT_THEME_ID}`);
    expect(one.statusCode, one.body).toBe(200);
    const view = one.json<{ content: { catalogues: Json }; catalogues: { versionId: string }[] }>();
    expect(view.catalogues.map((each) => each.versionId)).toEqual(
      expect.arrayContaining([view.content.catalogues['paragraph']]),
    );
    expect((await call(null, 'GET', '/v1/themes')).statusCode).toBe(401);
    expect((await call('ada', 'GET', `/v1/themes/${ids.ada}`)).statusCode).toBe(404);
  });

  it('STY-029 adds a style through the service, by whoever manages definitions, and STY-030 the theme every output reads then holds it', async () => {
    const openedFrom = await latest();
    const refused = await call(
      'ada',
      'PUT',
      `/v1/themes/${DEFAULT_THEME_ID}/styles/paragraph/warning`,
      {
        openedFrom,
        style: warning,
      },
    );
    // Decided at the theme: one Ada may not manage is answered as not there.
    expect(refused.statusCode).toBe(404);
    const saved = await call(
      'grace',
      'PUT',
      `/v1/themes/${DEFAULT_THEME_ID}/styles/paragraph/warning`,
      {
        openedFrom,
        style: warning,
      },
    );
    expect(saved.statusCode, saved.body).toBe(200);
    // The presentation the editor and every output read is the theme's latest.
    const presentation = await call('ada', 'GET', '/v1/presentation');
    const paragraphs = presentation
      .json<{ theme: { catalogues: { content: { kind: string; styles?: Json[] } }[] } }>()
      .theme.catalogues.find((each) => each.content.kind === 'paragraph')!;
    expect(paragraphs.content.styles).toContainEqual(warning);
    const stale = await call(
      'grace',
      'PUT',
      `/v1/themes/${DEFAULT_THEME_ID}/styles/paragraph/warning`,
      {
        openedFrom,
        style: { ...warning, name: 'Danger' },
      },
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'version.precondition' });
  });

  it('STY-031 refuses a deletion the theme would not read without, naming why, and deletes one nothing uses', async () => {
    const put = async (style: Json) =>
      call(
        'grace',
        'PUT',
        `/v1/themes/${DEFAULT_THEME_ID}/styles/paragraph/${String(style['id'])}`,
        {
          openedFrom: await latest(),
          style,
        },
      );
    const remove = async (style: string) =>
      call(
        'grace',
        'DELETE',
        `/v1/themes/${DEFAULT_THEME_ID}/styles/paragraph/${style}?openedFrom=${await latest()}`,
      );
    const reminder = await put({ ...warning, id: 'reminder', name: 'Reminder' });
    expect(reminder.statusCode, reminder.body).toBe(200);
    expect(
      (await put({ ...warning, id: 'caution', name: 'Caution', basedOn: 'reminder' })).statusCode,
    ).toBe(200);
    const based = await remove('reminder');
    expect(based.statusCode).toBe(400);
    expect(based.json()).toMatchObject({
      code: 'style_refused',
      refusals: expect.arrayContaining([expect.objectContaining({ code: 'style_parent_missing' })]),
    });
    // The seeded content sets its text in Body, so Body waits on it.
    const used = await remove('body');
    expect(used.statusCode).toBe(400);
    expect(used.json()).toMatchObject({ code: 'style_in_use', components: expect.any(Number) });
    const gone = await remove('caution');
    expect(gone.statusCode, gone.body).toBe(200);
  });

  it('STY-034 answers the documents a change would reach before it is made, to whoever manages definitions', async () => {
    const impact = await call('grace', 'POST', `/v1/themes/${DEFAULT_THEME_ID}/impact`, {
      kind: 'paragraph',
      style: 'body',
    });
    expect(impact.statusCode, impact.body).toBe(200);
    expect(impact.json()).toEqual({ documents: expect.any(Array), unreadable: expect.any(Number) });
    const refused = await call('ada', 'POST', `/v1/themes/${DEFAULT_THEME_ID}/impact`, {
      kind: 'paragraph',
      style: 'body',
    });
    // Decided at the theme: one Ada may not manage is answered as not there.
    expect(refused.statusCode).toBe(404);
  });

  it('STY-072 makes, renames and declares a theme through the service, by whoever manages definitions', async () => {
    const refused = await call('ada', 'POST', '/v1/themes', {
      from: DEFAULT_THEME_ID,
      name: 'Mine',
    });
    expect(refused.statusCode).toBe(403);
    const made = await call('grace', 'POST', '/v1/themes', {
      from: DEFAULT_THEME_ID,
      name: 'Field manual',
    });
    expect(made.statusCode, made.body).toBe(200);
    const theme = made.json<{ id: string; version: { id: string; number: string } }>();
    expect(theme.version.number).toBe('0.1');
    const renamed = await call('grace', 'PUT', `/v1/themes/${theme.id}/name`, {
      openedFrom: theme.version.id,
      name: 'Site manual',
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ name: 'Site manual', version: { number: '0.2' } });
    const declared = await call('grace', 'POST', `/v1/themes/${theme.id}/default`);
    expect(declared.statusCode, declared.body).toBe(200);
    expect(declared.json()).toMatchObject({ isDefault: true });
    const listed = (await call('ada', 'GET', '/v1/themes')).json<{ items: Json[] }>().items;
    expect(listed).toEqual([
      expect.objectContaining({ id: DEFAULT_THEME_ID, isDefault: false }),
      expect.objectContaining({ id: theme.id, isDefault: true }),
    ]);
    // Declared back, so the other tests' documents stand in the default theme.
    await call('grace', 'POST', `/v1/themes/${DEFAULT_THEME_ID}/default`);
  });
});
