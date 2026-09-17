// apps/service/src/invitation-routes.test.ts
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
import {
  STAND_IN_USERS,
  startStandInProvider,
  type StandInProvider,
} from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const GOOGLE_SIGN_IN = 'signin.acme.alloy.test';
const MISSING = '00000000-0000-4000-8000-000000000000';

type Json = Record<string, unknown>;
type Made = { invitation: { id: string; person: string; email: string }; renewed: boolean };

describe('inviting people through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let author: string;
  let general: string;
  let clinical: string;

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

  const inviting = (as: string, payload: Json) => call(as, 'POST', '/v1/invitations', payload);

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
        {
          clientId: 'alloy-google',
          clientSecret: 'google-secret',
          redirectUris: [`http://${GOOGLE_SIGN_IN}/v1/sign-in/google/callback`],
        },
      ],
      users: [
        ...STAND_IN_USERS,
        { id: 'ivy-unverified', name: 'Ivy', email: 'ivy@example.com', emailVerified: false },
        { id: 'eve', name: 'Eve', email: 'eve@example.net' },
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
      secrets: environmentSecrets({
        SECRET_STAND_IN: 'stand-in-secret',
        SECRET_GOOGLE: 'google-secret',
        SECRET_SIGN_IN_STATE: 'test-only-state-key-0123456789abcdef',
      }),
      // A Google client the service is configured with, which this environment does not permit - so
      // the closed Google route below is closed by the environment's own settings, not by a service
      // that could never offer Google to anybody.
      google: { issuer: idp.issuer, clientId: 'alloy-google', signInHost: GOOGLE_SIGN_IN },
    });
    for (const user of ['ada', 'grace']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      author = (await findRole(trx, 'Author'))!.id;
      const administrator = (await findRole(trx, 'Administrator'))!.id;
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      clinical = (await createSpace(trx, 'Clinical')).id;
      // Ada administers the environment; Grace administers Clinical only.
      await grant(trx, {
        roleId: administrator,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      await grant(trx, {
        roleId: administrator,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: clinical },
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

  it('IAM-072 invites an address, grants the person it makes before anybody signs in with it, and they have it only from their first verified sign-in through a permitted route', async () => {
    // Nobody has signed in as ivy@example.com: only Ada and Grace have signed in to this environment.
    const invited = await inviting('ada', { email: 'Ivy@Example.com' });
    expect(invited.statusCode).toBe(200);
    const made = invited.json<Made>();
    expect(made).toMatchObject({
      renewed: false,
      invitation: {
        email: 'ivy@example.com',
        external: false,
        invitedBy: { id: ids.ada, name: 'Ada' },
        lapsed: false,
        acceptedAt: null,
        acceptedThrough: null,
      },
    });

    const people = await call('ada', 'GET', '/v1/principals?level=tenant&limit=100');
    expect(people.json<{ items: unknown[] }>().items).toContainEqual({
      id: made.invitation.person,
      name: null,
      email: 'ivy@example.com',
      kind: 'user',
      invited: true,
    });
    const given = await call('ada', 'POST', '/v1/grants', {
      role: author,
      subject: { principal: made.invitation.person },
      level: `space:${general}`,
      effect: 'allow',
    });
    expect(given.statusCode).toBe(200);

    // An account whose provider does not verify the address is somebody new, holding nothing.
    const unverified = await signIn(app, HOST, 'ivy-unverified', idp.issuer);
    const unverifiedMe = await app.inject({
      url: '/v1/me',
      headers: { host: HOST, cookie: unverified },
    });
    expect(unverifiedMe.json<{ id: string }>().id).not.toBe(made.invitation.person);
    const stranger = await app.inject({
      url: `/v1/access?target=space:${general}`,
      headers: { host: HOST, cookie: unverified },
    });
    expect(stranger.statusCode).toBe(404);

    // Google - a route the service offers but this environment does not permit - never claims the
    // invitation either: it is refused closed before any identity is even asked for, and the
    // invitation is still waiting.
    const closedGoogle = await app.inject({ url: '/v1/sign-in/google', headers: { host: HOST } });
    expect(closedGoogle.statusCode).toBe(404);
    expect(closedGoogle.json()).toMatchObject({ code: 'sign_in_route_closed' });
    const stillWaiting = await call('ada', 'GET', '/v1/invitations');
    expect(
      stillWaiting.json<{ items: { id: string; acceptedAt: string | null }[] }>().items,
    ).toContainEqual(expect.objectContaining({ id: made.invitation.id, acceptedAt: null }));

    // Ivy, through the organisation's route - the one this environment permits - with it verified.
    cookies.ivy = await signIn(app, HOST, 'ivy', idp.issuer);
    const me = await call('ivy', 'GET', '/v1/me');
    expect(me.json()).toMatchObject({ id: made.invitation.person, email: 'ivy@example.com' });
    const access = await call('ivy', 'GET', `/v1/access?target=space:${general}`);
    expect(access.statusCode).toBe(200);
    expect(
      access.json<{ permissions: { permission: string; allowed: boolean }[] }>().permissions,
    ).toContainEqual(expect.objectContaining({ permission: 'edit', allowed: true }));

    const listed = await call('ada', 'GET', '/v1/invitations');
    expect(listed.json<{ items: unknown[] }>().items).toContainEqual(
      expect.objectContaining({
        id: made.invitation.id,
        acceptedAt: expect.any(String),
        acceptedThrough: 'organisation',
      }),
    );
    const again = await inviting('ada', { email: 'ivy@example.com' });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'invitation_signed_in' });
    const withdrawn = await call('ada', 'DELETE', `/v1/invitations/${made.invitation.id}`);
    expect(withdrawn.statusCode).toBe(409);
    expect(withdrawn.json()).toMatchObject({ code: 'invitation_accepted' });
  });

  it('renews a waiting invitation, refuses one that disagrees about being external, and withdraws it with its grants', async () => {
    const first = (
      await inviting('ada', { email: 'eve@example.net', external: true })
    ).json<Made>();
    const renewed = await inviting('ada', { email: 'EVE@example.net', external: true });
    expect(renewed.json<Made>()).toMatchObject({
      renewed: true,
      invitation: { id: first.invitation.id, external: true },
    });
    const disagrees = await inviting('ada', { email: 'eve@example.net' });
    expect(disagrees.statusCode).toBe(409);
    expect(disagrees.json()).toMatchObject({ code: 'invitation_kind_differs' });

    const reader = await call('ada', 'POST', '/v1/grants', {
      role: (await tenantDb.withTenant(tenant, (trx) => findRole(trx, 'Reader')))!.id,
      subject: { principal: first.invitation.person },
      level: `space:${general}`,
      effect: 'allow',
    });
    expect(reader.json()).toMatchObject({ grant: { expiresAt: expect.any(String) } });

    const withdrawn = await call('ada', 'DELETE', `/v1/invitations/${first.invitation.id}`);
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json()).toEqual({ withdrawn: first.invitation.id });
    const grants = await call('ada', 'GET', `/v1/grants?level=space:${general}`);
    expect(JSON.stringify(grants.json())).not.toContain(first.invitation.person);
    expect((await call('ada', 'DELETE', `/v1/invitations/${first.invitation.id}`)).statusCode).toBe(
      404,
    );
    expect((await call('ada', 'DELETE', `/v1/invitations/${MISSING}`)).statusCode).toBe(404);
    const malformed = await call('ada', 'DELETE', `/v1/invitations/${MISSING.replace('0', 'A')}`);
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ code: 'invalid_request' });

    // Eve signing in now is somebody new, holding nothing: her own id, not the withdrawn invitation's
    // principal, and refused the space the withdrawn invitation's person was once given.
    cookies.eve = await signIn(app, HOST, 'eve', idp.issuer);
    const eveMe = await call('eve', 'GET', '/v1/me');
    expect(eveMe.json<{ id: string }>().id).not.toBe(first.invitation.person);
    const eveAccess = await call('eve', 'GET', `/v1/access?target=space:${general}`);
    expect(eveAccess.statusCode).toBe(404);
  });

  it('refuses a body that is not exactly an invitation', async () => {
    for (const body of [
      {},
      { email: 'not an address' },
      { email: 'ivy@example.com', role: author },
      { email: 'ivy@example.com', external: 'yes' },
    ]) {
      const response = await inviting('ada', body);
      expect(response.statusCode, JSON.stringify(body)).toBe(400);
      expect(response.json()).toMatchObject({ code: 'invalid_request' });
    }
  });

  it('is only for whoever administers the whole environment', async () => {
    expect((await inviting('grace', { email: 'alice@example.org' })).statusCode).toBe(403);
    expect((await call('grace', 'GET', '/v1/invitations')).statusCode).toBe(403);
    expect((await call('grace', 'DELETE', `/v1/invitations/${MISSING}`)).statusCode).toBe(403);
    expect((await inviting(undefined as never, { email: 'alice@example.org' })).statusCode).toBe(
      401,
    );
  });
});
