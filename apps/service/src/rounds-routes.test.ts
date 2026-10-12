import type { RoundView, ThreadList } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createComponent,
  createDocument,
  createSpace,
  createTenant,
  findRole,
  grant,
  makeBaseline,
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

describe('review rounds over HTTP (collaboration.md, Review rounds)', () => {
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

  const due = () => new Date(Date.now() + 7 * 86_400_000).toISOString();
  /** A document placing one component, in Clinical. */
  const documentPlacing = async () => {
    const printer = await component([para('p1', 'Set the tray.')]);
    const node = 'a'.repeat(26);
    const document = await documentWith([reference(node, printer.artifactId, { kind: 'latest' })]);
    return { printer, document, node };
  };
  const open = (document: string, body: object, who = 'ada') =>
    call('POST', `/v1/documents/${document}/rounds`, who, {
      title: 'First review',
      dueAt: due(),
      reviewers: [ids.grace],
      ...body,
    });

  it('COL-028 COL-030 opens a round naming its reviewers, scope and due date, and answers who has reviewed from what each said', async () => {
    const { document, node } = await documentPlacing();
    const opened = await open(document.artifactId, { scope: [node] });
    expect(opened.statusCode, opened.body).toBe(200);
    const round = opened.json<RoundView>();
    expect(round).toMatchObject({
      title: 'First review',
      scope: [node],
      baseline: null,
      madeAgainst: document.id,
      complete: 0,
      of: 1,
      everybody: false,
      mayClose: true,
      reviewing: false,
      reviewers: [{ person: { id: ids.grace }, state: 'not_started', mayReview: true, threads: 0 }],
    });
    // Ivy, who reads it, sees it; nobody who may not read the document finds it.
    expect((await call('GET', `/v1/rounds/${round.id}`, 'ivy')).statusCode).toBe(200);
    const done = await call('POST', `/v1/rounds/${round.id}/completion`, 'grace', {
      outcome: 'nothing_to_say',
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json<RoundView>()).toMatchObject({
      complete: 1,
      of: 1,
      everybody: true,
      reviewers: [{ state: 'complete', outcome: 'nothing_to_say' }],
    });
    const listed = await call('GET', `/v1/documents/${document.artifactId}/rounds`, 'ivy');
    expect(listed.json<{ rounds: RoundView[] }>().rounds.map((each) => each.id)).toEqual([
      round.id,
    ]);
  });

  it('refuses a reviewer who may not review, a section the document lacks, a due date past, and a baseline it does not have', async () => {
    const { document } = await documentPlacing();
    // Ivy reads Clinical but may not comment or suggest.
    const unable = await open(document.artifactId, { reviewers: [ids.grace, ids.ivy] });
    expect(unable.statusCode).toBe(400);
    expect(unable.json()).toMatchObject({ code: 'round_reviewers_invalid', count: 1 });
    expect((await open(document.artifactId, { scope: ['z'.repeat(26)] })).json()).toMatchObject({
      code: 'round_scope_invalid',
      nodes: ['z'.repeat(26)],
    });
    expect(
      (
        await open(document.artifactId, { dueAt: new Date(Date.now() - 60_000).toISOString() })
      ).json(),
    ).toMatchObject({ code: 'round_due_invalid' });
    expect(
      (
        await open(document.artifactId, { baseline: '00000000-0000-4000-8000-000000000000' })
      ).json(),
    ).toMatchObject({ code: 'round_baseline_missing' });
    // Ivy may read the document but not open a round on it.
    expect((await open(document.artifactId, {}, 'ivy')).statusCode).toBe(403);
  });

  it('COL-029 COL-032 COL-057 COL-058 lets a reviewer start, complete with comments, reopen and complete again while it is open, counts what they said, and nothing once closed', async () => {
    const { printer, document } = await documentPlacing();
    const round = (await open(document.artifactId, {})).json<RoundView>();
    const as = (path: string, body?: object) =>
      call('POST', `/v1/rounds/${round.id}/${path}`, 'grace', body);
    expect((await as('start')).json<RoundView>()).toMatchObject({
      reviewing: true,
      reviewers: [{ state: 'in_progress' }],
    });
    // A thread Grace starts is counted beside her state, never read as her completion (COL-058).
    expect((await start(printer, SPAN, 'grace')).statusCode).toBe(200);
    expect((await call('GET', `/v1/rounds/${round.id}`, 'ada')).json<RoundView>()).toMatchObject({
      everybody: false,
      reviewers: [{ state: 'in_progress', threads: 1 }],
    });
    expect((await as('reopening')).json()).toMatchObject({ code: 'review_not_complete' });
    expect((await as('completion', { outcome: 'commented' })).statusCode).toBe(200);
    expect((await as('completion', { outcome: 'nothing_to_say' })).json()).toMatchObject({
      code: 'review_complete',
    });
    expect((await as('reopening')).json<RoundView>()).toMatchObject({
      reviewers: [{ state: 'in_progress' }],
    });
    expect((await as('completion', { outcome: 'nothing_to_say' })).statusCode).toBe(200);
    // Ada is no reviewer: her acts find no round.
    expect((await call('POST', `/v1/rounds/${round.id}/start`, 'ada')).statusCode).toBe(404);
    const closed = await call('POST', `/v1/rounds/${round.id}/closure`, 'ada');
    expect(closed.json<RoundView>()).toMatchObject({
      closed: { by: { id: ids.ada } },
      mayClose: false,
    });
    expect((await as('reopening')).json()).toMatchObject({ code: 'round_closed', rule: 'COL-057' });
  });

  it('COL-031 runs a round against a baseline: its reviewers comment on the pinned text, judged against the pins however the document moves on', async () => {
    const { printer, document } = await documentPlacing();
    const baseline = await tenantDb.withTenant(tenant, async (trx) => {
      const made = await makeBaseline(trx, {
        documentId: document.artifactId,
        version: document.id,
        name: 'As sent',
        maker: ids.ada!,
      });
      if (made.answer !== 'made') throw new Error(made.answer);
      return made.baseline;
    });
    const round = (await open(document.artifactId, { baseline })).json<RoundView>();
    expect(round).toMatchObject({ baseline, madeAgainst: document.id });
    // Grace comments on the pinned text; then the component moves on, and the quote is gone from it.
    expect((await start(printer, SPAN, 'grace')).statusCode).toBe(200);
    await revise(printer, [para('p1', 'Load the paper.')]);
    const live = await call('GET', `/v1/documents/${document.artifactId}/threads`, 'grace');
    expect(live.json<ThreadList>().threads[0]).toMatchObject({ orphaned: true });
    const pinned = await call('GET', `/v1/baselines/${baseline}/threads`, 'grace');
    expect(pinned.statusCode, pinned.body).toBe(200);
    expect(pinned.json<ThreadList>().threads[0]).toMatchObject({ orphaned: false });
    // The baseline's page offers Grace Review.
    const view = await call('GET', `/v1/baselines/${baseline}/view`, 'grace');
    expect(view.json()).toMatchObject({ mayReview: true, texts: [{ mayComment: true }] });
  });
});
