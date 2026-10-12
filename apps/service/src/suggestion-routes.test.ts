import type { SuggestionList, SuggestionView } from '@alloy-works/api-contract';
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

describe('suggestions over HTTP (collaboration.md, Suggestions)', () => {
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
        ['alice', 'Author', clinical],
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

  const SESSION = '00000000-0000-4000-8000-00000000abcd';
  /** Grace's suggestion on a version: p1 reworded, and p2 added. */
  const suggest = (version: StoredVersion, who = 'grace') =>
    call('POST', `/v1/components/${version.artifactId}/suggestions`, who, {
      version: version.id,
      content: {
        ...(version.content as ContentDocument),
        content: [para('p1', 'Set the tray carefully.'), para('p2', 'Then wait.')],
      },
    });
  const code = (response: { json: () => unknown }) => (response.json() as { code?: string }).code;

  it('COL-020 COL-021 COL-025 keeps a reviewer’s draft beside a component its author holds, drawn over the current version', async () => {
    const version = await component([para('p1', 'Set the tray.')]);
    const claimed = await call('POST', `/v1/components/${version.artifactId}/lock`, 'ada', {
      session: SESSION,
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    const made = await suggest(version);
    expect(made.statusCode, made.body).toBe(200);
    const view = made.json<SuggestionView>();
    expect(view).toMatchObject({
      component: version.artifactId,
      madeAgainst: version.id,
      madeBy: { id: ids.grace },
      state: 'pending',
      stale: [],
      drawnOver: { version: version.id },
    });
    expect(view.drawn).toMatchObject({ content: [{ id: 'p1' }, { id: 'p2' }] });
    // A reader may not suggest; nor may a draft that is not a document, or one that changes nothing.
    expect((await suggest(version, 'ivy')).statusCode).toBe(403);
    const invalid = await call(
      'POST',
      `/v1/components/${version.artifactId}/suggestions`,
      'grace',
      {
        version: version.id,
        content: { title: 'x' },
      },
    );
    expect([invalid.statusCode, code(invalid)]).toEqual([400, 'content_invalid']);
    const empty = await call('POST', `/v1/components/${version.artifactId}/suggestions`, 'grace', {
      version: version.id,
      content: version.content,
    });
    expect([empty.statusCode, code(empty)]).toEqual([400, 'suggestion_empty']);
  });

  it('COL-042 refuses accepting or rejecting while somebody else holds the component, naming them', async () => {
    const version = await component([para('p1', 'Set the tray.')]);
    const { id } = (await suggest(version)).json<SuggestionView>();
    await call('POST', `/v1/components/${version.artifactId}/lock`, 'ada', { session: SESSION });
    for (const act of ['acceptance', 'rejection']) {
      const answer = await call('POST', `/v1/suggestions/${id}/${act}`, 'alice');
      expect([answer.statusCode, code(answer)]).toEqual([409, 'lock_held']);
      expect(answer.json()).toMatchObject({
        holder: { id: ids.ada },
        expectedRelease: expect.any(String),
      });
    }
  });

  it('COL-024 COL-041 accepts as a version by whoever accepts, and refuses a reviewer who may not edit', async () => {
    const version = await component([para('p1', 'Set the tray.')]);
    const { id } = (await suggest(version)).json<SuggestionView>();
    expect((await call('POST', `/v1/suggestions/${id}/acceptance`, 'grace')).statusCode).toBe(403);
    const accepted = await call('POST', `/v1/suggestions/${id}/acceptance`, 'alice');
    expect(accepted.statusCode, accepted.body).toBe(200);
    const view = accepted.json<SuggestionView>();
    expect(view).toMatchObject({ state: 'accepted', resolution: { by: { id: ids.alice } } });
    const read = await call('GET', `/v1/components/${version.artifactId}`, 'ada');
    expect(read.json<{ version: { id: string; author: string } }>().version).toMatchObject({
      id: view.resolution!.version,
      author: ids.alice,
    });
    const again = await call('POST', `/v1/suggestions/${id}/rejection`, 'alice');
    expect([again.statusCode, code(again)]).toEqual([409, 'suggestion_resolved']);
  });

  it('COL-052 lists a suggestion that no longer fits as stale, with its places, and refuses accepting it', async () => {
    const version = await component([para('p1', 'Set the tray.')]);
    const { id } = (await suggest(version)).json<SuggestionView>();
    await revise(version, [para('p1', 'Set the lid.')]);
    const listed = (
      await call('GET', `/v1/components/${version.artifactId}/suggestions?state=pending`, 'ivy')
    ).json<SuggestionList>();
    expect(listed.suggestions.find((each) => each.id === id)).toMatchObject({
      stale: [{ block: 'p1', why: 'changed' }],
    });
    const refused = await call('POST', `/v1/suggestions/${id}/acceptance`, 'alice');
    expect([refused.statusCode, code(refused)]).toEqual([409, 'suggestion_stale']);
    expect(refused.json()).toMatchObject({ stale: [{ block: 'p1', why: 'changed' }] });
  });

  it('COL-022 accepts every pending suggestion on a document at once, by author, and says which it left and why', async () => {
    const first = await component([para('p1', 'Set the tray.')]);
    const second = await component([para('p1', 'Set the tray.')]);
    const document = await documentWith([
      reference('a'.repeat(26), first.artifactId, { kind: 'latest' }),
      reference('b'.repeat(26), second.artifactId, { kind: 'latest' }),
    ]);
    const fits = (await suggest(first)).json<SuggestionView>().id;
    const stale = (await suggest(second)).json<SuggestionView>().id;
    await revise(second, [para('p1', 'Set the lid.')]);
    const answer = await call('POST', '/v1/suggestions/resolutions', 'alice', {
      act: 'accept',
      scope: `artifact:${document.artifactId}`,
      author: ids.grace,
    });
    expect(answer.statusCode, answer.body).toBe(200);
    expect(answer.json()).toMatchObject({
      resolved: [{ suggestion: fits, version: expect.any(String) }],
      left: [{ suggestion: stale, why: 'stale', stale: [{ block: 'p1', why: 'changed' }] }],
    });
  });

  it('COL-048 lets its author alone withdraw a suggestion, and keeps it', async () => {
    const version = await component([para('p1', 'Set the tray.')]);
    const { id } = (await suggest(version)).json<SuggestionView>();
    const theirs = await call('POST', `/v1/suggestions/${id}/withdrawal`, 'alice');
    expect([theirs.statusCode, code(theirs)]).toEqual([403, 'suggestion_not_yours']);
    const withdrawn = await call('POST', `/v1/suggestions/${id}/withdrawal`, 'grace');
    expect(withdrawn.json<SuggestionView>()).toMatchObject({
      state: 'withdrawn',
      resolution: { by: { id: ids.grace } },
    });
    expect((await call('GET', `/v1/suggestions/${id}`, 'ivy')).statusCode).toBe(200);
  });

  it('answers a suggestion on a component the caller may not read as not found, and lists none of it', async () => {
    const hidden = await component([para('p1', 'Calibrate.')], quality, 'grace');
    const made = await call('POST', `/v1/components/${hidden.artifactId}/suggestions`, 'grace', {
      version: hidden.id,
      content: { ...(hidden.content as ContentDocument), content: [para('p1', 'Calibrate it.')] },
    });
    expect(made.statusCode, made.body).toBe(200);
    const { id } = made.json<SuggestionView>();
    for (const [method, url] of [
      ['GET', `/v1/suggestions/${id}`],
      ['POST', `/v1/suggestions/${id}/acceptance`],
      ['POST', `/v1/suggestions/${id}/withdrawal`],
      ['GET', `/v1/components/${hidden.artifactId}/suggestions`],
    ] as const) {
      expect((await call(method, url, 'ada')).statusCode, url).toBe(404);
    }
    const document = await documentWith([
      reference('h'.repeat(26), hidden.artifactId, { kind: 'latest' }),
    ]);
    const listed = (
      await call('GET', `/v1/documents/${document.artifactId}/suggestions`, 'ada')
    ).json<SuggestionList>();
    expect(listed.suggestions).toEqual([]);
  });
});
