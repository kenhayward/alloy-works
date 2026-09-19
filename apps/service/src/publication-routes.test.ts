import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createComponent,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  recordPublication,
  removeGrant,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  insideTransaction,
  TEST_PASSWORDS,
  type TestDatabase,
} from '@alloy-works/db/testing';
import { defaultNumberingScheme } from '@alloy-works/domain';
import { createObjectStores, type ObjectStores } from '@alloy-works/objects';
import { testObjectStore, type TestObjectStore } from '@alloy-works/objects/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
type Json = Record<string, unknown>;
const UNKNOWN = '11111111-1111-4111-8111-111111111111';

describe('publishing a document through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let objects: TestObjectStore;
  let stores: ObjectStores;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let general: string;
  let quality: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const grants: Record<string, string> = {};

  const appOver = (database: TenantDatabase, withObjects = true) =>
    buildApp({
      db: database,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
      ...(withObjects ? { objects: stores } : {}),
    });

  const call = (
    as: string | undefined,
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    payload?: Json,
    through: FastifyInstance = app,
  ) =>
    through.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  const publish = (
    as: string,
    document: { id: string; version: string },
    formats = ['pdf'],
    through: FastifyInstance = app,
  ) =>
    call(
      as,
      'POST',
      `/v1/documents/${document.id}/publications`,
      { version: document.version, formats },
      through,
    );

  /** A component in a space, at 0.1 as created: one empty paragraph. */
  const componentIn = async (space: string, title: string) => {
    const made = await tenantDb.withTenant(tenant, (trx) =>
      createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.grace!,
      }),
    );
    if (made.answer !== 'created') throw new Error(made.answer);
    return { id: made.version.artifactId, version: made.version.id };
  };

  /** A document in General referencing these components, made by Grace through the routes. */
  const documentReferencing = async (components: string[]) => {
    const made = (
      await call('grace', 'POST', `/v1/spaces/${general}/documents`, {
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
      })
    ).json<{ id: string; version: { id: string } }>();
    let version = made.version.id;
    for (const component of components) {
      const edited = await call('grace', 'POST', `/v1/documents/${made.id}/outline`, {
        openedFrom: version,
        operation: {
          operation: 'insert',
          parent: null,
          position: 0,
          node: { type: 'reference', component, mode: { kind: 'latest' } },
        },
      });
      expect(edited.statusCode, edited.body).toBe(200);
      version = edited.json<{ version: { id: string } }>().version.id;
    }
    const body = (await call('grace', 'GET', `/v1/documents/${made.id}`)).json<{
      outline: { nodes: { id: string }[] };
    }>();
    return { id: made.id, version, nodes: body.outline.nodes.map((node) => node.id) };
  };

  /** Asks for a publication as this caller, and answers the request's id. */
  const requested = async (as: string, document: { id: string; version: string }) => {
    const answer = await publish(as, document);
    expect(answer.statusCode, answer.body).toBe(200);
    return answer.json<{ id: string }>().id;
  };

  /** A publication recorded straight through the store, as a worker would, for the reading routes. */
  const published = async (requestId: string) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const store = await stores.forTenant(trx, tenant);
      const stored = await store.put(Buffer.from('%PDF-1.7 a stand-in'), 'application/pdf');
      const id = await recordPublication(trx, {
        requestId,
        engineVersion: '0.15.1',
        templateVersion: 1,
        pipelineVersion: '1',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        output: { key: stored.key, sha256: stored.sha256, bytes: stored.size },
      });
      if (!id) throw new Error(`The request ${requestId} was already finished`);
      return id;
    });

  /** Gives a principal a role at an artifact, allowed or denied. */
  const grantAt = (
    principal: string,
    roleName: string,
    artifact: string,
    effect: 'allow' | 'deny',
  ) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const role = await findRole(trx, roleName);
      const answer = await grant(trx, {
        roleId: role!.id,
        subject: { principal },
        level: { kind: 'artifact', id: artifact },
        effect,
        grantedBy: ids.ada!,
      });
      if (!('granted' in answer)) throw new Error(JSON.stringify(answer));
    });

  /** A refusal's body without its trace id, which differs on every answer. */
  const refusal = (answer: { json: <T>() => T }) => ({
    ...answer.json<Record<string, unknown>>(),
    traceId: undefined,
  });

  beforeAll(async () => {
    db = await freshDatabase();
    objects = await testObjectStore();
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
    await objects.setUp(db.adminUrl, tenant);
    stores = createObjectStores(objects.settings, objects.sealingKey);
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    await tenantDb.withTenant(tenant, (trx) => seedDevelopmentContent(trx, { issuer: idp.issuer }));
    app = appOver(tenantDb);
    for (const user of ['ada', 'grace', 'alice', 'ivy']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await call(user, 'GET', '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      general = (
        await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow()
      ).id;
      quality = (await createSpace(trx, 'Quality')).id;
      const [reader, author] = await Promise.all(
        ['Reader', 'Author'].map((name) => findRole(trx, name)),
      );
      // The seed makes Ada and Grace Authors and Publishers on General; Grace also authors Quality,
      // which Ada may not read. Alice reads General and publishes nothing; Ivy holds nothing.
      for (const [key, role, principal, space] of [
        ['graceQuality', author!, ids.grace!, quality],
        ['aliceReads', reader!, ids.alice!, general],
      ] as const) {
        const answer = await grant(trx, {
          roleId: role.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
        if (!('granted' in answer)) throw new Error(JSON.stringify(answer));
        grants[key] = answer.granted.id;
      }
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await objects?.drop();
    await db?.drop();
  });

  it('refuses a component the publisher may not read, naming its place and nothing of it', async () => {
    const hidden = await componentIn(quality, 'Calibration');
    const document = await documentReferencing([hidden.id]);
    const answer = await publish('ada', document);
    expect(answer.statusCode, answer.body).toBe(200);
    const body = answer.json<{ id: string; failures: unknown[] }>();
    expect(body).toMatchObject({ document: document.id, state: 'queued', publication: null });
    expect(body.failures).toEqual([
      {
        stage: 'resolve',
        code: 'occurrence_unreadable',
        node: document.nodes[0],
        block: null,
        detail: null,
      },
    ]);
    for (const withheld of [hidden.id, hidden.version, 'Calibration']) {
      expect(answer.body).not.toContain(withheld);
    }
    const followed = await call('ada', 'GET', `/v1/publication-requests/${body.id}`);
    expect(followed.statusCode, followed.body).toBe(200);
    for (const withheld of [hidden.id, hidden.version, 'Calibration']) {
      expect(followed.body).not.toContain(withheld);
    }
    expect(followed.json()).toEqual(body);
  });

  it("decides the publisher's read at the publication, whoever placed the reference", async () => {
    const hidden = await componentIn(quality, 'Calibration');
    // Grace placed it while she could read it, and can publish it.
    const document = await documentReferencing([hidden.id]);
    expect((await publish('grace', document)).json<{ failures: unknown[] }>().failures).toEqual([]);
    // Ada cannot, for she may not read it, though Grace's reference stands.
    const codes = async (as: string) =>
      (await publish(as, document))
        .json<{ failures: { code: string }[] }>()
        .failures.map((each) => each.code);
    expect(await codes('ada')).toEqual(['occurrence_unreadable']);
    // And once Grace may no longer read Quality, neither can she.
    await tenantDb.withTenant(tenant, (trx) => removeGrant(trx, grants.graceQuality!));
    expect(await codes('grace')).toEqual(['occurrence_unreadable']);
  });

  it('refuses a reader who may not publish, a stale version, a format it cannot make, and an unknown document', async () => {
    const document = await documentReferencing([]);
    const reader = await publish('alice', document);
    expect(reader.statusCode).toBe(403);
    // Naming the permission, and nothing of the document.
    expect(reader.json()).toEqual({
      code: 'forbidden',
      message: 'This needs the publish permission.',
      traceId: expect.any(String),
    });
    expect((await publish('ivy', document)).statusCode).toBe(404);
    const other = await documentReferencing([(await componentIn(general, 'Scope')).id]);
    const first = (await call('grace', 'GET', `/v1/documents/${other.id}`)).json<{
      version: { id: string };
    }>();
    expect(first.version.id).toBe(other.version);
    const older = { id: other.id, version: document.version };
    const stale = await publish('grace', older);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'version_precondition' });
    const docx = await publish('grace', other, ['docx']);
    expect(docx.statusCode).toBe(400);
    expect(docx.json()).toMatchObject({ code: 'format_unsupported' });
    // A format named twice is a malformed request, not one the template cannot make.
    const twice = await publish('grace', other, ['pdf', 'pdf']);
    expect(twice.statusCode).toBe(400);
    expect(twice.json()).toMatchObject({ code: 'invalid_request' });
    expect(twice.json<{ message: string }>().message).toContain('formats');
    const unknown = { id: '11111111-1111-4111-8111-111111111111', version: other.version };
    expect((await publish('grace', unknown)).statusCode).toBe(404);
  });

  it('answers a request to its requester alone', async () => {
    const made = (await publish('grace', await documentReferencing([]))).json<{ id: string }>();
    expect((await call('grace', 'GET', `/v1/publication-requests/${made.id}`)).statusCode).toBe(
      200,
    );
    // Ada may publish the same document, and still may not follow Grace's request.
    for (const somebodyElse of ['ada', 'alice', 'ivy']) {
      const answer = await call(somebodyElse, 'GET', `/v1/publication-requests/${made.id}`);
      expect(answer.statusCode, somebodyElse).toBe(404);
    }
    const nothing = '11111111-1111-4111-8111-111111111111';
    expect((await call('grace', 'GET', `/v1/publication-requests/${nothing}`)).statusCode).toBe(
      404,
    );
  });

  it('tells a reader of the document whether they may publish it', async () => {
    const document = await documentReferencing([]);
    const may = async (as: string) =>
      (await call(as, 'GET', `/v1/documents/${document.id}`)).json<{ mayPublish: boolean }>()
        .mayPublish;
    expect(await may('grace')).toBe(true);
    expect(await may('alice')).toBe(false);
  });

  it('decides publish and records the request in the one transaction it was decided in', async () => {
    const document = await documentReferencing([]);
    // Every transaction the service opens, asked before it commits what it holds and what it wrote.
    // `publish` is decided under the access epoch's shared lock, held to the transaction's end, so the
    // transaction that wrote the request must be one holding it: a handler that resolved and recorded
    // in a transaction of its own would decide the read after a grant could have changed.
    const seen: { holdsAccessEpoch: boolean; requestsWritten: number }[] = [];
    const watched: TenantDatabase = {
      ...tenantDb,
      withTenant: (owner, work) =>
        tenantDb.withTenant(owner, async (trx) => {
          const result = await work(trx);
          seen.push(await insideTransaction(trx));
          return result;
        }),
    };
    const counted = appOver(watched);
    try {
      const answer = await publish('grace', document, ['pdf'], counted);
      expect(answer.statusCode, answer.body).toBe(200);
      const writers = seen.filter((each) => each.requestsWritten > 0);
      expect(writers).toEqual([{ holdsAccessEpoch: true, requestsWritten: 1 }]);
    } finally {
      await counted.close();
    }
  });
  it("PUB-048 lists a document's publications, newest first, with who published each and when", async () => {
    const document = await documentReferencing([]);
    // The store keeps a request's time to the second, so the window is the seconds the two span.
    const before = Math.floor(Date.now() / 1000) * 1000;
    const one = await published(await requested('grace', document));
    const two = await published(await requested('ada', document));
    const after = Date.now();
    // Alice reads General and publishes nothing: listing is reading.
    const answer = await call('alice', 'GET', `/v1/documents/${document.id}/publications`);
    expect(answer.statusCode, answer.body).toBe(200);
    const listed = answer.json<{
      items: {
        id: string;
        document: string;
        title: string;
        publisher: { id: string; displayName: string };
        publishedAt: string;
        approval: string;
        formats: string[];
      }[];
    }>();
    expect(
      listed.items.map((each) => [
        each.id,
        each.document,
        each.title,
        each.publisher,
        each.approval,
        each.formats,
      ]),
    ).toEqual([
      [two, document.id, 'The dosing report', { id: ids.ada, displayName: 'Ada' }, 'none', ['pdf']],
      [
        one,
        document.id,
        'The dosing report',
        { id: ids.grace, displayName: 'Grace' },
        'none',
        ['pdf'],
      ],
    ]);
    for (const each of listed.items) {
      expect(Date.parse(each.publishedAt)).toBeGreaterThanOrEqual(before);
      expect(Date.parse(each.publishedAt)).toBeLessThanOrEqual(after);
    }
    expect(Date.parse(listed.items[0]!.publishedAt)).toBeGreaterThanOrEqual(
      Date.parse(listed.items[1]!.publishedAt),
    );
    // Beside its own document: another document's publications are not among them.
    const other = await documentReferencing([]);
    await published(await requested('grace', other));
    const again = await call('alice', 'GET', `/v1/documents/${document.id}/publications`);
    expect(again.json<{ items: { id: string }[] }>().items.map((each) => each.id)).toEqual([
      two,
      one,
    ]);
  });

  it('PUB-047 keeps a publication at its own address, read on its own grants, with no way to delete it', async () => {
    const document = await documentReferencing([]);
    const id = await published(await requested('grace', document));
    const read = await call('alice', 'GET', `/v1/publications/${id}`);
    expect(read.statusCode, read.body).toBe(200);
    const body = read.json<{
      outputs: { format: string; bytes: number; sha256: string; download: string }[];
    }>();
    expect(body).toMatchObject({
      id,
      document: document.id,
      version: { id: document.version, number: '0.1' },
      title: 'The dosing report',
      publisher: { id: ids.grace, displayName: 'Grace' },
      approval: 'none',
      formats: ['pdf'],
      engine: { name: 'typst', version: '0.15.1' },
      template: { name: 'publication', version: 1 },
      pipeline: '1',
    });
    expect(body.outputs).toHaveLength(1);
    expect(body.outputs[0]).toMatchObject({ format: 'pdf', standard: 'ua-1', bytes: 19 });
    // The download is named by the publication's id, never its title: the link reaches the store's
    // logs. Followed, it answers the bytes kept, saved under that name.
    const download = body.outputs[0]!.download;
    expect(download).toContain(`${id}.pdf`);
    expect(download.toLowerCase()).not.toContain('dosing');
    const fetched = await fetch(download);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-disposition')).toBe(`attachment; filename="${id}.pdf"`);
    expect(await fetched.text()).toBe('%PDF-1.7 a stand-in');
    // Ivy is granted the document alone (decision D): the publication is not hers to read, nor to
    // see listed - the same answer as for no publication at all.
    await grantAt(ids.ivy!, 'Reader', document.id, 'allow');
    expect((await call('ivy', 'GET', `/v1/documents/${document.id}`)).statusCode).toBe(200);
    const refused = await call('ivy', 'GET', `/v1/publications/${id}`);
    expect(refused.statusCode).toBe(404);
    const nothing = await call('ivy', 'GET', `/v1/publications/${UNKNOWN}`);
    expect(refusal(refused)).toEqual(refusal(nothing));
    expect((await call('ivy', 'GET', `/v1/documents/${document.id}/publications`)).json()).toEqual({
      items: [],
    });
    // A document's id is not a publication's, and nothing deletes one: it is still there after.
    expect((await call('alice', 'GET', `/v1/publications/${document.id}`)).statusCode).toBe(404);
    expect((await call('grace', 'DELETE', `/v1/publications/${id}`)).statusCode).toBe(404);
    expect((await call('alice', 'GET', `/v1/publications/${id}`)).statusCode).toBe(200);
  });

  it('lists and opens only the publications the caller may read, and a refused one reads as missing', async () => {
    const document = await documentReferencing([]);
    const first = await published(await requested('grace', document));
    const hidden = await published(await requested('grace', document));
    const last = await published(await requested('grace', document));
    await grantAt(ids.alice!, 'Reader', hidden, 'deny');
    const answer = await call('alice', 'GET', `/v1/documents/${document.id}/publications`);
    const listed = answer.json<{ items: { id: string }[] }>();
    // No count, no position and no gap: the list is as if the refused one had never been made.
    expect(Object.keys(listed)).toEqual(['items']);
    expect(listed.items.map((each) => each.id)).toEqual([last, first]);
    expect(answer.body).not.toContain(hidden);
    const refused = await call('alice', 'GET', `/v1/publications/${hidden}`);
    expect(refused.statusCode).toBe(404);
    const nothing = await call('alice', 'GET', `/v1/publications/${UNKNOWN}`);
    expect(refusal(refused)).toEqual(refusal(nothing));
    // Grace, who holds no refusal, still has all three.
    const hers = (await call('grace', 'GET', `/v1/documents/${document.id}/publications`)).json<{
      items: { id: string }[];
    }>();
    expect(hers.items.map((each) => each.id)).toEqual([last, hidden, first]);
  });

  it('answers a listing asked of anything but a document as there being no such document', async () => {
    const scope = await componentIn(general, 'Scope');
    const document = await documentReferencing([]);
    const publication = await published(await requested('grace', document));
    const missing = await call('alice', 'GET', `/v1/documents/${UNKNOWN}/publications`);
    expect(missing.statusCode).toBe(404);
    // Alice may read both, and neither is a document.
    expect((await call('alice', 'GET', `/v1/components/${scope.id}`)).statusCode).toBe(200);
    expect((await call('alice', 'GET', `/v1/publications/${publication}`)).statusCode).toBe(200);
    for (const id of [scope.id, publication]) {
      const answer = await call('alice', 'GET', `/v1/documents/${id}/publications`);
      expect(answer.statusCode, id).toBe(404);
      expect(refusal(answer)).toEqual(refusal(missing));
    }
  });
  it('answers a publication as unavailable where the environment has nowhere to keep its output', async () => {
    const id = await published(await requested('grace', await documentReferencing([])));
    const storeless = appOver(tenantDb, false);
    try {
      const answer = await call('alice', 'GET', `/v1/publications/${id}`, undefined, storeless);
      expect(answer.statusCode, answer.body).toBe(503);
      expect(answer.json()).toEqual({
        code: 'storage_unavailable',
        message: 'This environment has nowhere to keep documents yet. Try again later.',
        traceId: expect.any(String),
      });
      // Refused before anything is said of it: no id of its own, no record, no link.
      expect(answer.body).not.toContain(id);
    } finally {
      await storeless.close();
    }
  });
});
