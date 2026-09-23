// apps/service/src/cross-tenant.test.ts
import { randomUUID } from 'node:crypto';
import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createArtifact,
  createAssetUpload,
  createDocument,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  invite,
  migrate,
  receiveAssetBytes,
  recordAsset,
  recordPublication,
  requestPublication,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from '@alloy-works/db/testing';
import {
  DEFINITION_SCHEMA_VERSION,
  definitionsFor,
  type ComponentTypeDefinition,
} from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const A = 'acme.alloy.test';
const B = 'dev.acme.alloy.test';

const authenticated = allRoutes.filter((route) => route.access.check !== 'none');

/** An editing session and a version id, well formed: what the request's shape needs, and no more. */
const SESSION = '11111111-1111-4111-8111-111111111111';

/**
 * For each route with path parameters: how to name, in its path, something belonging to environment
 * B. A route with parameters must have an entry here, or the harness fails - the case this table
 * exists for is the one a filter would forget (IAM-004).
 */
const OTHER_TENANT_IDS: Readonly<
  Record<string, (tenant: Tenant, db: TenantDatabase) => Promise<Record<string, string>>>
> = {
  getSample: async (tenant, db) => ({
    sampleId: await db.withTenant(tenant, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'grace',
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const sample = await trx
        .insertInto('sample')
        .values({ requested_by: principal.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      return sample.id;
    }),
  }),
  listComponentTypes: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  createComponent: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  getComponent: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  createDocument: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  getDocument: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  editOutline: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getNumbering: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getContributions: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getDocumentTexts: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  requestPublication: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getPublicationRequest: async (tenant, db) => ({ id: (await publicationIn(tenant, db)).request }),
  listPublications: async (tenant, db) => ({ id: await documentIdIn(tenant, db) }),
  getPublication: async (tenant, db) => ({ id: (await publicationIn(tenant, db)).publication }),
  claimLock: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  releaseLock: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  cutVersion: async (tenant, db) => ({ id: await componentIdIn(tenant, db) }),
  saveIteration: async (tenant, db) => ({
    id: await componentIdIn(tenant, db),
    session: SESSION,
    sequence: '1',
  }),
  removeGrant: async (tenant, db) => ({ id: await grantIdIn(tenant, db) }),
  createAssetUpload: async (tenant, db) => ({ space: await spaceIdIn(tenant, db) }),
  putAssetUploadBytes: async (tenant, db) => ({ id: (await assetIn(tenant, db)).upload }),
  getAssetUpload: async (tenant, db) => ({ id: (await assetIn(tenant, db)).upload }),
  getAssetVersion: async (tenant, db) => ({ id: (await assetIn(tenant, db)).version }),
  getAssetVersionContent: async (tenant, db) => ({ id: (await assetIn(tenant, db)).version }),
  withdrawInvitation: async (tenant, db) => ({ id: await invitationIdIn(tenant, db) }),
};

/**
 * For each route taking a body, or a query that is not its target: a valid one, so that what the harness
 * sees is the environment's refusal and never the request's shape. A route with a body missing here
 * fails the harness.
 */
const VALID_INPUT: Readonly<
  Record<string, { readonly query?: string; readonly payload?: Record<string, unknown> }>
> = {
  createComponent: {
    payload: { title: 'Elsewhere', language: 'en-GB', direction: 'ltr' },
  },
  createDocument: { payload: { title: 'Elsewhere', language: 'en-GB', direction: 'ltr' } },
  createAssetUpload: { payload: { alternative: null } },
  editOutline: {
    payload: {
      openedFrom: SESSION,
      operation: { operation: 'remove', node: 'a'.repeat(26) },
    },
  },
  claimLock: { payload: { session: SESSION } },
  requestPublication: { payload: { version: SESSION, formats: ['pdf'] } },
  releaseLock: { query: `session=${SESSION}&openedFrom=${SESSION}` },
  cutVersion: { payload: { session: SESSION, openedFrom: SESSION } },
  invite: { payload: { email: 'ivy@example.com' } },
  makeGrant: {
    payload: { role: SESSION, subject: { principal: SESSION }, level: 'tenant', effect: 'allow' },
  },
  saveIteration: {
    payload: {
      openedFrom: SESSION,
      content: {
        schemaVersion: 1,
        title: 'Elsewhere',
        language: 'en-GB',
        direction: 'ltr',
        content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
      },
    },
  },
};

const CONTENT = {
  schemaVersion: 1,
  title: 'Audit the fleet',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'p1',
      style: 'body',
      content: [{ type: 'text', value: 'Audit the fleet.', marks: [] }],
    },
  ],
};

