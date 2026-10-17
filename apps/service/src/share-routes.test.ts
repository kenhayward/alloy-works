import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createSpace,
  createTenant,
  findRole,
  grant,
  migrate,
  recordPublication,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { defaultNumberingScheme, OUTPUT_CONTENT_TYPES } from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import {
  startStandInProvider,
  STAND_IN_USERS,
  type StandInProvider,
} from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const PDF = '%PDF-1.7 a shared stand-in';

describe('sharing a publication outside the organisation (the R17 plan)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let objects: TestObjectStore;
  let stores: ObjectStores;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let general = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (as: string, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[as]! },
      ...(payload ? { payload } : {}),
    });

  /** A document in General, published by Grace through the route and recorded as the worker would. */
  const document = async (title: string) => {
    const made = (
      await call('grace', 'POST', `/v1/spaces/${general}/documents`, {
        title,
        language: 'en-GB',
        direction: 'ltr',
      })
    ).json<{ id: string; version: { id: string } }>();
    return { id: made.id, version: made.version.id };
  };
  const publish = async (of: { id: string; version: string }) => {
    const asked = await call('grace', 'POST', `/v1/documents/${of.id}/publications`, {
      version: of.version,
      formats: ['pdf'],
    });
    expect(asked.statusCode, asked.body).toBe(200);
    const requestId = asked.json<{ id: string }>().id;
    return tenantDb.withTenant(tenant, async (trx) => {
      const store = await stores.forTenant(trx, tenant);
      const stored = await store.put(Buffer.from(PDF), OUTPUT_CONTENT_TYPES.pdf);
      const id = await recordPublication(trx, {
        requestId,
        pipelineVersion: '2',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf' as const,
            engineVersion: '0.15.1',
            templateVersion: 2,
            key: stored.key,
            sha256: stored.sha256,
            bytes: stored.size,
          },
        ],
      });
      if (!id) throw new Error('not recorded');
      return id;
    });
  };
  /** A later version of the document, through the outline route. */
  const revise = async (of: { id: string; version: string }) => {
    const edited = await call('grace', 'POST', `/v1/documents/${of.id}/outline`, {
      openedFrom: of.version,
      operation: {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'section', title: [{ type: 'text', value: 'Scope', marks: [] }] },
      },
    });
    expect(edited.statusCode, edited.body).toBe(200);
    return { id: of.id, version: edited.json<{ version: { id: string } }>().version.id };
  };

  beforeAll(async () => {
    db = await freshDatabase();
    objects = await testObjectStore();
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
      // Iris is from outside: a guest the organisation's provider holds, whom nobody has invited.
      users: [...STAND_IN_USERS, { id: 'iris', name: 'Iris', email: 'iris@example.net' }],
    });
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await objects.setUp(db.adminUrl, tenant);
    stores = createObjectStores(objects.settings, objects.sealingKey);
    await configureStandIn(db.adminUrl, tenant, { issuer: idp.issuer, clientId: 'alloy' });
    tenantDb = testTenantDatabase(db.serviceUrl);
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
      objects: stores,
    });
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      await createSpace(trx, 'Quality');
      // Ada administers the environment; Alice reads General and publishes nothing.
      await grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      await grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: ids.alice! },
        level: { kind: 'space', id: general },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('PUB-057 shares with a named person from outside, who reads it once they sign in, and with nobody in the organisation', async () => {
    const shared = await publish(await document('The shared manual'));
    const made = await call('grace', 'POST', `/v1/publications/${shared}/shares`, {
      email: 'Iris@Example.net',
    });
    expect(made.statusCode, made.body).toBe(200);
    expect(made.json()).toMatchObject({
      invited: true,
      share: { recipient: { email: 'iris@example.net', signedIn: false }, accesses: [] },
    });
    // Alice is one of the organisation's own.
    const member = await call('grace', 'POST', `/v1/publications/${shared}/shares`, {
      email: 'alice@example.org',
    });
    expect(member.statusCode).toBe(409);
    expect(member.json()).toMatchObject({ code: 'share_member' });
    // Whoever may only read it may not share it.
    expect(
      (await call('alice', 'POST', `/v1/publications/${shared}/shares`, { email: 'x@example.net' }))
        .statusCode,
    ).toBe(403);

    cookies.iris = await signIn(app, HOST, 'iris', idp.issuer);
    const me = (await call('iris', 'GET', '/v1/me')).json<{ id: string }>();
    ids.iris = me.id;
    const opened = await call('iris', 'GET', `/v1/publications/${shared}`);
    expect(opened.statusCode, opened.body).toBe(200);
    const [pdf] = opened.json<{ outputs: { download: string; view: string | null }[] }>().outputs;
    // No signed link to the store: the service's own address, and nothing shown in place.
    expect(pdf).toMatchObject({ download: `/v1/publications/${shared}/outputs/pdf`, view: null });
    const bytes = await call('iris', 'GET', pdf!.download);
    expect(bytes.statusCode).toBe(200);
    expect(bytes.body).toBe(PDF);
    expect(bytes.headers['content-disposition']).toBe(`attachment; filename="${shared}.pdf"`);
    expect(bytes.headers['cache-control']).toBe('private, no-store');
  });

  it('PUB-084 reaches that publication alone, and never its bindings, its document or another', async () => {
    const of = await document('The other manual');
    const shared = await publish(of);
    const other = await publish(await document('An unshared manual'));
    expect(
      (
        await call('grace', 'POST', `/v1/publications/${shared}/shares`, {
          email: 'iris@example.net',
        })
      ).statusCode,
    ).toBe(200);
    cookies.iris ??= await signIn(app, HOST, 'iris', idp.issuer);
    expect((await call('iris', 'GET', `/v1/publications/${shared}`)).statusCode).toBe(200);
    expect((await call('iris', 'GET', `/v1/publications/${shared}/bindings`)).statusCode).toBe(404);
    expect((await call('iris', 'GET', `/v1/publications/${other}`)).statusCode).toBe(404);
    expect((await call('iris', 'GET', `/v1/documents/${of.id}`)).statusCode).toBe(404);
    // The shared reader is granted only as a share.
    const fixed = await tenantDb.withTenant(tenant, (trx) => findRole(trx, 'Shared reader'));
    const refused = await call('ada', 'POST', '/v1/grants', {
      role: fixed!.id,
      subject: { principal: ids.alice },
      level: `artifact:${other}`,
      effect: 'allow',
    });
    expect(refused.json()).toMatchObject({ code: 'grant_role_fixed' });
  });

  it('PUB-060 records every access and reports it to whoever may share it', async () => {
    const shared = await publish(await document('The audited manual'));
    const made = await call('grace', 'POST', `/v1/publications/${shared}/shares`, {
      email: 'iris@example.net',
    });
    expect(made.json()).toMatchObject({ invited: false });
    cookies.iris ??= await signIn(app, HOST, 'iris', idp.issuer);
    await call('iris', 'GET', `/v1/publications/${shared}`);
    await call('iris', 'GET', `/v1/publications/${shared}/outputs/pdf`);
    // Grace's own reading is no share's access.
    await call('grace', 'GET', `/v1/publications/${shared}`);
    const listed = await call('grace', 'GET', `/v1/publications/${shared}/shares`);
    expect(listed.statusCode, listed.body).toBe(200);
    const [share] = listed.json<{ shares: { accesses: { output: string | null }[] }[] }>().shares;
    expect(share!.accesses.map((each) => each.output)).toEqual(['pdf', null]);
    expect((await call('alice', 'GET', `/v1/publications/${shared}/shares`)).statusCode).toBe(403);
  });

  it('PUB-058 revokes a share at once: the next request for the publication or its bytes finds nothing', async () => {
    const shared = await publish(await document('The revoked manual'));
    const made = (
      await call('grace', 'POST', `/v1/publications/${shared}/shares`, {
        email: 'iris@example.net',
      })
    ).json<{ share: { id: string; expiresAt: string } }>();
    const days = (Date.parse(made.share.expiresAt) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    const far = new Date(Date.now() + 91 * 86_400_000).toISOString();
    const capped = await call('grace', 'POST', `/v1/publications/${shared}/shares`, {
      email: 'ines@example.net',
      expiresAt: far,
    });
    expect(capped.json()).toMatchObject({ code: 'share_past_cap' });
    cookies.iris ??= await signIn(app, HOST, 'iris', idp.issuer);
    expect((await call('iris', 'GET', `/v1/publications/${shared}/outputs/pdf`)).statusCode).toBe(
      200,
    );
    const revoked = await call(
      'grace',
      'DELETE',
      `/v1/publications/${shared}/shares/${made.share.id}`,
    );
    expect(revoked.statusCode, revoked.body).toBe(200);
    expect((await call('iris', 'GET', `/v1/publications/${shared}/outputs/pdf`)).statusCode).toBe(
      404,
    );
    expect((await call('iris', 'GET', `/v1/publications/${shared}`)).statusCode).toBe(404);
    expect(
      (await call('grace', 'DELETE', `/v1/publications/${shared}/shares/${made.share.id}`))
        .statusCode,
    ).toBe(404);
  });

  it('PUB-059 tells a reader a later publication superseded it, naming it only to whoever may read it', async () => {
    const of = await document('The corrected manual');
    const first = await publish(of);
    expect(
      (
        await call('grace', 'POST', `/v1/publications/${first}/shares`, {
          email: 'iris@example.net',
        })
      ).statusCode,
    ).toBe(200);
    const second = await publish(await revise(of));
    cookies.iris ??= await signIn(app, HOST, 'iris', idp.issuer);
    expect((await call('grace', 'GET', `/v1/publications/${first}`)).json()).toMatchObject({
      superseded: true,
      newer: second,
    });
    expect((await call('iris', 'GET', `/v1/publications/${first}`)).json()).toMatchObject({
      superseded: true,
      newer: null,
    });
    expect((await call('grace', 'GET', `/v1/publications/${second}`)).json()).toMatchObject({
      superseded: false,
      newer: null,
    });
  });

  it('PUB-084 shows each share in the listing of access from outside, naming the publication it reaches', async () => {
    const shared = await publish(await document('The listed manual'));
    expect(
      (
        await call('grace', 'POST', `/v1/publications/${shared}/shares`, {
          email: 'iris@example.net',
        })
      ).statusCode,
    ).toBe(200);
    const listed = await call('ada', 'GET', '/v1/access/external');
    expect(listed.statusCode, listed.body).toBe(200);
    const iris = listed
      .json<{
        items: {
          principal: { email: string | null };
          grants: { level: string; role: { name: string }; on: unknown }[];
        }[];
      }>()
      .items.find((each) => each.principal.email === 'iris@example.net')!;
    expect(iris.grants.find((each) => each.level === `artifact:${shared}`)).toMatchObject({
      role: { name: 'Shared reader' },
      on: { kind: 'publication', title: 'The listed manual' },
    });
  });

  it('returns from signing in to the publication the sign-in started from, and to nowhere else', async () => {
    const shared = await publish(await document('The returned manual'));
    const signInTo = async (to: string) => {
      const started = await app.inject({
        url: `/v1/sign-in/organisation?to=${encodeURIComponent(to)}`,
        headers: { host: HOST },
      });
      if (started.statusCode !== 302) return { status: started.statusCode, location: undefined };
      const cookie = started.cookies.map((each) => `${each.name}=${each.value}`).join('; ');
      const back = await completeAtStandIn(started.headers.location!, 'iris', idp.issuer);
      const finished = await app.inject({
        url: `${back.pathname}${back.search}`,
        headers: { host: HOST, cookie },
      });
      return { status: finished.statusCode, location: finished.headers.location };
    };
    expect(await signInTo(`publications/${shared}`)).toEqual({
      status: 302,
      location: `/#/publications/${shared}`,
    });
    // Anything but a page of this app is refused before the provider is asked.
    for (const elsewhere of ['//evil.example', 'https://evil.example', '../v1/me', 'a b']) {
      expect((await signInTo(elsewhere)).status, elsewhere).toBe(400);
    }
    // And with none, home.
    expect((await signInTo('')).status).toBe(400);
    const plain = await app.inject({ url: '/v1/sign-in/organisation', headers: { host: HOST } });
    expect(plain.statusCode).toBe(302);
  });

  it('says to somebody from outside that they are, and which ways in this environment offers', async () => {
    cookies.iris ??= await signIn(app, HOST, 'iris', idp.issuer);
    expect((await call('iris', 'GET', '/v1/me')).json()).toMatchObject({ outside: true });
    expect((await call('grace', 'GET', '/v1/me')).json()).toMatchObject({ outside: false });
    const tenantProfile = await app.inject({ url: '/v1/tenant', headers: { host: HOST } });
    expect(tenantProfile.json()).toMatchObject({ signIn: ['organisation'] });
  });

  it('PUB-084 tells somebody shared a publication nothing else of the organisation, at any route a session opens', async () => {
    cookies.iris ??= await signIn(app, HOST, 'iris', idp.issuer);
    // What only the organisation's own may see: its people, its spaces and what was not shared. The
    // shared publication's own record, its publisher's name among it, is theirs to read.
    const secrets = ['Ada', 'Alice', 'General', 'Quality', 'grace@example.com', 'unshared'];
    const opened = allRoutes.filter(
      (route) =>
        route.method === 'GET' &&
        route.tenantScoped &&
        route.access.check === 'session' &&
        !route.path.includes('{') &&
        !route.responses[200]?.stream,
    );
    expect(opened.length).toBeGreaterThan(5);
    const leaks: string[] = [];
    // Each as it is, and looking for what every document here is titled, where it looks.
    for (const url of opened.flatMap((route) => [route.path, `${route.path}?q=manual`])) {
      const answer = await call('iris', 'GET', url);
      for (const word of secrets) {
        if (answer.statusCode === 200 && answer.body.includes(word))
          leaks.push(`${url} says ${word}`);
      }
    }
    expect(leaks).toEqual([]);
  });
});
