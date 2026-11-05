import { bootstrapCluster, createTenant, migrate, type Tenant } from '@alloy-works/db';
import type { TenantDatabase } from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, STAND_IN_SECRET, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'limits.acme.alloy.test';
const CALLBACK = `http://${HOST}/v1/sign-in/organisation/callback`;
const NAMES = ['ada', 'bob', 'carol', 'dan', 'erin', 'fay', 'gil', 'hal', 'ida', 'jon', 'kim'];
const USERS = NAMES.map((id) => ({ id, name: id, email: `${id}@acme.example` }));
const BEYOND = { code: 'grant_beyond_held' };

describe('grant limits: nobody gives an administrative permission they do not hold', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenant: Tenant;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let ada: Person;
  let bob: Person;
  let roles: Readonly<Record<string, string>>;

  interface Person {
    readonly cookie: string;
    readonly id: string;
    readonly grant: string;
  }

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: STAND_IN_SECRET, redirectUris: [CALLBACK] }],
      users: USERS,
    });
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Limits' },
      hostnames: [HOST],
    });
    await configureStandIn(db.adminUrl, tenant, { issuer: idp.issuer, clientId: 'alloy' });
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    await app.ready();
    ada = await holding('ada', 'Administrator');
    bob = await holding('bob', 'People manager', ['read', 'administer']);
    roles = Object.fromEntries(
      (
        await tenantDb.withTenant(tenant, (trx) =>
          trx.selectFrom('role').select(['id', 'name']).execute(),
        )
      ).map((role) => [role.name, role.id]),
    );
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  async function signIn(user: string) {
    const started = await app.inject({ url: '/v1/sign-in/organisation', headers: { host: HOST } });
    const attempt = started.cookies.find((cookie) => cookie.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, user, idp.issuer);
    const finished = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: HOST, cookie: `${attempt.name}=${attempt.value}` },
    });
    const session = finished.cookies.find((cookie) => cookie.name === '__Host-aw_session')!;
    return `${session.name}=${session.value}`;
  }

  /** Signs somebody in, holding a role at the environment: `name`, made with `permissions` if given. */
  async function holding(user: string, name?: string, permissions?: readonly string[]) {
    const cookie = await signIn(user);
    const { id } = (await send('GET', '/v1/me', cookie)).json<{ id: string }>();
    if (name === undefined) return { cookie, id, grant: '' };
    const grant = await tenantDb.withTenant(tenant, async (trx) => {
      const role = permissions
        ? await trx
            .insertInto('role')
            .values({ name, permissions: permissions as never })
            .returning('id')
            .executeTakeFirstOrThrow()
        : await trx
            .selectFrom('role')
            .select('id')
            .where('name', '=', name)
            .executeTakeFirstOrThrow();
      return trx
        .insertInto('access_grant')
        .values({
          principal_id: id,
          role_id: role.id,
          level: 'tenant',
          effect: 'allow',
          granted_by: id,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    });
    return { cookie, id, grant: grant.id };
  }

  const send = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie },
      ...(payload === undefined ? {} : { payload }),
    });

  const giving = (role: string, subject: object, level = 'tenant', effect = 'allow') => ({
    role: roles[role],
    subject,
    level,
    effect,
  });

  const madeBy = async (body: object) => {
    const made = await send('POST', '/v1/grants', ada.cookie, body);
    expect(made.statusCode).toBe(200);
    return made.json<{ grant: { id: string } }>().grant.id;
  };

  const newGroup = async (name: string) => {
    const made = await send('POST', '/v1/groups', ada.cookie, { name });
    expect(made.statusCode).toBe(200);
    return made.json<{ group: { id: string } }>().group.id;
  };

  const newSpace = async (name: string) => {
    const made = await tenantDb.withTenant(tenant, (trx) =>
      trx.insertInto('space').values({ name }).returning('id').executeTakeFirstOrThrow(),
    );
    return made.id;
  };

  const members = (group: string, cookie: string, principals: readonly string[]) =>
    send('PUT', `/v1/groups/${group}/members`, cookie, { principals });

  it('refuses granting himself Administrator, at the environment or at a space', async () => {
    const whole = await send(
      'POST',
      '/v1/grants',
      bob.cookie,
      giving('Administrator', { principal: bob.id }),
    );
    expect(whole.statusCode).toBe(403);
    expect(whole.json()).toMatchObject(BEYOND);
    expect(whole.json<{ message: string }>().message).toContain('close_environment');

    const space = await newSpace('Refused here');
    const there = await send(
      'POST',
      '/v1/grants',
      bob.cookie,
      giving('Administrator', { principal: bob.id }, `space:${space}`),
    );
    expect(there.json()).toMatchObject(BEYOND);
  });

  it('refuses granting Administrator to a group, or denying what he could not allow', async () => {
    const group = await newGroup('Refused a grant');
    const allow = await send('POST', '/v1/grants', bob.cookie, giving('Administrator', { group }));
    expect(allow.json()).toMatchObject(BEYOND);
    const deny = await send(
      'POST',
      '/v1/grants',
      bob.cookie,
      giving('Administrator', { principal: ada.id }, `space:${await newSpace('Deny')}`, 'deny'),
    );
    expect(deny.json()).toMatchObject(BEYOND);
  });

  it('lets him grant a content role he does not hold, and an administrative one he does', async () => {
    const carol = await holding('carol');
    const author = await send(
      'POST',
      '/v1/grants',
      bob.cookie,
      giving('Author', { principal: carol.id }),
    );
    expect(author.statusCode).toBe(200);
    const made = await send('POST', '/v1/roles', ada.cookie, {
      name: 'Another manager',
      permissions: ['read', 'administer'],
    });
    const same = await send('POST', '/v1/grants', bob.cookie, {
      role: made.json<{ role: { id: string } }>().role.id,
      subject: { principal: carol.id },
      level: 'tenant',
      effect: 'allow',
    });
    expect(same.statusCode).toBe(200);
  });

  it('refuses making a role holding what he does not, and lets him make one of content', async () => {
    const refused = await send('POST', '/v1/roles', bob.cookie, {
      name: 'Closer',
      permissions: ['read', 'close_environment'],
    });
    expect(refused.json()).toMatchObject(BEYOND);
    const made = await send('POST', '/v1/roles', bob.cookie, {
      name: 'Editor of his',
      permissions: ['read', 'edit'],
    });
    expect(made.statusCode).toBe(200);
  });

  it('refuses joining, or leaving, a group holding what he does not, at any level', async () => {
    const dan = await holding('dan');
    const whole = await newGroup('Administrators');
    await madeBy(giving('Administrator', { group: whole }));
    expect((await members(whole, bob.cookie, [bob.id])).json()).toMatchObject(BEYOND);

    const atSpace = await newGroup('Space administrators');
    await madeBy(giving('Administrator', { group: atSpace }, `space:${await newSpace('Held')}`));
    expect((await members(atSpace, bob.cookie, [bob.id])).json()).toMatchObject(BEYOND);

    expect((await members(whole, ada.cookie, [dan.id])).statusCode).toBe(200);
    expect((await members(whole, bob.cookie, [])).json()).toMatchObject(BEYOND);
  });

  it('lets him set the members of a group of content, and ignores a grant that has ended', async () => {
    const authors = await newGroup('Authors');
    await madeBy(giving('Author', { group: authors }));
    expect((await members(authors, bob.cookie, [bob.id])).statusCode).toBe(200);

    const ended = await newGroup('Once administrators');
    // Refused to anybody asking for one, so made here.
    await tenantDb.withTenant(tenant, (trx) =>
      trx
        .insertInto('access_grant')
        .values({
          group_id: ended,
          role_id: roles['Administrator']!,
          level: 'tenant',
          effect: 'allow',
          expires_at: new Date(Date.now() - 86_400_000),
          granted_by: ada.id,
        })
        .execute(),
    );
    expect((await members(ended, bob.cookie, [bob.id])).statusCode).toBe(200);
  });

  it('refuses deleting a group holding what he does not, and lets him delete one of content', async () => {
    const held = await newGroup('Not his to delete');
    await madeBy(giving('Administrator', { group: held }));
    expect((await send('DELETE', `/v1/groups/${held}`, bob.cookie)).json()).toMatchObject(BEYOND);

    const authors = await newGroup('His to delete');
    await madeBy(giving('Author', { group: authors }));
    expect((await send('DELETE', `/v1/groups/${authors}`, bob.cookie)).statusCode).toBe(200);
  });

  it('lets him remove an allow of Administrator, and refuses removing a denial of it', async () => {
    const erin = await holding('erin', 'Administrator');
    expect((await send('DELETE', `/v1/grants/${erin.grant}`, bob.cookie)).statusCode).toBe(200);

    const space = await newSpace('Denied');
    const denial = await madeBy(
      giving('Administrator', { principal: bob.id }, `space:${space}`, 'deny'),
    );
    const removed = await send('DELETE', `/v1/grants/${denial}`, bob.cookie);
    expect(removed.statusCode).toBe(403);
    expect(removed.json()).toMatchObject(BEYOND);
    expect((await send('DELETE', `/v1/grants/${denial}`, ada.cookie)).statusCode).toBe(200);
  });

  it('refuses re-enabling somebody holding what he does not, but not somebody holding less', async () => {
    const hal = await holding('hal', 'Administrator');
    expect(
      (await send('POST', `/v1/principals/${hal.id}/disablement`, ada.cookie, {})).statusCode,
    ).toBe(200);
    const back = await send('DELETE', `/v1/principals/${hal.id}/disablement`, bob.cookie);
    expect(back.json()).toMatchObject(BEYOND);
    expect(
      (await send('DELETE', `/v1/principals/${hal.id}/disablement`, ada.cookie)).statusCode,
    ).toBe(200);

    const ida = await holding('ida', 'Reader');
    await send('POST', `/v1/principals/${ida.id}/disablement`, bob.cookie, {});
    expect(
      (await send('DELETE', `/v1/principals/${ida.id}/disablement`, bob.cookie)).statusCode,
    ).toBe(200);
  });

  it('refuses erasing somebody holding what he does not through a group', async () => {
    const jon = await holding('jon');
    const group = await newGroup('Held by Jon');
    await madeBy(giving('Administrator', { group }));
    expect((await members(group, ada.cookie, [jon.id])).statusCode).toBe(200);
    const erased = await send('POST', `/v1/principals/${jon.id}/erase`, bob.cookie, {});
    expect(erased.json()).toMatchObject(BEYOND);
  });

  it('refuses a service identity a token scoped past what he holds', async () => {
    const made = await send('POST', '/v1/service-identities', ada.cookie, { name: 'Backups' });
    expect(made.statusCode).toBe(200);
    const id = made.json<{ id: string }>().id;
    const token = (scopes: readonly string[]) =>
      send('POST', `/v1/service-identities/${id}/tokens`, bob.cookie, {
        name: 'Nightly',
        scopes,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
    expect((await token(['export_environment'])).json()).toMatchObject(BEYOND);
    expect((await token(['edit'])).statusCode).toBe(200);
  });

  it('holds a token to its scopes, so one scoped administer alone cannot grant Administrator', async () => {
    const issued = await send('POST', '/v1/tokens', ada.cookie, {
      name: 'Administers alone',
      scopes: ['administer'],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const { secret } = issued.json<{ secret: string }>();
    const grant = await app.inject({
      method: 'POST',
      url: '/v1/grants',
      headers: { host: HOST, authorization: `Bearer ${secret}` },
      payload: giving('Administrator', { principal: bob.id }),
    });
    expect(grant.json()).toMatchObject(BEYOND);
  });

  it('lets an Administrator do all of it, and records the refusal in the audit log', async () => {
    const group = await newGroup('Ada makes these');
    const granted = await send(
      'POST',
      '/v1/grants',
      ada.cookie,
      giving('Administrator', { group }),
    );
    expect(granted.statusCode).toBe(200);
    expect((await members(group, ada.cookie, [bob.id])).statusCode).toBe(200);
    expect((await members(group, ada.cookie, [])).statusCode).toBe(200);
    const role = await send('POST', '/v1/roles', ada.cookie, {
      name: 'Closer of hers',
      permissions: ['read', 'close_environment'],
    });
    expect(role.statusCode).toBe(200);

    await send('POST', '/v1/grants', bob.cookie, giving('Administrator', { principal: bob.id }));
    const logged = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select('detail')
        .where('kind', '=', 'access.refused')
        .where('actor', '=', bob.id)
        .execute(),
    );
    expect(logged.map((event) => event.detail)).toContainEqual(
      expect.objectContaining({ permission: expect.any(String), reason: 'not_granted' }),
    );
  });

  // Last, since it takes Ada's grant: nobody could ever give a stranded permission again.
  it('refuses taking the last holder of an administrative permission, by removal or disablement', async () => {
    const fay = await holding('fay', 'Administrator');
    // Somebody else may still configure sign-in, so it is this guard that answers and not the lockout's.
    await holding('gil', 'Sign-in keeper', ['read', 'configure_services']);
    await tenantDb.withTenant(tenant, (trx) =>
      trx
        .deleteFrom('access_grant')
        .where('role_id', '=', roles['Administrator']!)
        .where('id', '<>', fay.grant)
        .where('effect', '=', 'allow')
        .execute(),
    );
    const removed = await send('DELETE', `/v1/grants/${fay.grant}`, bob.cookie);
    expect(removed.statusCode).toBe(409);
    expect(removed.json()).toMatchObject({ code: 'grant_last_holder' });
    const disabled = await send('POST', `/v1/principals/${fay.id}/disablement`, bob.cookie, {});
    expect(disabled.statusCode).toBe(409);
    expect(disabled.json()).toMatchObject({ code: 'principal_last_holder' });

    // With somebody else holding it, nothing is stranded.
    const kim = await holding('kim', 'Administrator');
    expect((await send('DELETE', `/v1/grants/${kim.grant}`, bob.cookie)).statusCode).toBe(200);
  });
});