/** The General space of environment B, so a route naming a space names one that is not ours. */
const spaceIdIn = async (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const space = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    return space.id;
  });

/** A component in environment B's General space, complete with a version, so a route that opens
 * one has something to actually find - never a bare artifact row a missing-version 404 would
 * satisfy whether or not the tenant boundary held. */
const componentIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const author = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const type: ComponentTypeDefinition = {
      schemaVersion: DEFINITION_SCHEMA_VERSION,
      id: randomUUID(),
      name: 'Topic',
      assignments: [],
    };
    const madeType = await createArtifact(trx, {
      author: author.id,
      substance: { kind: 'componentType', content: type },
    });
    const made = await createArtifact(trx, {
      author: author.id,
      spaceId: general.id,
      substance: {
        kind: 'component',
        content: CONTENT as never,
        values: {},
        notCarried: [],
        definitions: definitionsFor({ version: madeType.id, definition: type }, [], []),
      },
    });
    return made.artifactId;
  });

/** A document in environment B's General space, made through the store as the route makes one, so a
 * route that opens one has a real version to find. */
const documentIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const author = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await createDocument(trx, {
      spaceId: general.id,
      title: 'The dosing report',
      language: 'en-GB',
      direction: 'ltr',
      author: author.id,
    });
    if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
    return made.version.artifactId;
  });

/**
 * A publication in environment B, and the request that made it: asked for through the store and
 * recorded as a worker records one, over an output that need not exist - nothing here fetches it.
 */
/**
 * An asset in the tenant's General space, made as the `ingest` job makes one, over an object that need
 * not exist: a route reaching it from another environment must refuse before it reads the store.
 */
const assetIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const space = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const uploader = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const upload = await createAssetUpload(trx, {
      spaceId: space.id,
      uploader: uploader.id,
      alternative: null,
    });
    await receiveAssetBytes(trx, upload.id, {
      key: `${tenant.role}/sha256/${'d'.repeat(64)}`,
      format: 'png',
      bytes: 1,
    });
    const version = await recordAsset(trx, upload.id, {
      format: 'png',
      width: 1,
      height: 1,
      orientation: 1,
      colour: 'rgb',
      alpha: false,
      depth: 8,
      resolution: null,
    });
    return { upload: upload.id, version: version.id };
  });

const publicationIn = async (tenant: Tenant, db: TenantDatabase) => {
  const document = await documentIdIn(tenant, db);
  return db.withTenant(tenant, async (trx) => {
    const version = await trx
      .selectFrom('artifact_version')
      .select(['id', 'author_id'])
      .where('artifact_id', '=', document)
      .executeTakeFirstOrThrow();
    const asked = await requestPublication(trx, {
      documentId: document,
      version: version.id,
      formats: ['pdf'],
      requester: version.author_id!,
    });
    if (asked.answer !== 'requested') throw new Error(`refused: ${asked.answer}`);
    const publication = await recordPublication(trx, {
      requestId: asked.request.id,
      engineVersion: '0.15.1',
      // Made under a layout, as every request since layouts is: template 2 and pipeline 2.
      templateVersion: 2,
      pipelineVersion: '2',
      fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
      dataSha256: 'b'.repeat(64),
      numbering: { scheme: 'default/1', entries: [] },
      output: { key: `${tenant.role}/sha256/${'c'.repeat(64)}`, sha256: 'c'.repeat(64), bytes: 1 },
    });
    return { request: asked.request.id, publication: publication! };
  });
};

/** A grant in environment B: Reader on its General space, to a principal of its own. */
const grantIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const general = await trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow();
    const holder = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const reader = await findRole(trx, 'Reader');
    const made = await grant(trx, {
      roleId: reader!.id,
      subject: { principal: holder.id },
      level: { kind: 'space', id: general.id },
      effect: 'allow',
      grantedBy: holder.id,
    });
    if (!('granted' in made)) throw new Error(`refused: ${made.refused}`);
    return made.granted.id;
  });

