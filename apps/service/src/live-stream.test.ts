import { streamEvents, type StreamEventName } from '@alloy-works/api-contract';
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
import { openStream, type Frame } from './test/frames.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER_SESSION = '22222222-2222-4222-8222-222222222222';

/** Every frame a stream sends parses against the protocol's own schema for its event (API-015). */
function conforms(frame: Frame): Frame {
  const event = streamEvents[frame.event as StreamEventName];
  expect(event, `an event the protocol names: ${frame.event}`).toBeDefined();
  expect(event.schema.safeParse(frame.data).success, `${frame.event} as the protocol says`).toBe(
    true,
  );
  return frame;
}

describe("a document's stream: its locks and outline, to whoever may read them (the PL plan)", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let events: TenantListener;
  let app: FastifyInstance;
  let short: FastifyInstance;
  let address = '';
  let shortAddress = '';
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let open = '';
  let closed = '';
  let report = '';
  let clinical = '';
  let restricted = '';

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    who: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[who]! },
      ...(payload ? { payload } : {}),
    });
  const stream = (who: string, query: string, at = address) =>
    openStream(`${at}/v1/stream${query}`, cookies[who]!);
  /** The next frame of the kinds asked for, every frame on the way checked against the protocol. */
  const nextOf = async (opened: ReturnType<typeof stream>, ...kinds: string[]) => {
    for (;;) {
      const frame = conforms(await opened.next());
      if (kinds.includes(frame.event)) return frame;
    }
  };
  const claim = (who: string, component: string, session = SESSION) =>
    call('POST', `/v1/components/${component}/lock`, who, { session });
  /** Let go of a lock, cutting nothing, from the version it was opened at. */
  const release = async (who: string, component: string, session = SESSION) => {
    const opened = (await call('GET', `/v1/components/${component}`, who)).json<{
      version: { id: string };
    }>();
    return call(
      'DELETE',
      `/v1/components/${component}/lock?session=${session}&openedFrom=${opened.version.id}`,
      who,
    );
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
    const options = {
      db: tenantDb,
      logLevel: 'silent' as const,
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
      events,
    };
    app = buildApp(options);
    short = buildApp({ ...options, streamLifetimeMs: 300 });
    for (const who of ['ada', 'grace']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    // Ada authors in Clinical and Restricted; Grace reads Clinical alone.
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      restricted = (await createSpace(trx, 'Restricted')).id;
      const author = (await findRole(trx, 'Author'))!.id;
      const reader = (await findRole(trx, 'Reader'))!.id;
      for (const space of [clinical, restricted]) {
        await grant(trx, {
          roleId: author,
          subject: { principal: ids.ada! },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
      }
      await grant(trx, {
        roleId: reader,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
    const made = async (space: string, title: string) => {
      const answer = await call('POST', `/v1/spaces/${space}/components`, 'ada', {
        title,
        language: 'en-GB',
        direction: 'ltr',
      });
      expect(answer.statusCode, answer.body).toBe(200);
      return answer.json<{ id: string }>().id;
    };
    open = await made(clinical, 'Dosing');
    closed = await made(restricted, 'Trial codes');
    const document = await call('POST', `/v1/spaces/${clinical}/documents`, 'ada', {
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(document.statusCode, document.body).toBe(200);
    const created = document.json<{ id: string; version: { id: string } }>();
    report = created.id;
    let openedFrom = created.version.id;
    for (const component of [open, closed]) {
      const placed = await call('POST', `/v1/documents/${report}/outline`, 'ada', {
        openedFrom,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'reference', component, mode: { kind: 'latest' } },
        },
      });
      expect(placed.statusCode, placed.body).toBe(200);
      openedFrom = placed.json<{ version: { id: string } }>().version.id;
    }
    address = await app.listen({ port: 0, host: HOST });
    shortAddress = await short.listen({ port: 0, host: HOST });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await short.close();
    await events.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('COL-007 tells everyone in a document who holds a component and until when, as it is claimed and released, and nobody who may not read it', async () => {
    const graces = stream('grace', `?document=${report}`);
    const adas = stream('ada', `?document=${report}`);
    try {
      expect((await nextOf(graces, 'snapshot')).data).toEqual({ locks: [], presence: [] });
      expect((await nextOf(adas, 'snapshot')).data).toEqual({ locks: [], presence: [] });

      // A lock Grace may not read reaches Ada alone.
      expect((await claim('ada', closed)).statusCode).toBe(200);
      expect((await nextOf(adas, 'lock')).data).toMatchObject({
        component: closed,
        holder: { id: ids.ada, name: 'Ada' },
      });

      expect((await claim('ada', open)).statusCode).toBe(200);
      const held = await nextOf(graces, 'lock');
      expect(held.data).toEqual({
        component: open,
        holder: { id: ids.ada, name: 'Ada' },
        expectedRelease: expect.any(String),
        taking: null,
      });
      expect((await nextOf(adas, 'lock')).data).toMatchObject({ component: open });

      // Released, by cutting nothing and letting go.
      const released = await release('ada', open);
      expect(released.statusCode, released.body).toBeLessThan(300);
      expect((await nextOf(graces, 'lock')).data).toEqual({
        component: open,
        holder: null,
        expectedRelease: null,
        taking: null,
      });

      // A stream opened now begins where things stand: Restricted's lock is Ada's to see.
      const later = stream('grace', `?document=${report}`);
      const adaLater = stream('ada', `?document=${report}`);
      try {
        expect((await nextOf(later, 'snapshot')).data).toEqual({ locks: [], presence: [] });
        expect((await nextOf(adaLater, 'snapshot')).data).toEqual({
          locks: [expect.objectContaining({ component: closed })],
          presence: [],
        });
      } finally {
        later.close();
        adaLater.close();
      }
    } finally {
      graces.close();
      adas.close();
      await release('ada', closed);
    }
  });

  it("COL-007 tells a component's own stream of its lock, and never the environment's stream", async () => {
    const own = stream('grace', `?component=${open}`);
    const environment = stream('grace', '');
    try {
      await nextOf(own, 'snapshot');
      await nextOf(environment, 'snapshot');
      expect((await claim('ada', open, OTHER_SESSION)).statusCode).toBe(200);
      expect((await nextOf(own, 'lock')).data).toMatchObject({ component: open });
      await expect(environment.next(500)).rejects.toThrow(/no frame/);
    } finally {
      own.close();
      environment.close();
      await release('ada', open, OTHER_SESSION);
    }
  });

  it('answers a scope the viewer may not read as nothing there, and a malformed one as refused', async () => {
    const refused = async (query: string) =>
      (
        await app.inject({
          url: `/v1/stream${query}`,
          headers: { host: HOST, cookie: cookies.grace! },
        })
      ).statusCode;
    expect(await refused(`?component=${closed}`)).toBe(404);
    expect(await refused('?document=00000000-0000-4000-8000-000000000000')).toBe(404);
    expect(await refused(`?document=${report}&component=${open}`)).toBe(400);
  });

  it('API-016 ends every stream when access changes, so it is opened again and authorised afresh', async () => {
    const graces = stream('grace', `?document=${report}`);
    try {
      await nextOf(graces, 'snapshot');
      await tenantDb.withTenant(tenant, async (trx) =>
        grant(trx, {
          roleId: (await findRole(trx, 'Reviewer'))!.id,
          subject: { principal: ids.grace! },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          grantedBy: ids.ada!,
        }),
      );
      expect((await nextOf(graces, 'permissions')).data).toEqual({});
      await graces.ended;
    } finally {
      graces.close();
    }
  });

  it('API-016 ends a stream after its lifetime, so a grant lapsing by the clock reaches it too', async () => {
    const graces = stream('grace', `?document=${report}`, shortAddress);
    try {
      await nextOf(graces, 'snapshot');
      await graces.ended;
    } finally {
      graces.close();
    }
  });

  it("tells a document's stream its outline changed", async () => {
    const graces = stream('grace', `?document=${report}`);
    try {
      await nextOf(graces, 'snapshot');
      const current = (await call('GET', `/v1/documents/${report}`, 'ada')).json<{
        version: { id: string };
      }>();
      const moved = await call('POST', `/v1/documents/${report}/outline`, 'ada', {
        openedFrom: current.version.id,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: {
            type: 'section',
            title: [{ type: 'text', value: 'Scope', marks: [] }],
          },
        },
      });
      expect(moved.statusCode, moved.body).toBe(200);
      expect((await nextOf(graces, 'outline')).data).toEqual({ document: report });
    } finally {
      graces.close();
    }
  });

  describe('presence: who else is in a document, where and doing what', () => {
    const ADA_WINDOW = '44444444-4444-4444-8444-444444444444';
    const beat = (who: string, viewer: string, component: string | null, mode = 'author') =>
      call('PUT', '/v1/presence', who, { viewer, document: report, component, mode });

    it("COL-001 COL-002 shows everyone in a document each person, the component they are in and what they are doing, from their window's beat", async () => {
      const graces = stream('grace', `?document=${report}`);
      try {
        await nextOf(graces, 'snapshot');
        expect((await beat('ada', ADA_WINDOW, open)).statusCode).toBe(204);
        expect((await nextOf(graces, 'presence')).data).toEqual({
          viewer: ADA_WINDOW,
          person: { id: ids.ada, name: 'Ada' },
          component: open,
          mode: 'author',
          beatAt: expect.any(String),
        });
        // A stream opened now begins with Ada there.
        const later = stream('grace', `?document=${report}`);
        try {
          expect((await nextOf(later, 'snapshot')).data).toMatchObject({
            presence: [expect.objectContaining({ viewer: ADA_WINDOW, component: open })],
          });
        } finally {
          later.close();
        }
      } finally {
        graces.close();
        await call('DELETE', `/v1/presence/${ADA_WINDOW}`, 'ada');
      }
    });

    it('COL-003 shows somebody in a component the viewer may not read as in the document alone', async () => {
      const graces = stream('grace', `?document=${report}`);
      try {
        await nextOf(graces, 'snapshot');
        expect((await beat('ada', ADA_WINDOW, closed, 'review')).statusCode).toBe(204);
        expect((await nextOf(graces, 'presence')).data).toMatchObject({
          viewer: ADA_WINDOW,
          component: null,
          mode: null,
        });
      } finally {
        graces.close();
        await call('DELETE', `/v1/presence/${ADA_WINDOW}`, 'ada');
      }
    });

    it('COL-004 shows a window absent the moment its stream drops, never as still there', async () => {
      const graces = stream('grace', `?document=${report}`);
      const adas = stream('ada', `?document=${report}&viewer=${ADA_WINDOW}`);
      try {
        await nextOf(graces, 'snapshot');
        await nextOf(adas, 'snapshot');
        expect((await beat('ada', ADA_WINDOW, null, 'read')).statusCode).toBe(204);
        await nextOf(graces, 'presence');
        adas.close();
        expect((await nextOf(graces, 'presence_left')).data).toEqual({ viewer: ADA_WINDOW });
      } finally {
        graces.close();
        adas.close();
      }
    });

    it('COL-055 carries when each window last beat, and shows none silent past a minute', async () => {
      expect((await beat('ada', ADA_WINDOW, open)).statusCode).toBe(204);
      await tenantDb.withTenant(tenant, (trx) =>
        trx
          .updateTable('presence')
          .set({ beat_at: new Date(Date.now() - 61_000) })
          .where('viewer', '=', ADA_WINDOW)
          .execute(),
      );
      const graces = stream('grace', `?document=${report}`);
      try {
        expect(
          ((await nextOf(graces, 'snapshot')).data as { presence: unknown[] }).presence,
        ).toEqual([]);
      } finally {
        graces.close();
        await call('DELETE', `/v1/presence/${ADA_WINDOW}`, 'ada');
      }
    });

    it("refuses a beat for a document or component the person may not read, and for another person's window", async () => {
      expect((await beat('grace', ADA_WINDOW, closed)).statusCode).toBe(404);
      expect(
        (
          await call('PUT', '/v1/presence', 'grace', {
            viewer: ADA_WINDOW,
            document: '00000000-0000-4000-8000-000000000000',
            component: null,
            mode: 'read',
          })
        ).statusCode,
      ).toBe(404);
      expect((await beat('ada', ADA_WINDOW, open)).statusCode).toBe(204);
      expect((await beat('grace', ADA_WINDOW, open, 'read')).statusCode).toBe(404);
      await call('DELETE', `/v1/presence/${ADA_WINDOW}`, 'ada');
    });
  });
});
