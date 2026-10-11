import {
  bootstrapCluster,
  createTenant,
  findRole,
  grant,
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
const OTHER_HOST = 'dev.acme.alloy.test';

interface Event {
  readonly sequence: string;
  readonly kind: string;
  readonly actor: string | null;
  readonly subject: { kind: string; id: string | null } | null;
  readonly labels: Record<string, { text: string; erased: boolean }>;
}

describe('the audit log read (audit.md, "Reading and export")', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;
  let development: Tenant;
  let grace = '';
  let graceCookie = '';
  let adaCookie = '';
  let otherCookie = '';

  const call = (
    cookie: string,
    url: string,
    host = HOST,
    method: 'GET' | 'POST' = 'GET',
    payload?: Record<string, unknown>,
  ) => app.inject({ method, url, headers: { host, cookie }, ...(payload ? { payload } : {}) });
  const events = async (query: string, cookie = graceCookie, host = HOST) => {
    const answer = await call(cookie, `/v1/audit${query}`, host);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ items: Event[]; next: string | null }>();
  };
  const makeGroup = async (name: string) => {
    const made = await call(graceCookie, '/v1/groups', HOST, 'POST', { name });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ group: { id: string } }>().group.id;
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
          redirectUris: [
            `http://${HOST}/v1/sign-in/organisation/callback`,
            `http://${OTHER_HOST}/v1/sign-in/organisation/callback`,
          ],
        },
      ],
      users: [
        { id: 'grace', name: 'Grace', email: 'grace@example.com' },
        { id: 'ada', name: 'Ada', email: 'ada@example.com' },
      ],
    });
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: [OTHER_HOST],
    });
    for (const tenant of [production, development]) {
      await configureStandIn(db.adminUrl, tenant, { issuer: idp.issuer, clientId: 'alloy' });
    }
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    graceCookie = await signIn(app, HOST, 'grace', idp.issuer);
    adaCookie = await signIn(app, HOST, 'ada', idp.issuer);
    otherCookie = await signIn(app, OTHER_HOST, 'grace', idp.issuer);
    grace = (await call(graceCookie, '/v1/me')).json<{ id: string }>().id;
    const otherGrace = (await call(otherCookie, '/v1/me', OTHER_HOST)).json<{ id: string }>().id;
    for (const [tenant, principal] of [
      [production, grace],
      [development, otherGrace],
    ] as const) {
      await tenantDb.withTenant(tenant, async (trx) => {
        await grant(trx, {
          roleId: (await findRole(trx, 'Administrator'))!.id,
          subject: { principal },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: principal,
        });
      });
    }
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('ADM-038 lets an administrator read the log newest first, filtered by who acted, the kind or its family and what it was about, each event with the names it was recorded with', async () => {
    const reviewers = await makeGroup('Reviewers');
    const editors = await makeGroup('Editors');

    const groups = await events('?kind=group.made');
    expect(groups.items.map((each) => each.subject?.id)).toEqual([editors, reviewers]);
    expect(groups.items[0]).toMatchObject({
      kind: 'group.made',
      actor: grace,
      labels: { actor: { text: 'Grace', erased: false } },
    });
    expect((await events(`?subject=${reviewers}`)).items.map((each) => each.kind)).toEqual([
      'group.made',
    ]);
    const signIns = await events(`?kind=authentication.&actor=${grace}`);
    expect(signIns.items.length).toBeGreaterThan(0);
    expect(signIns.items.every((each) => each.kind.startsWith('authentication.'))).toBe(true);
    expect(signIns.items.every((each) => each.actor === grace)).toBe(true);
  });

  it('LIF-028 pages the log by a cursor, each event once', async () => {
    await makeGroup('One');
    await makeGroup('Two');
    await makeGroup('Three');
    const seen: string[] = [];
    let page = await events('?kind=group.made&limit=2');
    seen.push(...page.items.map((each) => each.sequence));
    while (page.next !== null) {
      page = await events(`?kind=group.made&limit=2&cursor=${page.next}`);
      seen.push(...page.items.map((each) => each.sequence));
    }
    const all = (await events('?kind=group.made&limit=100')).items.map((each) => each.sequence);
    expect(seen).toEqual(all);
    expect(all.length).toBeGreaterThanOrEqual(3);
  });

  it('LIF-031 reads no event of another environment', async () => {
    const theirs = await events('?kind=group.made', otherCookie, OTHER_HOST);
    expect(theirs.items).toEqual([]);
  });

  it('refuses a filter the log cannot take, and a cursor it did not give out', async () => {
    for (const query of [
      '?kind=group.painted',
      '?kind=nothing.',
      '?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z',
    ]) {
      const answer = await call(graceCookie, `/v1/audit${query}`);
      expect(answer.statusCode, query).toBe(400);
      expect(answer.json()).toMatchObject({ code: 'audit_filter_invalid' });
    }
    const forged = Buffer.from(JSON.stringify({ v: 1, q: '5', n: "1:1:'; drop" })).toString(
      'base64url',
    );
    const answer = await call(graceCookie, `/v1/audit?cursor=${forged}`);
    expect(answer.statusCode).toBe(400);
    expect(answer.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('refuses anybody who may not administer the environment', async () => {
    const answer = await call(adaCookie, '/v1/audit');
    expect(answer.statusCode).toBe(403);
  });
});