/** An invitation waiting in environment B, made by a principal of its own. */
const invitationIdIn = (tenant: Tenant, db: TenantDatabase) =>
  db.withTenant(tenant, async (trx) => {
    const inviter = await trx
      .insertInto('principal')
      .values({
        issuer: 'https://idp.example',
        subject: `ivy-${randomUUID()}`,
        email: null,
        display_name: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const made = await invite(trx, {
      email: `${randomUUID()}@example.com`,
      external: false,
      invitedBy: inviter.id,
    });
    if (!('invited' in made)) throw new Error(`refused: ${made.refused}`);
    return made.invited.id;
  });

/** The same, as a query's target names it. */
const componentIn = async (tenant: Tenant, db: TenantDatabase) =>
  `artifact:${await componentIdIn(tenant, db)}`;

/**
 * For each route whose permission's target is a query member: the query naming something belonging to
 * environment B. As with path parameters, a route missing here fails the harness.
 */
const OTHER_TENANT_QUERIES: Readonly<
  Record<string, (tenant: Tenant, db: TenantDatabase) => Promise<string>>
> = {
  getAccess: async (tenant, db) => `target=${await componentIn(tenant, db)}`,
  listGrants: async (tenant, db) => `level=${await componentIn(tenant, db)}`,
  listRoles: async (tenant, db) => `level=${await componentIn(tenant, db)}`,
  listPrincipals: async (tenant, db) => `level=${await componentIn(tenant, db)}`,
  explainAccess: async (tenant, db) => {
    const principal = await db.withTenant(tenant, (trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'alice',
          email: null,
          display_name: null,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    return `principal=${principal.id}&target=${await componentIn(tenant, db)}`;
  },
};

const withParameters = authenticated.filter((route) => route.path.includes('{'));
const withQueryTargets = allRoutes.filter(
  (route) => route.access.check === 'permission' && 'query' in route.access.target,
);
const fill = (path: string, ids: Record<string, string>) =>
  path.replace(/\{(\w+)\}/g, (_match, name: string) => ids[name] ?? '');
/** The route's address with its valid query, and its valid body, as `inject` takes them. */
const request = (name: string, url: string) => {
  const input = VALID_INPUT[name] ?? {};
  return {
    url: input.query ? `${url}?${input.query}` : url,
    ...(input.payload ? { payload: input.payload } : {}),
  };
};

describe("no environment accepts another environment's session (IAM-004)", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let fromA = '';
  let a: Tenant;
  let b: Tenant;
  let foreignPrincipal = '';
  let ownTarget = '';
  const othersIds: Record<string, Record<string, string>> = {};
  const othersQueries: Record<string, string> = {};

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [A, B].map((host) => `http://${host}/v1/sign-in/organisation/callback`),
        },
      ],
    });
    for (const [host, name] of [
      [A, 'Production'],
      [B, 'Development'],
    ] as const) {
      const tenant = await createTenant(db.adminUrl, db.migratorUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id: db.newTenantId(), name },
        hostnames: [host],
      });
      if (host === A) a = tenant;
      if (host === B) b = tenant;
      await configureOrganisationSignIn(db.adminUrl, tenant, {
        issuer: idp.issuer,
        clientId: 'alloy',
        secretName: 'stand_in',
      });
    }
    tenantDb = createTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    fromA = await signIn(app, A, 'ada', idp.issuer);
    for (const route of withParameters) {
      othersIds[route.operationId] = await OTHER_TENANT_IDS[route.operationId]!(b, tenantDb);
    }
    // Ada administers environment A, so a refusal below is the other environment's, not her own lack.
    const me = await app.inject({ url: '/v1/me', headers: { host: A, cookie: fromA } });
    const ada = me.json<{ id: string }>().id;
    await tenantDb.withTenant(a, async (trx) => {
      const administrator = await findRole(trx, 'Administrator');
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ada },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      });
    });
    for (const route of withQueryTargets) {
      const query = OTHER_TENANT_QUERIES[route.operationId];
      if (query) othersQueries[route.operationId] = await query(b, tenantDb);
    }
    // A principal belonging to B, and a target belonging to A: explainAccess takes both from its
    // query, so mixing environments across the two - not just naming both from the other one - is
    // its own escape to close.
    foreignPrincipal = await tenantDb
      .withTenant(b, (trx) =>
        trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'carol',
            email: null,
            display_name: null,
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      )
      .then((row) => row.id);
    ownTarget = await componentIn(a, tenantDb);
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('has authenticated routes to test', () => {
    expect(authenticated.length).toBeGreaterThan(0);
  });

  it('knows how to address the other environment for every route with path parameters', () => {
    for (const route of withParameters) {
      expect(OTHER_TENANT_IDS[route.operationId], route.operationId).toBeDefined();
    }
  });

  it.each(authenticated.map((route) => [route.operationId, route] as const))(
    '%s refuses a session from another environment',
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        ...request(name, fill(route.path, othersIds[name] ?? {})),
        headers: { host: B, cookie: fromA },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'unauthenticated' });
    },
  );

  it.each(withParameters.map((route) => [route.operationId, route] as const))(
    "%s will not reach another environment's data through this one's address",
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        ...request(name, fill(route.path, othersIds[name] ?? {})),
        headers: { host: A, cookie: fromA },
      });
      expect(response.statusCode).toBe(404);
    },
  );

  it('knows a valid body for every route that takes one', () => {
    for (const route of authenticated.filter((each) => each.body)) {
      expect(VALID_INPUT[route.operationId]?.payload, route.operationId).toBeDefined();
    }
  });

  it('opens a component in another environment exactly as one that does not exist, never its content', async () => {
    const route = withParameters.find((each) => each.operationId === 'getComponent')!;
    const response = await app.inject({
      method: route.method,
      url: fill(route.path, othersIds.getComponent ?? {}),
      headers: { host: A, cookie: fromA },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json<Record<string, unknown>>();
    expect(body).toMatchObject({ code: 'not_found' });
    expect(body).not.toHaveProperty('content');
  });

  it('knows how to address the other environment for every route whose target is in its query', () => {
    expect(withQueryTargets.length).toBeGreaterThan(0);
    for (const route of withQueryTargets) {
      expect(OTHER_TENANT_QUERIES[route.operationId], route.operationId).toBeDefined();
    }
  });

  it.each(withQueryTargets.map((route) => [route.operationId, route] as const))(
    "%s will not reach another environment's target through this one's address",
    async (name, route) => {
      const response = await app.inject({
        method: route.method,
        url: `${route.path}?${othersQueries[name]}`,
        headers: { host: A, cookie: fromA },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'not_found' });
    },
  );

  it("explainAccess will not reach a target this environment holds through another environment's principal", async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/access/explain?principal=${foreignPrincipal}&target=${ownTarget}`,
      headers: { host: A, cookie: fromA },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'not_found' });
  });

  it("makeGrant will not grant at another environment's level, or name another environment's role or person", async () => {
    const reader = (tenant: Tenant) =>
      tenantDb.withTenant(tenant, async (trx) => ({
        role: (await findRole(trx, 'Reader'))!.id,
        space: (
          await trx
            .selectFrom('space')
            .select('id')
            .where('name', '=', 'General')
            .executeTakeFirstOrThrow()
        ).id,
        person: (await trx.selectFrom('principal').select('id').executeTakeFirstOrThrow()).id,
        grants: (
          await trx
            .selectFrom('access_grant')
            .select((eb) => eb.fn.countAll<string>().as('count'))
            .executeTakeFirstOrThrow()
        ).count,
      }));
    const ours = await reader(a);
    const theirs = await reader(b);
    const make = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/v1/grants',
        headers: { host: A, cookie: fromA },
        payload: { effect: 'allow', ...payload },
      });

    const elsewhere = await make({
      role: ours.role,
      subject: { principal: ours.person },
      level: `space:${theirs.space}`,
    });
    expect(elsewhere.statusCode).toBe(404);
    expect(elsewhere.json()).toMatchObject({ code: 'not_found' });
    const theirRole = await make({
      role: theirs.role,
      subject: { principal: ours.person },
      level: `space:${ours.space}`,
    });
    expect(theirRole.statusCode).toBe(409);
    expect(theirRole.json()).toMatchObject({ code: 'grant_role_missing' });
    const theirPerson = await make({
      role: ours.role,
      subject: { principal: theirs.person },
      level: `space:${ours.space}`,
    });
    expect(theirPerson.statusCode).toBe(409);
    expect(theirPerson.json()).toMatchObject({ code: 'grant_subject_missing' });

    expect((await reader(a)).grants).toBe(ours.grants);
    expect((await reader(b)).grants).toBe(theirs.grants);
  });

  it('leaves the session working where it was issued, whatever was tried elsewhere', async () => {
    const me = await app.inject({ url: '/v1/me', headers: { host: A, cookie: fromA } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ environment: 'Production' });
  });
});
