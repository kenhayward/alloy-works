import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  seedDevelopmentContent,
  STARTER_COMPONENT_TYPE_ID,
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
const OTHER = 'dev.acme.alloy.test';
const SESSION = '22222222-2222-4222-8222-222222222222';
const ELSEWHERE = '11111111-1111-4111-8111-111111111111';

type Json = Record<string, unknown>;

describe('creating a component through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let elsewhere: Tenant;
  let general: string;
  let quality: string;
  let elsewhereSpace: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (
    as: string | undefined,
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    payload?: Json,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  const create = (as: string, space: string, body: Json) =>
    call(as, 'POST', `/v1/spaces/${space}/components`, {
      title: 'Replace the toner',
      language: 'en-GB',
      direction: 'ltr',
      ...body,
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
    const organisation = { id: 'acme', name: 'Acme' };
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    elsewhere = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: [OTHER],
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
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      general = space.id;
      quality = (await createSpace(trx, 'Quality')).id;
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ids.alice! },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      // Ada administers the tenant, so GET /v1/spaces shows her Quality too, with mayCreate false:
      // Administrator carries read but not create, which is exactly the pair the listing exists to
      // tell apart (S13). Without this grant, seedDevelopmentContent gives Ada only Author on
      // General, and she cannot read Quality at all.
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
    elsewhereSpace = await tenantDb.withTenant(elsewhere, async (trx) => {
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return space.id;
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('answers the component it made, at 0.1, which then opens and lists like any other', async () => {
    const made = await create('ada', general, { title: 'Replace the toner' });
    expect(made.statusCode).toBe(200);
    const body = made.json<{
      id: string;
      version: { number: string };
      content: Json;
      lock: unknown;
    }>();
    expect(body.version.number).toBe('0.1');
    expect(body.lock).toBeNull();
    expect(body.content).toMatchObject({
      title: 'Replace the toner',
      language: 'en-GB',
      direction: 'ltr',
    });
    const opened = await call('ada', 'GET', `/v1/components/${body.id}`);
    expect(opened.statusCode).toBe(200);
    expect(opened.json<{ mayEdit: boolean }>().mayEdit).toBe(true);
    const listed = await call('ada', 'GET', '/v1/components');
    expect(listed.json<{ items: { title: string }[] }>().items.map((i) => i.title)).toContain(
      'Replace the toner',
    );
  });

  it('MET-011 gives a component exactly one component type, chosen when it is created', async () => {
    const types = await call('ada', 'GET', `/v1/spaces/${general}/component-types`);
    expect(types.statusCode).toBe(200);
    expect(types.json<{ items: unknown[] }>().items).toEqual([
      { id: STARTER_COMPONENT_TYPE_ID, name: 'Topic', isDefault: true },
    ]);

    const byDefault = await create('ada', general, { title: 'By the default' });
    const named = await create('ada', general, {
      title: 'By a choice',
      componentType: STARTER_COMPONENT_TYPE_ID,
    });
    expect(named.statusCode).toBe(200);

    const recorded = async (id: string) =>
      tenantDb.withTenant(tenant, async (trx) => {
        const version = await trx
          .selectFrom('artifact_version')
          .select(['id', 'component_type_version_id'])
          .where('artifact_id', '=', id)
          .executeTakeFirstOrThrow();
        const definitions = await trx
          .selectFrom('version_definition')
          .select(['definition_kind', 'definition_artifact_id'])
          .where('version_id', '=', version.id)
          .execute();
        return { version, definitions };
      });
    for (const answer of [byDefault, named]) {
      const { version, definitions } = await recorded(answer.json<{ id: string }>().id);
      expect(version.component_type_version_id).toEqual(expect.any(String));
      expect(definitions.filter((each) => each.definition_kind === 'componentType')).toEqual([
        { definition_kind: 'componentType', definition_artifact_id: STARTER_COMPONENT_TYPE_ID },
      ]);
    }

    const absent = await create('ada', general, {
      title: 'No such type',
      componentType: ELSEWHERE,
    });
    expect(absent.statusCode).toBe(409);
    expect(absent.json()).toMatchObject({ code: 'component_type_missing' });
  });

  it('CNT-143 records in a version the title and base language the component had when it was cut', async () => {
    const made = await create('ada', general, { title: 'Clear a paper jam' });
    const created = made.json<{ id: string; version: { id: string }; content: Json }>();
    expect(
      await call('ada', 'POST', `/v1/components/${created.id}/lock`, { session: SESSION }),
    ).toMatchObject({
      statusCode: 200,
    });
    const renamed = { ...created.content, title: 'Clear a jam', language: 'fr-CA' };
    const saved = await app.inject({
      method: 'PUT',
      url: `/v1/components/${created.id}/iterations/${SESSION}/1`,
      headers: { host: HOST, cookie: cookies.ada! },
      payload: { openedFrom: created.version.id, content: renamed },
    });
    expect(saved.statusCode).toBe(200);
    const cut = await call('ada', 'POST', `/v1/components/${created.id}/versions`, {
      session: SESSION,
      openedFrom: created.version.id,
    });
    expect(cut.json<{ version: { number: string } }>().version.number).toBe('0.2');

    const opened = await call('ada', 'GET', `/v1/components/${created.id}`);
    expect(opened.json<{ content: { title: string; language: string } }>().content).toMatchObject({
      title: 'Clear a jam',
      language: 'fr-CA',
    });
    const first = await tenantDb.withTenant(tenant, async (trx) => {
      const row = await trx
        .selectFrom('artifact_version')
        .select('content')
        .where('id', '=', created.version.id)
        .executeTakeFirstOrThrow();
      return row.content as { title: string; language: string };
    });
    expect(first).toMatchObject({ title: 'Clear a paper jam', language: 'en-GB' });
    const listed = await call('ada', 'GET', '/v1/components');
    expect(listed.json<{ items: { title: string }[] }>().items.map((i) => i.title)).toContain(
      'Clear a jam',
    );
  });

  it('refuses a space the caller may read but not create in, and answers nothing for the rest', async () => {
    const readOnly = await create('alice', general, {});
    expect(readOnly.statusCode).toBe(403);
    expect(readOnly.json()).toMatchObject({ code: 'forbidden' });
    expect(readOnly.json<{ message: string }>().message).not.toContain('General');

    expect((await create('alice', quality, {})).statusCode).toBe(404);
    expect((await create('ada', elsewhereSpace, {})).statusCode).toBe(404);
    expect((await create('ada', ELSEWHERE, {})).statusCode).toBe(404);

    expect((await call('alice', 'GET', `/v1/spaces/${general}/component-types`)).statusCode).toBe(
      403,
    );
    expect((await call('alice', 'GET', `/v1/spaces/${quality}/component-types`)).statusCode).toBe(
      404,
    );
  });

  it('lists the spaces the caller may read, saying in which of them they may create', async () => {
    const ada = await call('ada', 'GET', '/v1/spaces');
    expect(ada.json<{ items: unknown[] }>().items).toEqual([
      { id: general, name: 'General', mayCreate: true },
      { id: quality, name: 'Quality', mayCreate: false },
    ]);
    const alice = await call('alice', 'GET', '/v1/spaces');
    expect(alice.json<{ items: unknown[] }>().items).toEqual([
      { id: general, name: 'General', mayCreate: false },
    ]);
    expect((await call(undefined, 'GET', '/v1/spaces')).statusCode).toBe(401);
  });

  it('refuses a body the content model would not accept, and one carrying a member it does not declare', async () => {
    expect((await create('ada', general, { title: '' })).statusCode).toBe(400);
    expect((await create('ada', general, { language: 'english' })).statusCode).toBe(400);
    expect((await create('ada', general, { direction: 'sideways' })).statusCode).toBe(400);
    expect((await create('ada', general, { values: {} })).statusCode).toBe(400);
    expect(
      (await create('ada', general, { componentType: STARTER_COMPONENT_TYPE_ID.toUpperCase() }))
        .statusCode,
    ).toBe(400);
  });
});
