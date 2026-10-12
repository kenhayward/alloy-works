import type { InboxPreferences, InboxView, ThreadView } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createComponent,
  createSpace,
  createTenant,
  findRole,
  grant,
  migrate,
  recordVersion,
  substanceOf,
  type StoredVersion,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import type { BlockNode, ContentDocument } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const text = (value: string) => ({ type: 'text' as const, value, marks: [] });
const para = (id: string, value: string): BlockNode => ({
  type: 'paragraph',
  id,
  style: 'body',
  content: [text(value)],
});

describe('the inbox over HTTP (collaboration.md, The inbox)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  let quality = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

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

  /** A component in a space, by its author, at a version holding these blocks. */
  const component = (blocks: BlockNode[], space = clinical, author = 'ada') =>
    tenantDb
      .withTenant(tenant, async (trx) => {
        const made = await createComponent(trx, {
          spaceId: space,
          title: 'Install the printer',
          language: 'en-GB',
          direction: 'ltr',
          author: ids[author]!,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        return made.version;
      })
      .then((made) => revise(made, blocks, author));
  const revise = (version: StoredVersion, blocks: BlockNode[], author = 'ada') =>
    tenantDb.withTenant(tenant, async (trx) => {
      const substance = substanceOf(version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: version.artifactId,
        openedFrom: version.id,
        author: ids[author]!,
        substance: {
          ...substance,
          content: { ...substance.content, content: blocks } as ContentDocument,
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version;
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
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    for (const who of ['ada', 'grace', 'ivy', 'alice']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const role = async (name: string) => (await findRole(trx, name))!.id;
      // Ada authors Clinical; Grace reviews it and authors Quality, which Ada may not read; Ivy reads
      // Clinical and may not comment.
      for (const [who, name, space] of [
        ['ada', 'Author', clinical],
        ['grace', 'Reviewer', clinical],
        ['grace', 'Author', quality],
        ['ivy', 'Reader', clinical],
      ] as const) {
        await grant(trx, {
          roleId: await role(name),
          subject: { principal: ids[who]! },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ids.ada!,
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

  /** A thread on a fresh Clinical component, by Ada, its comment naming these people. */
  const mentioning = async (...who: string[]) => {
    const version = await component([para('p1', 'Set the tray.')]);
    const started = await call('POST', `/v1/components/${version.artifactId}/threads`, 'ada', {
      version: version.id,
      anchor: { kind: 'component' },
      parts: [{ text: 'Secret words, ' }, ...who.map((name) => ({ mention: ids[name]! }))],
    });
    return { version, thread: started.json<ThreadView>() };
  };
  const inbox = async (who: string, query = '') =>
    (await call('GET', `/v1/inbox${query}`, who)).json<InboxView>();

  it('COL-015 COL-036 tells a person a comment names, by identifiers and a title they may read, never the text, and tells its author who could not be told', async () => {
    const { version, thread } = await mentioning('grace', 'alice');
    expect(thread.untold).toEqual([ids.alice]);
    const listed = await inbox('grace');
    expect(listed.notifications[0]).toMatchObject({
      kind: 'mention',
      actor: { id: ids.ada },
      thread: thread.id,
      on: { id: version.artifactId, title: 'Install the printer' },
      counts: null,
      read: false,
    });
    expect(JSON.stringify(listed)).not.toContain('Secret words');
    expect((await inbox('alice')).notifications).toEqual([]);
  });

  it('COL-063 COL-062 marks read and deletes a person’s own notification, and answers anybody else’s as not there', async () => {
    await mentioning('grace');
    const { notifications, unread } = await inbox('grace');
    const mine = notifications[0]!.id;
    expect((await call('POST', `/v1/inbox/${mine}/read`, 'ada')).statusCode).toBe(404);
    expect((await call('POST', `/v1/inbox/${mine}/read`, 'grace')).statusCode).toBe(204);
    const after = await inbox('grace');
    expect([after.unread, after.notifications[0]!.read]).toEqual([unread - 1, true]);
    expect(
      (await inbox('grace', '?unread=true')).notifications.map((each) => each.id),
    ).not.toContain(mine);
    expect((await call('DELETE', `/v1/inbox/${mine}`, 'ada')).statusCode).toBe(404);
    expect((await call('DELETE', `/v1/inbox/${mine}`, 'grace')).statusCode).toBe(204);
    expect((await inbox('grace')).notifications.map((each) => each.id)).not.toContain(mine);
  });

  it('pages the inbox by a cursor', async () => {
    await mentioning('ivy');
    await mentioning('ivy');
    const first = await inbox('ivy', '?limit=1');
    expect(first.notifications).toHaveLength(1);
    const rest = await inbox('ivy', `?limit=1&cursor=${first.next}`);
    expect(rest.notifications[0]!.id).not.toBe(first.notifications[0]!.id);
    expect((await call('GET', '/v1/inbox?cursor=nonsense', 'ivy')).statusCode).toBe(400);
  });

  it('COL-034 reads and chooses how often each kind is told, the rest left as they were', async () => {
    expect((await call('GET', '/v1/inbox/preferences', 'ivy')).json<InboxPreferences>()).toEqual({
      mention: 'at_once',
      reply: 'at_once',
      resolution: 'daily',
    });
    const set = await call('PUT', '/v1/inbox/preferences', 'ivy', { mention: 'never' });
    expect(set.json<InboxPreferences>()).toEqual({
      mention: 'never',
      reply: 'at_once',
      resolution: 'daily',
    });
    const before = (await inbox('ivy')).notifications.length;
    await mentioning('ivy');
    expect((await inbox('ivy')).notifications).toHaveLength(before);
    expect(
      (await call('PUT', '/v1/inbox/preferences', 'ivy', { mention: 'hourly' })).statusCode,
    ).toBe(400);
  });
});
