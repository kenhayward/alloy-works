import { Writable } from 'node:stream';
import {
  bootstrapCluster,
  createTenant,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  auditEvents,
  freshDatabase,
  newestEvent,
  queryAs,
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
import { configureStandIn, STAND_IN_SECRET, TEST_SEALING_KEY } from './test/sign-in.js';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';

const OTHER_SECRET = 'another-environments-secret';

const callback = (host: string) => `http://${host}/v1/sign-in/organisation/callback`;

describe('signing in with the organisation provider', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;
  let copied: Tenant;
  let before: Tenant;
  const lines: string[] = [];

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [
            callback('acme.alloy.test'),
            callback('other.acme.alloy.test'),
            callback('copied.acme.alloy.test'),
            callback('before.acme.alloy.test'),
          ],
        },
      ],
    });
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Closed' },
      hostnames: ['closed.acme.alloy.test'],
    });
    await configureStandIn(db.adminUrl, production, { issuer: idp.issuer, clientId: 'alloy' });
    // The same client of the same provider, with a secret of its own that the provider refuses.
    const other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Other' },
      hostnames: ['other.acme.alloy.test'],
    });
    await configureStandIn(db.adminUrl, other, {
      issuer: idp.issuer,
      clientId: 'alloy',
      clientSecret: OTHER_SECRET,
    });
    copied = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Copied' },
      hostnames: ['copied.acme.alloy.test'],
    });
    await configureStandIn(db.adminUrl, copied, { issuer: idp.issuer, clientId: 'alloy' });
    before = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Before' },
      hostnames: ['before.acme.alloy.test'],
    });
    await configureStandIn(db.adminUrl, before, { issuer: idp.issuer, clientId: 'alloy' });
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
      // The stand-in's secret under the name environments used to give it, so an environment still
      // naming it could be signed in with it, if the service ever read a secret by name.
      secrets: environmentSecrets({ SECRET_STAND_IN: STAND_IN_SECRET }),
      sealingKey: TEST_SEALING_KEY,
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  const start = () =>
    app.inject({ url: '/v1/sign-in/organisation', headers: { host: 'acme.alloy.test' } });

  it('sends the browser to the provider, and binds the attempt to it with a cookie', async () => {
    const response = await start();
    expect(response.statusCode).toBe(302);
    expect(response.headers.location?.startsWith(idp.issuer)).toBe(true);
    const cookie = response.cookies.find((candidate) => candidate.name === '__Host-aw_signin');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.domain).toBeUndefined();
  });

  it('IAM-007 comes back signed in, with a session cookie and a principal found by issuer and subject', async () => {
    const started = await start();
    const signIn = started.cookies.find((candidate) => candidate.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, 'ada', idp.issuer);
    const finished = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: 'acme.alloy.test', cookie: `${signIn.name}=${signIn.value}` },
    });
    expect(finished.statusCode).toBe(302);
    expect(finished.headers.location).toBe('/');
    const session = finished.cookies.find((candidate) => candidate.name === '__Host-aw_session');
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    const { rows } = await queryAs(
      db.adminUrl,
      `select issuer, subject, email, display_name from ${production.schema}.principal`,
    );
    expect(rows).toEqual([
      { issuer: idp.issuer, subject: 'ada', email: 'ada@example.com', display_name: 'Ada' },
    ]);
  });

  it('refuses to finish in a browser that did not start the sign-in', async () => {
    const started = await start();
    const back = await completeAtStandIn(started.headers.location!, 'ada', idp.issuer);
    const finished = await app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host: 'acme.alloy.test' },
    });
    expect(finished.statusCode).toBe(401);
    expect(finished.json()).toMatchObject({ code: 'sign_in_failed' });
  });

  it('uses an attempt once only', async () => {
    const started = await start();
    const signIn = started.cookies.find((candidate) => candidate.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, 'grace', idp.issuer);
    const request = {
      url: `${back.pathname}${back.search}`,
      headers: { host: 'acme.alloy.test', cookie: `${signIn.name}=${signIn.value}` },
    };
    expect((await app.inject(request)).statusCode).toBe(302);
    expect((await app.inject(request)).statusCode).toBe(401);
  });

  it('turns the provider refusing into sign_in_failed', async () => {
    const started = await start();
    const signIn = started.cookies.find((candidate) => candidate.name === '__Host-aw_signin')!;
    const finished = await app.inject({
      url: `/v1/sign-in/organisation/callback?error=access_denied&state=${signIn.value}`,
      headers: { host: 'acme.alloy.test', cookie: `${signIn.name}=${signIn.value}` },
    });
    expect(finished.statusCode).toBe(401);
    expect(finished.json()).toMatchObject({ code: 'sign_in_failed' });
  });

  it('refuses a route the environment does not permit', async () => {
    const response = await app.inject({
      url: '/v1/sign-in/organisation',
      headers: { host: 'closed.acme.alloy.test' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'sign_in_route_closed', rule: 'IAM-043' });
  });

  /** Signs Ada in at `host`, and answers the callback's response. */
  async function signInAt(host: string) {
    const started = await app.inject({ url: '/v1/sign-in/organisation', headers: { host } });
    const signIn = started.cookies.find((candidate) => candidate.name === '__Host-aw_signin')!;
    const back = await completeAtStandIn(started.headers.location!, 'ada', idp.issuer);
    return app.inject({
      url: `${back.pathname}${back.search}`,
      headers: { host, cookie: `${signIn.name}=${signIn.value}` },
    });
  }

  it("IAM-075 exchanges with each environment's own secret, though two environments configure the same client of the same provider", async () => {
    expect((await signInAt('acme.alloy.test')).statusCode).toBe(302);
    const refused = await signInAt('other.acme.alloy.test');
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ code: 'sign_in_failed' });
    expect((await signInAt('acme.alloy.test')).statusCode).toBe(302);
  });

  const logged = (message: string) =>
    lines.filter((line) => line.includes(message)).map((line) => JSON.parse(line) as object);

  it("IAM-075 never signs anybody in with another environment's secret: one copied into its row does not open there", async () => {
    expect((await signInAt('copied.acme.alloy.test')).statusCode).toBe(302);
    const { rows } = await queryAs(
      db.adminUrl,
      `select sealed_secret from ${production.schema}.identity_provider`,
    );
    await queryAs(db.adminUrl, `update ${copied.schema}.identity_provider set sealed_secret = $1`, [
      rows[0].sealed_secret,
    ]);
    const refused = await app.inject({
      url: '/v1/sign-in/organisation',
      headers: { host: 'copied.acme.alloy.test' },
    });
    expect(refused.statusCode).toBe(404);
    expect(refused.json()).toMatchObject({ code: 'sign_in_route_closed' });
    // Once for the environment, however often anybody asks: an unauthenticated start cannot flood it.
    for (let again = 0; again < 3; again += 1) {
      const repeated = await app.inject({
        url: '/v1/sign-in/organisation',
        headers: { host: 'copied.acme.alloy.test' },
      });
      expect(repeated.statusCode).toBe(404);
    }
    expect(logged('does not open for this environment')).toEqual([
      expect.objectContaining({ tenant: copied.id, level: 40 }),
    ]);
  });

  it('signs nobody in through an environment configured before secrets were sealed, until it is configured again', async () => {
    await queryAs(
      db.adminUrl,
      `update ${before.schema}.identity_provider set secret_name = 'stand_in', sealed_secret = null`,
    );
    const refused = await app.inject({
      url: '/v1/sign-in/organisation',
      headers: { host: 'before.acme.alloy.test' },
    });
    expect(refused.statusCode).toBe(404);
    expect(refused.json()).toMatchObject({ code: 'sign_in_route_closed' });
    // Once for the environment, however often anybody asks: an unauthenticated start cannot flood it.
    for (let again = 0; again < 3; again += 1) {
      const repeated = await app.inject({
        url: '/v1/sign-in/organisation',
        headers: { host: 'before.acme.alloy.test' },
      });
      expect(repeated.statusCode).toBe(404);
    }
    expect(logged('must be configured again')).toEqual([
      expect.objectContaining({ tenant: before.id, level: 40 }),
    ]);
    await configureStandIn(db.adminUrl, before, { issuer: idp.issuer, clientId: 'alloy' });
    expect((await signInAt('before.acme.alloy.test')).statusCode).toBe(302);
  });

  /** What `act` recorded in the environment at `host`. */
  async function recorded(host: string, act: () => Promise<unknown>) {
    const tenant = (await tenantDb.resolveHostname(host))!;
    const before = await tenantDb.withTenant(tenant, newestEvent);
    await act();
    return tenantDb.withTenant(tenant, (trx) => auditEvents(trx, before));
  }

  /** Forgets the failures naming nobody that earlier tests counted, so the next is recorded. */
  async function freshTally(host: string) {
    const tenant = (await tenantDb.resolveHostname(host))!;
    await queryAs(db.adminUrl, `delete from ${tenant.schema}.sign_in_failure_tally`);
  }

  it('IAM-013 records a sign-in and its sign-out as the person, and a failed sign-in naming nobody', async () => {
    await freshTally('acme.alloy.test');
    await freshTally('other.acme.alloy.test');
    let cookie = '';
    const signedIn = await recorded('acme.alloy.test', async () => {
      const finished = await signInAt('acme.alloy.test');
      const session = finished.cookies.find((candidate) => candidate.name === '__Host-aw_session')!;
      cookie = `${session.name}=${session.value}`;
    });
    const ada = signedIn[0]?.actor;
    expect(signedIn.map((event) => [event.kind, event.actorKind, event.subject])).toEqual([
      ['authentication.signed_in', 'person', ada],
    ]);
    expect(signedIn[0]!.detail).toEqual({ route: 'organisation', session: expect.any(String) });
    expect(signedIn[0]!.labels['actor']!.text).toBe('Ada');
    expect(signedIn[0]!.traceId).toEqual(expect.any(String));

    const signedOut = await recorded('acme.alloy.test', () =>
      app.inject({
        method: 'POST',
        url: '/v1/sign-out',
        headers: { host: 'acme.alloy.test', cookie },
      }),
    );
    expect(signedOut.map((event) => [event.kind, event.actorKind, event.actor])).toEqual([
      ['authentication.signed_out', 'person', ada],
    ]);
    expect(signedOut[0]!.detail).toEqual({
      ended: 'signed_out',
      session: signedIn[0]!.detail['session'],
    });

    // The provider's answer, by its kind and never its words, from nobody the environment knows.
    const errored = await recorded('acme.alloy.test', async () => {
      const started = await start();
      const signIn = started.cookies.find((candidate) => candidate.name === '__Host-aw_signin')!;
      await app.inject({
        url: `/v1/sign-in/organisation/callback?error=access_denied&state=${signIn.value}`,
        headers: { host: 'acme.alloy.test', cookie: `${signIn.name}=${signIn.value}` },
      });
    });
    expect(errored.map((event) => [event.kind, event.actorKind, event.actor])).toEqual([
      ['authentication.sign_in_failed', 'anonymous', null],
    ]);
    expect(errored[0]).toMatchObject({
      outcome: 'refused',
      detail: { route: 'organisation', failure: 'provider_error', count: 1 },
    });
    expect(JSON.stringify(errored)).not.toContain('access_denied');

    // The provider refusing the exchange: another environment's secret.
    const refused = await recorded('other.acme.alloy.test', () =>
      signInAt('other.acme.alloy.test'),
    );
    expect(refused.map((event) => [event.kind, event.actorKind, event.detail])).toEqual([
      [
        'authentication.sign_in_failed',
        'anonymous',
        { route: 'organisation', failure: 'provider_refused', count: 1 },
      ],
    ]);
    expect(JSON.stringify(refused)).not.toContain(OTHER_SECRET);
  });

  it('IAM-013 records a failure naming nobody at most once a minute per route and kind, counting the rest', async () => {
    const tenant = (await tenantDb.resolveHostname('acme.alloy.test'))!;
    const tally = `${tenant.schema}.sign_in_failure_tally`;
    await freshTally('acme.alloy.test');
    const fail = async () => {
      const started = await start();
      const signIn = started.cookies.find((candidate) => candidate.name === '__Host-aw_signin')!;
      await app.inject({
        url: `/v1/sign-in/organisation/callback?error=x&state=${signIn.value}`,
        headers: { host: 'acme.alloy.test', cookie: `${signIn.name}=${signIn.value}` },
      });
    };
    // A loop of failures within the minute writes one event.
    const looped = await recorded('acme.alloy.test', async () => {
      for (let each = 0; each < 5; each += 1) await fail();
    });
    expect(looped.map((event) => [event.kind, event.detail])).toEqual([
      [
        'authentication.sign_in_failed',
        { route: 'organisation', failure: 'provider_error', count: 1 },
      ],
    ]);
    // A minute on, the next is recorded with the four it held back.
    await queryAs(db.adminUrl, `update ${tally} set recorded_at = now() - interval '2 minutes'`);
    const later = await recorded('acme.alloy.test', fail);
    expect(later.map((event) => event.detail)).toEqual([
      { route: 'organisation', failure: 'provider_error', count: 5 },
    ]);
  });

  it('never writes a client secret to its log or to a refusal', async () => {
    const refused = await signInAt('other.acme.alloy.test');
    expect(refused.statusCode).toBe(401);
    expect(refused.body).not.toContain(OTHER_SECRET);
    const log = lines.join('');
    expect(log).toContain('sign-in refused');
    expect(log).not.toContain(OTHER_SECRET);
    expect(log).not.toContain(STAND_IN_SECRET);
  });

  it('never writes an authorisation code or a token to its log', () => {
    const log = lines.join('');
    expect(log).not.toMatch(/[?&]code=/);
    expect(log).not.toContain('__Host-aw_session=');
  });
});
