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

/** Reads frames off a live stream, and gives up rather than hanging for ever. */
async function framesFrom(url: string, cookie: string, wanted: number, within = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), within);
  const response = await fetch(url, {
    headers: { cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  const frames: { event: string; data: unknown }[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (frames.length < wanted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (event && data) frames.push({ event, data: JSON.parse(data) });
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { frames, contentType: response.headers.get('content-type') };
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
          else await holding;
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
    const { frames, contentType } = await framesFrom(`${address}/v1/stream`, cookie, 1);
    expect(contentType).toContain('text/event-stream');
    expect(frames[0]?.event).toBe('snapshot');
    expect((frames[0]?.data as { samples: { id: string }[] }).samples.map((s) => s.id)).toContain(
      id,
    );
  });

  it('then says what happens', async () => {
    const id = await sampleIn(production);
    const reading = framesFrom(`${address}/v1/stream`, cookie, 2);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await announce(production, id);
    const { frames } = await reading;
    expect(frames[1]).toEqual({ event: 'sample', data: { kind: 'sample', id, state: 'done' } });
  });

  it("hears another environment's events not at all", async () => {
    const mine = await sampleIn(production);
    const theirs = await sampleIn(development);
    const reading = framesFrom(`${address}/v1/stream`, cookie, 2);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await announce(development, theirs);
    await announce(production, mine);
    const { frames } = await reading;
    expect(frames[1]).toMatchObject({ data: { id: mine } });
  });

  it('loses nothing that happens while its snapshot is being read', async () => {
    // The ordering the realtime spike paid for: an event that commits while the snapshot is being
    // read must arrive after it, not before it and then be undone by older state (ADR-0018).
    const id = await sampleIn(production);
    let release = () => {};
    letThrough = 1;
    holding = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = framesFrom(`${slowAddress}/v1/stream`, cookie, 2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await announce(production, id);
    release();
    holding = undefined;
    const { frames } = await reading;
    expect(frames[0]?.event).toBe('snapshot');
    expect(frames[1]).toEqual({ event: 'sample', data: { kind: 'sample', id, state: 'done' } });
  });

  it('is refused without a session', async () => {
    const response = await fetch(`${address}/v1/stream`);
    expect(response.status).toBe(401);
  });
});
