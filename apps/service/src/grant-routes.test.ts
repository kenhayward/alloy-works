// apps/service/src/grant-routes.test.ts
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createSpace,
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

const HOST = 'acme.alloy.test';
const MISSING = '00000000-0000-4000-8000-000000000000';

type Json = Record<string, unknown>;

describe('making, listing and removing grants through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const roles: Record<string, string> = {};
  let clinical: string;
  let quality: string;
  let adaAdministers: string;

  const call = (
    as: string | undefined,
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    payload?: Json,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  const give = (as: string, body: Json) => call(as, 'POST', '/v1/grants', body);

  const allowed = async (as: string, target: string) => {
    const response = await call(as, 'GET', `/v1/access?target=${target}`);
    if (response.statusCode !== 200) return response.statusCode;
    return response
      .json<{ permissions: { permission: string; allowed: boolean }[] }>()
      .permissions.filter((answer) => answer.allowed)
      .map((answer) => answer.permission);
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
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
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
      for (const name of ['Reader', 'Author', 'Administrator', 'Editing']) {
        roles[name] = (await findRole(trx, name))!.id;
      }
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada administers the environment, as its first administrator would; Grace administers Clinical
      // and reads Quality, and administers nothing there.
      const made = await grant(trx, {
        roleId: roles.Administrator!,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      if (!('granted' in made)) throw new Error(`refused: ${made.refused}`);
      adaAdministers = made.granted.id;
      await grant(trx, {
        roleId: roles.Administrator!,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      await grant(trx, {
        roleId: roles.Reader!,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: quality },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('gives a person a role at a space, lists it there, and takes it away, each at the next request', async () => {
    const made = await give('ada', {
      role: roles.Author,
      subject: { principal: ids.alice },
      level: `space:${clinical}`,
      effect: 'allow',
    });
    expect(made.statusCode).toBe(200);
    const view = made.json<{ grant: Json & { id: string } }>().grant;
    expect(view).toEqual({
      id: expect.any(String),
      role: { id: roles.Author, name: 'Author' },
      subject: { principal: { id: ids.alice, name: 'Alice', email: expect.any(String) } },
      level: `space:${clinical}`,
      effect: 'allow',
      expiresAt: null,
      extends: null,
      grantedBy: { id: ids.ada, name: 'Ada' },
      grantedAt: expect.any(String),
    });
    await expect(allowed('alice', `space:${clinical}`)).resolves.toContain('edit');

    const listed = await call('ada', 'GET', `/v1/grants?level=space:${clinical}`);
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ items: Json[] }>().items).toContainEqual(view);

    const removed = await call('ada', 'DELETE', `/v1/grants/${view.id}`);
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ removed: view.id });
    await expect(allowed('alice', `space:${clinical}`)).resolves.toBe(404);
    const again = await call('ada', 'DELETE', `/v1/grants/${view.id}`);
    expect(again.statusCode).toBe(404);
    expect(again.json()).toMatchObject({ code: 'not_found' });
  });

  it('lets an administrator of a space manage grants there and on what it holds, and nowhere above or beside it', async () => {
    const atClinical = await give('grace', {
      role: roles.Reader,
      subject: { principal: ids.alice },
      level: `space:${clinical}`,
      effect: 'allow',
    });
    expect(atClinical.statusCode).toBe(200);
    const id = atClinical.json<{ grant: { id: string } }>().grant.id;
    expect((await call('grace', 'GET', `/v1/grants?level=space:${clinical}`)).statusCode).toBe(200);

    const atTenant = await give('grace', {
      role: roles.Reader,
      subject: { principal: ids.alice },
      level: 'tenant',
      effect: 'allow',
    });
    expect(atTenant.statusCode).toBe(403);
    expect(atTenant.json()).toMatchObject({
      code: 'forbidden',
      message: 'This needs the administer permission.',
    });
    expect((await call('grace', 'GET', '/v1/grants?level=tenant')).statusCode).toBe(403);
    // Quality she reads, so asking about it is forbidden rather than absent.
    expect((await call('grace', 'GET', `/v1/grants?level=space:${quality}`)).statusCode).toBe(403);
    // Ada's grant is at the tenant: Grace may not manage it, so she is told it is not there at all.
    const hers = await call('grace', 'DELETE', `/v1/grants/${adaAdministers}`);
    const nobodys = await call('grace', 'DELETE', `/v1/grants/${MISSING}`);
    expect(hers.statusCode).toBe(404);
    const untraced = (body: Json) =>
      Object.fromEntries(Object.entries(body).filter(([member]) => member !== 'traceId'));
    expect(untraced(hers.json())).toEqual(untraced(nobodys.json()));

    expect((await call('grace', 'DELETE', `/v1/grants/${id}`)).statusCode).toBe(200);
  });

  it('refuses a person holding nothing, and nobody signed in, before looking at what they asked', async () => {
    const body = {
      role: roles.Author,
      subject: { principal: ids.alice },
      level: `space:${clinical}`,
      effect: 'allow',
    };
    expect((await give('alice', body)).statusCode).toBe(404);
    expect((await call(undefined, 'POST', '/v1/grants', body)).statusCode).toBe(401);
    expect((await call('alice', 'GET', '/v1/grants?level=tenant')).statusCode).toBe(403);
  });

  it('refuses, by a code and a sentence, each grant the rules refuse where it is made', async () => {
    const refusal = async (body: Json) => {
      const response = await give('ada', body);
      return { status: response.statusCode, ...response.json<Json>() };
    };
    const base = {
      role: roles.Reader,
      subject: { principal: ids.grace },
      level: `space:${clinical}`,
      effect: 'allow',
    };
    expect((await give('ada', base)).statusCode).toBe(200);
    await expect(refusal(base)).resolves.toMatchObject({
      status: 409,
      code: 'grant_duplicate',
      message: 'That role is already granted to that person here, with that effect.',
    });
    await expect(refusal({ ...base, role: roles.Editing })).resolves.toMatchObject({
      status: 409,
      code: 'grant_allow_without_read',
      message: 'A role that does not include read can only be denied, not allowed.',
    });
    await expect(
      refusal({ ...base, role: roles.Administrator, level: 'tenant', effect: 'deny' }),
    ).resolves.toMatchObject({
      status: 409,
      code: 'grant_administer_denied_at_tenant',
      message: 'A role that includes administer cannot be denied across the whole environment.',
    });
    await expect(refusal({ ...base, role: MISSING })).resolves.toMatchObject({
      status: 409,
      code: 'grant_role_missing',
      message: 'There is no such role in this environment.',
    });
    await expect(refusal({ ...base, subject: { principal: MISSING } })).resolves.toMatchObject({
      status: 409,
      code: 'grant_subject_missing',
      message: 'There is no such person in this environment.',
    });
  });

  it('holds someone from outside the organisation to the external rules on the wire', async () => {
    const outsider = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: idp.issuer,
          subject: 'ivy',
          email: null,
          display_name: 'Ivy',
          kind: 'external',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    const refusal = async (body: Json) => {
      const response = await give('ada', {
        subject: { principal: outsider },
        effect: 'allow',
        ...body,
      });
      return { status: response.statusCode, ...response.json<Json>() };
    };
    await expect(refusal({ role: roles.Reader, level: 'tenant' })).resolves.toMatchObject({
      status: 409,
      code: 'grant_external_at_tenant',
    });
    await expect(
      refusal({ role: roles.Author, level: `space:${clinical}` }),
    ).resolves.toMatchObject({ status: 409, code: 'grant_external_capped' });
    // Given no expiry, an allow takes the environment's default, and says when.
    const defaulted = await refusal({ role: roles.Reader, level: `space:${clinical}` });
    expect(defaulted).toMatchObject({ status: 200, grant: { expiresAt: expect.any(String) } });
  });

  it('refuses to remove the last grant keeping the environment administered, until somebody else holds one', async () => {
    const last = await call('ada', 'DELETE', `/v1/grants/${adaAdministers}`);
    expect(last.statusCode).toBe(409);
    expect(last.json()).toMatchObject({
      code: 'grant_last_administrator',
      message:
        'This is the last grant that lets anyone administer this environment, so it cannot be removed.',
    });

    const graceToo = await give('ada', {
      role: roles.Administrator,
      subject: { principal: ids.grace },
      level: 'tenant',
      effect: 'allow',
    });
    expect(graceToo.statusCode).toBe(200);
    expect((await call('ada', 'DELETE', `/v1/grants/${adaAdministers}`)).statusCode).toBe(200);
    // Grace now administers, and puts Ada back.
    const restored = await give('grace', {
      role: roles.Administrator,
      subject: { principal: ids.ada },
      level: 'tenant',
      effect: 'allow',
    });
    expect(restored.statusCode).toBe(200);
    adaAdministers = restored.json<{ grant: { id: string } }>().grant.id;
    const gracesId = graceToo.json<{ grant: { id: string } }>().grant.id;
    expect((await call('ada', 'DELETE', `/v1/grants/${gracesId}`)).statusCode).toBe(200);
  });

  it('refuses a body that is not exactly a grant: an unknown member, a group, an uppercase id', async () => {
    const base = {
      role: roles.Reader,
      subject: { principal: ids.grace },
      level: `space:${quality}`,
      effect: 'allow',
    };
    for (const body of [
      { ...base, expiresAt: '2030-01-01T00:00:00Z' },
      { ...base, subject: { group: MISSING } },
      { ...base, role: roles.Reader!.toUpperCase() },
      { ...base, level: `space:${quality.toUpperCase()}` },
      { ...base, effect: 'maybe' },
    ]) {
      const response = await give('ada', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ code: 'invalid_request' });
    }
  });

  it('lists the roles and the people to choose from, to anyone who administers the level asked about', async () => {
    const roleList = await call('grace', 'GET', `/v1/roles?level=space:${clinical}&limit=100`);
    expect(roleList.statusCode).toBe(200);
    const listedRoles = roleList.json<{ items: { name: string; permissions: string[] }[] }>();
    expect(listedRoles).toMatchObject({ next: null });
    expect(listedRoles.items).toContainEqual({
      id: roles.Editing,
      name: 'Editing',
      permissions: ['edit'],
    });

    const people = await call('grace', 'GET', `/v1/principals?level=space:${clinical}`);
    expect(people.statusCode).toBe(200);
    expect(people.json<{ items: unknown[] }>().items).toEqual(
      expect.arrayContaining([
        { id: ids.ada, name: 'Ada', email: expect.any(String), kind: 'user', invited: false },
        { id: ids.alice, name: 'Alice', email: expect.any(String), kind: 'user', invited: false },
      ]),
    );
    const firstPerson = await call('ada', 'GET', '/v1/principals?level=tenant&limit=1');
    expect(firstPerson.json()).toMatchObject({ next: expect.any(String) });

    // Grace administers nothing at the tenant or at Quality; Alice nothing anywhere.
    expect((await call('grace', 'GET', '/v1/roles?level=tenant')).statusCode).toBe(403);
    expect((await call('grace', 'GET', `/v1/principals?level=space:${quality}`)).statusCode).toBe(
      403,
    );
    expect((await call('alice', 'GET', `/v1/principals?level=space:${clinical}`)).statusCode).toBe(
      404,
    );
    expect((await call(undefined, 'GET', '/v1/roles?level=tenant')).statusCode).toBe(401);
  });

  it('pages the grants at a level by an opaque cursor, and refuses one it did not give out', async () => {
    const artifact = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .insertInto('artifact')
        .values({ kind: 'component', space_id: clinical })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
    for (const role of ['Reader', 'Author']) {
      expect(
        (
          await give('ada', {
            role: roles[role],
            subject: { principal: ids.grace },
            level: `artifact:${artifact}`,
            effect: 'allow',
          })
        ).statusCode,
      ).toBe(200);
    }
    const first = await call('ada', 'GET', `/v1/grants?level=artifact:${artifact}&limit=1`);
    const page = first.json<{ items: { id: string }[]; next: string }>();
    expect(page.items).toHaveLength(1);
    expect(page.next).toEqual(expect.any(String));
    const second = await call(
      'ada',
      'GET',
      `/v1/grants?level=artifact:${artifact}&limit=1&cursor=${page.next}`,
    );
    expect(second.json()).toMatchObject({ next: null });
    const forged = await call('ada', 'GET', `/v1/grants?level=artifact:${artifact}&cursor=nope`);
    expect(forged.statusCode).toBe(400);
  });
});
