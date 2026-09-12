import { Writable } from 'node:stream';
import {
  bootstrapCluster,
  closeSignInRoute,
  createTenant,
  createTenantDatabase,
  inviteToTenant,
  migrate,
  permitGoogleSignIn,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import {
  STAND_IN_USERS,
  startStandInProvider,
  type StandInProvider,
} from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type AppOptions } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { hashToken } from './sessions.js';
import { signState, verifyState } from './sign-in-state.js';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';

const SIGN_IN = 'signin.alloy.test';
const DEV = 'dev.acme.alloy.test';
const PRODUCTION = 'acme.alloy.test';
const OTHER = 'other.alloy.test';
const STATE_KEY = 'test-only-state-key-0123456789abcdef';

describe('signing in with a Google account', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let dev: Tenant;
  let other: Tenant;
  const lines: string[] = [];

  const options = (extra: Partial<AppOptions>): AppOptions => ({
    db: tenantDb,
    logLevel: 'info',
    logStream: new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    }),
    oidc: createOidcClient({ allowInsecureIssuers: true }),
    secrets: environmentSecrets({
      SECRET_GOOGLE: 'google-secret',
      SECRET_SIGN_IN_STATE: STATE_KEY,
    }),
    ...extra,
  });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    // The stand-in plays Google: one client, returning only to the sign-in address.
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy-google',
          clientSecret: 'google-secret',
          redirectUris: [`http://${SIGN_IN}/v1/sign-in/google/callback`],
        },
      ],
      users: [
        ...STAND_IN_USERS,
        { id: 'eve', name: 'Eve', email: 'eve@example.com', emailVerified: false },
        { id: 'second-ada', name: 'Ada', email: 'ada@example.com' },
      ],
    });
    const acme = { id: 'acme', name: 'Acme' };
    dev = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: acme,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: [DEV],
    });
    await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: acme,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [PRODUCTION],
    });
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'other', name: 'Other' },
      tenant: { id: db.newTenantId(), name: 'Demonstration' },
      hostnames: [OTHER],
    });
    await permitGoogleSignIn(db.adminUrl, dev, { domains: ['example.org'] });
    await inviteToTenant(db.adminUrl, dev, 'Ada@Example.com');
    await inviteToTenant(db.adminUrl, dev, 'eve@example.com');
    await permitGoogleSignIn(db.adminUrl, other, { domains: ['example.org'] });
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp(
      options({ google: { issuer: idp.issuer, clientId: 'alloy-google', signInHost: SIGN_IN } }),
    );
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  const start = (host: string, target: FastifyInstance = app) =>
    target.inject({ url: '/v1/sign-in/google', headers: { host } });

  it('sends the browser to Google by way of the one sign-in address, bound to this browser', async () => {
    const response = await start(DEV);
    expect(response.statusCode).toBe(302);
    const location = new URL(response.headers.location!);
    expect(location.origin).toBe(idp.issuer);
    expect(location.searchParams.get('redirect_uri')).toBe(
      `http://${SIGN_IN}/v1/sign-in/google/callback`,
    );
    const cookie = response.cookies.find((candidate) => candidate.name === '__Host-aw_signin');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  });

  it('names the environment, its address and the attempt, in a state only the service can sign', async () => {
    for (const [host, tenant] of [
      [DEV, dev],
      [OTHER, other],
    ] as const) {
      const response = await start(host);
      const state = new URL(response.headers.location!).searchParams.get('state')!;
      const attempt = response.cookies.find((c) => c.name === '__Host-aw_signin')!.value;
      expect(verifyState(STATE_KEY, state)).toEqual({ tenant: tenant.id, host, attempt });
    }
  });

  it('refuses to start where the environment does not permit Google (IAM-043)', async () => {
    const response = await start(PRODUCTION);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'sign_in_route_closed', rule: 'IAM-043' });
  });

  it('refuses to start when the service has no Google client', async () => {
    const without = buildApp(options({}));
    try {
      const response = await start(DEV, without);
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'sign_in_route_closed' });
    } finally {
      await without.close();
    }
  });

  /** Starts at `host` and signs in at the stand-in as `user`: where Google sends the browser back. */
  async function atGoogle(host: string, user: string) {
    const started = await start(host);
    const attempt = started.cookies.find((c) => c.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, user, idp.issuer);
    return { back, cookie: `${attempt.name}=${attempt.value}`, attempt: attempt.value };
  }

  /** The sign-in address, as the browser reaches it from Google: no cookie of the environment's. */
  const callback = (back: URL) =>
    app.inject({ url: `${back.pathname}${back.search}`, headers: { host: SIGN_IN } });

  /** As far as the hand-off: where the sign-in address sends the browser, and its attempt cookie. */
  async function untilHandoff(host: string, user: string) {
    const { back, cookie } = await atGoogle(host, user);
    const handedOff = await callback(back);
    expect(handedOff.statusCode, `${user} at the sign-in address`).toBe(302);
    return { next: new URL(handedOff.headers.location!), cookie };
  }

  const complete = (next: URL, cookie?: string) =>
    app.inject({
      url: `${next.pathname}${next.search}`,
      headers: { host: next.host, ...(cookie ? { cookie } : {}) },
    });

  async function signInWithGoogle(host: string, user: string): Promise<string> {
    const { next, cookie } = await untilHandoff(host, user);
    const done = await complete(next, cookie);
    const session = done.cookies.find((c) => c.name === '__Host-aw_session');
    if (!session) throw new Error(`${user} was not signed in to ${host}: ${done.statusCode}`);
    return `${session.name}=${session.value}`;
  }

  const me = (host: string, cookie: string) =>
    app.inject({ url: '/v1/me', headers: { host, cookie } });

  it('hands an invited address back to the environment that asked, which signs it in', async () => {
    const { next, cookie } = await untilHandoff(DEV, 'ada');
    expect(`${next.origin}${next.pathname}`).toBe(`http://${DEV}/v1/sign-in/google/complete`);
    const done = await complete(next, cookie);
    expect(done.statusCode).toBe(302);
    expect(done.headers.location).toBe('/');
    const session = done.cookies.find((c) => c.name === '__Host-aw_session')!;
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    const answer = await me(DEV, `${session.name}=${session.value}`);
    expect(answer.json()).toMatchObject({
      displayName: 'Ada',
      email: 'ada@example.com',
      environment: 'Development',
    });
  });

  it('admits any account of a named Workspace domain', async () => {
    const cookie = await signInWithGoogle(DEV, 'alice');
    expect((await me(DEV, cookie)).json()).toMatchObject({ email: 'alice@example.org' });
  });

  it('refuses an account nobody invited (IAM-054)', async () => {
    const { back } = await atGoogle(DEV, 'grace');
    const refused = await callback(back);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'not_invited', rule: 'IAM-054' });
  });

  it('refuses a second account presenting an invited address already taken', async () => {
    await signInWithGoogle(DEV, 'ada');
    const { back } = await atGoogle(DEV, 'second-ada');
    expect((await callback(back)).statusCode).toBe(403);
  });

  it('refuses an invited address the provider has not verified', async () => {
    const { back } = await atGoogle(DEV, 'eve');
    expect((await callback(back)).statusCode).toBe(403);
  });

  it('uses a hand-off code once only', async () => {
    const { next, cookie } = await untilHandoff(DEV, 'alice');
    expect((await complete(next, cookie)).statusCode).toBe(302);
    expect((await complete(next, cookie)).statusCode).toBe(401);
  });

  it('completes only in the browser that started', async () => {
    const { next } = await untilHandoff(DEV, 'alice');
    const done = await complete(next);
    expect(done.statusCode).toBe(401);
    expect(done.json()).toMatchObject({ code: 'sign_in_failed' });
  });

  it('gives a hand-off code sixty seconds, and refuses it after', async () => {
    const { next, cookie } = await untilHandoff(DEV, 'alice');
    const codeHash = hashToken(next.searchParams.get('code')!);
    const { rows } = await queryAs(
      db.adminUrl,
      `select extract(epoch from expires_at - now())::float8 as seconds
         from ${dev.schema}.sign_in_handoff where code_hash = $1`,
      [codeHash],
    );
    expect(rows[0]?.seconds).toBeGreaterThan(50);
    expect(rows[0]?.seconds).toBeLessThanOrEqual(60);
    await queryAs(
      db.adminUrl,
      `update ${dev.schema}.sign_in_handoff set expires_at = now() - interval '1 second'
        where code_hash = $1`,
      [codeHash],
    );
    expect((await complete(next, cookie)).statusCode).toBe(401);
  });

  it('refuses a state that has been tampered with', async () => {
    const { back } = await atGoogle(DEV, 'ada');
    const [payload, signature] = back.searchParams.get('state')!.split('.');
    const altered = { ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), host: OTHER };
    back.searchParams.set(
      'state',
      `${Buffer.from(JSON.stringify(altered)).toString('base64url')}.${signature}`,
    );
    const refused = await callback(back);
    expect(refused.statusCode).toBe(401);
    expect(refused.headers.location).toBeUndefined();
  });

  it("will not hand a sign-in to an address the state's environment does not own", async () => {
    const { back, attempt } = await atGoogle(DEV, 'ada');
    back.searchParams.set('state', signState(STATE_KEY, { tenant: dev.id, host: OTHER, attempt }));
    const refused = await callback(back);
    expect(refused.statusCode).toBe(401);
    expect(refused.headers.location).toBeUndefined();
  });

  it('refuses a state whose environment and address disagree, even with a real attempt', async () => {
    // The attempt is real and lives where the address points; only the environment named differs.
    const { back, attempt } = await atGoogle(OTHER, 'alice');
    back.searchParams.set('state', signState(STATE_KEY, { tenant: dev.id, host: OTHER, attempt }));
    const refused = await callback(back);
    expect(refused.statusCode).toBe(401);
    expect(refused.headers.location).toBeUndefined();
  });

  it('answers the Google callback only at the sign-in address', async () => {
    const { back } = await atGoogle(DEV, 'ada');
    const elsewhere = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: DEV },
    });
    expect(elsewhere.statusCode).toBe(404);
  });

  it('ends the sessions Google issued when the environment closes the route (IAM-043)', async () => {
    const cookie = await signInWithGoogle(OTHER, 'alice');
    expect((await me(OTHER, cookie)).statusCode).toBe(200);
    await closeSignInRoute(db.adminUrl, other, 'google');
    expect((await me(OTHER, cookie)).statusCode).toBe(401);
    expect((await start(OTHER)).statusCode).toBe(404);
  });

  it('never writes a code, a state or a session token to its log', () => {
    const log = lines.join('');
    expect(log).not.toMatch(/[?&](code|state)=/);
    expect(log).not.toContain('__Host-aw_session=');
  });
});
