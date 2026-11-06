import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import {
  bootstrapCluster,
  createTenant,
  issueApiToken,
  migrate,
  openSecret,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  queryAs,
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
import { hashToken, PROVIDER_CHECK_INTERVAL_MS } from './sessions.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const CALLBACK = `http://${HOST}/v1/sign-in/organisation/callback`;

/** A person signed in through the organisation's provider, asked again there (the PC plan). */
describe("a session asked again at its organisation's provider", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const lines: string[] = [];

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [{ clientId: 'alloy', clientSecret: 'stand-in-secret', redirectUris: [CALLBACK] }],
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
      logLevel: 'info',
      logStream: new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString());
          done();
        },
      }),
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  const me = (headers: Record<string, string>) =>
    app.inject({ url: '/v1/me', headers: { host: HOST, ...headers } });

  const sessionOf = async (cookie: string) =>
    (
      await queryAs(
        db.adminUrl,
        `select id, principal_id, sealed_refresh, provider_checked_at from ${tenant.schema}.session
         where token_hash = $1`,
        [hashToken(cookie.slice(cookie.indexOf('=') + 1))],
      )
    ).rows[0] as
      | {
          id: string;
          principal_id: string;
          sealed_refresh: string | null;
          provider_checked_at: Date | null;
        }
      | undefined;

  /** As though the provider was last asked longer ago than the interval. */
  const lastAskedLongAgo = (id: string) =>
    queryAs(
      db.adminUrl,
      `update ${tenant.schema}.session set provider_checked_at = now() - $2 * interval '1 millisecond'
       where id = $1`,
      [id, PROVIDER_CHECK_INTERVAL_MS + 1000],
    );

  it('keeps the refresh token an organisation sign-in was granted, sealed to the environment and the session, and never says it', async () => {
    const cookie = await signIn(app, HOST, 'ada', idp.issuer);
    const session = (await sessionOf(cookie))!;
    expect(session.sealed_refresh).toMatch(/^v1\./);
    const token = openSecret(
      TEST_SEALING_KEY,
      'session-refresh',
      tenant.id,
      session.sealed_refresh!,
      session.id,
    );
    expect(token.length).toBeGreaterThan(10);
    expect(session.provider_checked_at).toEqual(expect.any(Date));
    // Never said: not in what the person reads of their sessions, nor in a log line.
    await lastAskedLongAgo(session.id);
    const said = [
      (await me({ cookie })).body,
      (await app.inject({ url: '/v1/sessions', headers: { host: HOST, cookie } })).body,
    ];
    for (const text of [...said, lines.join('')]) expect(text).not.toContain(token);
  });

  it('IAM-010 signs out a person disabled at their provider at their next request after the interval, and ends their API tokens', async () => {
    const cookie = await signIn(app, HOST, 'grace', idp.issuer);
    const session = (await sessionOf(cookie))!;
    const secret = `awt_${randomBytes(32).toString('base64url')}`;
    await tenantDb.withTenant(tenant, (trx) =>
      issueApiToken(trx, {
        principalId: session.principal_id,
        name: 'Scripts',
        tokenHash: hashToken(secret),
        scopes: ['edit'],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }),
    );
    expect((await me({ authorization: `Bearer ${secret}` })).statusCode).toBe(200);
    idp.disable('grace');
    try {
      // Within the interval nobody is asked.
      expect((await me({ cookie })).statusCode).toBe(200);
      await lastAskedLongAgo(session.id);
      const refused = await me({ cookie });
      expect(refused.statusCode).toBe(401);
      expect(refused.json()).toMatchObject({ code: 'unauthenticated' });
      expect(await sessionOf(cookie)).toBeUndefined();
      expect((await me({ authorization: `Bearer ${secret}` })).statusCode).toBe(401);
      const ended = await queryAs(
        db.adminUrl,
        `select actor_kind, detail from ${tenant.schema}.audit_event
         where kind = 'authentication.signed_out' and detail ->> 'session' = $1`,
        [session.id],
      );
      expect(ended.rows).toEqual([
        { actor_kind: 'system', detail: { ended: 'provider_refused', session: session.id } },
      ]);
      expect(lines.join('')).not.toContain(secret);
    } finally {
      idp.enable('grace');
    }
  });

  it('IAM-010 keeps a session its provider still honours, and keeps the token it rotates', async () => {
    const cookie = await signIn(app, HOST, 'ada', idp.issuer);
    const session = (await sessionOf(cookie))!;
    await lastAskedLongAgo(session.id);
    expect((await me({ cookie })).statusCode).toBe(200);
    const after = (await sessionOf(cookie))!;
    expect(after.provider_checked_at!.getTime()).toBeGreaterThan(
      session.provider_checked_at!.getTime(),
    );
    expect(after.sealed_refresh).toMatch(/^v1\./);
  });

  it('keeps a session going while its provider cannot be reached, and says so in the log by the fact alone', async () => {
    const host = 'outage.acme.alloy.test';
    const elsewhere = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${host}/v1/sign-in/organisation/callback`],
        },
      ],
    });
    const outage = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Outage' },
      hostnames: [host],
    });
    await configureStandIn(db.adminUrl, outage, { issuer: elsewhere.issuer, clientId: 'alloy' });
    // Signed in at a provider for that environment, which then goes away.
    const started = await app.inject({ url: '/v1/sign-in/organisation', headers: { host } });
    const attempt = started.cookies.find((each) => each.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, 'ada', elsewhere.issuer);
    const finished = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host, cookie: `${attempt.name}=${attempt.value}` },
    });
    const session = finished.cookies.find((each) => each.name === '__Host-aw_session')!;
    const cookie = `${session.name}=${session.value}`;
    await elsewhere.close();
    await queryAs(
      db.adminUrl,
      `update ${outage.schema}.session set provider_checked_at = now() - interval '6 minutes'`,
    );
    const answered = await app.inject({ url: '/v1/me', headers: { host, cookie } });
    expect(answered.statusCode).toBe(200);
    expect(lines.join('')).toContain("a session's identity provider could not be asked");
  });

  it('replaces the token kept when the person signs in again to confirm it is them', async () => {
    const cookie = await signIn(app, HOST, 'ada', idp.issuer);
    const before = (await sessionOf(cookie))!;
    const asked = await app.inject({
      method: 'POST',
      url: '/v1/sessions/current/reauthentication',
      headers: { host: HOST, cookie },
      payload: { to: 'admin/sign-in' },
    });
    expect(asked.statusCode).toBe(200);
    const attempt = asked.cookies.find((each) => each.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(asked.json<{ url: string }>().url, 'ada', idp.issuer);
    const answer = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: HOST, cookie: `${cookie}; ${attempt.name}=${attempt.value}` },
    });
    expect(answer.statusCode).toBe(302);
    const after = (await sessionOf(cookie))!;
    expect(after.sealed_refresh).toMatch(/^v1\./);
    expect(after.sealed_refresh).not.toBe(before.sealed_refresh);
  });
});
