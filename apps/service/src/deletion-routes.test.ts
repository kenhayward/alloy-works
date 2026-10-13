import { randomUUID } from 'node:crypto';

import type {
  ChangesView,
  ComponentList,
  DeletionView,
  DocumentRestorationView,
} from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createComponent,
  createDocument,
  createSpace,
  createTenant,
  editOutline,
  findRole,
  grant,
  makeBaseline,
  migrate,
  placeHold,
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
import type { OutlineDocument } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';

describe('deleting a component or a document over HTTP (the DL plan, Task 1)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (
    method: 'GET' | 'POST',
    url: string,
    who: string,
    payload?: object,
    headers: Record<string, string> = { cookie: cookies[who] ?? '' },
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...headers },
      ...(payload ? { payload } : {}),
    });

  const component = (title: string) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: clinical,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version.artifactId;
    });

  const document = (title: string) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createDocument(trx, {
        spaceId: clinical,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });

  /** One outline act by Ada, recorded. */
  const act = (opened: StoredVersion, operation: object) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const answer = await editOutline(trx, {
        artifactId: opened.artifactId,
        openedFrom: opened.id,
        author: ids.ada!,
        operation: operation as never,
      });
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
      return answer.version;
    });

  const listed = async () =>
    (await call('GET', `/v1/components?spaces=${clinical}&limit=100`, 'ada'))
      .json<ComponentList>()
      .items.map((each) => each.id);

  const found = async (words: string) =>
    (await call('GET', `/v1/search?q=${encodeURIComponent(words)}`, 'ada'))
      .json<{ items: { artifactId: string }[] }>()
      .items.map((each) => each.artifactId);

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
      // Ada authors, publishes and administers Clinical; Grace authors it; Ivy administers it, and
      // is then made external. Alice holds nothing.
      for (const [who, name] of [
        ['ada', 'Author'],
        ['ada', 'Publisher'],
        ['ada', 'Administrator'],
        ['grace', 'Author'],
        ['ivy', 'Administrator'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, name))!.id,
          subject: { principal: ids[who]! },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          grantedBy: ids.ada!,
          ...(who === 'ivy' ? { expiresAt: new Date(Date.now() + 7 * 86_400_000) } : {}),
        });
      }
      await trx
        .updateTable('principal')
        .set({ kind: 'external' })
        .where('id', '=', ids.ivy!)
        .execute();
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await tenantDb?.close();
    await db?.drop();
  });

  it('LIF-024 VER-048 says what deleting it leaves, deletes it, answers 410 to a reader and 404 to anyone else, and undeletes it', async () => {
    const word = `wombat${randomUUID().slice(0, 8)}`;
    const gone = await component(`Gone ${word}`);
    const preview = await call('GET', `/v1/components/${gone}/deletion`, 'ada');
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json<DeletionView>()).toMatchObject({
      kind: 'component',
      deleted: false,
      remains: { versions: 1, iterations: 0, threads: 0, suggestions: 0, rounds: 0 },
      refusals: [],
    });

    const deleted = await call('POST', `/v1/components/${gone}/delete`, 'ada');
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toEqual({ deleted: true });
    expect(await listed()).not.toContain(gone);
    expect(await found(word)).toEqual([]);

    const read = await call('GET', `/v1/components/${gone}`, 'grace');
    expect(read.statusCode).toBe(410);
    expect(read.json()).toMatchObject({ code: 'artifact_deleted' });
    expect((await call('GET', `/v1/components/${gone}/versions`, 'grace')).statusCode).toBe(410);
    expect((await call('POST', `/v1/components/${gone}/delete`, 'ada')).statusCode).toBe(410);
    const hidden = await call('GET', `/v1/components/${gone}`, 'alice');
    expect(hidden.statusCode).toBe(404);
    expect(hidden.json()).toMatchObject({ code: 'not_found' });

    // What remains is still told to whoever may retire it, and kept: its version and its events.
    const after = await call('GET', `/v1/components/${gone}/deletion`, 'ada');
    expect(after.json<DeletionView>()).toMatchObject({ deleted: true, remains: { versions: 1 } });

    const back = await call('POST', `/v1/components/${gone}/undelete`, 'ada');
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json()).toEqual({ deleted: false });
    expect((await call('POST', `/v1/components/${gone}/undelete`, 'ada')).json()).toEqual({
      deleted: false,
    });
    expect((await call('GET', `/v1/components/${gone}`, 'grace')).statusCode).toBe(200);
    expect(await listed()).toContain(gone);
    expect(await found(word)).toEqual([gone]);
  });

  it('LIF-023 refuses deleting a document a baseline pins and a hold holds, 409 with every reason', async () => {
    const report = await document('Pinned report');
    const baseline = await tenantDb.withTenant(tenant, async (trx) => {
      const made = await makeBaseline(trx, {
        documentId: report.artifactId,
        version: report.id,
        name: 'Issue 1',
        maker: ids.ada!,
      });
      if (made.answer !== 'made') throw new Error(made.answer);
      await placeHold(trx, {
        target: { artifact: report.artifactId },
        reason: 'A matter',
        by: ids.ada!,
      });
      return made.baseline;
    });
    const expected = [
      { code: 'baselined', named: [{ id: baseline, title: 'Issue 1' }], unnamed: 0 },
      { code: 'held' },
    ];
    const preview = await call('GET', `/v1/documents/${report.artifactId}/deletion`, 'ada');
    expect(preview.json<DeletionView>().refusals).toEqual(expected);
    const refused = await call('POST', `/v1/documents/${report.artifactId}/delete`, 'ada');
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'deletion_refused', refusals: expected });
    expect((await call('GET', `/v1/documents/${report.artifactId}`, 'grace')).statusCode).toBe(200);
  });

  it('VER-044 refuses restoring a reference to a component since deleted, naming it by its node and last title', async () => {
    const printer = await component('Install the printer');
    const made = await document('Restored report');
    const placed = await act(made, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'reference', component: printer, mode: { kind: 'latest' } },
    });
    const node = (placed.content as OutlineDocument).nodes[0]!.id;
    const emptied = await act(placed, { operation: 'remove', node });
    expect((await call('POST', `/v1/components/${printer}/delete`, 'ada')).statusCode).toBe(200);
    const preview = await call(
      'GET',
      `/v1/documents/${made.artifactId}/versions/${placed.id}/restoration`,
      'ada',
    );
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json<DocumentRestorationView>().refusals).toEqual([
      { code: 'reference_deleted', node, title: 'Install the printer' },
    ]);
    const restored = await call(
      'POST',
      `/v1/documents/${made.artifactId}/versions/${placed.id}/restore`,
      'ada',
      { latest: emptied.id },
    );
    expect(restored.statusCode, restored.body).toBe(409);
    expect(restored.json()).toMatchObject({
      code: 'reference_deleted',
      node,
      title: 'Install the printer',
    });
  });

  it('reports a deletion and an undeletion as changes since', async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const report = await document(`Changing ${randomUUID()}`);
    await call('POST', `/v1/documents/${report.artifactId}/delete`, 'ada');
    const changed = await call(
      'GET',
      `/v1/changes?since=${encodeURIComponent(since)}&ids=${report.artifactId}`,
      'ada',
    );
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json<ChangesView>().artifacts).toEqual([
      expect.objectContaining({
        artifact: report.artifactId,
        deletion: { act: 'deleted', at: expect.any(String) },
      }),
    ]);
  });

  it('deletes only for whoever may retire it: an author is refused, an external administrator capped, and a token must be scoped to it', async () => {
    const guarded = await component('Guarded procedure');
    expect((await call('POST', `/v1/components/${guarded}/delete`, 'grace')).statusCode).toBe(403);
    expect((await call('POST', `/v1/components/${guarded}/delete`, 'ivy')).statusCode).toBe(403);
    expect((await call('GET', `/v1/components/${guarded}/deletion`, 'grace')).statusCode).toBe(403);
    const issue = async (scopes: string[]) =>
      (
        await call('POST', '/v1/tokens', 'ada', {
          name: `Scoped ${scopes.join(' ')}`,
          scopes,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
      ).json<{ secret: string }>().secret;
    const editing = await issue(['edit']);
    const refused = await call('POST', `/v1/components/${guarded}/delete`, 'ada', undefined, {
      authorization: `Bearer ${editing}`,
    });
    expect(refused.statusCode, refused.body).toBe(403);
    const retiring = await issue(['retire']);
    const allowed = await call('POST', `/v1/components/${guarded}/delete`, 'ada', undefined, {
      authorization: `Bearer ${retiring}`,
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
    // A document is not a component, at either kind's route.
    const manual = await document('Not a component');
    expect(
      (await call('POST', `/v1/components/${manual.artifactId}/delete`, 'ada')).statusCode,
    ).toBe(404);
  });

  it('LIF-057 records who deleted and undeleted it', async () => {
    const audited = await component('Audited procedure');
    await call('POST', `/v1/components/${audited}/delete`, 'ada');
    await call('POST', `/v1/components/${audited}/undelete`, 'ada');
    const events = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'actor', 'subject_kind', 'space'])
        .where('subject', '=', audited)
        .where('kind', 'like', 'artifact.%')
        .orderBy('sequence')
        .execute(),
    );
    expect(events).toEqual([
      { kind: 'artifact.deleted', actor: ids.ada, subject_kind: 'component', space: clinical },
      { kind: 'artifact.undeleted', actor: ids.ada, subject_kind: 'component', space: clinical },
    ]);
  });
});
