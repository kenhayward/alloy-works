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
import { STREAM_RETRY_MS } from './stream.js';
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

  it('reads its snapshot only once it is heard, so a sample finishing in between is not lost', async () => {
    // Postgres hears nothing on a channel until its LISTEN has landed. This listener stretches that
    // moment for as long as the test likes: until the gate opens, an announcement reaches nobody,
    // exactly as one committed before the LISTEN would reach nobody.
    let gateOpen = false;
    let openGate = () => {};
    const opened = new Promise<void>((resolve) => {
      openGate = () => {
        gateOpen = true;
        resolve();
      };
    });
    let askedForReady = () => {};
    const waitedOn = new Promise<'waiting'>((resolve) => {
      askedForReady = () => resolve('waiting');
    });
    // An announcement that arrived while the gate was shut, and so reached nobody.
    let lost = () => {};
    const unheard = new Promise<void>((resolve) => {
      lost = resolve;
    });
    let underneath: Promise<void> = new Promise(() => {});
    const gated: TenantListener = {
      ...events,
      subscribe(tenantId, handler) {
        const real = events.subscribe(tenantId, (event) => {
          if (gateOpen) handler(event);
          else lost();
        });
        underneath = real.ready;
        const ready = Promise.all([real.ready, opened]).then(() => undefined);
        return {
          stop: real.stop,
          get ready() {
            askedForReady();
            return ready;
          },
        };
      },
    };
    // Its reads go through, but the snapshot's answer is kept back once it has been read, so the
    // sample can finish after the snapshot was taken.
    let reads = 0;
    let snapshotTaken = () => {};
    const taken = new Promise<'read'>((resolve) => {
      snapshotTaken = () => resolve('read');
    });
    let sendSnapshot = () => {};
    const sending = new Promise<void>((resolve) => {
      sendSnapshot = resolve;
    });
    const reading: TenantDatabase = {
      ...tenantDb,
      async withTenant(tenant, work) {
        const result = await tenantDb.withTenant(tenant, work);
        // The session, then the snapshot.
        if ((reads += 1) === 2) {
          snapshotTaken();
          await sending;
        }
        return result;
      },
    };
    const gatedApp = buildApp({
      db: reading,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
      events: gated,
    });
    const gatedAddress = await gatedApp.listen({ port: 0, host: '127.0.0.1' });
    const id = await sampleIn(production);
    const stream = openStream(`${gatedAddress}/v1/stream`, cookie);
    try {
      // Whichever comes first: a stream that reads before it is heard, or one waiting to be heard.
      await Promise.race([taken, waitedOn]);
      // The real channel is heard, so the announcement is sure to arrive - and be shut out.
      await underneath;
      await tenantDb.withTenant(production, async (trx) => {
        await trx
          .updateTable('sample')
          .set({ state: 'failed', finished_at: new Date() })
          .where('id', '=', id)
          .execute();
        await notifyTenant(trx, { kind: 'sample', id, state: 'failed' });
      });
      await unheard;
      openGate();
      sendSnapshot();
      const snapshot = await stream.next();
      expect(snapshot.event).toBe('snapshot');
      const told = (snapshot.data as { samples: { id: string; state: string }[] }).samples.find(
        (sample) => sample.id === id,
      )?.state;
      // Told by its snapshot, or failing that by an event after it - but told.
      if (told !== 'failed') {
        expect(await stream.next()).toEqual({
          event: 'sample',
          data: { kind: 'sample', id, state: 'failed' },
        });
      }
    } finally {
      stream.close();
      await gatedApp.close();
    }
  });

  it('ends, for the browser to come back, when it cannot be heard', async () => {
    const unheard: TenantListener = {
      ...events,
      subscribe(tenantId, handler) {
        const real = events.subscribe(tenantId, handler);
        const refused = Promise.reject(new Error('The database cannot be reached'));
        // Handled here as well, so the rejection is not reported before the stream waits on it.
        refused.catch(() => {});
        return { stop: real.stop, ready: refused };
      },
    };
    const unheardApp = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
      events: unheard,
    });
    const unheardAddress = await unheardApp.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();
    try {
      const response = await fetch(`${unheardAddress}/v1/stream`, {
        headers: { cookie, accept: 'text/event-stream' },
        signal: controller.signal,
      });
      const ended = await Promise.race([
        response.text(),
        new Promise<'still open'>((resolve) => setTimeout(() => resolve('still open'), 10_000)),
      ]);
      // It says when to come back, and nothing that would stand still.
      expect(ended).toBe(`retry: ${STREAM_RETRY_MS}\n\n`);
    } finally {
      controller.abort();
      await unheardApp.close();
    }
  });

  it('is refused without a session', async () => {
    const response = await fetch(`${address}/v1/stream`);
    expect(response.status).toBe(401);
  });
});
