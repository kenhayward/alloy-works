import type { ComponentVersionList, DocumentRestorationView } from '@alloy-works/api-contract';
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

type Version = { id: string; number: string };
type Opened = { id: string; version: Version; outline: { nodes: { id: string }[] } };

describe("a document's versions and its restore over HTTP (the RS plan, Task 2)", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (method: 'GET' | 'POST', url: string, who: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[who]! },
      ...(payload ? { payload } : {}),
    });
  const act = async (document: Opened, operation: object, who = 'ada') => {
    const response = await call('POST', `/v1/documents/${document.id}/outline`, who, {
      openedFrom: document.version.id,
      operation,
    });
    if (response.statusCode !== 200) throw new Error(response.body);
    return response.json<Opened>();
  };
  const preview = (document: string, version: Version, who = 'ada') =>
    call('GET', `/v1/documents/${document}/versions/${version.id}/restoration`, who);
  const restore = (document: string, version: Version, latest: Version, who = 'ada') =>
    call('POST', `/v1/documents/${document}/versions/${version.id}/restore`, who, {
      latest: latest.id,
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
      return made.version;
    });
  const document = async () => {
    const id = await tenantDb.withTenant(tenant, async (trx) => {
      const made = await createDocument(trx, {
        spaceId: clinical,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version.artifactId;
    });
    return (await call('GET', `/v1/documents/${id}`, 'ada')).json<Opened>();
  };
  const reference = (component: string, mode: object) => ({
    operation: 'insert',
    parent: null,
    position: 0,
    node: { type: 'reference', component, mode },
  });
  const eventsOf = (version: string) =>
    tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'actor', 'detail'])
        .where('subject_version', '=', version)
        .where('kind', '=', 'reference.repointed')
        .orderBy('sequence')
        .execute(),
    );

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
      // Ada and Grace author Clinical; Ivy reads it.
      for (const [who, name] of [
        ['ada', 'Author'],
        ['grace', 'Author'],
        ['ivy', 'Reader'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, name))!.id,
          subject: { principal: ids[who]! },
          level: { kind: 'space', id: clinical },
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

  it('VER-032 VER-033 restores a document as a new version, listed with the version it was restored from', async () => {
    const made = await document();
    const first = await act(made, {
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'section', title: [{ type: 'text', value: 'Method', marks: [] }] },
    });
    const second = await act(first, { operation: 'remove', node: first.outline.nodes[0]!.id });
    const response = await restore(made.id, first.version, second.version);
    expect(response.statusCode).toBe(200);
    expect(response.json<{ version: Version }>().version.number).toBe('0.4');
    const listed = (
      await call('GET', `/v1/documents/${made.id}/versions`, 'ivy')
    ).json<ComponentVersionList>();
    expect(listed.items.map((each) => [each.number, each.restoredFrom])).toEqual([
      ['0.4', { id: first.version.id, number: '0.2' }],
      ['0.3', null],
      ['0.2', null],
      ['0.1', null],
    ]);
    // And the page opens at it.
    const now = (await call('GET', `/v1/documents/${made.id}`, 'ivy')).json<Opened>();
    expect(now.outline.nodes.map((node) => node.id)).toEqual([first.outline.nodes[0]!.id]);
  });

  it('VER-035 previews the outline a restore would make against the latest, withholding a component the caller may not read', async () => {
    const shown = await component('Install the printer');
    const hidden = await component('Calibrate the scanner');
    await tenantDb.withTenant(tenant, async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: ids.grace! },
        level: { kind: 'artifact', id: hidden.artifactId },
        effect: 'deny',
        grantedBy: ids.ada!,
      }),
    );
    const made = await document();
    const first = await act(made, reference(hidden.artifactId, { kind: 'latest' }));
    const second = await act(first, reference(shown.artifactId, { kind: 'latest' }));
    const response = await preview(made.id, first.version, 'grace');
    expect(response.statusCode).toBe(200);
    const view = response.json<DocumentRestorationView>();
    expect(view).toMatchObject({
      document: made.id,
      from: { id: first.version.id, number: '0.2' },
      latest: { id: second.version.id, number: '0.3' },
      titles: [{ node: second.outline.nodes[0]!.id, title: 'Install the printer' }],
      refusals: [],
    });
    expect(view.structure).toContainEqual(
      expect.objectContaining({ change: 'deleted', older: second.outline.nodes[0]!.id }),
    );
    expect(JSON.stringify(view)).not.toContain(hidden.artifactId);
    expect(JSON.stringify(view)).not.toContain('Calibrate the scanner');
    // Grace restores it: the reference she may not read was already the latest's, so it stands.
    expect((await restore(made.id, first.version, second.version, 'grace')).statusCode).toBe(200);
  });

  it('CNT-182 audits who changes which version a reference takes, from which to which, by an outline act and by a restore', async () => {
    const printer = await component('Install the printer');
    const made = await document();
    const first = await act(made, reference(printer.artifactId, { kind: 'latest' }));
    const node = first.outline.nodes[0]!.id;
    const pinned = { kind: 'pinned', version: printer.id };
    const second = await act(first, { operation: 'set', node, mode: pinned }, 'grace');
    expect(await eventsOf(second.version.id)).toEqual([
      {
        kind: 'reference.repointed',
        actor: ids.grace,
        detail: { node, component: printer.artifactId, from: { kind: 'latest' }, to: pinned },
      },
    ]);
    const restored = (await restore(made.id, first.version, second.version, 'ada')).json<{
      version: Version;
    }>();
    expect(await eventsOf(restored.version.id)).toEqual([
      {
        kind: 'reference.repointed',
        actor: ids.ada,
        detail: { node, component: printer.artifactId, from: pinned, to: { kind: 'latest' } },
      },
    ]);
  });

  it('refuses in words: a reference the restorer may not read, a restore changing nothing, and one previewed against an older latest', async () => {
    const secret = await component('The secret procedure');
    const made = await document();
    const first = await act(made, reference(secret.artifactId, { kind: 'latest' }));
    const second = await act(first, { operation: 'remove', node: first.outline.nodes[0]!.id });
    await tenantDb.withTenant(tenant, async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: ids.grace! },
        level: { kind: 'artifact', id: secret.artifactId },
        effect: 'deny',
        grantedBy: ids.ada!,
      }),
    );
    const refused = await restore(made.id, first.version, second.version, 'grace');
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      code: 'outline_invalid',
      reason: 'The component is not one this outline can reference',
    });
    expect((await preview(made.id, first.version, 'grace')).json()).toMatchObject({
      refusals: [
        { code: 'outline_invalid', reason: 'The component is not one this outline can reference' },
      ],
    });
    const unchanged = await restore(made.id, second.version, second.version);
    expect(unchanged.statusCode).toBe(409);
    expect(unchanged.json()).toMatchObject({ code: 'restore_unchanged' });
    expect((await restore(made.id, first.version, second.version)).statusCode).toBe(200);
    const stale = await restore(made.id, made.version, second.version);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'version_precondition',
      current: { number: '0.4' },
    });
  });

  it('refuses a reader who may not edit, and answers a version of another document as not found', async () => {
    const made = await document();
    const other = await document();
    expect((await preview(made.id, made.version, 'ivy')).statusCode).toBe(403);
    expect((await restore(made.id, made.version, made.version, 'ivy')).statusCode).toBe(403);
    expect((await preview(made.id, other.version)).statusCode).toBe(404);
    expect((await restore(made.id, other.version, made.version)).statusCode).toBe(404);
  });
});
