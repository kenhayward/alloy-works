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
  removeGrant,
  seedDevelopmentContent,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
type Json = Record<string, unknown>;

describe('publishing a document through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let general: string;
  let quality: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const grants: Record<string, string> = {};

  const appOver = (database: TenantDatabase) =>
    buildApp({
      db: database,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });

  const call = (
    as: string | undefined,
    method: 'GET' | 'POST',
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
    // Every transaction the service opens, counted: the session's lookup, and then one more, in
    // which `publish` is decided under the access epoch's shared lock and the occurrences resolved
    // and the request recorded. A handler that resolved in a transaction of its own would open a
    // third, and a grant removed between the two would not be seen by the decision.
    let opened = 0;
    const counting: TenantDatabase = {
      ...tenantDb,
      withTenant: (owner, work) => {
        opened += 1;
        return tenantDb.withTenant(owner, work);
      },
    };
    const counted = appOver(counting);
    try {
      const answer = await publish('grace', document, ['pdf'], counted);
      expect(answer.statusCode, answer.body).toBe(200);
      expect(opened).toBe(2);
    } finally {
      await counted.close();
    }
  });
});
