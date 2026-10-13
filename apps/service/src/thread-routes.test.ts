import type { ThreadList, ThreadView } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createComponent,
  createDocument,
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
import type { BlockNode, ContentDocument, OutlineDocument, OutlineNode } from '@alloy-works/domain';
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
const said = (value: string) => [{ text: value }];
const SPAN = { kind: 'span', block: 'p1', quote: 'the tray', before: 'Set ' };

describe('threads over HTTP (collaboration.md, Threads)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  let quality = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, who: string, payload?: object) =>
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
  const documentWith = (nodes: OutlineNode[]) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createDocument(trx, {
        spaceId: clinical,
        title: 'Report',
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ids.ada!,
        substance: {
          kind: 'document',
          content: { ...(made.version.content as OutlineDocument), nodes },
        },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return recorded.version;
    });
  const reference = (
    id: string,
    to: string,
    mode: OutlineNode extends never
      ? never
      : { kind: 'latest' } | { kind: 'pinned'; version: string },
  ): OutlineNode =>
    ({
      type: 'reference',
      id,
      component: to,
      mode,
      numbered: true,
      matter: 'body',
      pageBreak: 'none',
      values: {},
      children: [],
    }) as OutlineNode;
  const start = (on: StoredVersion, anchor: object, who = 'ada', kind = 'components') =>
    call('POST', `/v1/${kind}/${on.artifactId}/threads`, who, {
      version: on.id,
      anchor,
      parts: said('Is this right?'),
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
    for (const who of ['ada', 'grace', 'ivy']) {
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

  it('COL-012 starts a thread on a span of a component, answered whole, and refuses one that does not stand or one the caller may not comment', async () => {
    const version = await component([para('p1', 'Set the tray, then wait.')]);
    const started = await start(version, SPAN, 'grace');
    expect(started.statusCode).toBe(200);
    expect(started.json<ThreadView>()).toMatchObject({
      on: { id: version.artifactId, kind: 'component' },
      anchor: SPAN,
      madeAgainst: version.id,
      startedBy: { id: ids.grace },
      resolution: null,
      comments: [{ author: { id: ids.grace }, texts: [{ parts: said('Is this right?') }] }],
    });

    const refusal = async (response: Promise<{ statusCode: number; json: () => unknown }>) => {
      const answered = await response;
      return [answered.statusCode, (answered.json() as { code?: string }).code];
    };
    expect(await refusal(start(version, { ...SPAN, quote: 'the lid' }))).toEqual([
      400,
      'anchor_invalid',
    ]);
    expect(await refusal(start(version, { kind: 'margin' }))).toEqual([400, 'anchor_invalid']);
    expect(await refusal(start(version, SPAN, 'ivy'))).toEqual([403, 'forbidden']);
    // A component's id on a document's route is no document.
    expect((await start(version, SPAN, 'ada', 'documents')).statusCode).toBe(404);
    const other = await component([para('p1', 'Set the tray.')]);
    expect(
      await refusal(
        call('POST', `/v1/components/${version.artifactId}/threads`, 'ada', {
          version: other.id,
          anchor: SPAN,
          parts: said('Hm'),
        }),
      ),
    ).toEqual([400, 'version_not_held']);
    expect(
      await refusal(
        call('POST', `/v1/components/${version.artifactId}/threads`, 'ada', {
          version: version.id,
          anchor: SPAN,
          parts: [{ text: 'Hm, ' }, { mention: '00000000-0000-4000-8000-000000000000' }],
        }),
      ),
    ).toEqual([400, 'parts_invalid']);
  });

  it('COL-016 COL-017 keeps a span thread through an edit elsewhere in its block, and lists it orphaned once its text is gone', async () => {
    const version = await component([para('p1', 'Set the tray, then wait.')]);
    const { id } = (await start(version, SPAN)).json<ThreadView>();
    const listed = async () =>
      (await call('GET', `/v1/components/${version.artifactId}/threads`, 'ivy'))
        .json<ThreadList>()
        .threads.find((each) => each.id === id);
    const moved = await revise(version, [
      para('p0', 'First, check.'),
      para('p1', 'Now set the tray.'),
    ]);
    expect(await listed()).toMatchObject({ orphaned: false });
    await revise(moved, [para('p1', 'Set the lid.')]);
    expect(await listed()).toMatchObject({ orphaned: true, comments: 1 });
  });

  it('COL-017 COL-018 places a component’s thread in a document by each occurrence’s own version', async () => {
    const before = await component([para('p1', 'Set the tray, then wait.')]);
    const { id } = (await start(before, SPAN)).json<ThreadView>();
    await revise(before, [para('p1', 'Set the lid.')]);
    const pinned = 'p'.repeat(26);
    const latest = 'l'.repeat(26);
    const document = await documentWith([
      reference(pinned, before.artifactId, { kind: 'pinned', version: before.id }),
      reference(latest, before.artifactId, { kind: 'latest' }),
    ]);
    const node = await start(document, { kind: 'node', node: pinned }, 'ada', 'documents');
    expect(node.statusCode).toBe(200);
    const listed = (
      await call('GET', `/v1/documents/${document.artifactId}/threads`, 'ivy')
    ).json<ThreadList>().threads;
    expect(listed.find((each) => each.id === id)).toMatchObject({
      on: { kind: 'component' },
      orphaned: false,
      places: [
        { node: pinned, orphaned: false },
        { node: latest, orphaned: true },
      ],
    });
    expect(listed.find((each) => each.id === node.json<ThreadView>().id)).toMatchObject({
      on: { kind: 'document' },
      anchor: { kind: 'node', node: pinned },
      orphaned: false,
    });
  });

  it('COL-014 COL-013 keeps replies in order, resolves once with who and when, and then takes nothing more', async () => {
    const version = await component([para('p1', 'Set the tray.')]);
    const { id } = (await start(version, { kind: 'component' })).json<ThreadView>();
    expect(
      (await call('POST', `/v1/threads/${id}/comments`, 'grace', { parts: said('Yes.') }))
        .statusCode,
    ).toBe(200);
    expect(
      (await call('POST', `/v1/threads/${id}/comments`, 'ivy', { parts: said('No.') })).statusCode,
    ).toBe(403);
    const resolved = await call('POST', `/v1/threads/${id}/resolution`, 'grace');
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json<ThreadView>()).toMatchObject({
      resolution: { by: { id: ids.grace, name: expect.any(String) }, at: expect.any(String) },
      comments: [{ author: { id: ids.ada } }, { author: { id: ids.grace } }],
    });
    for (const [method, url, payload] of [
      ['POST', `/v1/threads/${id}/resolution`, undefined],
      ['POST', `/v1/threads/${id}/comments`, { parts: said('And?') }],
    ] as const) {
      const again = await call(method, url, 'ada', payload);
      expect([again.statusCode, again.json<{ code: string }>().code]).toEqual([
        409,
        'thread_resolved',
      ]);
    }
    const list = (state: string) =>
      call('GET', `/v1/components/${version.artifactId}/threads?state=${state}`, 'ada').then(
        (response) => response.json<ThreadList>().threads.map((each) => each.id),
      );
    expect(await list('resolved')).toEqual([id]);
    expect(await list('open')).toEqual([]);
  });

  it('COL-051 keeps every text of a comment its author edits, and refuses anybody else’s edit', async () => {
    const version = await component([para('p1', 'Set the tray.')]);
    const thread = (await start(version, { kind: 'component' })).json<ThreadView>();
    const comment = thread.comments[0]!.id;
    const url = `/v1/threads/${thread.id}/comments/${comment}`;
    const theirs = await call('PUT', url, 'grace', { parts: said('Is this wrong?') });
    expect([theirs.statusCode, theirs.json<{ code: string }>().code]).toEqual([
      403,
      'comment_not_yours',
    ]);
    const edited = await call('PUT', url, 'ada', { parts: said('Is this wrong?') });
    expect(edited.json<ThreadView>().comments[0]!.texts.map((each) => each.parts)).toEqual([
      said('Is this right?'),
      said('Is this wrong?'),
    ]);
    const read = await call('GET', `/v1/threads/${thread.id}`, 'ivy');
    expect(read.json<ThreadView>().comments[0]!.texts).toHaveLength(2);
  });

  it('IAM-081 offers Review to whoever may comment or suggest on a document, and says of each component it places whether they may comment', async () => {
    const placed = await component([para('p1', 'Set the tray.')]);
    const node = 'r'.repeat(26);
    const document = await documentWith([reference(node, placed.artifactId, { kind: 'latest' })]);
    const decided = async (who: string) => {
      const view = (await call('GET', `/v1/documents/${document.artifactId}`, who)).json<{
        mayComment: boolean;
        mayReview: boolean;
      }>();
      const texts = (await call('GET', `/v1/documents/${document.artifactId}/texts`, who)).json<{
        occurrences: { node: string; mayComment: boolean }[];
      }>();
      return [view.mayReview, view.mayComment, texts.occurrences[0]!.mayComment];
    };
    expect(await decided('grace')).toEqual([true, true, true]);
    expect(await decided('ivy')).toEqual([false, false, false]);
  });

  it('answers a thread on a component the caller may not read as not found', async () => {
    const hidden = await component([para('p1', 'Calibrate.')], quality, 'grace');
    const { id } = (await start(hidden, { kind: 'component' }, 'grace')).json<ThreadView>();
    for (const [method, url, payload] of [
      ['GET', `/v1/threads/${id}`, undefined],
      ['POST', `/v1/threads/${id}/comments`, { parts: said('Hm') }],
      ['POST', `/v1/threads/${id}/resolution`, undefined],
      ['GET', `/v1/components/${hidden.artifactId}/threads`, undefined],
    ] as const) {
      expect((await call(method, url, 'ada', payload)).statusCode).toBe(404);
    }
    expect(
      (await call('GET', '/v1/threads/00000000-0000-4000-8000-000000000000', 'ada')).statusCode,
    ).toBe(404);
  });

  it('COL-018 pages a list by a cursor, filtered by who started each', async () => {
    const version = await component([para('p1', 'Set the tray.')]);
    const first = (await start(version, { kind: 'component' }, 'ada')).json<ThreadView>().id;
    const second = (await start(version, { kind: 'component' }, 'grace')).json<ThreadView>().id;
    const url = `/v1/components/${version.artifactId}/threads`;
    const page = (await call('GET', `${url}?limit=1`, 'ivy')).json<ThreadList>();
    expect(page.threads.map((each) => each.id)).toEqual([second]);
    const rest = (
      await call('GET', `${url}?limit=1&cursor=${page.next}`, 'ivy')
    ).json<ThreadList>();
    expect([rest.threads.map((each) => each.id), rest.next]).toEqual([[first], null]);
    const byAda = (await call('GET', `${url}?author=${ids.ada}`, 'ivy')).json<ThreadList>();
    expect(byAda.threads.map((each) => each.id)).toEqual([first]);
    expect((await call('GET', `${url}?cursor=nonsense`, 'ivy')).statusCode).toBe(400);
  });
});
