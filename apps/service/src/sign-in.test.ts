import { Writable } from 'node:stream';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';

const callback = (host: string) => `http://${host}/v1/sign-in/organisation/callback`;

describe('signing in with the organisation provider', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;
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
          redirectUris: [callback('acme.alloy.test')],
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
    await configureOrganisationSignIn(db.adminUrl, production, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
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
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
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

  it('comes back signed in, with a session cookie and a principal found by issuer and subject', async () => {
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

  it('never writes an authorisation code or a token to its log', () => {
    const log = lines.join('');
    expect(log).not.toMatch(/[?&]code=/);
    expect(log).not.toContain('__Host-aw_session=');
  });
});
