import { randomUUID } from 'node:crypto';
import type { AttentionView } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createComponent,
  createSpace,
  createTenant,
  failPublicationRequest,
  findRole,
  grant,
  latestVersion,
  migrate,
  recordPublication,
  recordVersion,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { dataFailures, defaultNumberingScheme, type OutlineDocument } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { FAKE_CONNECTOR_KEY, fakeConnector } from './test/fake-connector.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const SECRET = 'an-invented-source-password';

const paragraph = (text: string) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: text, marks: [] }],
    },
  ],
});

describe('what waits on the caller over HTTP (home.md, Needs your attention)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const connector = fakeConnector();
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
  const ok = async (...args: Parameters<typeof call>) => {
    const answer = await call(...args);
    expect(answer.statusCode, `${args[1]} ${answer.body}`).toBe(200);
    return answer.json<Record<string, unknown>>();
  };

  const attention = async (who: string) => {
    const answer = await call('GET', '/v1/me/attention', who);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<AttentionView>();
  };
  const listed = async (who: string) =>
    (await attention(who)).items.map((item) => [item.kind, item.artifact.id]);

  const roleOn = (who: string, name: string, level: object, effect: 'allow' | 'deny' = 'allow') =>
    tenantDb.withTenant(tenant, async (trx) => {
      const answer = await grant(trx, {
        roleId: (await findRole(trx, name))!.id,
        subject: { principal: ids[who]! },
        level: level as never,
        effect,
        grantedBy: ids[who]!,
      });
      if (!('granted' in answer)) throw new Error(JSON.stringify(answer));
    });
  /** Refuses one person reading one artifact. */
  const hide = (who: string, artifact: string) =>
    roleOn(who, 'Reader', { kind: 'artifact', id: artifact }, 'deny');

  /**
   * A space of its own and people of their own, so nothing another test made waits on them: Ada
   * administers it, and she and Grace author, publish and use its connections; Ivy reads it.
   */
  let round = 0;
  const fresh = async () => {
    round += 1;
    for (const who of ['ada', 'grace', 'ivy']) {
      cookies[who] = await signIn(app, HOST, `${who}-${round}`, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    const space = await tenantDb.withTenant(tenant, (trx) =>
      createSpace(trx, `Space ${randomUUID()}`),
    );
    const level = { kind: 'space', id: space.id };
    for (const who of ['ada', 'grace']) {
      for (const name of ['Author', 'Publisher', 'Query builder']) await roleOn(who, name, level);
    }
    await roleOn('ada', 'Administrator', level);
    await roleOn('ivy', 'Reader', level);
    return space.id;
  };

  /** A document Ada made, at its first version. */
  const documentIn = async (space: string, title: string) => {
    const made = await ok('POST', `/v1/spaces/${space}/documents`, 'ada', {
      title,
      language: 'en-GB',
      direction: 'ltr',
    });
    return { id: made.id as string, version: (made.version as { id: string }).id };
  };
  /** Grace moves the document on a version. */
  const moveOn = (document: { id: string }) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const current = (await latestVersion(trx, document.id))!;
      const content = current.content as OutlineDocument;
      const next = await recordVersion(trx, {
        artifactId: document.id,
        openedFrom: current.id,
        author: ids.grace!,
        substance: {
          kind: 'document',
          content: { ...content, title: `${content.title}, revised` },
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return next.version.id;
    });
  /** Asks to publish the document at a version, as this person. */
  const publish = async (who: string, document: { id: string }, version: string) =>
    (
      await ok('POST', `/v1/documents/${document.id}/publications`, who, {
        version,
        formats: ['pdf'],
      })
    ).id as string;
  /** The worker's answer to a request: a publication made, or the request failed. */
  const made = (requestId: string) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const id = await recordPublication(trx, {
        requestId,
        pipelineVersion: '2',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf',
            engineVersion: '0.15.1',
            templateVersion: 2,
            key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1000,
          },
        ],
      });
      if (!id) throw new Error(`The request ${requestId} was already finished`);
      return id;
    });
  const failed = (requestId: string) =>
    tenantDb.withTenant(tenant, (trx) =>
      failPublicationRequest(trx, requestId, [
        { stage: 'engine', code: 'engine_failed', node: null, block: null, detail: null },
      ]),
    );

  /** A component, and Ada's session on it holding a save not in a version. */
  const editedIn = async (space: string, title: string) => {
    const version = await tenantDb.withTenant(tenant, async (trx) => {
      const answer = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      });
      if (answer.answer !== 'created') throw new Error(answer.answer);
      return answer.version;
    });
    const id = version.artifactId;
    const session = randomUUID();
    await ok('POST', `/v1/components/${id}/lock`, 'ada', { session });
    const saved = await ok('PUT', `/v1/components/${id}/iterations/${session}/1`, 'ada', {
      openedFrom: version.id,
      content: { ...paragraph('Unbox the printer.'), title },
    });
    return { id, session, openedFrom: version.id, saved };
  };

  /**
   * A connection Ada made, whose credential she set and never tested: the connector sealed it, then
   * answered its test with a failure no test gives, which is not recorded.
   */
  const connectionIn = async (space: string, name: string) => {
    const connection = await ok('POST', `/v1/spaces/${space}/connections`, 'ada', {
      settings: {
        schemaVersion: 1,
        name,
        description: 'The sites and their readings.',
        type: 'postgres',
        source: {
          host: 'source-postgres',
          port: 5432,
          database: 'readings',
          account: 'reader',
          tls: 'require',
        },
        identity: { kind: 'service' },
        retired: false,
      },
    });
    const id = connection.id as string;
    connector.test = {
      outcome: 'failed',
      failure: { code: 'row_limit', attribution: dataFailures.row_limit },
    };
    await ok('PUT', `/v1/connections/${id}/credential`, 'ada', { secret: SECRET });
    connector.test = { outcome: 'ok', findings: [] };
    return id;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      users: Array.from({ length: 10 }, (_, at) =>
        (['ada', 'grace', 'ivy'] as const).map((who) => ({
          id: `${who}-${at + 1}`,
          name: `${who[0]!.toUpperCase()}${who.slice(1)}`,
          email: `${who}-${at + 1}@example.com`,
          groups: [],
        })),
      ).flat(),
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
      connector: {
        url: 'http://connector.test:8090',
        key: FAKE_CONNECTOR_KEY,
        fetch: connector.fetch,
      },
    });
    connector.mode = 'answer';
    connector.test = { outcome: 'ok', findings: [] };
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('SCH-070 LIF-005 lists each kind with its reason, title and state, and clears each once the person does what it asks', async () => {
    const space = await fresh();
    const failing = await documentIn(space, 'The dosing report');
    const request = await publish('ada', failing, failing.version);
    await failed(request);
    const behind = await documentIn(space, 'The audit');
    await made(await publish('ada', behind, behind.version));
    const latest = await moveOn(behind);
    const cut = await editedIn(space, 'Install the printer');
    const discarded = await editedIn(space, 'Clean the printer');
    const connection = await connectionIn(space, 'Readings');

    const before = await attention('ada');
    expect(before.total).toBe(5);
    expect(before.items).toEqual([
      {
        kind: 'publish_failed',
        artifact: { id: failing.id, kind: 'document', title: 'The dosing report' },
        reason: 'engine_failed',
        request,
        state: { key: 'draft', name: 'Draft' },
      },
      {
        kind: 'changes_not_in_version',
        artifact: { id: discarded.id, kind: 'component', title: 'Clean the printer' },
        state: { key: 'draft', name: 'Draft' },
      },
      {
        kind: 'changes_not_in_version',
        artifact: { id: cut.id, kind: 'component', title: 'Install the printer' },
        state: { key: 'draft', name: 'Draft' },
      },
      {
        kind: 'published_earlier',
        artifact: { id: behind.id, kind: 'document', title: 'The audit, revised' },
        state: { key: 'draft', name: 'Draft' },
      },
      {
        kind: 'connection_untested',
        artifact: { id: connection, kind: 'connection', title: 'Readings' },
        // A connection has no workflow.
        state: null,
      },
    ]);

    // Each act, done as Ada: publish, cut a version, discard, publish the latest, test.
    await made(await publish('ada', failing, failing.version));
    expect(await listed('ada')).not.toContainEqual(['publish_failed', failing.id]);
    await ok('POST', `/v1/components/${cut.id}/versions`, 'ada', {
      session: cut.session,
      openedFrom: cut.openedFrom,
    });
    expect(await listed('ada')).not.toContainEqual(['changes_not_in_version', cut.id]);
    const unsaved = (await ok('GET', `/v1/components/${discarded.id}`, 'ada')).unsaved as {
      savedAt: string;
    };
    await ok('PUT', `/v1/components/${discarded.id}/unsaved/discarded`, 'ada', {
      upTo: unsaved.savedAt,
    });
    expect(await listed('ada')).not.toContainEqual(['changes_not_in_version', discarded.id]);
    await made(await publish('ada', behind, latest));
    expect(await listed('ada')).not.toContainEqual(['published_earlier', behind.id]);
    await ok('POST', `/v1/connections/${connection}/test`, 'ada', {});
    expect(await attention('ada')).toEqual({ items: [], total: 0 });
  });

  it('names the failed request, which its requester reads with every failure and nobody else reads', async () => {
    const space = await fresh();
    const failing = await documentIn(space, 'The dosing report');
    await failed(await publish('ada', failing, failing.version));
    const [item] = (await attention('ada')).items;
    expect(item).toMatchObject({ kind: 'publish_failed', request: expect.any(String) });
    expect(await ok('GET', `/v1/publication-requests/${item!.request!}`, 'ada')).toMatchObject({
      state: 'failed',
      failures: [{ code: 'engine_failed' }],
    });
    expect(
      (await call('GET', `/v1/publication-requests/${item!.request!}`, 'grace')).statusCode,
    ).toBe(404);
  });

  it('SCH-070 clears a failed publish and an earlier publication by a publication the publisher made, though they may not read it', async () => {
    const space = await fresh();
    const failing = await documentIn(space, 'The dosing report');
    await failed(await publish('ada', failing, failing.version));
    const behind = await documentIn(space, 'The audit');
    await made(await publish('grace', behind, behind.version));
    const latest = await moveOn(behind);
    expect(await listed('ada')).toEqual([
      ['publish_failed', failing.id],
      ['published_earlier', behind.id],
    ]);

    await hide('ada', await made(await publish('ada', failing, failing.version)));
    await hide('ada', await made(await publish('ada', behind, latest)));
    expect(await attention('ada')).toEqual({ items: [], total: 0 });
  });

  it('SCH-070 neither lists nor clears a document as published from an earlier version by a publication of a baseline', async () => {
    const space = await fresh();
    const baseline = async (document: { id: string }, version: string, name: string) =>
      (await ok('POST', `/v1/documents/${document.id}/baselines`, 'ada', { version, name }))
        .id as string;
    const ofBaseline = async (id: string) =>
      made(
        (await ok('POST', `/v1/baselines/${id}/publications`, 'ada', { formats: ['pdf'] }))
          .id as string,
      );
    // A baseline of the first version, published once the second exists, lists nothing.
    const pinned = await documentIn(space, 'The audit');
    const issued = await baseline(pinned, pinned.version, 'Issued');
    await moveOn(pinned);
    await ofBaseline(issued);
    expect(await attention('ada')).toEqual({ items: [], total: 0 });

    // Published from an earlier version, a baseline of the latest clears nothing; published from the
    // latest, a baseline of the first lists nothing again.
    const behind = await documentIn(space, 'The summary');
    const first = await baseline(behind, behind.version, 'First issue');
    await made(await publish('ada', behind, behind.version));
    const latest = await moveOn(behind);
    await ofBaseline(await baseline(behind, latest, 'Second issue'));
    expect(await listed('ada')).toEqual([['published_earlier', behind.id]]);
    await made(await publish('ada', behind, latest));
    await ofBaseline(first);
    expect(await attention('ada')).toEqual({ items: [], total: 0 });
  });

  it('SCH-070 lists a document once, at its most pressing', async () => {
    const space = await fresh();
    const document = await documentIn(space, 'The dosing report');
    await made(await publish('ada', document, document.version));
    await failed(await publish('ada', document, await moveOn(document)));
    expect(await attention('ada')).toMatchObject({
      items: [{ kind: 'publish_failed', artifact: { id: document.id } }],
      total: 1,
    });
  });

  it('SCH-070 lists for each person only what waits on them that they may resolve', async () => {
    const space = await fresh();
    const failing = await documentIn(space, 'The dosing report');
    await failed(await publish('ada', failing, failing.version));
    const behind = await documentIn(space, 'The audit');
    await made(await publish('ada', behind, behind.version));
    await moveOn(behind);
    await editedIn(space, 'Install the printer');
    const connection = await connectionIn(space, 'Readings');
    // What waits on anybody who may resolve it waits on Grace too, but not Ada's own attempt or
    // work; Ivy reads all of it and may resolve none.
    expect(await listed('grace')).toEqual([
      ['published_earlier', behind.id],
      ['connection_untested', connection],
    ]);
    expect(await attention('ivy')).toEqual({ items: [], total: 0 });
  });

  it('SCH-032 lists and counts nothing the caller may not read', async () => {
    const space = await fresh();
    const failing = await documentIn(space, 'The dosing report');
    await failed(await publish('ada', failing, failing.version));
    const behind = await documentIn(space, 'The audit');
    await made(await publish('ada', behind, behind.version));
    await moveOn(behind);
    const component = await editedIn(space, 'Install the printer');
    const connection = await connectionIn(space, 'Readings');
    expect((await attention('ada')).total).toBe(4);
    for (const id of [failing.id, behind.id, component.id, connection]) await hide('ada', id);
    const hidden = await call('GET', '/v1/me/attention', 'ada');
    expect(hidden.json()).toEqual({ items: [], total: 0 });
    for (const withheld of ['The dosing report', 'The audit', 'Install the printer', 'Readings']) {
      expect(hidden.body).not.toContain(withheld);
    }
  });

  it('answers at most 20, with how many wait', async () => {
    const space = await fresh();
    for (let each = 0; each < 21; each += 1) await connectionIn(space, `Readings ${each}`);
    const answer = await attention('ada');
    expect(answer.items).toHaveLength(20);
    expect(answer.total).toBe(21);
  });

  it('refuses a token: what waits is a signed-in person’s, whose scopes a token could not keep', async () => {
    await fresh();
    const issued = await ok('POST', '/v1/tokens', 'ivy', {
      name: 'Script',
      scopes: [],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const answer = await app.inject({
      method: 'GET',
      url: '/v1/me/attention',
      headers: { host: HOST, authorization: `Bearer ${issued.secret as string}` },
    });
    expect(answer.statusCode).toBe(403);
    expect(answer.json()).toMatchObject({ code: 'token_not_allowed' });
  });
});
