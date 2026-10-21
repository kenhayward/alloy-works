import type { ErasureView, PrincipalList } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createSpace,
  createTenant,
  findRole,
  grant,
  migrate,
  removeGrant,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  auditEvents,
  freshDatabase,
  newestEvent,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { recordRefusal } from './audit.js';
import { AppError } from './errors.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const DAY = 86_400_000;

describe('erasure over HTTP (the ER plan, Task 1)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let gracesGrant = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (
    method: 'GET' | 'POST',
    url: string,
    who: string,
    headers: Record<string, string> = { cookie: cookies[who] ?? '' },
  ) => app.inject({ method, url, headers: { host: HOST, ...headers } });

  const preview = (person: string, who = 'ivy') =>
    call('GET', `/v1/principals/${person}/erasure`, who);
  const erase = (person: string, who = 'ivy', headers?: Record<string, string>) =>
    call('POST', `/v1/principals/${person}/erase`, who, headers);

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
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    for (const who of ['ivy', 'ada', 'grace', 'alice']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      const clinical = (await createSpace(trx, 'Clinical')).id;
      // Ivy administers the environment, and so does Alice, external; Ada administers Clinical;
      // Grace reads it.
      for (const who of ['ivy', 'alice']) {
        await grant(trx, {
          roleId: (await findRole(trx, 'Administrator'))!.id,
          subject: { principal: ids[who]! },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: ids.ivy!,
          ...(who === 'alice' ? { expiresAt: new Date(Date.now() + 7 * DAY) } : {}),
        });
      }
      await trx
        .updateTable('principal')
        .set({ kind: 'external' })
        .where('id', '=', ids.alice!)
        .execute();
      await grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ids.ivy!,
      });
      const read = await grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ids.ivy!,
      });
      if (!('granted' in read)) throw new Error('not granted');
      gracesGrant = read.granted.id;
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await tenantDb?.close();
    await db?.drop();
  });

  it('erases only for an environment administrator, never a space administrator or an external one', async () => {
    for (const who of ['ada', 'grace', 'alice']) {
      expect((await preview(ids.grace!, who)).statusCode, who).toBe(403);
      expect((await erase(ids.grace!, who)).statusCode, who).toBe(403);
    }
  });

  it('erases by a session alone, and states what it would do to a token scoped to administer', async () => {
    const issue = async (scopes: string[]) =>
      (
        await app.inject({
          method: 'POST',
          url: '/v1/tokens',
          headers: { host: HOST, cookie: cookies.ivy! },
          payload: {
            name: `Scoped ${scopes.join(' ') || 'none'}`,
            scopes,
            expiresAt: new Date(Date.now() + DAY).toISOString(),
          },
        })
      ).json<{ secret: string }>().secret;
    const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
    const refused = await erase(ids.grace!, 'ivy', bearer(await issue(['edit'])));
    expect(refused.statusCode, refused.body).toBe(403);
    const administering = await erase(ids.grace!, 'ivy', bearer(await issue(['administer'])));
    expect(administering.statusCode, administering.body).toBe(403);
    expect(administering.json()).toMatchObject({ code: 'token_not_allowed' });
    const reading = await call(
      'GET',
      `/v1/principals/${ids.grace}/erasure`,
      'ivy',
      bearer(await issue(['administer'])),
    );
    expect(reading.statusCode, reading.body).toBe(200);
  });

  it('refuses while a grant names them, for oneself and for a service, every reason listed', async () => {
    const granted = await erase(ids.grace!);
    expect(granted.statusCode, granted.body).toBe(409);
    expect(granted.json()).toMatchObject({
      code: 'erasure_refused',
      refusals: [{ code: 'granted', grants: 1 }],
    });
    expect((await erase(ids.ivy!)).json()).toMatchObject({
      code: 'erasure_refused',
      refusals: [{ code: 'granted', grants: 1 }, { code: 'self' }],
    });
    // Their own id in capitals is no other person's.
    expect((await erase(ids.ivy!.toUpperCase())).statusCode).toBe(400);
    const robot = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: null, subject: null, display_name: 'Publisher', kind: 'service' })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    expect((await preview(robot.id)).json<ErasureView>().refusals).toEqual([{ code: 'service' }]);
    expect((await erase(robot.id)).statusCode).toBe(409);
    expect((await erase('00000000-0000-4000-8000-000000000003')).statusCode).toBe(404);
    expect((await preview('not-an-id')).statusCode).toBe(400);
  });

  it('VER-038 states what goes and what stays, then erases them: their session ends, the act names the administrator alone', async () => {
    await tenantDb.withTenant(tenant, (trx) => removeGrant(trx, gracesGrant));
    const before = await tenantDb.withTenant(tenant, newestEvent);
    const stated = await preview(ids.grace!);
    expect(stated.statusCode, stated.body).toBe(200);
    expect(stated.json<ErasureView>()).toMatchObject({
      person: { id: ids.grace, kind: 'user', invited: false, erased: false },
      erases: { sessions: 1, tokens: 0, invitation: false },
      refusals: [],
    });
    expect(stated.json<ErasureView>().remains.events).toBeGreaterThan(0);

    const erased = await erase(ids.grace!);
    expect(erased.statusCode, erased.body).toBe(200);
    expect(erased.json()).toEqual({ erased: true, labels: expect.any(Number) });
    // Her session ended with the act.
    expect((await call('GET', '/v1/me', 'grace')).statusCode).toBe(401);
    const people = (
      await call('GET', '/v1/principals?level=tenant&limit=100', 'ivy')
    ).json<PrincipalList>();
    expect(people.items.find((each) => each.id === ids.grace)).toMatchObject({
      name: 'Erased person',
      email: null,
      erased: true,
    });
    expect(people.items.find((each) => each.id === ids.ada)).toMatchObject({ erased: false });
    const events = await tenantDb.withTenant(tenant, (trx) => auditEvents(trx, before));
    const act = events.find((event) => event.kind === 'audit.label_erased')!;
    expect(act).toMatchObject({ actorKind: 'person', actor: ids.ivy, subject: ids.grace });
    expect(act.labels).toEqual({ actor: { text: 'Ivy', refersTo: ids.ivy, erased: false } });
    // Erasing the erased changes nothing.
    const again = await erase(ids.grace!);
    expect(again.json()).toEqual({ erased: true, labels: 0 });
    expect((await preview(ids.grace!)).json<ErasureView>().person.erased).toBe(true);
  });

  it('refuses a grant naming somebody erased, and names nobody erased in a refusal recorded late', async () => {
    const reader = await tenantDb.withTenant(tenant, (trx) => findRole(trx, 'Reader'));
    const granting = await app.inject({
      method: 'POST',
      url: '/v1/grants',
      headers: { host: HOST, cookie: cookies.ivy! },
      payload: {
        role: reader!.id,
        subject: { principal: ids.grace },
        level: 'tenant',
        effect: 'allow',
      },
    });
    expect(granting.statusCode, granting.body).toBe(409);
    expect(granting.json()).toMatchObject({ code: 'grant_subject_erased' });

    // A request Grace made before the act, refused after it, by her name as it was then.
    const before = await tenantDb.withTenant(tenant, newestEvent);
    const stale = {
      id: 'req-stale',
      tenant,
      principal: { principalId: ids.grace, email: 'grace@example.com', displayName: 'Grace' },
      credential: { kind: 'session', id: 'session-stale', route: 'organisation' },
      log: { error: () => undefined },
    } as unknown as FastifyRequest;
    await recordRefusal(
      tenantDb,
      stale,
      new AppError(403, 'forbidden', 'No.').refusing({
        permission: 'administer',
        target: { kind: 'tenant' },
        reason: 'not_granted',
        level: null,
        hidden: false,
      }),
    );
    const [late] = await tenantDb.withTenant(tenant, (trx) => auditEvents(trx, before));
    expect(late).toMatchObject({ kind: 'access.refused', actor: ids.grace });
    expect(late!.labels).toEqual({
      actor: { text: 'erased', refersTo: ids.grace, erased: true },
    });
  });
});
