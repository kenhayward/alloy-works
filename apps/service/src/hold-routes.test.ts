import type { ComponentView, DocumentView, HoldList, HoldView } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createComponent,
  createDocument,
  createSpace,
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

const HOST = '127.0.0.1';

describe('legal holds over HTTP (the AH plan, Task 2)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (
    method: 'GET' | 'POST',
    url: string,
    who: string,
    payload?: object,
    headers: Record<string, string> = { cookie: cookies[who] ?? '' },
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...headers },
      ...(payload ? { payload } : {}),
    });

  const made = (kind: 'component' | 'document', title: string) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const input = {
        spaceId: clinical,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      } as const;
      const answer =
        kind === 'component' ? await createComponent(trx, input) : await createDocument(trx, input);
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.version.artifactId;
    });

  const place = (target: { artifact: string } | { space: string }, reason: string, who = 'ivy') =>
    call('POST', '/v1/holds', who, { target, reason });

  const component = async (id: string, who: string) =>
    (await call('GET', `/v1/components/${id}`, who)).json<ComponentView>();

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
    for (const who of ['ivy', 'ada', 'grace']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      // Ivy administers the environment; Ada authors and administers Clinical; Grace authors it.
      await grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: ids.ivy! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ivy!,
      });
      for (const [who, name] of [
        ['ada', 'Author'],
        ['ada', 'Administrator'],
        ['grace', 'Author'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, name))!.id,
          subject: { principal: ids[who]! },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          grantedBy: ids.ivy!,
        });
      }
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await tenantDb?.close();
    await db?.drop();
  });

  it('LIF-022 places a hold with who, when and why, and lists it in force', async () => {
    const held = await made('component', 'Held procedure');
    const placed = await place({ artifact: held }, '  Matter 2026-14 ');
    expect(placed.statusCode, placed.body).toBe(200);
    const view = placed.json<HoldView>();
    expect(view).toMatchObject({
      target: { kind: 'component', id: held, title: 'Held procedure' },
      reason: 'Matter 2026-14',
      appliedBy: { id: ids.ivy, name: 'Ivy' },
      released: null,
    });
    expect(Date.parse(view.appliedAt)).toBeGreaterThan(Date.now() - 60_000);
    const listed = (await call('GET', '/v1/holds?limit=100', 'ivy')).json<HoldList>();
    expect(listed.items.find((each) => each.id === view.id)).toEqual(view);
    expect(listed.total).toBeGreaterThanOrEqual(1);
  });

  it('LIF-022 releases a hold only with a reason, records it, and only once', async () => {
    const held = await made('document', 'Released manual');
    const hold = (await place({ artifact: held }, 'Audit request')).json<HoldView>();
    const release = (reason: string, id = hold.id) =>
      call('POST', `/v1/holds/${id}/release`, 'ivy', { reason });
    expect((await release('  ')).statusCode).toBe(400);
    const released = await release('Matter closed');
    expect(released.statusCode, released.body).toBe(200);
    expect(released.json<HoldView>().released).toMatchObject({
      reason: 'Matter closed',
      by: { id: ids.ivy },
    });
    const again = await release('Again');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'hold_released' });
    expect((await release('Nothing', '00000000-0000-4000-8000-000000000001')).statusCode).toBe(404);
    // A released hold no longer holds.
    expect((await call('GET', `/v1/documents/${held}`, 'ivy')).json<DocumentView>().onHold).toBe(
      false,
    );
  });

  it("LIF-022 holds a space's artifacts by the space's hold", async () => {
    const manual = await made('document', 'Space-held manual');
    const space = await place({ space: clinical }, 'Whole space');
    expect(space.statusCode, space.body).toBe(200);
    expect(space.json<HoldView>().target).toEqual({
      kind: 'space',
      id: clinical,
      title: 'Clinical',
    });
    expect((await call('GET', `/v1/documents/${manual}`, 'ivy')).json<DocumentView>().onHold).toBe(
      true,
    );
    await call('POST', `/v1/holds/${space.json<HoldView>().id}/release`, 'ivy', {
      reason: 'Space done',
    });
    expect((await call('GET', `/v1/documents/${manual}`, 'ivy')).json<DocumentView>().onHold).toBe(
      false,
    );
  });

  it('places, releases and lists holds only for an environment administrator', async () => {
    const held = await made('component', 'Guarded procedure');
    // Ada administers its space, and Grace authors it: neither may.
    for (const who of ['ada', 'grace']) {
      expect((await place({ artifact: held }, 'Not mine', who)).statusCode, who).toBe(403);
      expect((await place({ space: clinical }, 'Not mine', who)).statusCode, who).toBe(403);
      expect((await call('GET', '/v1/holds', who)).statusCode, who).toBe(403);
    }
    const hold = (await place({ artifact: held }, 'Kept')).json<HoldView>();
    expect(
      (await call('POST', `/v1/holds/${hold.id}/release`, 'ada', { reason: 'Not mine' }))
        .statusCode,
    ).toBe(403);
    // Not a thing a hold takes, or not there at all.
    expect(
      (await place({ artifact: '00000000-0000-4000-8000-000000000002' }, 'x')).statusCode,
    ).toBe(404);
    expect((await place({ space: '00000000-0000-4000-8000-000000000003' }, 'x')).statusCode).toBe(
      404,
    );
  });

  it('refuses a token not scoped to administer', async () => {
    const held = await made('component', 'Token procedure');
    const issue = async (scopes: string[]) =>
      (
        await call('POST', '/v1/tokens', 'ivy', {
          name: `Scoped ${scopes.join(' ') || 'none'}`,
          scopes,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
      ).json<{ secret: string }>().secret;
    const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
    const editing = await issue(['edit']);
    const refused = await call(
      'POST',
      '/v1/holds',
      'ivy',
      { target: { artifact: held }, reason: 'By token' },
      bearer(editing),
    );
    expect(refused.statusCode, refused.body).toBe(403);
    const administering = await issue(['administer']);
    const allowed = await call(
      'POST',
      '/v1/holds',
      'ivy',
      { target: { artifact: held }, reason: 'By token' },
      bearer(administering),
    );
    expect(allowed.statusCode, allowed.body).toBe(200);
    // Nor is On hold told through a token that may not retire or administer.
    expect(
      (
        await call('GET', `/v1/components/${held}`, 'ivy', undefined, bearer(editing))
      ).json<ComponentView>().onHold,
    ).toBe(false);
  });

  it('says On hold only to whoever may retire it or administer the environment', async () => {
    const held = await made('component', 'Confidential procedure');
    await place({ artifact: held }, 'Confidential matter');
    expect(await component(held, 'ivy')).toMatchObject({ onHold: true, mayHold: true });
    // Ada may retire it, administering its space, but may not place a hold.
    expect(await component(held, 'ada')).toMatchObject({ onHold: true, mayHold: false });
    expect(await component(held, 'grace')).toMatchObject({ onHold: false, mayHold: false });
    const manual = await made('document', 'Confidential manual');
    await place({ artifact: manual }, 'Confidential matter');
    const document = async (who: string) =>
      (await call('GET', `/v1/documents/${manual}`, who)).json<DocumentView>();
    expect(await document('ivy')).toMatchObject({ onHold: true, mayHold: true });
    expect(await document('ada')).toMatchObject({ onHold: true, mayHold: false });
    expect(await document('grace')).toMatchObject({ onHold: false, mayHold: false });
  });

  it('LIF-057 records hold.applied and hold.removed, and the reason nowhere but the holds routes', async () => {
    const word = 'zebrafinch';
    const held = await made('component', 'Audited procedure');
    const hold = (await place({ artifact: held }, `Matter ${word}`)).json<HoldView>();
    await call('POST', `/v1/holds/${hold.id}/release`, 'ivy', { reason: `Closed ${word}` });
    const events = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'actor', 'subject_kind', 'space', 'detail'])
        .where('subject', '=', held)
        .where('kind', 'like', 'hold.%')
        .orderBy('sequence')
        .execute(),
    );
    const about = { actor: ids.ivy, subject_kind: 'component', space: clinical };
    expect(events).toEqual([
      { kind: 'hold.applied', ...about, detail: { hold: hold.id } },
      { kind: 'hold.removed', ...about, detail: { hold: hold.id } },
    ]);
    // Read by everything else that answers about it, by the one who placed it.
    for (const url of [
      `/v1/components/${held}`,
      `/v1/components?spaces=${clinical}&limit=100`,
      `/v1/audit?limit=100`,
      `/v1/search?q=${word}`,
    ]) {
      const answer = await call('GET', url, 'ivy');
      expect(answer.statusCode, url).toBe(200);
      expect(answer.body, url).not.toContain(word);
    }
    expect((await call('GET', '/v1/holds?limit=100', 'ivy')).body).toContain(word);
  });
});
