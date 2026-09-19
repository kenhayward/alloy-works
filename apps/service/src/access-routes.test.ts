// apps/service/src/access-routes.test.ts
import { randomUUID } from 'node:crypto';
import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createArtifact,
  createDocument,
  createRole,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  recordPublication,
  requestPublication,
  type NewGrant,
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
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorise, type PermissionCheck } from './access.js';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const MISSING = '00000000-0000-4000-8000-000000000000';

describe('routes that check a permission', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let clinical: string;
  let quality: string;
  let dosing: string;
  let audit: string;
  let report: string;
  let reportPublication: string;
  let graceAuthors: string;

  const give = async (input: Omit<NewGrant, 'grantedBy' | 'roleId'> & { role: string }) => {
    const answer = await tenantDb.withTenant(tenant, async (trx) => {
      const role = await findRole(trx, input.role);
      return grant(trx, {
        roleId: role!.id,
        subject: input.subject,
        level: input.level,
        effect: input.effect,
        grantedBy: ids.ada!,
      });
    });
    if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.granted;
  };

  const get = (url: string, as?: string) =>
    app.inject({ url, headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) } });

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
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (await get('/v1/me', user)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // A real version each, not a bare artifact row: a route that opens one (getComponent) must
      // have something to find, so its refusal proves the permission held rather than just that
      // nothing was there to read.
      const type: ComponentTypeDefinition = {
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        id: randomUUID(),
        name: 'Topic',
        assignments: [],
      };
      const madeType = await createArtifact(trx, {
        author: ids.ada!,
        substance: { kind: 'componentType', content: type },
      });
      const content = (title: string) => ({
        schemaVersion: 1,
        title,
        language: 'en-GB',
        direction: 'ltr',
        content: [
          {
            type: 'paragraph',
            id: 'p1',
            style: 'body',
            content: [{ type: 'text', value: title, marks: [] }],
          },
        ],
      });
      const artifact = (spaceId: string, title: string) =>
        createArtifact(trx, {
          author: ids.ada!,
          spaceId,
          substance: {
            kind: 'component',
            content: content(title) as never,
            values: {},
            notCarried: [],
            definitions: definitionsFor({ version: madeType.id, definition: type }, [], []),
          },
        }).then((made) => made.artifactId);
      dosing = await artifact(clinical, 'Dosing');
      audit = await artifact(quality, 'Audit');
      // A document beside `dosing`, at a real version, so a document route's refusal proves the
      // permission held rather than that nothing was there.
      const made = await createDocument(trx, {
        spaceId: clinical,
        title: 'The dosing report',
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      });
      if (made.answer !== 'created') throw new Error(`refused: ${made.answer}`);
      report = made.version.artifactId;
      // And a publication of it, recorded as a worker records one over an output that need not
      // exist: a route reading it must refuse before it signs a link to anything.
      const asked = await requestPublication(trx, {
        documentId: report,
        version: made.version.id,
        formats: ['pdf'],
        requester: ids.ada!,
      });
      if (asked.answer !== 'requested') throw new Error(`refused: ${asked.answer}`);
      const recorded = await recordPublication(trx, {
        requestId: asked.request.id,
        engineVersion: '0.15.1',
        templateVersion: 1,
        pipelineVersion: '1',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: 'default/1', entries: [] },
        output: {
          key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
          sha256: 'c'.repeat(64),
          bytes: 1,
        },
      });
      if (!recorded) throw new Error('The publication was not recorded');
      reportPublication = recorded;
    });
    await give({
      role: 'Administrator',
      subject: { principal: ids.ada! },
      level: { kind: 'tenant' },
      effect: 'allow',
    });
    graceAuthors = (
      await give({
        role: 'Author',
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it("answers the caller's own permissions on a target they may read", async () => {
    const response = await get(`/v1/access?target=artifact:${dosing}`, 'grace');
    expect(response.statusCode).toBe(200);
    const allowed = response
      .json<{ permissions: { permission: string; allowed: boolean }[] }>()
      .permissions.filter((answer) => answer.allowed)
      .map((answer) => answer.permission);
    expect(allowed).toEqual(['read', 'create', 'edit', 'comment', 'suggest']);
    expect(response.json()).toMatchObject({ target: `artifact:${dosing}` });
  });

  it('refuses a malformed target as an invalid request', async () => {
    const response = await get('/v1/access?target=document:1', 'grace');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('refuses a malformed target on the explain route as an invalid request too', async () => {
    const response = await get(
      `/v1/access/explain?principal=${ids.grace}&target=document:1`,
      'ada',
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid_request' });
  });

  it('answers a malformed path-parameter target as not found, never a database error', async () => {
    // No route names a path parameter as its target yet (task 10's `RouteTarget` already has the
    // shape for one), so this calls `authorise` directly with a check built for the occasion - the
    // one way to exercise `targetOf`'s path-parameter branch before such a route exists.
    const check: PermissionCheck = {
      check: 'permission',
      permission: 'read',
      target: { space: 'spaceId' },
    };
    const request = { params: { spaceId: 'not-a-uuid' }, query: {} } as unknown as FastifyRequest;
    await expect(
      tenantDb.withTenant(tenant, (trx) => authorise(trx, ids.grace!, check, request)),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('refuses edit as not found, not forbidden or allowed, when the caller may edit above but is denied read on the target itself (regression, item A)', async () => {
    // Grace holds Author (read, edit, ...) at the Clinical space, but is denied Reader - so read
    // alone, a denial may name any role - on `dosing` itself. No permission implies another, so
    // decide('edit') still walks up to the space's allow; skipping the read gate for any allowed
    // permission (rather than for `administer` alone) would let her act on, and learn of, an artifact
    // she may not read, which access.md forbids.
    const denied = await give({
      role: 'Reader',
      subject: { principal: ids.grace! },
      level: { kind: 'artifact', id: dosing },
      effect: 'deny',
    });
    try {
      const check: PermissionCheck = {
        check: 'permission',
        permission: 'edit',
        target: { query: 'target' },
      };
      const request = {
        params: {},
        query: { target: `artifact:${dosing}` },
      } as unknown as FastifyRequest;
      await expect(
        tenantDb.withTenant(tenant, (trx) => authorise(trx, ids.grace!, check, request)),
      ).rejects.toMatchObject({ status: 404, code: 'not_found' });
    } finally {
      await tenantDb.withTenant(tenant, (trx) =>
        trx.deleteFrom('access_grant').where('id', '=', denied.id).execute(),
      );
    }
  });

  it('explains, for an administrator, the level and grants behind every answer and every refusal', async () => {
    const response = await get(
      `/v1/access/explain?principal=${ids.grace}&target=artifact:${dosing}`,
      'ada',
    );
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      principal: string;
      permissions: { permission: string; [member: string]: unknown }[];
    }>();
    expect(body.principal).toBe(ids.grace);
    const edit = body.permissions.find((answer) => answer.permission === 'edit');
    expect(edit).toMatchObject({
      allowed: true,
      reason: 'allowed',
      level: `space:${clinical}`,
      grants: [
        {
          role: 'Author',
          effect: 'allow',
          subject: { principal: ids.grace },
          through: null,
          expiresAt: null,
        },
      ],
    });
    const publish = body.permissions.find((answer) => answer.permission === 'publish');
    expect(publish).toEqual({
      permission: 'publish',
      allowed: false,
      reason: 'not_granted',
      level: null,
      checked: [`artifact:${dosing}`, `space:${clinical}`, 'tenant'],
      grants: [],
    });
  });

  it('API-053 refuses without a session as unauthenticated, and a reader lacking the permission as forbidden', async () => {
    const url = `/v1/access/explain?principal=${ids.grace}&target=artifact:${dosing}`;
    const anonymous = await get(url);
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ code: 'unauthenticated' });

    const reader = await get(url, 'grace');
    expect(reader.statusCode).toBe(403);
    expect(reader.json()).toMatchObject({
      code: 'forbidden',
      message: 'This needs the administer permission.',
    });
    expect(reader.json()).not.toHaveProperty('rule');
  });

  it('answers 403, not 404, for the tenant target when the caller lacks read there', async () => {
    // The tenant is never a 404 (decisions.md, item 12), so a caller who cannot read at the tenant
    // is refused as forbidden - getAccess checks `read`, so this is that route's own case of it.
    const response = await get('/v1/access?target=tenant', 'alice');
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'forbidden',
      message: 'This needs the read permission.',
    });
  });

  it('answers a target the caller may not read exactly as one that does not exist', async () => {
    const unreadable = await get(`/v1/access?target=artifact:${audit}`, 'grace');
    const missing = await get(`/v1/access?target=artifact:${MISSING}`, 'grace');
    expect(unreadable.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    // Byte for byte but for the trace id, which is every request's own, and the date, which is
    // every response's own; no header carries the trace id.
    const untracedBody = (body: Record<string, string>) =>
      Object.fromEntries(Object.entries(body).filter(([member]) => member !== 'traceId'));
    const untracedHeaders = (headers: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(headers).filter(([name]) => name !== 'date'));
    const refused = untracedBody(unreadable.json());
    const absent = untracedBody(missing.json());
    expect(refused).toEqual(absent);
    expect(refused).toEqual({ code: 'not_found', message: 'There is nothing at this address.' });
    expect(untracedHeaders(unreadable.headers)).toEqual(untracedHeaders(missing.headers));

    const space = await get(`/v1/access?target=space:${quality}`, 'grace');
    expect(space.statusCode).toBe(404);
    const explainUnknown = await get(
      `/v1/access/explain?principal=${MISSING}&target=artifact:${dosing}`,
      'ada',
    );
    expect(explainUnknown.statusCode).toBe(404);
  });

  it('answers from the grants as they stand at each request, a removed one included', async () => {
    const readable = await give({
      role: 'Reader',
      subject: { principal: ids.alice! },
      level: { kind: 'artifact', id: audit },
      effect: 'allow',
    });
    expect((await get(`/v1/access?target=artifact:${audit}`, 'alice')).statusCode).toBe(200);
    await tenantDb.withTenant(tenant, (trx) =>
      trx.deleteFrom('access_grant').where('id', '=', readable.id).execute(),
    );
    expect((await get(`/v1/access?target=artifact:${audit}`, 'alice')).statusCode).toBe(404);
  });

  it('explains at a space or an artifact despite a denial there, because the tenant administrator stands above it', async () => {
    // decisions.md, finding 6: "administer at its level or above" is each level's own walk, so a
    // denial of an administer-holding role at the space does not stand against ada's tenant grant.
    // Held alone (no `read`), so the denial does not also make the space unreadable to ada - the
    // 404 gate for an unreadable target is unaffected by this fix and must still pass first.
    const administerOnly = await tenantDb.withTenant(tenant, (trx) =>
      createRole(trx, 'Administer only', ['administer']),
    );
    if (!('role' in administerOnly)) throw new Error(`refused: ${administerOnly.refused}`);
    const denied = await give({
      role: administerOnly.role.name,
      subject: { principal: ids.ada! },
      level: { kind: 'space', id: clinical },
      effect: 'deny',
    });
    try {
      const space = await get(
        `/v1/access/explain?principal=${ids.grace}&target=space:${clinical}`,
        'ada',
      );
      expect(space.statusCode).toBe(200);
      const artifact = await get(
        `/v1/access/explain?principal=${ids.grace}&target=artifact:${dosing}`,
        'ada',
      );
      expect(artifact.statusCode).toBe(200);
    } finally {
      await tenantDb.withTenant(tenant, (trx) =>
        trx.deleteFrom('access_grant').where('id', '=', denied.id).execute(),
      );
    }

    // Grace holds no administer anywhere on that chain - not at the artifact, the space or the
    // tenant - so she is refused, above or not.
    const noAdministerAnywhere = await get(
      `/v1/access/explain?principal=${ids.ada}&target=artifact:${dosing}`,
      'grace',
    );
    expect(noAdministerAnywhere.statusCode).toBe(403);
  });

  it('explains a space and its artifact for a tenant administrator denied the starter Administrator role there, rather than 404 for being unreadable', async () => {
    // The starter Administrator role holds `read`, so its denial used to trip the 404 read gate
    // before "administer at its level or above" got a chance to run (final review, item 2).
    const denied = await give({
      role: 'Administrator',
      subject: { principal: ids.ada! },
      level: { kind: 'space', id: clinical },
      effect: 'deny',
    });
    try {
      const space = await get(
        `/v1/access/explain?principal=${ids.grace}&target=space:${clinical}`,
        'ada',
      );
      expect(space.statusCode).toBe(200);
      const artifact = await get(
        `/v1/access/explain?principal=${ids.grace}&target=artifact:${dosing}`,
        'ada',
      );
      expect(artifact.statusCode).toBe(200);
    } finally {
      await tenantDb.withTenant(tenant, (trx) =>
        trx.deleteFrom('access_grant').where('id', '=', denied.id).execute(),
      );
    }

    // Alice holds neither administer nor read anywhere on that chain: the fix must not turn an
    // ordinary unreadable target into anything other than 404.
    const unreadable = await get(
      `/v1/access/explain?principal=${ids.grace}&target=space:${clinical}`,
      'alice',
    );
    expect(unreadable.statusCode).toBe(404);
  });

  it('reports administer on GET /v1/access by "at its level or above", the same rule the route check uses', async () => {
    const administerOnly = await tenantDb.withTenant(tenant, (trx) =>
      createRole(trx, 'Administer only for reporting', ['administer']),
    );
    if (!('role' in administerOnly)) throw new Error(`refused: ${administerOnly.refused}`);
    const denied = await give({
      role: administerOnly.role.name,
      subject: { principal: ids.ada! },
      level: { kind: 'space', id: clinical },
      effect: 'deny',
    });
    try {
      const response = await get(`/v1/access?target=space:${clinical}`, 'ada');
      expect(response.statusCode).toBe(200);
      const administer = response
        .json<{ permissions: { permission: string; allowed: boolean }[] }>()
        .permissions.find((answer) => answer.permission === 'administer');
      expect(administer).toMatchObject({ allowed: true });
    } finally {
      await tenantDb.withTenant(tenant, (trx) =>
        trx.deleteFrom('access_grant').where('id', '=', denied.id).execute(),
      );
    }
  });

  it('explains administer by "at its level or above" too, the same value the route helper reads (item B)', async () => {
    const administerOnly = await tenantDb.withTenant(tenant, (trx) =>
      createRole(trx, 'Administer only for explaining', ['administer']),
    );
    if (!('role' in administerOnly)) throw new Error(`refused: ${administerOnly.refused}`);
    const denied = await give({
      role: administerOnly.role.name,
      subject: { principal: ids.ada! },
      level: { kind: 'space', id: clinical },
      effect: 'deny',
    });
    try {
      const response = await get(
        `/v1/access/explain?principal=${ids.ada}&target=space:${clinical}`,
        'ada',
      );
      expect(response.statusCode).toBe(200);
      const administer = response
        .json<{ permissions: { permission: string; allowed: boolean; level: string | null }[] }>()
        .permissions.find((answer) => answer.permission === 'administer');
      expect(administer).toMatchObject({ allowed: true, level: 'tenant' });
    } finally {
      await tenantDb.withTenant(tenant, (trx) =>
        trx.deleteFrom('access_grant').where('id', '=', denied.id).execute(),
      );
    }
  });

  /**
   * For each permission-checked route: an address naming something in this environment that a
   * principal holding nothing is refused. A route missing here fails the harness, as
   * cross-tenant.test.ts does for path parameters.
   */
  const HOLDING_NOTHING: Readonly<
    Record<
      string,
      () => {
        readonly url: string;
        readonly status: 403 | 404;
        readonly payload?: Record<string, unknown>;
      }
    >
  > = {
    getAccess: () => ({ url: `/v1/access?target=artifact:${dosing}`, status: 404 }),
    explainAccess: () => ({
      url: `/v1/access/explain?principal=${ids.ada}&target=tenant`,
      status: 403,
    }),
    listComponentTypes: () => ({ url: `/v1/spaces/${clinical}/component-types`, status: 404 }),
    createComponent: () => ({
      url: `/v1/spaces/${clinical}/components`,
      status: 404,
      payload: { title: 'Not mine', language: 'en-GB', direction: 'ltr' },
    }),
    getComponent: () => ({ url: `/v1/components/${dosing}`, status: 404 }),
    createDocument: () => ({
      url: `/v1/spaces/${clinical}/documents`,
      status: 404,
      payload: { title: 'Not mine', language: 'en-GB', direction: 'ltr' },
    }),
    getDocument: () => ({ url: `/v1/documents/${report}`, status: 404 }),
    getNumbering: () => ({ url: `/v1/documents/${report}/numbering`, status: 404 }),
    getContributions: () => ({ url: `/v1/documents/${report}/contributions`, status: 404 }),
    editOutline: () => ({
      url: `/v1/documents/${report}/outline`,
      status: 404,
      payload: { openedFrom: MISSING, operation: { operation: 'remove', node: 'a'.repeat(26) } },
    }),
    requestPublication: () => ({
      url: `/v1/documents/${report}/publications`,
      status: 404,
      payload: { version: MISSING, formats: ['pdf'] },
    }),
    listPublications: () => ({ url: `/v1/documents/${report}/publications`, status: 404 }),
    getPublication: () => ({ url: `/v1/publications/${reportPublication}`, status: 404 }),
    claimLock: () => ({
      url: `/v1/components/${dosing}/lock`,
      status: 404,
      payload: { session: MISSING },
    }),
    releaseLock: () => ({
      url: `/v1/components/${dosing}/lock?session=${MISSING}&openedFrom=${MISSING}`,
      status: 404,
    }),
    cutVersion: () => ({
      url: `/v1/components/${dosing}/versions`,
      status: 404,
      payload: { session: MISSING, openedFrom: MISSING },
    }),
    saveIteration: () => ({
      url: `/v1/components/${dosing}/iterations/${MISSING}/1`,
      status: 404,
      payload: {
        openedFrom: MISSING,
        content: {
          schemaVersion: 1,
          title: 'Dosing',
          language: 'en-GB',
          direction: 'ltr',
          content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
        },
      },
    }),
    listGrants: () => ({ url: `/v1/grants?level=artifact:${dosing}`, status: 404 }),
    makeGrant: () => ({
      url: '/v1/grants',
      status: 404,
      payload: {
        role: MISSING,
        subject: { principal: ids.alice },
        level: `space:${clinical}`,
        effect: 'allow',
      },
    }),
    removeGrant: () => ({ url: `/v1/grants/${graceAuthors}`, status: 404 }),
    listRoles: () => ({ url: '/v1/roles?level=tenant', status: 403 }),
    listPrincipals: () => ({ url: `/v1/principals?level=space:${clinical}`, status: 404 }),
    listInvitations: () => ({ url: '/v1/invitations', status: 403 }),
    invite: () => ({
      url: '/v1/invitations',
      status: 403,
      payload: { email: 'ivy@example.com' },
    }),
    withdrawInvitation: () => ({ url: `/v1/invitations/${MISSING}`, status: 403 }),
  };

  const checked = allRoutes.filter((route) => route.access.check === 'permission');

  it('refuses a principal holding nothing on every route that checks a permission', async () => {
    expect(checked.length).toBeGreaterThan(0);
    for (const route of checked) {
      const address = HOLDING_NOTHING[route.operationId];
      expect(address, `${route.operationId} has no address in HOLDING_NOTHING`).toBeDefined();
      const { url, status, payload } = address!();
      const response = await app.inject({
        method: route.method,
        url,
        headers: { host: HOST, cookie: cookies.alice! },
        ...(payload ? { payload } : {}),
      });
      expect(response.statusCode, route.operationId).toBe(status);
    }
  });
});
