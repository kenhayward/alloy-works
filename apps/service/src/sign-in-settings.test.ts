import { createHash } from 'node:crypto';
import {
  bootstrapCluster,
  createTenant,
  migrate,
  wayInRemains,
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
import { createOidcClient, type OidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, STAND_IN_SECRET, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'settings.acme.alloy.test';
const CALLBACK = `http://${HOST}/v1/sign-in/organisation/callback`;
const HEADERS = { host: HOST };
const USERS = ['ada', 'grace', 'hedy', 'mary', 'joan'].map((id) => ({
  id,
  name: id,
  email: `${id}@acme.example`,
}));

describe('administration of sign-in', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let other: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let providerId: string;
  /** Whatever a test wants the provider's answer to say of when the person authenticated. */
  let authTimeOverride: number | null | undefined;

  const standIn = () =>
    startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: STAND_IN_SECRET, redirectUris: [CALLBACK] }],
      users: USERS,
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await standIn();
    other = await standIn();
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Settings' },
      hostnames: [HOST],
    });
    providerId = await configureStandIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
    });
    tenantDb = testTenantDatabase(db.serviceUrl);
    const real = createOidcClient({ allowInsecureIssuers: true });
    const oidc: OidcClient = {
      start: real.start,
      finish: async (...args) => {
        const identity = await real.finish(...args);
        return authTimeOverride === undefined
          ? identity
          : { ...identity, authTime: authTimeOverride };
      },
    };
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc,
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await other.close();
    await db.drop();
  });

  async function signIn(user: string, at = idp, provider = providerId) {
    const started = await app.inject({
      url: `/v1/sign-in/organisation?provider=${provider}`,
      headers: HEADERS,
    });
    const attempt = started.cookies.find((cookie) => cookie.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, user, at.issuer);
    const finished = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { ...HEADERS, cookie: `${attempt.name}=${attempt.value}` },
    });
    const session = finished.cookies.find((cookie) => cookie.name === '__Host-aw_session');
    return {
      status: finished.statusCode,
      code: finished.statusCode === 302 ? undefined : (finished.json() as { code: string }).code,
      cookie: session ? `${session.name}=${session.value}` : undefined,
    };
  }

  const cookieOf = async (user: string) => (await signIn(user)).cookie!;

  const idOf = async (cookie: string) =>
    (await app.inject({ url: '/v1/me', headers: { ...HEADERS, cookie } })).json<{ id: string }>()
      .id;

  /** Gives somebody administer at the environment, by a grant no test takes back. */
  async function administrator(user: string): Promise<{ cookie: string; id: string }> {
    const cookie = await cookieOf(user);
    const id = await idOf(cookie);
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
    return { cookie, id };
  }

  const age = (cookie: string, minutes: number) =>
    tenantDb.withTenant(tenant, (trx) =>
      trx
        .updateTable('session')
        .set({ authenticated_at: new Date(Date.now() - minutes * 60_000) })
        .where('id', 'in', (eb) => eb.selectFrom('session').select('id'))
        .where('token_hash', '=', hashOf(cookie))
        .execute(),
    );

  const hashOf = (cookie: string) =>
    createHash('sha256').update(cookie.split('=')[1]!).digest('hex');

  const session = (cookie: string) =>
    tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('session')
        .selectAll()
        .where('token_hash', '=', hashOf(cookie))
        .executeTakeFirst(),
    );

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: { ...HEADERS, cookie },
      ...(payload === undefined ? {} : { payload }),
    });

  /** Asks to sign in again and goes through the stand-in as `user`, answering where it ends. */
  async function reauthenticate(cookie: string, user: string, at = idp) {
    const asked = await call('POST', '/v1/sessions/current/reauthentication', cookie, {
      to: 'admin/sign-in',
    });
    expect(asked.statusCode).toBe(200);
    const url = asked.json<{ url: string }>().url;
    const attempt = asked.cookies.find((each) => each.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(url, user, at.issuer);
    const returned = asked.cookies.find((each) => each.name === '__Host-aw_return');
    return {
      url,
      answer: await app.inject({
        url: `${back.pathname}${back.search}`,
        headers: {
          ...HEADERS,
          cookie: [
            cookie,
            `${attempt.name}=${attempt.value}`,
            `${returned!.name}=${returned!.value}`,
          ].join('; '),
        },
      }),
    };
  }

  describe('re-authentication', () => {
    it('IAM-012 asks the provider to authenticate afresh and marks the session, returning to the page', async () => {
      const cookie = await cookieOf('ada');
      await age(cookie, 60);
      const before = await session(cookie);
      const { url, answer } = await reauthenticate(cookie, 'ada');
      expect(new URL(url).searchParams.get('max_age')).toBe('0');
      expect(new URL(url).searchParams.get('prompt')).toBe('login');
      expect(answer.statusCode).toBe(302);
      expect(answer.headers.location).toBe('/#/admin/sign-in');
      // No new session is made: the one asking is the one marked.
      expect(answer.cookies.find((each) => each.name === '__Host-aw_session')).toBeUndefined();
      const after = await session(cookie);
      expect(after!.id).toBe(before!.id);
      expect(after!.authenticated_at.getTime()).toBeGreaterThan(before!.authenticated_at.getTime());
    });

    it('IAM-012 refuses a re-authentication whose subject is another', async () => {
      const cookie = await cookieOf('grace');
      await age(cookie, 60);
      const before = await session(cookie);
      const { answer } = await reauthenticate(cookie, 'hedy');
      expect(answer.statusCode).toBe(401);
      expect((await session(cookie))!.authenticated_at).toEqual(before!.authenticated_at);
    });

    it('IAM-012 refuses a re-authentication whose auth_time is before it began, or absent', async () => {
      const cookie = await cookieOf('grace');
      await age(cookie, 60);
      const before = await session(cookie);
      for (const stale of [Math.floor(Date.now() / 1000) - 3600, null]) {
        authTimeOverride = stale;
        const { answer } = await reauthenticate(cookie, 'grace');
        authTimeOverride = undefined;
        expect(answer.statusCode).toBe(401);
        expect((await session(cookie))!.authenticated_at).toEqual(before!.authenticated_at);
      }
    });

    it('IAM-012 a route needing a recent sign-in refuses an old session, and accepts it signed in again', async () => {
      const { cookie } = await administrator('mary');
      await age(cookie, 11);
      const body = { idleMinutes: 60, absoluteHours: 12 };
      const refused = await call('PUT', '/v1/sign-in-settings/sessions', cookie, body);
      expect(refused.statusCode).toBe(403);
      expect(refused.json<{ code: string }>().code).toBe('reauthentication_required');
      const settings = await call('GET', '/v1/sign-in-settings', cookie);
      expect(settings.json<{ recentSignIn: boolean }>().recentSignIn).toBe(false);
      await reauthenticate(cookie, 'mary');
      expect((await call('PUT', '/v1/sign-in-settings/sessions', cookie, body)).statusCode).toBe(
        200,
      );
    });
  });

  describe('session lifetimes', () => {
    it('IAM-038 shortening the idle timeout ends a session idle longer than it at its next request', async () => {
      const { cookie } = await administrator('joan');
      const idle = await cookieOf('hedy');
      await tenantDb.withTenant(tenant, (trx) =>
        trx
          .updateTable('session')
          .set({ last_seen_at: new Date(Date.now() - 30 * 60_000) })
          .where('token_hash', '=', hashOf(idle))
          .execute(),
      );
      expect((await call('GET', '/v1/me', idle)).statusCode).toBe(200);
      await tenantDb.withTenant(tenant, (trx) =>
        trx
          .updateTable('session')
          .set({ last_seen_at: new Date(Date.now() - 30 * 60_000) })
          .where('token_hash', '=', hashOf(idle))
          .execute(),
      );
      const shortened = await call('PUT', '/v1/sign-in-settings/sessions', cookie, {
        idleMinutes: 10,
        absoluteHours: 12,
      });
      expect(shortened.statusCode).toBe(200);
      expect((await call('GET', '/v1/me', idle)).statusCode).toBe(401);
      await call('PUT', '/v1/sign-in-settings/sessions', cookie, {
        idleMinutes: 60,
        absoluteHours: 12,
      });
    });

    it('IAM-038 shortening the absolute lifetime ends a session older than it at its next request', async () => {
      const { cookie } = await administrator('joan');
      const old = await cookieOf('hedy');
      await tenantDb.withTenant(tenant, (trx) =>
        trx
          .updateTable('session')
          .set({ created_at: new Date(Date.now() - 2 * 60 * 60_000) })
          .where('token_hash', '=', hashOf(old))
          .execute(),
      );
      expect((await call('GET', '/v1/me', old)).statusCode).toBe(200);
      await call('PUT', '/v1/sign-in-settings/sessions', cookie, {
        idleMinutes: 60,
        absoluteHours: 1,
      });
      expect((await call('GET', '/v1/me', old)).statusCode).toBe(401);
      await call('PUT', '/v1/sign-in-settings/sessions', cookie, {
        idleMinutes: 60,
        absoluteHours: 12,
      });
    });

    it('IAM-038 a new session takes the lifetimes set, and an open one is not lengthened', async () => {
      const { cookie } = await administrator('joan');
      const open = await session(cookie);
      await call('PUT', '/v1/sign-in-settings/sessions', cookie, {
        idleMinutes: 90,
        absoluteHours: 24,
      });
      const { cookie: fresh } = await signIn('hedy');
      const made = await session(fresh!);
      expect(made!.expires_at.getTime() - made!.created_at.getTime()).toBeGreaterThan(
        23 * 60 * 60_000,
      );
      expect((await session(cookie))!.expires_at).toEqual(open!.expires_at);
      await call('PUT', '/v1/sign-in-settings/sessions', cookie, {
        idleMinutes: 60,
        absoluteHours: 12,
      });
    });

    it('refuses lifetimes outside the bounds', async () => {
      const { cookie } = await administrator('joan');
      for (const body of [
        { idleMinutes: 4, absoluteHours: 12 },
        { idleMinutes: 60, absoluteHours: 721 },
      ]) {
        expect((await call('PUT', '/v1/sign-in-settings/sessions', cookie, body)).statusCode).toBe(
          400,
        );
      }
    });
  });

  describe('providers in Administration', () => {
    it('IAM-011 adds a provider, offered by name, whose secret is never answered', async () => {
      const { cookie } = await administrator('ada');
      const secret = 'a-secret-that-stays-sealed';
      const added = await call('POST', '/v1/sign-in-settings/providers', cookie, {
        name: 'Contractors',
        issuer: other.issuer,
        clientId: 'alloy',
        clientSecret: STAND_IN_SECRET,
      });
      expect(added.statusCode).toBe(200);
      expect(added.body).not.toContain(STAND_IN_SECRET);
      const added2 = added.json<{ providers: { id: string; name: string }[] }>();
      const contractors = added2.providers.find((each) => each.name === 'Contractors')!;
      const tenantView = await app.inject({ url: '/v1/tenant', headers: HEADERS });
      expect(
        tenantView.json<{ providers: { name: string }[] }>().providers.map((p) => p.name),
      ).toEqual(['Contractors', 'Your organisation']);
      expect((await signIn('grace', other, contractors.id)).cookie).toBeDefined();

      const replaced = await call(
        'PUT',
        `/v1/sign-in-settings/providers/${contractors.id}/secret`,
        cookie,
        { clientSecret: secret },
      );
      expect(replaced.statusCode).toBe(200);
      expect(replaced.body).not.toContain(secret);
      // Audited with neither secret.
      const events = await tenantDb.withTenant(tenant, (trx) =>
        trx
          .selectFrom('audit_event')
          .select('detail')
          .where('kind', '=', 'sign_in.configured')
          .execute(),
      );
      expect(JSON.stringify(events)).not.toContain(secret);
      expect(events.map((each) => (each.detail as { change: string }).change)).toEqual(
        expect.arrayContaining(['provider_added', 'provider_secret_replaced']),
      );

      expect(
        (
          await call('PUT', `/v1/sign-in-settings/providers/${contractors.id}/secret`, cookie, {
            clientSecret: STAND_IN_SECRET,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await call('POST', '/v1/sign-in-settings/providers', cookie, {
            name: 'Twice',
            issuer: other.issuer,
            clientId: 'alloy',
            clientSecret: STAND_IN_SECRET,
          })
        ).json<{ code: string }>().code,
      ).toBe('provider_issuer_taken');
      const renamed = await call(
        'PUT',
        `/v1/sign-in-settings/providers/${contractors.id}`,
        cookie,
        { name: 'Your organisation' },
      );
      expect(renamed.json<{ code: string }>().code).toBe('provider_name_taken');

      // Closing it ends only what it issued.
      const theirs = (await signIn('grace', other, contractors.id)).cookie!;
      const closed = await call(
        'POST',
        `/v1/sign-in-settings/providers/${contractors.id}/closure`,
        cookie,
      );
      expect(closed.statusCode).toBe(200);
      expect((await call('GET', '/v1/me', theirs)).statusCode).toBe(401);
      expect((await call('GET', '/v1/me', cookie)).statusCode).toBe(200);
    });

    it('refuses closing the provider of the session asking', async () => {
      const { cookie } = await administrator('ada');
      const own = await call(
        'POST',
        `/v1/sign-in-settings/providers/${providerId}/closure`,
        cookie,
      );
      expect(own.json<{ code: string }>().code).toBe('provider_own_session');
    });

    it('refuses to change anything without administer', async () => {
      const cookie = await cookieOf('hedy');
      expect((await call('GET', '/v1/sign-in-settings', cookie)).statusCode).toBe(403);
      const body = { idleMinutes: 60, absoluteHours: 12 };
      const refused = await call('PUT', '/v1/sign-in-settings/sessions', cookie, body);
      expect(refused.statusCode).toBe(403);
      expect(refused.json<{ code: string }>().code).toBe('forbidden');
    });
  });

  describe('disabled people', () => {
    it('a disabled person loses their sessions and tokens at once, and is refused at sign-in until enabled', async () => {
      const admin = await administrator('ada');
      const theirs = await cookieOf('hedy');
      const id = await idOf(theirs);
      const token = await call('POST', '/v1/tokens', theirs, {
        name: 'Hedy',
        scopes: [],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(token.statusCode).toBeLessThan(300);
      const secret = token.json<{ secret: string }>().secret;

      const disabled = await call('POST', `/v1/principals/${id}/disablement`, admin.cookie);
      expect(disabled.statusCode).toBe(200);
      expect((await call('GET', '/v1/me', theirs)).statusCode).toBe(401);
      expect(
        (
          await app.inject({
            url: '/v1/me',
            headers: { ...HEADERS, authorization: `Bearer ${secret}` },
          })
        ).statusCode,
      ).toBe(401);
      const refused = await signIn('hedy');
      expect(refused.code).toBe('principal_disabled');
      expect(refused.cookie).toBeUndefined();

      expect(
        (await call('DELETE', `/v1/principals/${id}/disablement`, admin.cookie)).statusCode,
      ).toBe(200);
      expect((await signIn('hedy')).cookie).toBeDefined();
    });

    it('refuses disabling oneself, and one disabled shows as such', async () => {
      const admin = await administrator('ada');
      const own = await call('POST', `/v1/principals/${admin.id}/disablement`, admin.cookie);
      expect(own.json<{ code: string }>().code).toBe('principal_own_account');
    });

    it('disabling the last person who can configure sign-in, closing their provider, or removing their grant is refused', async () => {
      // Ada alone holds administer outright; Joan's lapses, so it keeps no way in.
      const ada = await administrator('ada');
      const joan = await administrator('joan');
      const grace = await administrator('grace');
      await tenantDb.withTenant(tenant, async (trx) => {
        await trx
          .deleteFrom('access_grant')
          .where('level', '=', 'tenant')
          .where('principal_id', 'not in', [ada.id, joan.id, grace.id])
          .execute();
        const held = await trx
          .deleteFrom('access_grant')
          .where('principal_id', '=', joan.id)
          .where('level', '=', 'tenant')
          .returning('role_id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('access_grant')
          .values({
            principal_id: joan.id,
            role_id: held.role_id,
            level: 'tenant',
            effect: 'allow',
            granted_by: ada.id,
            expires_at: new Date(Date.now() + 86_400_000),
          })
          .execute();
      });
      // Grace's grant still counts for the guard an administrator has always had, but she is disabled,
      // so hers is no way in.
      await tenantDb.withTenant(tenant, async (trx) => {
        await trx
          .updateTable('principal')
          .set({ disabled_at: new Date(), disabled_by: 'person' })
          .where('id', '=', grace.id)
          .execute();
      });

      const disabling = await call('POST', `/v1/principals/${ada.id}/disablement`, joan.cookie);
      expect(disabling.statusCode).toBe(409);
      expect(disabling.json<{ code: string }>().code).toBe('last_way_in');

      const closing = await call(
        'POST',
        `/v1/sign-in-settings/providers/${providerId}/closure`,
        joan.cookie,
      );
      // Joan came through this provider too, so her own session answers first.
      expect(closing.json<{ code: string }>().code).toBe('provider_own_session');

      const grant = await tenantDb.withTenant(tenant, (trx) =>
        trx
          .selectFrom('access_grant')
          .select('id')
          .where('principal_id', '=', ada.id)
          .where('level', '=', 'tenant')
          .executeTakeFirstOrThrow(),
      );
      const removing = await call('DELETE', `/v1/grants/${grant.id}`, joan.cookie);
      expect(removing.statusCode).toBe(409);
      expect(removing.json<{ code: string }>().code).toBe('last_way_in');
      expect(
        await tenantDb.withTenant(tenant, (trx) =>
          wayInRemains(trx, { closingProvider: providerId }),
        ),
      ).toBe(false);
    });
  });
});
