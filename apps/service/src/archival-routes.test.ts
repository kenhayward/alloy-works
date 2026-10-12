import { randomUUID } from 'node:crypto';

import type {
  ComponentList,
  ComponentView,
  DocumentList,
  DocumentView,
} from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createComponent,
  createDocument,
  createSpace,
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

const HOST = '127.0.0.1';

describe('archiving a component or a document over HTTP (the AH plan, Task 1)', () => {
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

  const listedComponents = async (query = '') =>
    (await call('GET', `/v1/components?spaces=${clinical}&limit=100${query}`, 'ada'))
      .json<ComponentList>()
      .items.map((each) => each.id);

  const listedDocuments = async (query = '') =>
    (await call('GET', `/v1/documents?spaces=${clinical}&limit=100${query}`, 'ada'))
      .json<DocumentList>()
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
    for (const who of ['ada', 'grace', 'ivy']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      // Ada authors, publishes and administers Clinical; Grace authors it; Ivy administers it, and
      // is then made external.
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
          // An external principal's grants count only while they expire within the cap.
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

  it('LIF-020 takes an archived component out of the listing and search, lists it alone when asked, and brings it back on unarchive', async () => {
    const word = `quokka${randomUUID().slice(0, 8)}`;
    const shelved = await component(`Shelved ${word}`);
    expect(await found(word)).toEqual([shelved]);

    const archived = await call('POST', `/v1/components/${shelved}/archive`, 'ada');
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json()).toEqual({ archived: true });
    expect(await listedComponents()).not.toContain(shelved);
    expect(await listedComponents('&archived=only')).toEqual([shelved]);
    expect(await found(word)).toEqual([]);

    // Still retrievable by its id, marked.
    const opened = await call('GET', `/v1/components/${shelved}`, 'grace');
    expect(opened.statusCode).toBe(200);
    expect(opened.json<ComponentView>()).toMatchObject({ archived: true, mayRetire: false });
    expect(
      (await call('GET', `/v1/components/${shelved}`, 'ada')).json<ComponentView>().mayRetire,
    ).toBe(true);

    const unarchived = await call('POST', `/v1/components/${shelved}/unarchive`, 'ada');
    expect(unarchived.json()).toEqual({ archived: false });
    expect(await listedComponents()).toContain(shelved);
    expect(await listedComponents('&archived=only')).toEqual([]);
    expect(await found(word)).toEqual([shelved]);
    expect(
      (await call('GET', `/v1/components/${shelved}`, 'grace')).json<ComponentView>().archived,
    ).toBe(false);
  });

  it('LIF-020 takes an archived document out of the listing, and still opens and publishes it', async () => {
    const manual = await document('Shelved manual');
    expect(
      (await call('POST', `/v1/documents/${manual.artifactId}/archive`, 'ada')).statusCode,
    ).toBe(200);
    expect(await listedDocuments()).not.toContain(manual.artifactId);
    expect(await listedDocuments('&archived=only')).toEqual([manual.artifactId]);
    const opened = await call('GET', `/v1/documents/${manual.artifactId}`, 'grace');
    expect(opened.json<DocumentView>()).toMatchObject({ archived: true, mayRetire: false });
    const published = await call('POST', `/v1/documents/${manual.artifactId}/publications`, 'ada', {
      version: manual.id,
      formats: ['pdf'],
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(
      (await call('POST', `/v1/documents/${manual.artifactId}/unarchive`, 'ada')).statusCode,
    ).toBe(200);
    expect(await listedDocuments()).toContain(manual.artifactId);
  });

  it('changes nothing archiving the archived, and answers a document at the component route as absent', async () => {
    const shelved = await component('Twice shelved');
    await call('POST', `/v1/components/${shelved}/archive`, 'ada');
    const again = await call('POST', `/v1/components/${shelved}/archive`, 'ada');
    expect(again.json()).toEqual({ archived: true });
    const acts = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('artifact_archival')
        .select('act')
        .where('artifact_id', '=', shelved)
        .execute(),
    );
    expect(acts).toHaveLength(1);
    const manual = await document('Not a component');
    expect(
      (await call('POST', `/v1/components/${manual.artifactId}/archive`, 'ada')).statusCode,
    ).toBe(404);
    expect((await call('POST', `/v1/documents/${shelved}/archive`, 'ada')).statusCode).toBe(404);
  });

  it('archives only for whoever may retire it: an author is refused, and an external administrator capped', async () => {
    const shelved = await component('Guarded procedure');
    const byAuthor = await call('POST', `/v1/components/${shelved}/archive`, 'grace');
    expect(byAuthor.statusCode).toBe(403);
    // Ivy reads it, and administers its space, but retiring is capped for an external principal.
    expect((await call('GET', `/v1/components/${shelved}`, 'ivy')).statusCode).toBe(200);
    const byOutsider = await call('POST', `/v1/components/${shelved}/archive`, 'ivy');
    expect(byOutsider.statusCode).toBe(403);
    const refusals = async () =>
      (
        await tenantDb.withTenant(tenant, (trx) =>
          trx
            .selectFrom('audit_event')
            .select(['actor', 'detail'])
            .where('kind', '=', 'access.refused')
            .where('subject', '=', shelved)
            .orderBy('sequence')
            .execute(),
        )
      ).map((each) => [each.actor, (each.detail as { reason: string }).reason]);
    await expect.poll(refusals).toEqual([
      [ids.grace, 'not_granted'],
      [ids.ivy, 'capped'],
    ]);
    expect(await listedComponents()).toContain(shelved);
  });

  it('refuses a token not scoped to retire, the refusal audited as scoped', async () => {
    const shelved = await component('Token procedure');
    const issue = async (scopes: string[]) =>
      (
        await call('POST', '/v1/tokens', 'ada', {
          name: `Scoped ${scopes.join(' ') || 'none'}`,
          scopes,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        })
      ).json<{ secret: string }>().secret;
    const editing = await issue(['edit']);
    const refused = await call('POST', `/v1/components/${shelved}/archive`, 'ada', undefined, {
      authorization: `Bearer ${editing}`,
    });
    expect(refused.statusCode, refused.body).toBe(403);
    // A refusal is recorded after its answer, in a transaction of its own.
    const reasons = async () =>
      (
        await tenantDb.withTenant(tenant, (trx) =>
          trx
            .selectFrom('audit_event')
            .select('detail')
            .where('kind', '=', 'access.refused')
            .where('subject', '=', shelved)
            .execute(),
        )
      ).map((each) => each.detail as { reason: string; permission: string });
    await expect
      .poll(reasons)
      .toEqual([expect.objectContaining({ reason: 'scoped', permission: 'retire' })]);
    const retiring = await issue(['retire']);
    const allowed = await call('POST', `/v1/components/${shelved}/archive`, 'ada', undefined, {
      authorization: `Bearer ${retiring}`,
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
  });

  it('LIF-057 records who archived and unarchived it', async () => {
    const shelved = await component('Audited procedure');
    await call('POST', `/v1/components/${shelved}/archive`, 'ada');
    await call('POST', `/v1/components/${shelved}/unarchive`, 'ada');
    const events = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'actor', 'subject_kind', 'space'])
        .where('subject', '=', shelved)
        .where('kind', 'like', 'artifact.%')
        .orderBy('sequence')
        .execute(),
    );
    expect(events).toEqual([
      { kind: 'artifact.archived', actor: ids.ada, subject_kind: 'component', space: clinical },
      { kind: 'artifact.unarchived', actor: ids.ada, subject_kind: 'component', space: clinical },
    ]);
  });
});
