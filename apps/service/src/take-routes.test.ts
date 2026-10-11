import {
  bootstrapCluster,
  createSpace,
  createTenant,
  findRole,
  grant,
  listenToTenants,
  migrate,
  type Tenant,
  type TenantDatabase,
  type TenantListener,
} from '@alloy-works/db';
import {
  auditEvents,
  freshDatabase,
  newestEvent,
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
import { openStream } from './test/frames.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const ADAS = '11111111-1111-4111-8111-111111111111';
const GRACES = '22222222-2222-4222-8222-222222222222';

interface Lock {
  holder: { id: string; name: string | null };
  taking: { by: { id: string; name: string | null }; until: string } | null;
  takeableAt: string;
}

describe('taking a lock from an idle holder (collaboration.md, Taking)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let events: TenantListener;
  let app: FastifyInstance;
  let address = '';
  let tenant: Tenant;
  let clinical = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, who: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[who]! },
      ...(payload ? { payload } : {}),
    });

  /** A component Ada holds and has left idle for six minutes, past the take period of five. */
  const heldIdle = async () => {
    const made = await call('POST', `/v1/spaces/${clinical}/components`, 'ada', {
      title: `Dosing ${Math.random()}`,
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(made.statusCode, made.body).toBe(200);
    const component = made.json<{ id: string; version: { id: string } }>();
    expect(
      (await call('POST', `/v1/components/${component.id}/lock`, 'ada', { session: ADAS }))
        .statusCode,
    ).toBe(200);
    await tenantDb.withTenant(tenant, (trx) =>
      trx
        .updateTable('component_lock')
        .set({
          claimed_at: new Date(Date.now() - 7 * 60_000),
          active_at: new Date(Date.now() - 6 * 60_000),
        })
        .where('artifact_id', '=', component.id)
        .execute(),
    );
    return component;
  };
  const take = (component: string) =>
    call('POST', `/v1/components/${component}/lock/take`, 'grace', { session: GRACES });
  const graceOver = (component: string) =>
    tenantDb.withTenant(tenant, (trx) =>
      trx
        .updateTable('component_lock')
        .set({ taking_until: new Date(Date.now() - 1000) })
        .where('artifact_id', '=', component)
        .execute(),
    );
  const saveAsAda = (component: { id: string; version: { id: string } }, sequence: number) =>
    call('PUT', `/v1/components/${component.id}/iterations/${ADAS}/${sequence}`, 'ada', {
      openedFrom: component.version.id,
      content: {
        schemaVersion: 1,
        title: 'Dosing',
        language: 'en-GB',
        direction: 'ltr',
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [{ type: 'text', value: `Draft ${sequence}`, marks: [] }],
          },
        ],
      },
    });

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
    events = listenToTenants(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
      events,
    });
    for (const who of ['ada', 'grace']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      const author = (await findRole(trx, 'Author'))!.id;
      for (const who of ['ada', 'grace']) {
        await grant(trx, {
          roleId: author,
          subject: { principal: ids[who]! },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
      }
    });
    address = await app.listen({ port: 0, host: HOST });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await events.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('COL-046 refuses to ask for a lock whose holder has been working within the take period', async () => {
    const component = await heldIdle();
    await tenantDb.withTenant(tenant, (trx) =>
      trx
        .updateTable('component_lock')
        .set({ active_at: new Date() })
        .where('artifact_id', '=', component.id)
        .execute(),
    );
    const answer = await take(component.id);
    expect(answer.statusCode).toBe(409);
    expect(answer.json()).toMatchObject({ code: 'lock_active', takeableAt: expect.any(String) });
  });

  it('COL-047 warns the holder at once on their own stream, and keeps it theirs when they work in the grace; never taken at the first ask', async () => {
    const component = await heldIdle();
    const adas = openStream(`${address}/v1/stream?component=${component.id}`, cookies.ada!);
    try {
      expect((await adas.next()).event).toBe('snapshot');
      const asked = await take(component.id);
      expect(asked.statusCode, asked.body).toBe(200);
      expect(asked.json()).toMatchObject({
        taken: false,
        lock: { holder: { id: ids.ada }, taking: { by: { id: ids.grace, name: 'Grace' } } },
      });
      const heard = await adas.next();
      expect(heard).toMatchObject({
        event: 'lock',
        data: { holder: { id: ids.ada }, taking: { by: { id: ids.grace } } },
      });
      expect((await saveAsAda(component, 1)).statusCode).toBe(200);
      const kept = (await call('GET', `/v1/components/${component.id}`, 'grace')).json<{
        lock: Lock;
      }>();
      expect(kept.lock).toMatchObject({ holder: { id: ids.ada }, taking: null });
    } finally {
      adas.close();
    }
  });

  it('COL-009 COL-045 takes it once the grace passes with the holder idle, records whom from, and tells the holder at once and at their next save', async () => {
    const component = await heldIdle();
    const before = await tenantDb.withTenant(tenant, newestEvent);
    expect((await take(component.id)).json()).toMatchObject({ taken: false });
    await graceOver(component.id);
    const adas = openStream(`${address}/v1/stream?component=${component.id}`, cookies.ada!);
    try {
      expect((await adas.next()).event).toBe('snapshot');
      const taken = await take(component.id);
      expect(taken.statusCode, taken.body).toBe(200);
      expect(taken.json()).toMatchObject({
        taken: true,
        lock: { holder: { id: ids.grace }, yours: true, session: GRACES },
      });
      expect(await adas.next()).toMatchObject({
        event: 'lock',
        data: { holder: { id: ids.grace, name: 'Grace' } },
      });
    } finally {
      adas.close();
    }
    const refused = await saveAsAda(component, 1);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({
      code: 'lock_taken',
      holder: { id: ids.grace, name: 'Grace' },
    });
    const recorded = await tenantDb.withTenant(tenant, (trx) => auditEvents(trx, before));
    expect(recorded.filter((event) => event.kind === 'lock.taken')).toEqual([
      expect.objectContaining({
        actor: ids.grace,
        subject: component.id,
        detail: { from: ids.ada, session: ADAS },
      }),
    ]);
  });
});
