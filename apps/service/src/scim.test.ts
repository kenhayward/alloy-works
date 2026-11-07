import {
  bootstrapCluster,
  createTenant,
  erasePerson,
  migrate,
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
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { SCIM_PATHS } from './scim.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, STAND_IN_SECRET, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'scim.acme.alloy.test';
const OTHER = 'scim.other.alloy.test';
const CALLBACK = `http://${HOST}/v1/sign-in/organisation/callback`;
const SCIM_TYPE = 'application/scim+json';

const USERS = ['ada', 'grace', 'hedy', 'mary', 'joan', 'ivy', 'alan', 'kay', 'lin'].map((id) => ({
  id,
  name: id,
  email: `${id}@acme.example`,
}));

describe('SCIM', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let elsewhere: Tenant;
  let providerId: string;
  let token: string;
  /** A token replaced and still overlapping, which turning SCIM off ends too. */
  let held = '';
  let admin: { cookie: string; id: string };

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
      tenant: { id: db.newTenantId(), name: 'Scim' },
      hostnames: [HOST],
    });
    elsewhere = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'other', name: 'Other' },
      tenant: { id: db.newTenantId(), name: 'Elsewhere' },
      hostnames: [OTHER],
    });
    providerId = await configureStandIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
    });
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    await app.ready();

    // Ada signs in before SCIM is on, and holds administer outright.
    admin = await administrator('ada');
    const on = await settings('POST', `/providers/${providerId}/scim`, { claim: 'sub' });
    expect(on.statusCode).toBe(200);
    const issued = await settings('POST', `/providers/${providerId}/scim/token`, {});
    expect(issued.statusCode).toBe(200);
    expect(issued.headers['cache-control']).toBe('no-store');
    token = issued.json<{ secret: string }>().secret;
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  async function signIn(user: string) {
    const started = await app.inject({
      url: '/v1/sign-in/organisation',
      headers: { host: HOST },
    });
    const attempt = started.cookies.find((cookie) => cookie.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, user, idp.issuer);
    const finished = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: HOST, cookie: `${attempt.name}=${attempt.value}` },
    });
    const session = finished.cookies.find((cookie) => cookie.name === '__Host-aw_session');
    return {
      status: finished.statusCode,
      code: finished.statusCode === 302 ? undefined : finished.json<{ code: string }>().code,
      cookie: session ? `${session.name}=${session.value}` : undefined,
    };
  }

  async function administrator(user: string) {
    const { cookie } = await signIn(user);
    const id = (
      await app.inject({ url: '/v1/me', headers: { host: HOST, cookie: cookie! } })
    ).json<{ id: string }>().id;
    await tenantDb.withTenant(tenant, async (trx) => {
      const role = await trx
        .selectFrom('role')
        .select('id')
        .where('name', '=', 'Administrator')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('access_grant')
        .values({
          principal_id: id,
          role_id: role.id,
          level: 'tenant',
          effect: 'allow',
          granted_by: id,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    });
    return { cookie: cookie!, id };
  }

  const settings = (method: 'POST' | 'DELETE', path: string, payload?: object) =>
    app.inject({
      method,
      url: `/v1/sign-in-settings${path}`,
      headers: { host: HOST, cookie: admin.cookie },
      ...(payload === undefined ? {} : { payload }),
    });

  const scim = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    payload?: object,
    options: { host?: string; bearer?: string | null } = {},
  ) =>
    app.inject({
      method,
      url: `/scim/v2${path}`,
      headers: {
        host: options.host ?? HOST,
        ...(options.bearer === null ? {} : { authorization: `Bearer ${options.bearer ?? token}` }),
        ...(payload === undefined ? {} : { 'content-type': SCIM_TYPE }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });

  const push = async (user: string, over: object = {}) => {
    const made = await scim('POST', '/Users', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      externalId: user,
      userName: `${user}@acme.example`,
      displayName: user,
      emails: [{ value: `${user}@acme.example`, primary: true }],
      active: true,
      ...over,
    });
    expect(made.statusCode, made.body).toBe(201);
    return made.json<{ id: string; active: boolean }>();
  };

  const me = (cookie: string) => app.inject({ url: '/v1/me', headers: { host: HOST, cookie } });

  it('serves the subset the design names, and no other', () => {
    expect([...SCIM_PATHS].sort()).toEqual(
      [
        'GET /ServiceProviderConfig',
        'GET /ResourceTypes',
        'GET /Schemas',
        'GET /Users',
        'POST /Users',
        'GET /Users/:id',
        'PUT /Users/:id',
        'PATCH /Users/:id',
        'DELETE /Users/:id',
        'GET /Groups',
        'POST /Groups',
        'GET /Groups/:id',
        'PUT /Groups/:id',
        'PATCH /Groups/:id',
        'DELETE /Groups/:id',
      ].sort(),
    );
    for (const path of SCIM_PATHS) {
      const [method, url] = path.split(' ') as ['GET', string];
      expect(app.hasRoute({ method, url: `/scim/v2${url}` }), path).toBe(true);
    }
  });

  it('describes itself, in the type SCIM has, and refuses without its token', async () => {
    const config = await scim('GET', '/ServiceProviderConfig');
    expect(config.statusCode).toBe(200);
    expect(config.headers['content-type']).toContain(SCIM_TYPE);
    expect(config.json()).toMatchObject({ patch: { supported: true }, bulk: { supported: false } });
    expect((await scim('GET', '/ResourceTypes')).json()).toMatchObject({ totalResults: 2 });
    expect((await scim('GET', '/Schemas')).json()).toMatchObject({ totalResults: 2 });

    const none = await scim('GET', '/Users', undefined, { bearer: null });
    expect(none.statusCode).toBe(401);
    expect(none.json()).toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      status: '401',
    });
    expect((await scim('GET', '/Users', undefined, { bearer: 'awt_nonsense' })).statusCode).toBe(
      401,
    );
  });

  it('IAM-003 a token is found only in its own environment', async () => {
    expect(elsewhere).toBeDefined();
    expect((await scim('GET', '/Users', undefined, { host: OTHER })).statusCode).toBe(401);
  });

  it("refuses somebody else's token, whatever it holds", async () => {
    const own = await app.inject({
      method: 'POST',
      url: '/v1/tokens',
      headers: { host: HOST, cookie: admin.cookie },
      payload: {
        name: 'Mine',
        scopes: ['administer'],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    const secret = own.json<{ secret: string }>().secret;
    expect((await scim('GET', '/Users', undefined, { bearer: secret })).statusCode).toBe(401);
  });

  it('IAM-008 provisions a person by SCIM who then signs in and is bound by the named claim, never by email', async () => {
    const pushed = await push('grace', { emails: [{ value: 'someone-else@acme.example' }] });
    const first = await signIn('grace');
    expect(first.cookie).toBeDefined();
    const id = (await me(first.cookie!)).json<{ id: string }>().id;
    expect(id).toBe(pushed.id);
    // The same address on another's account links nothing.
    const other = await signIn('hedy');
    expect(other.code).toBe('not_provisioned');
  });

  it('IAM-008 provisions a person who signed in before SCIM was on as that principal, not a second', async () => {
    const pushed = await push('ada');
    expect(pushed.id).toBe(admin.id);
    const again = await signIn('ada');
    expect((await me(again.cookie!)).json<{ id: string }>().id).toBe(admin.id);
  });

  it('IAM-008 a provider that provisions refuses a subject it never pushed', async () => {
    const refused = await signIn('mary');
    expect(refused.status).toBe(403);
    expect(refused.code).toBe('not_provisioned');
    const made = await tenantDb.withTenant(tenant, (trx) =>
      trx.selectFrom('principal').select('id').where('subject', '=', 'mary').execute(),
    );
    expect(made).toEqual([]);
  });

  it('refuses a person bound to one subject when another arrives with their key', async () => {
    const grace = (
      await scim('GET', `/Users?filter=${encodeURIComponent('externalId eq "grace"')}`)
    ).json<{ Resources: { id: string }[] }>().Resources[0]!;
    const rekey = (value: string) =>
      scim('PATCH', `/Users/${grace.id}`, {
        Operations: [{ op: 'replace', path: 'externalId', value }],
      });
    expect((await rekey('hedy')).statusCode).toBe(200);
    expect((await signIn('hedy')).code).toBe('not_provisioned');
    expect((await rekey('grace')).statusCode).toBe(200);
  });

  it('turning SCIM on locks out nobody holding administer outright before they are pushed', async () => {
    // Joan signed in and was given administer before SCIM reached her; SCIM has never pushed her.
    const joan = await tenantDb.withTenant(tenant, async (trx) => {
      const made = await trx
        .insertInto('principal')
        .values({ issuer: idp.issuer, subject: 'joan', email: null, display_name: 'joan' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const role = await trx
        .selectFrom('role')
        .select('id')
        .where('name', '=', 'Administrator')
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('access_grant')
        .values({
          principal_id: made.id,
          role_id: role.id,
          level: 'tenant',
          effect: 'allow',
          granted_by: made.id,
        })
        .execute();
      return made.id;
    });
    const signedIn = await signIn('joan');
    expect((await me(signedIn.cookie!)).json<{ id: string }>().id).toBe(joan);
  });

  it('lists by filter and page, and shows nobody it did not push', async () => {
    const ivy = await push('ivy');
    const found = await scim(
      'GET',
      `/Users?filter=${encodeURIComponent('userName eq "IVY@acme.example"')}`,
    );
    expect(found.json()).toMatchObject({ totalResults: 1, Resources: [{ id: ivy.id }] });
    const external = await scim(
      'GET',
      `/Users?filter=${encodeURIComponent('externalId eq "ivy"')}`,
    );
    expect(external.json()).toMatchObject({ totalResults: 1 });
    expect(
      (await scim('GET', `/Users?filter=${encodeURIComponent('displayName sw "x"')}`)).json(),
    ).toMatchObject({ status: '400', scimType: 'invalidFilter' });
    const page = await scim('GET', '/Users?startIndex=1&count=1');
    expect(page.json()).toMatchObject({ startIndex: 1, itemsPerPage: 1 });

    const others = await tenantDb.withTenant(tenant, (trx) =>
      trx.selectFrom('principal').select('id').where('kind', '=', 'service').execute(),
    );
    for (const service of others) {
      expect((await scim('GET', `/Users/${service.id}`)).statusCode).toBe(404);
    }
    expect((await scim('POST', '/Users', { userName: 'no-external' })).statusCode).toBe(400);
    expect((await scim('POST', '/Users', { externalId: 'ivy', userName: 'ivy2' })).statusCode).toBe(
      409,
    );
  });

  it('a person set inactive is refused at once, Entra spelling it as text, and an administrator stays obeyed', async () => {
    const alan = await push('alan');
    const session = (await signIn('alan')).cookie!;
    expect((await me(session)).statusCode).toBe(200);

    const off = await scim('PATCH', `/Users/${alan.id}`, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', path: 'active', value: 'False' }],
    });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ active: false });
    expect((await me(session)).statusCode).toBe(401);
    expect((await signIn('alan')).code).toBe('principal_disabled');

    const on = await scim('PATCH', `/Users/${alan.id}`, {
      Operations: [{ op: 'replace', value: { active: true } }],
    });
    expect(on.json()).toMatchObject({ active: true });
    expect((await signIn('alan')).cookie).toBeDefined();

    // An administrator's disablement is not undone by the provider saying active again.
    await app.inject({
      method: 'POST',
      url: `/v1/principals/${alan.id}/disablement`,
      headers: { host: HOST, cookie: admin.cookie },
    });
    const replay = await scim('PUT', `/Users/${alan.id}`, {
      externalId: 'alan',
      userName: 'alan@acme.example',
      displayName: 'alan',
      active: true,
    });
    expect(replay.json()).toMatchObject({ active: false });
    await app.inject({
      method: 'DELETE',
      url: `/v1/principals/${alan.id}/disablement`,
      headers: { host: HOST, cookie: admin.cookie },
    });

    // A delete disables and keeps the principal; pushing them again brings them back.
    expect((await scim('DELETE', `/Users/${alan.id}`)).statusCode).toBe(204);
    expect((await scim('GET', `/Users/${alan.id}`)).statusCode).toBe(404);
    const kept = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('principal')
        .select(['id', 'disabled_by', 'display_name'])
        .where('id', '=', alan.id)
        .executeTakeFirst(),
    );
    expect(kept).toMatchObject({ disabled_by: 'scim', display_name: 'alan' });
    expect((await signIn('alan')).code).toBe('not_provisioned');
    const back = await push('alan');
    expect(back).toMatchObject({ id: alan.id, active: true });
  });

  it('a group applies on receipt, is held until a group here stands for it, and goes when removed', async () => {
    const ivy = (
      await scim('GET', `/Users?filter=${encodeURIComponent('externalId eq "ivy"')}`)
    ).json<{ Resources: { id: string }[] }>().Resources[0]!;
    const editors = await scim('POST', '/Groups', {
      displayName: 'Editors',
      externalId: 'g-1',
      members: [{ value: ivy.id }],
    });
    expect(editors.statusCode).toBe(201);
    const scimId = editors.json<{ id: string }>().id;

    // Nothing stands for it yet: held. A group made here later picks its members up.
    const made = await app.inject({
      method: 'POST',
      url: '/v1/groups',
      headers: { host: HOST, cookie: admin.cookie },
      payload: { name: 'Editors here', providerValue: 'g-1' },
    });
    expect(made.statusCode, made.body).toBe(200);
    const groupId = made.json<{ group: { id: string } }>().group.id;
    const members = () =>
      tenantDb.withTenant(tenant, (trx) =>
        trx
          .selectFrom('group_member')
          .select('principal_id')
          .where('group_id', '=', groupId)
          .execute(),
      );
    expect(await members()).toEqual([{ principal_id: ivy.id }]);

    // Removed by a patch, as Okta and Entra spell it, on receipt.
    const removed = await scim('PATCH', `/Groups/${scimId}`, {
      Operations: [{ op: 'remove', path: `members[value eq "${ivy.id}"]` }],
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await members()).toEqual([]);
    const added = await scim('PATCH', `/Groups/${scimId}`, {
      Operations: [{ op: 'add', path: 'members', value: [{ value: ivy.id }] }],
    });
    expect(added.json<{ members: unknown[] }>().members).toHaveLength(1);
    expect(await members()).toEqual([{ principal_id: ivy.id }]);

    // The groups claim is not read for a provider that provisions.
    const signedIn = await signIn('ivy');
    expect(signedIn.cookie).toBeDefined();
    expect(await members()).toEqual([{ principal_id: ivy.id }]);

    // Nobody it did not push may be named a member.
    expect(
      (
        await scim('POST', '/Groups', {
          displayName: 'Strangers',
          members: [{ value: '00000000-0000-4000-8000-000000000000' }],
        })
      ).statusCode,
    ).toBe(400);

    expect((await scim('DELETE', `/Groups/${scimId}`)).statusCode).toBe(204);
    expect(await members()).toEqual([]);
    const events = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['detail', 'actor_kind'])
        .where('kind', '=', 'scim.provisioned')
        .execute(),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((each) => each.actor_kind === 'token')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('@acme.example');
  });

  it("an administrator's disabling of somebody SCIM disabled stands when the provider says active", async () => {
    const kay = await push('kay', { active: false });
    expect(kay.active).toBe(false);
    const disabled = await app.inject({
      method: 'POST',
      url: `/v1/principals/${kay.id}/disablement`,
      headers: { host: HOST, cookie: admin.cookie },
    });
    expect(disabled.statusCode, disabled.body).toBe(200);
    const replay = await scim('PUT', `/Users/${kay.id}`, {
      externalId: 'kay',
      userName: 'kay@acme.example',
      active: true,
    });
    expect(replay.json()).toMatchObject({ active: false });
  });

  it('an erased person leaves what SCIM holds, so its next push neither refuses nor restores them', async () => {
    const lin = await push('lin');
    const ivy = (
      await scim('GET', `/Users?filter=${encodeURIComponent('externalId eq "ivy"')}`)
    ).json<{ Resources: { id: string }[] }>().Resources[0]!;
    const held = await scim('POST', '/Groups', {
      displayName: 'Reviewers',
      externalId: 'g-erased',
      members: [{ value: lin.id }],
    });
    const group = held.json<{ id: string }>().id;
    await tenantDb.withTenant(tenant, (trx) => erasePerson(trx, lin.id, admin.id), {
      actorKind: 'person',
      actor: admin.id,
      traceId: 'erasing',
    });
    const next = await scim('PATCH', `/Groups/${group}`, {
      Operations: [{ op: 'add', path: 'members', value: [{ value: ivy.id }] }],
    });
    expect(next.statusCode, next.body).toBe(200);
    expect(next.json<{ members: { value: string }[] }>().members.map((each) => each.value)).toEqual(
      [ivy.id],
    );
    expect((await scim('DELETE', `/Groups/${group}`)).statusCode).toBe(204);
  });

  it('says a body that is no JSON, and a key somebody else holds, in its own shape', async () => {
    const broken = await app.inject({
      method: 'POST',
      url: '/scim/v2/Users',
      headers: { host: HOST, authorization: `Bearer ${token}`, 'content-type': SCIM_TYPE },
      payload: '{not json',
    });
    expect(broken.statusCode).toBe(400);
    expect(broken.json()).toMatchObject({ status: '400' });

    const ivy = (
      await scim('GET', `/Users?filter=${encodeURIComponent('externalId eq "ivy"')}`)
    ).json<{ Resources: { id: string }[] }>().Resources[0]!;
    const taken = await scim('PATCH', `/Users/${ivy.id}`, {
      Operations: [{ op: 'replace', path: 'externalId', value: 'grace' }],
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ scimType: 'uniqueness' });
  });

  it('closing a provider ends its SCIM token', async () => {
    const added = await settings('POST', '/providers', {
      name: 'Partners',
      issuer: 'https://partners.example',
      clientId: 'alloy',
      clientSecret: 'kept-sealed',
    });
    expect(added.statusCode, added.body).toBe(200);
    const partners = added
      .json<{ providers: { id: string; name: string }[] }>()
      .providers.find((each) => each.name === 'Partners')!.id;
    await settings('POST', `/providers/${partners}/scim`, { claim: 'oid' });
    const secret = (await settings('POST', `/providers/${partners}/scim/token`, {})).json<{
      secret: string;
      id: string;
    }>();
    // One provider's token reaches nobody of another's.
    const theirs = { bearer: secret.secret };
    const ivy = (
      await scim('GET', `/Users?filter=${encodeURIComponent('externalId eq "ivy"')}`)
    ).json<{ Resources: { id: string }[] }>().Resources[0]!;
    expect((await scim('GET', '/Users', undefined, theirs)).json()).toMatchObject({
      totalResults: 0,
    });
    expect((await scim('GET', `/Users/${ivy.id}`, undefined, theirs)).statusCode).toBe(404);
    expect((await scim('DELETE', `/Users/${ivy.id}`, undefined, theirs)).statusCode).toBe(404);
    expect(
      (
        await scim(
          'PATCH',
          `/Users/${ivy.id}`,
          { Operations: [{ op: 'replace', path: 'active', value: false }] },
          theirs,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await scim(
          'POST',
          '/Groups',
          { displayName: 'Theirs', members: [{ value: ivy.id }] },
          theirs,
        )
      ).statusCode,
    ).toBe(400);
    expect((await scim('GET', '/Groups', undefined, theirs)).json()).toMatchObject({
      totalResults: 0,
    });
    const closed = await settings('POST', `/providers/${partners}/closure`);
    expect(closed.statusCode, closed.body).toBe(200);
    expect((await scim('GET', '/Users', undefined, { bearer: secret.secret })).statusCode).toBe(
      401,
    );
    const held = await tenantDb.withTenant(tenant, (trx) =>
      trx.selectFrom('api_token').select('id').where('id', '=', secret.id).executeTakeFirst(),
    );
    expect(held).toBeUndefined();
  });

  it('ADM-007 a new token leaves the one before it working for 24 hours, and ends any older at once', async () => {
    const first = token;
    const again = await settings('POST', `/providers/${providerId}/scim/token`, {});
    const second = again.json<{ id: string; secret: string }>();
    token = second.secret;
    // Both work: the provider moves to the new one without a moment when neither does.
    expect((await scim('GET', '/Users', undefined, { bearer: first })).statusCode).toBe(200);
    expect((await scim('GET', '/Users')).statusCode).toBe(200);
    const ends = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('api_token')
        .select(['id', 'ends_at'])
        .where('principal_id', '=', (eb) =>
          eb.selectFrom('identity_provider').select('scim_identity').where('id', '=', providerId),
        )
        .orderBy('created_at')
        .execute(),
    );
    expect(ends).toHaveLength(2);
    const hours = (ends[0]!.ends_at!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    expect(ends[1]).toEqual({ id: second.id, ends_at: null });

    // A third: the second overlaps in turn, and the first ends now, so two at most are accepted.
    const third = await settings('POST', `/providers/${providerId}/scim/token`, {});
    token = third.json<{ secret: string }>().secret;
    expect((await scim('GET', '/Users', undefined, { bearer: first })).statusCode).toBe(401);
    expect((await scim('GET', '/Users', undefined, { bearer: second.secret })).statusCode).toBe(
      200,
    );
    expect((await scim('GET', '/Users')).statusCode).toBe(200);
    held = second.secret;
  });

  it('lists every secret with its consumers and overlap, and never a value or a hash', async () => {
    const answer = await app.inject({
      url: '/v1/secrets',
      headers: { host: HOST, cookie: admin.cookie },
    });
    expect(answer.statusCode, answer.body).toBe(200);
    const { items } = answer.json<{
      items: {
        kind: string;
        of: { id: string; name: string | null };
        previousUntil: string | null;
        replacement: { operation: string; how: string };
        consumers: { kind: string; id: string | null }[];
      }[];
    }>();
    const scimToken = items.find((each) => each.kind === 'scim_token')!;
    expect(scimToken.of.id).toBe(providerId);
    expect(scimToken.replacement).toMatchObject({ operation: 'issueScimToken', how: 'overlap' });
    expect(scimToken.consumers).toEqual([
      { kind: 'provisioning', id: providerId, name: expect.any(String) },
    ]);
    expect(Date.parse(scimToken.previousUntil!)).toBeGreaterThan(Date.now() + 23 * 3_600_000);
    const signIn = items.find((each) => each.kind === 'sign_in_client_secret')!;
    expect(signIn.consumers).toEqual([
      { kind: 'sign_in', id: providerId, name: expect.any(String) },
    ]);
    // Neither the tokens nor the provider's secret, nor any hash or sealed value of them.
    const hashes = await tenantDb.withTenant(tenant, (trx) =>
      trx.selectFrom('api_token').select('token_hash').execute(),
    );
    const sealed = await tenantDb.withTenant(tenant, (trx) =>
      trx.selectFrom('identity_provider').select('sealed_secret').execute(),
    );
    for (const value of [
      token,
      held,
      STAND_IN_SECRET,
      ...hashes.map((each) => each.token_hash),
      ...sealed.flatMap((each) => (each.sealed_secret === null ? [] : [each.sealed_secret])),
    ]) {
      expect(answer.body).not.toContain(value);
    }
  });

  it('ADM-007 turning it off ends every token at once, and its people sign in as anybody of the provider', async () => {
    const off = await settings('DELETE', `/providers/${providerId}/scim`);
    expect(off.statusCode).toBe(200);
    expect((await scim('GET', '/Users')).statusCode).toBe(401);
    expect((await scim('GET', '/Users', undefined, { bearer: held })).statusCode).toBe(401);
    expect((await signIn('mary')).cookie).toBeDefined();
  });
});
