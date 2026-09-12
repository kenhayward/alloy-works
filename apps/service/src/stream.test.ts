import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createTenant,
  createTenantDatabase,
  listenToTenants,
  notifyTenant,
  migrate,
  type Tenant,
  type TenantDatabase,
  type TenantListener,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

// Hostnames that resolve to this machine: the stream is read over a real socket, and the hostname
// is what names the environment.
const A = '127.0.0.1';
const B = 'localhost';

interface Frame {
  readonly event: string;
  readonly data: unknown;
}

/**
 * A stream, read frame by frame. Tests wait for the frame they expect rather than for a length of
 * time: a machine busier than this one takes longer to connect, and a sleep would race it.
 */
function openStream(url: string, cookie: string) {
  const controller = new AbortController();
  const arrived: Frame[] = [];
  const waiting: ((frame: Frame) => void)[] = [];
  const deliver = (frame: Frame) => {
    const next = waiting.shift();
    if (next) next(frame);
    else arrived.push(frame);
  };

  const response = fetch(url, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });

  void response
    .then(async (answer) => {
      if (!answer.body) return;
      const reader = answer.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = /^event: (.+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (event && data) deliver({ event, data: JSON.parse(data) });
          boundary = buffer.indexOf('\n\n');
        }
      }
    })
    .catch(() => {
      // The test closes the stream when it is done, which ends the read.
    });

  return {
    response,
    next: (within = 10_000) =>
      new Promise<Frame>((resolve, reject) => {
        const held = arrived.shift();
        if (held) {
          resolve(held);
          return;
        }
        const timer = setTimeout(() => reject(new Error(`no frame within ${within}ms`)), within);
        waiting.push((frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
      }),
    close: () => controller.abort(),
  };
}

describe('what an environment is doing, as it happens', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let events: TenantListener;
  let app: FastifyInstance;
  let address = '';
  let slow: FastifyInstance;
  let slowAddress = '';
  let holding: Promise<void> | undefined;
  /** A stream reads twice: the session, then the snapshot. Only the snapshot is held. */
  let letThrough = 0;
  let onHold: (() => void) | undefined;
  let production: Tenant;
  let development: Tenant;
  let cookie = '';

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [A, B].map((host) => `http://${host}/v1/sign-in/organisation/callback`),
        },
      ],
    });
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [A],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: [B],
    });
    for (const tenant of [production, development]) {
      await configureOrganisationSignIn(db.adminUrl, tenant, {
        issuer: idp.issuer,
        clientId: 'alloy',
        secretName: 'stand_in',
      });
    }
    tenantDb = createTenantDatabase(db.serviceUrl);
    events = listenToTenants(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
      events,
    });
    cookie = await signIn(app, A, 'ada', idp.issuer);
    // A real socket, not inject: a stream is the one thing inject cannot hold open.
    address = await app.listen({ port: 0, host: '127.0.0.1' });
    // The same service, but its reads can be held open, so a test can commit something while a
    // snapshot is being read.
    const held: TenantDatabase = {
      ...tenantDb,
      async withTenant(tenant, work) {
        if (holding) {
          if (letThrough > 0) letThrough -= 1;
          else {
            onHold?.();
            onHold = undefined;
            await holding;
          }
        }
        return tenantDb.withTenant(tenant, work);
      },
    };
    slow = buildApp({
      db: held,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
      events,
    });
    slowAddress = await slow.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await slow.close();
    await app.close();
    await events.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  let people = 0;
  const sampleIn = (tenant: Tenant) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: `someone-${(people += 1)}`,
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sample = await trx
        .insertInto('sample')
        .values({ requested_by: principal.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      return sample.id;
    });

  const announce = (tenant: Tenant, id: string) =>
    tenantDb.withTenant(tenant, (trx) => notifyTenant(trx, { kind: 'sample', id, state: 'done' }));

  it('opens with what there is now', async () => {
    const id = await sampleIn(production);
    const stream = openStream(`${address}/v1/stream`, cookie);
    try {
      const snapshot = await stream.next();
      expect((await stream.response).headers.get('content-type')).toContain('text/event-stream');
      expect(snapshot.event).toBe('snapshot');
      expect((snapshot.data as { samples: { id: string }[] }).samples.map((s) => s.id)).toContain(
        id,
      );
    } finally {
      stream.close();
    }
  });

  it('then says what happens', async () => {
    const id = await sampleIn(production);
    const stream = openStream(`${address}/v1/stream`, cookie);
    try {
      // Its snapshot has arrived, so it is subscribed: what happens now must reach it.
      expect((await stream.next()).event).toBe('snapshot');
      await announce(production, id);
      expect(await stream.next()).toEqual({
        event: 'sample',
        data: { kind: 'sample', id, state: 'done' },
      });
    } finally {
      stream.close();
    }
  });

  it("hears another environment's events not at all", async () => {
    const mine = await sampleIn(production);
    const theirs = await sampleIn(development);
    const stream = openStream(`${address}/v1/stream`, cookie);
    try {
      expect((await stream.next()).event).toBe('snapshot');
      await announce(development, theirs);
      await announce(production, mine);
      // The next frame is this environment's, not the one announced first.
      expect(await stream.next()).toMatchObject({ data: { id: mine } });
    } finally {
      stream.close();
    }
  });

  it('loses nothing that happens while its snapshot is being read', async () => {
    // The ordering the realtime spike paid for: an event that commits while the snapshot is being
    // read must arrive after it, not before it and then be undone by older state (ADR-0018).
    const id = await sampleIn(production);
    let release = () => {};
    let reached = () => {};
    const held = new Promise<void>((resolve) => {
      reached = resolve;
    });
    letThrough = 1;
    onHold = reached;
    holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stream = openStream(`${slowAddress}/v1/stream`, cookie);
    try {
      // Waiting for the read to be held, rather than for a length of time.
      await held;
      await announce(production, id);
      release();
      holding = undefined;
      expect((await stream.next()).event).toBe('snapshot');
      expect(await stream.next()).toEqual({
        event: 'sample',
        data: { kind: 'sample', id, state: 'done' },
      });
    } finally {
      stream.close();
    }
  });

  it('is refused without a session', async () => {
    const response = await fetch(`${address}/v1/stream`);
    expect(response.status).toBe(401);
  });
});
