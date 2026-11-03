import {
  bootstrapCluster,
  createRole,
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

describe('moving content between spaces, over HTTP (moving.md)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let production: Tenant;
  let open = '';
  let closed = '';
  let elsewhere = '';
  const cookies: Record<string, string> = {};

  const call = (headers: Record<string, string>, url: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url, headers: { host: HOST, ...headers }, payload });
  const as = (who: string) => ({ cookie: cookies[who]! });

  /** A component in the open space, made by Ada, who authors there. */
  const component = async () => {
    const made = await call(as('ada'), `/v1/spaces/${open}/components`, {
      title: 'A part',
      language: 'en-GB',
      direction: 'ltr',
      markdown: 'Set the tray, then wait.',
    });
    expect(made.statusCode, made.body).toBe(200);
    return made.json<{ id: string }>().id;
  };
  const moving = (who: string | Record<string, string>, id: string, to = closed, from = open) =>
    call(typeof who === 'string' ? as(who) : who, `/v1/artifacts/${id}/move`, {
      from,
      to,
      also: false,
    });

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const users = ['ada', 'grace', 'ivy', 'nell', 'reader'];
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
        },
      ],
      users: users.map((id) => ({ id, name: id, email: `${id}@example.com` })),
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
    const ids: Record<string, string> = {};
    for (const user of users) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (
        await app.inject({ method: 'GET', url: '/v1/me', headers: { host: HOST, ...as(user) } })
      ).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(production, async (trx) => {
      open = (await trx.selectFrom('space').select('id').executeTakeFirstOrThrow()).id;
      const space = async (name: string) =>
        (await trx.insertInto('space').values({ name }).returning('id').executeTakeFirstOrThrow())
          .id;
      closed = await space('Closed');
      elsewhere = await space('Elsewhere');
      const author = (await findRole(trx, 'Author'))!;
      const administrator = (await findRole(trx, 'Administrator'))!;
      const allow = (who: string, roleId: string, id: string) =>
        grant(trx, {
          subject: { principal: ids[who]! },
          roleId,
          level: { kind: 'space', id },
          effect: 'allow',
          grantedBy: ids['grace']!,
        });
      // Ada authors in the open space and may not administer anywhere; Grace administers both ends
      // and creates in neither; Ivy administers the open space and authors in the closed one; Nell
      // administers the open space and can only read the elsewhere one.
      await allow('ada', author.id, open);
      await allow('ada', author.id, closed);
      await allow('grace', administrator.id, open);
      await allow('grace', administrator.id, closed);
      await allow('ivy', administrator.id, open);
      await allow('ivy', author.id, closed);
      await allow('nell', administrator.id, open);
      const reader = await createRole(trx, 'Looks', ['read']);
      if (!('role' in reader)) throw new Error(reader.refused);
      await allow('nell', reader.role.id, elsewhere);
      await allow('reader', reader.role.id, open);
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('IAM-015 an Administrator without create at the target may move there; an Author may not move at all', async () => {
    const part = await component();
    const refused = await moving('ada', part);
    expect(refused.statusCode, refused.body).toBe(403);
    const moved = await moving('grace', part);
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({ changed: true, moved: [part], grantsEnded: 0 });
    const again = await moving('grace', part, closed, closed);
    expect(again.json()).toMatchObject({ changed: false, moved: [] });
  });

  it('IAM-015 an Author at the target may move into it, and one who may only read there is refused', async () => {
    const part = await component();
    expect((await moving('ivy', part)).statusCode).toBe(200);
    const other = await component();
    const refused = await moving('nell', other, elsewhere);
    expect(refused.statusCode, refused.body).toBe(403);
    expect((await moving('nell', other)).statusCode).toBe(404);
  });

  it('IAM-015 a move through a token narrowed by scope is decided on those scopes at both ends', async () => {
    const part = await component();
    const issue = async (scopes: string[]) => {
      const issued = await call(as('grace'), '/v1/tokens', {
        name: `Move ${scopes.join(' ')}`,
        scopes,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(issued.statusCode, issued.body).toBe(200);
      return { authorization: `Bearer ${issued.json<{ secret: string }>().secret}` };
    };
    const reading = await moving(await issue(['edit']), part);
    expect(reading.statusCode, reading.body).toBe(403);
    const moved = await moving(await issue(['administer']), part);
    expect(moved.statusCode, moved.body).toBe(200);
  });

  it('COL-069 one who lost the component sees the flag on the withheld part and no thread; one who kept it sees the thread standing', async () => {
    const part = await component();
    const made = await call(as('ada'), `/v1/spaces/${open}/documents`, {
      title: 'The report',
      language: 'en-GB',
      direction: 'ltr',
    });
    expect(made.statusCode, made.body).toBe(200);
    const document = made.json<{ id: string; version: { id: string } }>();
    const placed = await call(as('ada'), `/v1/documents/${document.id}/outline`, {
      openedFrom: document.version.id,
      operation: {
        operation: 'insert',
        parent: null,
        position: 0,
        node: { type: 'reference', component: part, mode: { kind: 'latest' } },
      },
    });
    expect(placed.statusCode, placed.body).toBe(200);
    const node = placed.json<{ outline: { nodes: { id: string }[] } }>().outline.nodes[0]!.id;
    const view = (
      await app.inject({
        method: 'GET',
        url: `/v1/components/${part}`,
        headers: { host: HOST, ...as('ada') },
      })
    ).json<{ version: { id: string }; content: { content: { id: string }[] } }>();
    const started = await call(as('ada'), `/v1/components/${part}/threads`, {
      version: view.version.id,
      anchor: {
        kind: 'span',
        block: view.content.content[0]!.id,
        quote: 'the tray',
        before: 'Set ',
      },
      parts: [{ text: 'Is this right?' }],
    });
    expect(started.statusCode, started.body).toBe(200);
    const look = (who: string, url: string) =>
      app.inject({ method: 'GET', url, headers: { host: HOST, ...as(who) } });
    expect(
      (await look('reader', `/v1/documents/${document.id}`)).json<{ movedParts: string[] }>()
        .movedParts,
    ).toEqual([]);
    expect((await moving('grace', part)).statusCode).toBe(200);

    const lost = (await look('reader', `/v1/documents/${document.id}`)).json<{
      movedParts: string[];
      outline: { nodes: { component: string | null }[] };
    }>();
    expect(lost.movedParts).toEqual([node]);
    expect(lost.outline.nodes[0]!.component).toBeNull();
    const unlisted = await look('reader', `/v1/documents/${document.id}/threads`);
    expect(JSON.stringify(unlisted.json())).not.toContain('Is this right?');

    const kept = await look('ada', `/v1/components/${part}/threads`);
    expect(kept.statusCode, kept.body).toBe(200);
    expect(JSON.stringify(kept.json())).toContain('Is this right?');
    expect(
      (await look('ada', `/v1/documents/${document.id}`)).json<{ movedParts: string[] }>()
        .movedParts,
    ).toEqual([]);
  });

  it('says which spaces the caller may move into', async () => {
    const answer = await app.inject({
      method: 'GET',
      url: '/v1/spaces?limit=100',
      headers: { host: HOST, ...as('nell') },
    });
    const items = answer.json<{ items: { id: string; mayMoveInto: boolean }[] }>().items;
    expect(items.find((each) => each.id === open)?.mayMoveInto).toBe(true);
    expect(items.find((each) => each.id === elsewhere)?.mayMoveInto).toBe(false);
  });

  it('answers a preview without moving anything, and refuses a stale from or the archived target', async () => {
    const part = await component();
    const preview = await call(as('grace'), `/v1/artifacts/${part}/move/preview`, {
      from: open,
      to: closed,
      also: false,
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({
      changed: true,
      moved: [part],
      consequences: { citations: 0, openRounds: 0 },
    });
    const stale = await moving('grace', part, open, closed);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'space_moved' });
  });
});
