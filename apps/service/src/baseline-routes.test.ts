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
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import type { OutlineDocument, OutlineNode } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const NODE = 'q'.repeat(26);

describe('baselines over HTTP (baselines.md)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  let quality = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (method: 'GET' | 'POST', url: string, who: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[who]! },
      ...(payload ? { payload } : {}),
    });

  /** A document in Clinical, by Ada, at a second version holding these nodes, or at 0.1 holding none. */
  const documentWith = (nodes: OutlineNode[] = []) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createDocument(trx, {
        spaceId: clinical,
        title: `Report ${Math.random()}`,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      if (nodes.length === 0) return made.version;
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

  const make = (document: { artifactId: string; id: string }, name: string, who = 'ada') =>
    call('POST', `/v1/documents/${document.artifactId}/baselines`, who, {
      version: document.id,
      name,
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
    for (const who of ['ada', 'grace']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const role = async (name: string) => (await findRole(trx, name))!.id;
      // Ada authors and publishes Clinical; Grace reads it, and authors Quality, which Ada may not read.
      for (const [who, name, space] of [
        ['ada', 'Author', clinical],
        ['ada', 'Publisher', clinical],
        ['grace', 'Reader', clinical],
        ['grace', 'Author', quality],
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
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('VER-017 makes a baseline by an explicit call, lists it, and reads what it pins', async () => {
    const document = await documentWith();
    const made = await make(document, 'As approved');
    expect(made.statusCode, made.body).toBe(200);
    const baseline = made.json<{ id: string; digest: string }>();
    expect(made.json()).toMatchObject({
      document: document.artifactId,
      name: 'As approved',
      madeBy: { id: ids.ada, name: 'Ada' },
      superseded: null,
    });

    const listed = await call('GET', `/v1/documents/${document.artifactId}/baselines`, 'grace');
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ baselines: { id: string }[] }>().baselines.map((each) => each.id)).toEqual(
      [baseline.id],
    );
    const read = await call('GET', `/v1/baselines/${baseline.id}`, 'grace');
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json()).toMatchObject({
      id: baseline.id,
      digest: baseline.digest,
      pins: { document: { version: document.id }, occurrences: [], template: null },
      withheld: { nodes: [], assets: 0 },
    });
  });

  it('VER-046 refuses a name taken in the document, whatever its case, and one it cannot store, each in words', async () => {
    const document = await documentWith();
    expect((await make(document, 'Issue 1')).statusCode).toBe(200);
    const taken = await make(document, 'issue 1');
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ code: 'name_taken', rule: 'VER-046' });
    const invalid = await make(document, 'Issue 2 ');
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      code: 'name_invalid',
      message: 'A name has no space before or after it.',
    });
  });

  it('refuses a baseline to whoever may read the document but not publish it, and one of a version not the latest', async () => {
    const document = await documentWith();
    expect((await make(document, 'Grace’s', 'grace')).statusCode).toBe(403);
    const stale = await call('POST', `/v1/documents/${document.artifactId}/baselines`, 'ada', {
      version: '00000000-0000-4000-8000-000000000000',
      name: 'Stale',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'version_precondition' });
  });

  it('refuses a baseline of a place its maker may not read, by its node alone', async () => {
    const secret = await tenantDb.withTenant(tenant, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: quality,
        title: 'Calibration',
        language: 'en-GB',
        direction: 'ltr',
        author: ids.grace!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.version;
    });
    const document = await documentWith([
      {
        type: 'reference',
        id: NODE,
        component: secret.artifactId,
        mode: { kind: 'latest' },
        numbered: true,
        matter: 'body',
        pageBreak: 'none',
        values: {},
        children: [],
      },
    ]);
    const refused = await make(document, 'Partial');
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      code: 'baseline_unresolved',
      places: [{ code: 'occurrence_unreadable', node: NODE, block: null, detail: null }],
    });
    expect(refused.body).not.toContain(secret.artifactId);
  });

  it('VER-049 marks a baseline superseded by a later one, keeps it readable, and lists by state', async () => {
    const document = await documentWith();
    const first = (await make(document, 'Issue 1')).json<{ id: string }>().id;
    const second = (await make(document, 'Issue 2')).json<{ id: string }>().id;

    expect(
      (await call('POST', `/v1/baselines/${first}/supersession`, 'grace', { by: second }))
        .statusCode,
    ).toBe(403);
    const backwards = await call('POST', `/v1/baselines/${second}/supersession`, 'ada', {
      by: first,
    });
    expect(backwards.statusCode).toBe(400);
    expect(backwards.json()).toMatchObject({ code: 'superseder_invalid' });
    const done = await call('POST', `/v1/baselines/${first}/supersession`, 'ada', { by: second });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({
      id: first,
      superseded: { by: second, principal: ids.ada },
    });
    const again = await call('POST', `/v1/baselines/${first}/supersession`, 'ada', { by: second });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'superseded_already' });

    const names = async (query: string) =>
      (await call('GET', `/v1/documents/${document.artifactId}/baselines${query}`, 'grace'))
        .json<{ baselines: { name: string }[] }>()
        .baselines.map((each) => each.name);
    expect(await names('')).toEqual(['Issue 2', 'Issue 1']);
    expect(await names('?state=current')).toEqual(['Issue 2']);
    expect(await names('?state=superseded')).toEqual(['Issue 1']);
    expect((await call('GET', `/v1/baselines/${first}`, 'grace')).statusCode).toBe(200);
  });
});
