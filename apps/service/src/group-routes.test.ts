import {
  bootstrapCluster,
  configureOrganisationSignIn,
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

interface GroupView {
  readonly id: string;
  readonly name: string;
  readonly source: 'tenant' | 'provider';
  readonly providerValue: string | null;
  readonly members: readonly { readonly id: string; readonly name: string | null }[];
}

describe('groups: made, filled and deleted, and followed from the provider at sign-in (access.md, "Groups and Access, as W12 builds them")', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;
  let general = '';
  let grace = '';
  let graceCookie = '';
  /** Ada as the directory has her: a test moves her between groups between two sign-ins. */
  const ada: { id: string; name: string; email: string; groups?: unknown } = {
    id: 'ada',
    name: 'Ada',
    email: 'ada@example.com',
    groups: ['authors'],
  };

  const as = (cookie: string) => ({ host: HOST, cookie });

  const call = (
    cookie: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) => app.inject({ method, url, headers: as(cookie), ...(payload ? { payload } : {}) });

  const makeGroup = async (name: string, providerValue?: string) => {
    const made = await call(graceCookie, 'POST', '/v1/groups', {
      name,
      ...(providerValue === undefined ? {} : { providerValue }),
    });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ group: GroupView }>().group;
  };

  const roleId = (name: string) =>
    tenantDb.withTenant(production, async (trx) => (await findRole(trx, name))!.id);

  /**
   * Whether the person signed in with `cookie` may create in the General space. A space they may not
   * read answers as one that does not exist (access.md, "Refusing"), so they may not create there.
   */
  const mayCreate = async (cookie: string) => {
    const answer = await call(cookie, 'GET', `/v1/access?target=space:${general}`);
    if (answer.statusCode === 404) return false;
    expect(answer.statusCode, answer.body).toBe(200);
    return answer
      .json<{ permissions: { permission: string; allowed: boolean }[] }>()
      .permissions.find((each) => each.permission === 'create')!.allowed;
  };

  const listed = async () => {
    const answer = await call(graceCookie, 'GET', '/v1/groups?limit=100');
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ items: GroupView[]; next: string | null }>().items;
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
      users: [
        ada as never,
        { id: 'grace', name: 'Grace', email: 'grace@example.com', groups: ['publishers'] },
        { id: 'alice', name: 'Alice', email: 'alice@example.com' },
      ],
    });
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureOrganisationSignIn(db.adminUrl, production, {
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
    // Grace administers the environment, directly: the grant the lock-out guard counts.
    graceCookie = await signIn(app, HOST, 'grace', idp.issuer);
    grace = (await call(graceCookie, 'GET', '/v1/me')).json<{ id: string }>().id;
    general = await tenantDb.withTenant(production, async (trx) => {
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: grace },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: grace,
      });
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      return space.id;
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it("IAM-009 signs a principal in through the organisation's provider holding the role of the group their claim's value stands for, and signs them in again without it once the value is gone", async () => {
    const authors = await makeGroup('Directory authors', 'authors');
    expect(authors).toMatchObject({ source: 'provider', providerValue: 'authors', members: [] });
    const given = await call(graceCookie, 'POST', '/v1/grants', {
      role: await roleId('Author'),
      subject: { group: authors.id },
      level: `space:${general}`,
      effect: 'allow',
    });
    expect(given.statusCode, given.body).toBe(200);
    expect(given.json()).toMatchObject({
      grant: { subject: { group: { id: authors.id, name: 'Directory authors' } } },
    });

    ada.groups = ['authors'];
    const first = await signIn(app, HOST, 'ada', idp.issuer);
    expect(await mayCreate(first)).toBe(true);
    const adaId = (await call(first, 'GET', '/v1/me')).json<{ id: string }>().id;
    expect((await listed()).find((each) => each.id === authors.id)?.members).toEqual([
      expect.objectContaining({ id: adaId, name: 'Ada' }),
    ]);

    ada.groups = ['somebody-else'];
    const second = await signIn(app, HOST, 'ada', idp.issuer);
    expect(await mayCreate(second)).toBe(false);
    // Memberships are the principal's, not the session's: the earlier session loses it too.
    expect(await mayCreate(first)).toBe(false);
  });

  it('counts an absent or malformed claim as no groups, and empties the provider memberships', async () => {
    const [authors] = (await listed()).filter((each) => each.providerValue === 'authors');
    for (const claim of [undefined, 'authors', { authors: true }]) {
      ada.groups = ['authors'];
      const cookie = await signIn(app, HOST, 'ada', idp.issuer);
      expect(await mayCreate(cookie)).toBe(true);
      ada.groups = claim;
      const again = await signIn(app, HOST, 'ada', idp.issuer);
      expect(await mayCreate(again), JSON.stringify(claim)).toBe(false);
      expect(
        (await listed()).find((each) => each.id === authors!.id)?.members,
        JSON.stringify(claim),
      ).toEqual([]);
    }
  });

  it("makes the environment's own group, fills it by hand, lists it and deletes it with its grants", async () => {
    const alice = await signIn(app, HOST, 'alice', idp.issuer);
    const aliceId = (await call(alice, 'GET', '/v1/me')).json<{ id: string }>().id;
    const reviewers = await makeGroup('Reviewers');
    expect(reviewers).toMatchObject({ source: 'tenant', providerValue: null, members: [] });

    const filled = await call(graceCookie, 'PUT', `/v1/groups/${reviewers.id}/members`, {
      principals: [aliceId, grace, aliceId],
    });
    expect(filled.statusCode, filled.body).toBe(200);
    expect(
      filled
        .json<{ group: GroupView }>()
        .group.members.map((each) => each.id)
        .sort(),
    ).toEqual([aliceId, grace].sort());

    const given = await call(graceCookie, 'POST', '/v1/grants', {
      role: await roleId('Author'),
      subject: { group: reviewers.id },
      level: `space:${general}`,
      effect: 'allow',
    });
    expect(given.statusCode, given.body).toBe(200);
    expect(await mayCreate(alice)).toBe(true);

    const deleted = await call(graceCookie, 'DELETE', `/v1/groups/${reviewers.id}`);
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toEqual({ deleted: reviewers.id });
    expect(await mayCreate(alice)).toBe(false);
    expect((await listed()).map((each) => each.id)).not.toContain(reviewers.id);
    const grants = await call(graceCookie, 'GET', `/v1/grants?level=space:${general}`);
    expect(
      grants
        .json<{ items: { subject: { group?: { id: string } } }[] }>()
        .items.filter((each) => each.subject.group?.id === reviewers.id),
    ).toEqual([]);

    const again = await call(graceCookie, 'DELETE', `/v1/groups/${reviewers.id}`);
    expect(again.statusCode).toBe(404);
  });

  it("refuses to fill a provider's group by hand, a name or value already taken, and a person this environment does not hold", async () => {
    const publishers = await makeGroup('Directory publishers', 'publishers');
    const byHand = await call(graceCookie, 'PUT', `/v1/groups/${publishers.id}/members`, {
      principals: [grace],
    });
    expect(byHand.statusCode).toBe(409);
    expect(byHand.json()).toMatchObject({ code: 'group_from_provider' });

    const sameName = await call(graceCookie, 'POST', '/v1/groups', {
      name: 'Directory publishers',
    });
    expect(sameName.statusCode).toBe(409);
    expect(sameName.json()).toMatchObject({ code: 'group_name_taken' });
    const sameValue = await call(graceCookie, 'POST', '/v1/groups', {
      name: 'Publishers again',
      providerValue: 'publishers',
    });
    expect(sameValue.statusCode).toBe(409);
    expect(sameValue.json()).toMatchObject({ code: 'group_value_taken' });

    const own = await makeGroup('Nobody unknown');
    const unknown = await call(graceCookie, 'PUT', `/v1/groups/${own.id}/members`, {
      principals: ['11111111-1111-4111-8111-111111111111'],
    });
    expect(unknown.statusCode).toBe(409);
    expect(unknown.json()).toMatchObject({ code: 'group_member_missing' });
  });

  it('takes a name of 1 to 80 characters once trimmed, and a value of 1 to 256 kept exactly', async () => {
    const padded = await makeGroup('  Padded  ', ' spaced value ');
    expect(padded).toMatchObject({ name: 'Padded', providerValue: ' spaced value ' });
    for (const payload of [
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(81) },
      { name: 'Empty value', providerValue: '' },
      { name: 'Long value', providerValue: 'v'.repeat(257) },
    ]) {
      const refused = await call(graceCookie, 'POST', '/v1/groups', payload);
      expect(refused.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('never counts a grant through a group towards keeping the environment administered', async () => {
    const administrators = await makeGroup('Administrators');
    await call(graceCookie, 'PUT', `/v1/groups/${administrators.id}/members`, {
      principals: [grace],
    });
    const throughGroup = await call(graceCookie, 'POST', '/v1/grants', {
      role: await roleId('Administrator'),
      subject: { group: administrators.id },
      level: 'tenant',
      effect: 'allow',
    });
    expect(throughGroup.statusCode, throughGroup.body).toBe(200);
    const direct = await tenantDb.withTenant(production, (trx) =>
      trx
        .selectFrom('access_grant')
        .select('id')
        .where('principal_id', '=', grace)
        .where('level', '=', 'tenant')
        .executeTakeFirstOrThrow(),
    );
    const removed = await call(graceCookie, 'DELETE', `/v1/grants/${direct.id}`);
    expect(removed.statusCode).toBe(409);
    expect(removed.json()).toMatchObject({ code: 'grant_last_administrator' });
    // And the group, with the grant it holds, goes without a word from the guard.
    const deleted = await call(graceCookie, 'DELETE', `/v1/groups/${administrators.id}`);
    expect(deleted.statusCode).toBe(200);
  });

  it('refuses every group route to somebody who does not administer the environment', async () => {
    const alice = await signIn(app, HOST, 'alice', idp.issuer);
    const some = (await listed())[0]!;
    for (const [method, url, payload] of [
      ['GET', '/v1/groups', undefined],
      ['POST', '/v1/groups', { name: 'Mine' }],
      ['PUT', `/v1/groups/${some.id}/members`, { principals: [] }],
      ['DELETE', `/v1/groups/${some.id}`, undefined],
    ] as const) {
      const refused = await call(alice, method, url, payload);
      expect(refused.statusCode, `${method} ${url}`).toBe(403);
    }
    expect((await listed()).map((each) => each.id)).toContain(some.id);
  });
});
