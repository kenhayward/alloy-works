import {
  bootstrapCluster,
  createTenant,
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
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';

interface Session {
  readonly id: string;
  readonly route: string;
  readonly startedAt: string;
  readonly lastActiveAt: string;
  readonly expiresAt: string;
  readonly current: boolean;
}

describe("a person's own sessions, seen and ended (IAM-040)", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;

  const call = (cookie: string, method: 'GET' | 'DELETE' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, headers: { host: HOST, cookie }, ...(payload ? { payload } : {}) });
  const sessionsOf = async (cookie: string) => {
    const answer = await call(cookie, 'GET', '/v1/sessions');
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ sessions: Session[] }>().sessions;
  };
  const thisOne = async (cookie: string) =>
    (await sessionsOf(cookie)).find((each) => each.current)!;

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
        { id: 'ada', name: 'Ada', email: 'ada@example.com' },
        { id: 'grace', name: 'Grace', email: 'grace@example.com' },
      ],
    });
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureStandIn(db.adminUrl, production, { issuer: idp.issuer, clientId: 'alloy' });
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
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

  it('IAM-040 shows a person their own sessions, which this one is, and ends another, whose next request is refused', async () => {
    const laptop = await signIn(app, HOST, 'ada', idp.issuer);
    const phone = await signIn(app, HOST, 'ada', idp.issuer);
    const graces = await signIn(app, HOST, 'grace', idp.issuer);

    const seen = await sessionsOf(laptop);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.filter((each) => each.current)).toHaveLength(1);
    expect(seen[0]).toMatchObject({ route: 'organisation' });
    const theirs = await thisOne(graces);
    expect(seen.map((each) => each.id)).not.toContain(theirs.id);

    const phones = await thisOne(phone);
    expect((await call(laptop, 'DELETE', `/v1/sessions/${phones.id}`)).statusCode).toBe(204);
    expect((await call(phone, 'GET', '/v1/me')).statusCode).toBe(401);
    expect((await call(laptop, 'GET', '/v1/me')).statusCode).toBe(200);
    expect((await sessionsOf(laptop)).map((each) => each.id)).not.toContain(phones.id);

    // Recorded as ended by its holder, from the session that ended it.
    const events = await tenantDb.withTenant(production, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['detail'])
        .where('kind', '=', 'authentication.signed_out')
        .execute(),
    );
    const event = { rows: events.filter((each) => each.detail['session'] === phones.id) };
    expect(event.rows).toEqual([
      expect.objectContaining({ detail: { ended: 'ended_by_holder', session: phones.id } }),
    ]);
  });

  it("IAM-040 ends every session of a person's but this one, and ending this one signs out", async () => {
    const keeping = await signIn(app, HOST, 'ada', idp.issuer);
    const other = await signIn(app, HOST, 'ada', idp.issuer);
    const ended = await call(keeping, 'DELETE', '/v1/sessions');
    expect(ended.statusCode).toBe(200);
    expect(ended.json<{ ended: number }>().ended).toBeGreaterThanOrEqual(1);
    expect((await call(other, 'GET', '/v1/me')).statusCode).toBe(401);
    expect(await sessionsOf(keeping)).toEqual([expect.objectContaining({ current: true })]);

    const own = await thisOne(keeping);
    const signedOut = await call(keeping, 'DELETE', `/v1/sessions/${own.id}`);
    expect(signedOut.statusCode).toBe(204);
    expect(signedOut.cookies.find((cookie) => cookie.name === '__Host-aw_session')?.value).toBe('');
    expect((await call(keeping, 'GET', '/v1/me')).statusCode).toBe(401);
  });

  it('ends only sessions that have not ended of themselves, leaving an expired one to the sweep', async () => {
    const keeping = await signIn(app, HOST, 'ada', idp.issuer);
    await call(keeping, 'DELETE', '/v1/sessions');
    const own = await thisOne(keeping);
    // An expired session of Ada's, not yet swept: the list never shows it, so nor is it ended here.
    const principal = await tenantDb.withTenant(
      production,
      async (trx) =>
        (
          await trx
            .selectFrom('session')
            .select('principal_id')
            .where('id', '=', own.id)
            .executeTakeFirstOrThrow()
        ).principal_id,
    );
    const past = new Date(Date.now() - 60_000);
    await tenantDb.withTenant(production, (trx) =>
      trx
        .insertInto('session')
        .values({
          token_hash: 'e'.repeat(64),
          principal_id: principal,
          route: 'organisation',
          last_seen_at: past,
          idle_expires_at: past,
          expires_at: past,
        })
        .execute(),
    );
    const ended = await call(keeping, 'DELETE', '/v1/sessions');
    expect(ended.json<{ ended: number }>().ended).toBe(0);
  });

  it("answers another person's session as one that does not exist, and ends nothing of theirs", async () => {
    const ada = await signIn(app, HOST, 'ada', idp.issuer);
    const grace = await signIn(app, HOST, 'grace', idp.issuer);
    const theirs = await thisOne(grace);
    expect((await call(ada, 'DELETE', `/v1/sessions/${theirs.id}`)).statusCode).toBe(404);
    expect((await call(grace, 'GET', '/v1/me')).statusCode).toBe(200);
  });

  it('refuses a token: sessions are seen and ended with a session', async () => {
    const ada = await signIn(app, HOST, 'ada', idp.issuer);
    const issued = await call(ada, 'POST', '/v1/tokens', {
      name: 'Script',
      scopes: [],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(issued.statusCode, issued.body).toBe(200);
    const secret = issued.json<{ secret: string }>().secret;
    for (const [method, url] of [
      ['GET', '/v1/sessions'],
      ['DELETE', '/v1/sessions'],
    ] as const) {
      const answer = await app.inject({
        method,
        url,
        headers: { host: HOST, authorization: `Bearer ${secret}` },
      });
      expect(answer.statusCode, url).toBe(403);
      expect(answer.json()).toMatchObject({ code: 'token_not_allowed' });
    }
  });
});
