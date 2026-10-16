// apps/service/src/access-routes.test.ts
import { randomUUID } from 'node:crypto';
import { allRoutes } from '@alloy-works/api-contract';
import {
  addToGroup,
  bootstrapCluster,
  createArtifact,
  createAssetUpload,
  createConnection,
  createQueryDefinition,
  createDocument,
  createGroup,
  createRole,
  createTemplate,
  createSpace,
  createTenant,
  DEFAULT_LAYOUT_ID,
  DEFAULT_THEME_ID,
  deleteGroup,
  findRole,
  grant,
  migrate,
  receiveAssetBytes,
  recordAsset,
  recordPublication,
  makeBaseline,
  makeSuggestion,
  startThread,
  requestPublication,
  STARTER_COMPONENT_TYPE_ID,
  type NewGrant,
  type Tenant,
  type TenantDatabase,
  openRound,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import {
  DEFINITION_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  definitionsFor,
  type ComponentTypeDefinition,
  type ContentDocument,
} from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorise, type PermissionCheck } from './access.js';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const MISSING = '00000000-0000-4000-8000-000000000000';

/** A template definition any environment resolves: the default theme and layout, one section. */
const aTemplate = () => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  name: 'Plan',
  theme: DEFAULT_THEME_ID,
  layout: DEFAULT_LAYOUT_ID,
  schemas: [],
  outline: {
    sections: [
      {
        key: 'introduction',
        title: [{ type: 'text', value: 'Introduction', marks: [] }],
        required: false,
        numbered: true,
        matter: 'body',
        pageBreak: 'none',
        children: [],
      },
    ],
  },
  changes: { add: true, remove: true, reorder: true },
});

/** A query definition's shape, naming a connection by id: what a route's shape needs. */
const aQueryDefinition = (connection: string) => ({
  schemaVersion: 1,
  title: 'Elsewhere',
  description: '',
  connection,
  parameters: [],
  fetch: { kind: 'sql', text: 'select 1 as one' },
  columns: [{ name: 'one', from: { column: 'one' }, type: { base: 'integer' } }],
  key: ['one'],
  order: [{ column: 'one', direction: 'ascending' }],
  empty: 'valid',
  limits: { rows: 10, bytes: 1024, seconds: 5 },
  retired: false,
});

/** A connection's settings any environment takes. */
const aConnection = () =>
  ({
    schemaVersion: 1,
    name: 'Readings',
    description: '',
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
  }) as const;

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
  let reportBaseline: string;
  let reportThread: string;
  let dosingSuggestion: string;
  let reportRound: string;
  let plan: string;
  let readings: string;
  let dailyReadings: string;
  let clinicalImage: string;
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
    await configureStandIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
    });
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
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
        // Named apart from the starter Topic: two component types may not share a name (MET-031).
        name: 'Probe type',
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
        // Made under a layout, as every request since layouts is: template 2 and pipeline 2.
        pipelineVersion: '2',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: 'default/1', entries: [] },
        outputs: [
          {
            format: 'pdf' as const,
            engineVersion: '0.15.1',
            templateVersion: 2,
            key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1,
          },
        ],
      });
      if (!recorded) throw new Error('The publication was not recorded');
      reportPublication = recorded;
      // And a baseline of it, which a route on a baseline must refuse as it refuses the document.
      const pinned = await makeBaseline(trx, {
        documentId: report,
        version: made.version.id,
        name: 'As approved',
        maker: ids.ada!,
      });
      if (pinned.answer !== 'made') throw new Error(`refused: ${pinned.answer}`);
      reportBaseline = pinned.baseline;
      // And a thread on Dosing, which a route on a thread must refuse as it refuses Dosing (TH-J).
      const dosingVersion = await trx
        .selectFrom('artifact_version')
        .select('id')
        .where('artifact_id', '=', dosing)
        .executeTakeFirstOrThrow();
      const thread = await startThread(trx, {
        on: dosing,
        version: dosingVersion.id,
        anchor: { kind: 'component' },
        parts: [{ text: 'Is this right?' }],
        author: ids.ada!,
      });
      if (thread.answer !== 'done') throw new Error(`refused: ${thread.answer}`);
      reportThread = thread.thread;
      // And a suggestion on Dosing, which a route on a suggestion must refuse as it refuses Dosing.
      const dosingRead = await trx
        .selectFrom('artifact_version')
        .select('content')
        .where('id', '=', dosingVersion.id)
        .executeTakeFirstOrThrow();
      const suggested = await makeSuggestion(trx, {
        component: dosing,
        version: dosingVersion.id,
        proposed: { ...(dosingRead.content as ContentDocument), title: 'Dosing, revised' },
        by: ids.ada!,
      });
      if (suggested.answer !== 'made') throw new Error(`refused: ${suggested.answer}`);
      dosingSuggestion = suggested.suggestion;
      // And a round on Report, which a route on a round must refuse as it refuses Report.
      const opened = await openRound(trx, {
        document: report,
        title: 'A round',
        scope: [],
        dueAt: new Date(Date.now() + 86_400_000),
        baseline: null,
        reviewers: [ids.ada!],
        by: ids.ada!,
      });
      if (opened.answer !== 'opened') throw new Error(`refused: ${opened.answer}`);
      reportRound = opened.round.id;
      // And a template in Clinical, which a route reading or changing it must refuse to name.
      const template = await createTemplate(trx, {
        spaceId: clinical,
        definition: aTemplate(),
        author: ids.ada!,
      });
      if (template.answer !== 'created') throw new Error(`refused: ${template.answer}`);
      plan = template.template.id;
      // And a connection in Clinical, which a route reading, changing or using it must refuse.
      const connection = await createConnection(trx, {
        spaceId: clinical,
        settings: aConnection(),
        author: ids.ada!,
      });
      if (connection.answer !== 'created') throw new Error(`refused: ${connection.answer}`);
      readings = connection.connection.id;
      // And a query definition in Clinical naming it, which a route reading or changing it must
      // refuse to name.
      const definition = await createQueryDefinition(trx, {
        spaceId: clinical,
        definition: aQueryDefinition(readings),
        author: ids.ada!,
      });
      if (definition.answer !== 'created') throw new Error(`refused: ${definition.answer}`);
      dailyReadings = definition.definition.id;
      // And an image in Clinical, made as the `ingest` job makes one, over an object that need not
      // exist: a route reading it must refuse before it reads the store.
      const upload = await createAssetUpload(trx, {
        spaceId: clinical,
        uploader: ids.ada!,
        alternative: null,
      });
      await receiveAssetBytes(trx, upload.id, {
        key: `${tenant.role}/sha256/${'e'.repeat(64)}`,
        format: 'png',
        bytes: 1,
      });
      clinicalImage = (
        await recordAsset(trx, upload.id, {
          format: 'png',
          width: 1,
          height: 1,
          orientation: 1,
          colour: 'rgb',
          alpha: false,
          depth: 8,
          resolution: null,
          end: 1,
        })
      ).id;
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

  it('IAM-030 names the group a deciding grant reached the person through by its name, beside the grant and its level', async () => {
    const made = await tenantDb.withTenant(tenant, (trx) => createGroup(trx, 'Auditors'));
    if (!('group' in made)) throw new Error(`refused: ${made.refused}`);
    const auditors = made.group.id;
    try {
      await tenantDb.withTenant(tenant, (trx) => addToGroup(trx, auditors, ids.alice!));
      await give({
        role: 'Reader',
        subject: { group: auditors },
        level: { kind: 'artifact', id: audit },
        effect: 'allow',
      });
      const response = await get(
        `/v1/access/explain?principal=${ids.alice}&target=artifact:${audit}`,
        'ada',
      );
      expect(response.statusCode).toBe(200);
      const read = response
        .json<{ permissions: { permission: string; [member: string]: unknown }[] }>()
        .permissions.find((answer) => answer.permission === 'read');
      expect(read).toMatchObject({
        allowed: true,
        reason: 'allowed',
        level: `artifact:${audit}`,
        grants: [
          {
            role: 'Reader',
            effect: 'allow',
            subject: { group: auditors },
            through: auditors,
            groupName: 'Auditors',
          },
        ],
      });

      // A grant made to the person directly names no group.
      const direct = await get(
        `/v1/access/explain?principal=${ids.grace}&target=artifact:${dosing}`,
        'ada',
      );
      const edit = direct
        .json<{ permissions: { permission: string; grants: unknown[] }[] }>()
        .permissions.find((answer) => answer.permission === 'edit');
      expect(edit?.grants).toEqual([expect.objectContaining({ through: null, groupName: null })]);
    } finally {
      // With its grant, which goes with it.
      await tenantDb.withTenant(tenant, (trx) => deleteGroup(trx, auditors));
    }
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
    // Byte for byte but for the trace id, which is every request's own - in the body and in the
    // request identifier header (API-047), which is the same value - and the date, which is every
    // response's own.
    const untracedBody = (body: Record<string, string>) =>
      Object.fromEntries(Object.entries(body).filter(([member]) => member !== 'traceId'));
    const untracedHeaders = (headers: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(headers).filter(([name]) => name !== 'date' && name !== 'x-request-id'),
      );
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
    listComponentVersions: () => ({ url: `/v1/components/${dosing}/versions`, status: 404 }),
    listComponentApprovals: () => ({ url: `/v1/components/${dosing}/approvals`, status: 404 }),
    listDocumentApprovals: () => ({ url: `/v1/documents/${MISSING}/approvals`, status: 404 }),
    createDocument: () => ({
      url: `/v1/spaces/${clinical}/documents`,
      status: 404,
      payload: { title: 'Not mine', language: 'en-GB', direction: 'ltr' },
    }),
    getDocument: () => ({ url: `/v1/documents/${report}`, status: 404 }),
    getNumbering: () => ({ url: `/v1/documents/${report}/numbering`, status: 404 }),
    getDocumentPresentation: () => ({ url: `/v1/documents/${report}/presentation`, status: 404 }),
    getContributions: () => ({ url: `/v1/documents/${report}/contributions`, status: 404 }),
    getDocumentTexts: () => ({ url: `/v1/documents/${report}/texts`, status: 404 }),
    editOutline: () => ({
      url: `/v1/documents/${report}/outline`,
      status: 404,
      payload: { openedFrom: MISSING, operation: { operation: 'remove', node: 'a'.repeat(26) } },
    }),
    recordDocumentValues: () => ({
      url: `/v1/documents/${report}/values`,
      status: 404,
      payload: { openedFrom: MISSING, values: {} },
    }),
    getDocumentParameters: () => ({ url: `/v1/documents/${report}/parameters`, status: 404 }),
    recordDocumentParameters: () => ({
      url: `/v1/documents/${report}/parameters`,
      status: 404,
      payload: { openedFrom: MISSING, parameters: {} },
    }),
    recordDocumentProfile: () => ({
      url: `/v1/documents/${report}/profile`,
      status: 404,
      payload: { openedFrom: MISSING, profile: null },
    }),
    requestPublication: () => ({
      url: `/v1/documents/${report}/publications`,
      status: 404,
      payload: { version: MISSING, formats: ['pdf'] },
    }),
    requestPreview: () => ({
      url: `/v1/documents/${report}/previews`,
      status: 404,
      payload: { version: MISSING },
    }),
    listPublications: () => ({ url: `/v1/documents/${report}/publications`, status: 404 }),
    getPublication: () => ({ url: `/v1/publications/${reportPublication}`, status: 404 }),
    makeBaseline: () => ({
      url: `/v1/documents/${report}/baselines`,
      status: 404,
      payload: { version: MISSING, name: 'Probe' },
    }),
    listBaselines: () => ({ url: `/v1/documents/${report}/baselines`, status: 404 }),
    getBaseline: () => ({ url: `/v1/baselines/${reportBaseline}`, status: 404 }),
    getBaselineView: () => ({ url: `/v1/baselines/${reportBaseline}/view`, status: 404 }),
    listBaselineThreads: () => ({
      url: `/v1/baselines/${reportBaseline}/threads`,
      status: 404,
    }),
    compareComponentVersions: () => ({
      url: `/v1/components/${dosing}/comparison?from=${MISSING}&to=${MISSING}`,
      status: 404,
    }),
    compareBaselineResolved: () => ({
      url: `/v1/baselines/${reportBaseline}/comparison/resolved?with=now`,
      status: 404,
    }),
    compareBaseline: () => ({
      url: `/v1/baselines/${reportBaseline}/comparison?with=now`,
      status: 404,
    }),
    publishBaseline: () => ({
      url: `/v1/baselines/${reportBaseline}/publications`,
      status: 404,
      payload: { formats: ['pdf'] },
    }),
    supersedeBaseline: () => ({
      url: `/v1/baselines/${reportBaseline}/supersession`,
      status: 404,
      payload: { by: MISSING },
    }),
    startDocumentThread: () => ({
      url: `/v1/documents/${report}/threads`,
      status: 404,
      payload: { version: MISSING, anchor: { kind: 'component' }, parts: [{ text: 'Hm' }] },
    }),
    listDocumentThreads: () => ({ url: `/v1/documents/${report}/threads`, status: 404 }),
    startComponentThread: () => ({
      url: `/v1/components/${dosing}/threads`,
      status: 404,
      payload: { version: MISSING, anchor: { kind: 'component' }, parts: [{ text: 'Hm' }] },
    }),
    listComponentThreads: () => ({ url: `/v1/components/${dosing}/threads`, status: 404 }),
    getThread: () => ({ url: `/v1/threads/${reportThread}`, status: 404 }),
    makeSuggestion: () => ({
      url: `/v1/components/${dosing}/suggestions`,
      status: 404,
      payload: { version: MISSING, content: { title: 'x' } },
    }),
    listComponentSuggestions: () => ({ url: `/v1/components/${dosing}/suggestions`, status: 404 }),
    listDocumentSuggestions: () => ({ url: `/v1/documents/${report}/suggestions`, status: 404 }),
    getSuggestion: () => ({ url: `/v1/suggestions/${dosingSuggestion}`, status: 404 }),
    acceptSuggestion: () => ({
      url: `/v1/suggestions/${dosingSuggestion}/acceptance`,
      status: 404,
    }),
    rejectSuggestion: () => ({ url: `/v1/suggestions/${dosingSuggestion}/rejection`, status: 404 }),
    withdrawSuggestion: () => ({
      url: `/v1/suggestions/${dosingSuggestion}/withdrawal`,
      status: 404,
    }),
    resolveSuggestions: () => ({
      url: '/v1/suggestions/resolutions',
      status: 404,
      payload: { act: 'reject', scope: `artifact:${dosing}` },
    }),
    openRound: () => ({
      url: `/v1/documents/${report}/rounds`,
      status: 404,
      payload: {
        title: 'Probe',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        reviewers: [ids.ada!],
      },
    }),
    listRounds: () => ({ url: `/v1/documents/${report}/rounds`, status: 404 }),
    getRound: () => ({ url: `/v1/rounds/${reportRound}`, status: 404 }),
    closeRound: () => ({ url: `/v1/rounds/${reportRound}/closure`, status: 404 }),
    startReview: () => ({ url: `/v1/rounds/${reportRound}/start`, status: 404 }),
    completeReview: () => ({
      url: `/v1/rounds/${reportRound}/completion`,
      status: 404,
      payload: { outcome: 'commented' },
    }),
    reopenReview: () => ({ url: `/v1/rounds/${reportRound}/reopening`, status: 404 }),
    addComment: () => ({
      url: `/v1/threads/${reportThread}/comments`,
      status: 404,
      payload: { parts: [{ text: 'Hm' }] },
    }),
    editComment: () => ({
      url: `/v1/threads/${reportThread}/comments/${MISSING}`,
      status: 404,
      payload: { parts: [{ text: 'Hm' }] },
    }),
    resolveThread: () => ({ url: `/v1/threads/${reportThread}/resolution`, status: 404 }),
    getPublicationBindings: () => ({
      url: `/v1/publications/${reportPublication}/bindings`,
      status: 404,
    }),
    createTemplate: () => ({
      url: `/v1/spaces/${clinical}/templates`,
      status: 404,
      payload: { definition: aTemplate() },
    }),
    getTemplate: () => ({ url: `/v1/templates/${plan}`, status: 404 }),
    createConnection: () => ({
      url: `/v1/spaces/${clinical}/connections`,
      status: 404,
      payload: { settings: aConnection() },
    }),
    getConnection: () => ({ url: `/v1/connections/${readings}`, status: 404 }),
    recordConnectionVersion: () => ({
      url: `/v1/connections/${readings}/versions`,
      status: 404,
      payload: { openedFrom: MISSING, settings: aConnection() },
    }),
    setConnectionCredential: () => ({
      url: `/v1/connections/${readings}/credential`,
      status: 404,
      payload: { secret: 'an-invented-password' },
    }),
    testConnection: () => ({ url: `/v1/connections/${readings}/test`, status: 404, payload: {} }),
    describeConnection: () => ({
      url: `/v1/connections/${readings}/describe`,
      status: 404,
      payload: {},
    }),
    sampleConnection: () => ({
      url: `/v1/connections/${readings}/sample`,
      status: 404,
      payload: {
        definition: (({ title: _t, description: _d, retired: _r, ...draft }) => draft)(
          aQueryDefinition(readings),
        ),
        values: {},
      },
    }),
    getConnectionUses: () => ({ url: `/v1/connections/${readings}/uses`, status: 404 }),
    getQueryDefinitionUses: () => ({
      url: `/v1/query-definitions/${dailyReadings}/uses`,
      status: 404,
    }),
    // A document's bindings, and a dataset: the document is one she may not read, and so is the
    // definition, which stands for a dataset in its space.
    getDocumentBindings: () => ({ url: `/v1/documents/${report}/bindings`, status: 404 }),
    resolveBindings: () => ({
      url: `/v1/documents/${report}/bindings/resolve`,
      status: 404,
      payload: { bindings: [{ node: 'a'.repeat(26), binding: 'b1' }] },
    }),
    checkBindings: () => ({
      url: `/v1/documents/${report}/bindings/check`,
      status: 404,
      payload: {},
    }),
    acceptBinding: () => ({
      url: `/v1/documents/${report}/bindings/accept`,
      status: 404,
      payload: { node: 'a'.repeat(26), binding: 'b1', version: MISSING, replaces: MISSING },
    }),
    getDocumentDataset: () => ({
      url: `/v1/documents/${report}/datasets/${MISSING}`,
      status: 404,
    }),
    getBoundTableRows: () => ({
      url: `/v1/documents/${report}/bindings/${'a'.repeat(26)}/b1/rows?version=${MISSING}`,
      status: 404,
    }),
    confirmBinding: () => ({
      url: `/v1/documents/${report}/bindings/confirm`,
      status: 404,
      payload: { node: 'a'.repeat(26), binding: 'b1', replaces: MISSING },
    }),
    reviseBinding: () => ({
      url: `/v1/documents/${report}/bindings/revisions`,
      status: 404,
      payload: {
        node: 'a'.repeat(26),
        binding: 'b1',
        act: 'revise',
        value: '1',
        reason: 'Probe',
        resolution: '1',
        replaces: null,
      },
    }),
    getBindingHolders: () => ({ url: `/v1/components/${dosing}/bindings/b1/holders`, status: 404 }),
    nameDataset: () => ({
      url: `/v1/datasets/${dailyReadings}/name`,
      status: 404,
      payload: { name: 'Probe' },
    }),
    createQueryDefinition: () => ({
      url: `/v1/spaces/${clinical}/query-definitions`,
      status: 404,
      payload: { definition: aQueryDefinition(readings) },
    }),
    getQueryDefinition: () => ({ url: `/v1/query-definitions/${dailyReadings}`, status: 404 }),
    listQueryDefinitionApprovals: () => ({
      url: `/v1/query-definitions/${dailyReadings}/approvals`,
      status: 404,
    }),
    transitionQueryDefinition: () => ({
      url: `/v1/query-definitions/${dailyReadings}/transitions`,
      status: 404,
      payload: { transition: 'submit', from: 'draft' },
    }),
    decideQueryDefinitionGate: () => ({
      url: `/v1/query-definitions/${dailyReadings}/approvals`,
      status: 404,
      payload: { transition: 'approve', version: MISSING, decision: 'approved' },
    }),
    recordQueryDefinitionVersion: () => ({
      url: `/v1/query-definitions/${dailyReadings}/versions`,
      status: 404,
      payload: { openedFrom: MISSING, definition: aQueryDefinition(readings) },
    }),
    listDefinitions: () => ({ url: '/v1/definitions', status: 403 }),
    createDefinition: () => ({
      url: '/v1/definitions',
      status: 403,
      payload: {
        kind: 'field',
        definition: {
          schemaVersion: 1,
          name: 'Probe',
          dataType: 'text',
          multiplicity: 'one',
          validation: {},
        },
      },
    }),
    // The starter component type every environment holds: a definition this principal may not read.
    getDefinition: () => ({ url: `/v1/definitions/${STARTER_COMPONENT_TYPE_ID}`, status: 404 }),
    recordDefinitionVersion: () => ({
      url: `/v1/definitions/${STARTER_COMPONENT_TYPE_ID}/versions`,
      status: 404,
      payload: {
        openedFrom: MISSING,
        definition: {
          schemaVersion: 1,
          name: 'Probe',
          dataType: 'text',
          multiplicity: 'one',
          validation: {},
        },
      },
    }),
    recordTemplateVersion: () => ({
      url: `/v1/templates/${plan}/versions`,
      status: 404,
      payload: { openedFrom: MISSING, definition: aTemplate() },
    }),
    claimLock: () => ({
      url: `/v1/components/${dosing}/lock`,
      status: 404,
      payload: { session: MISSING },
    }),
    takeLock: () => ({
      url: `/v1/components/${dosing}/lock/take`,
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
    listDocumentVersions: () => ({ url: `/v1/documents/${report}/versions`, status: 404 }),
    getDocumentVersion: () => ({ url: `/v1/documents/${report}/versions/${MISSING}`, status: 404 }),
    getComponentVersion: () => ({
      url: `/v1/components/${dosing}/versions/${MISSING}`,
      status: 404,
    }),
    previewDocumentRestore: () => ({
      url: `/v1/documents/${report}/versions/${MISSING}/restoration`,
      status: 404,
    }),
    restoreDocumentVersion: () => ({
      url: `/v1/documents/${report}/versions/${MISSING}/restore`,
      status: 404,
      payload: { latest: MISSING },
    }),
    archiveComponent: () => ({ url: `/v1/components/${dosing}/archive`, status: 404 }),
    unarchiveComponent: () => ({ url: `/v1/components/${dosing}/unarchive`, status: 404 }),
    archiveDocument: () => ({ url: `/v1/documents/${report}/archive`, status: 404 }),
    unarchiveDocument: () => ({ url: `/v1/documents/${report}/unarchive`, status: 404 }),
    getComponentDeletion: () => ({ url: `/v1/components/${dosing}/deletion`, status: 404 }),
    getComponentUses: () => ({ url: `/v1/components/${dosing}/uses`, status: 404 }),
    getArtifactImpact: () => ({ url: `/v1/artifacts/${dosing}/impact?depth=1`, status: 404 }),
    getArtifactReferences: () => ({ url: `/v1/artifacts/${dosing}/references`, status: 404 }),
    submitImpactReport: () => ({
      url: `/v1/artifacts/${dosing}/impact-reports`,
      status: 404,
      payload: { depth: 1 },
    }),
    getJob: () => ({ url: `/v1/jobs/${MISSING}`, status: 404 }),
    submitCohort: () => ({
      url: `/v1/spaces/${MISSING}/cohorts`,
      status: 404,
      payload: {
        template: MISSING,
        title: 'Report',
        language: 'en-GB',
        direction: 'ltr',
        rows: [{}],
      },
    }),
    getCohort: () => ({ url: `/v1/cohorts/${MISSING}`, status: 404 }),
    rerunCohort: () => ({ url: `/v1/cohorts/${MISSING}/rerun`, status: 404, payload: {} }),
    cancelJob: () => ({ url: `/v1/jobs/${MISSING}/cancel`, status: 404 }),
    downloadJob: () => ({ url: `/v1/jobs/${MISSING}/download`, status: 404 }),
    placeSection: () => ({
      url: `/v1/documents/${report}/placement`,
      status: 404,
      payload: {
        openedFrom: MISSING,
        from: MISSING,
        fromVersion: MISSING,
        section: 'x',
        parent: null,
        position: 0,
        title: [{ type: 'text', value: 'Upkeep', marks: [] }],
        mode: 'latest',
      },
    }),
    previewPlacement: () => ({
      url: `/v1/documents/${report}/placement?from=${report}&section=x`,
      status: 404,
    }),
    deleteComponent: () => ({ url: `/v1/components/${dosing}/delete`, status: 404 }),
    undeleteComponent: () => ({ url: `/v1/components/${dosing}/undelete`, status: 404 }),
    getDocumentDeletion: () => ({ url: `/v1/documents/${report}/deletion`, status: 404 }),
    deleteDocument: () => ({ url: `/v1/documents/${report}/delete`, status: 404 }),
    undeleteDocument: () => ({ url: `/v1/documents/${report}/undelete`, status: 404 }),
    previewRestore: () => ({
      url: `/v1/components/${dosing}/versions/${MISSING}/restoration`,
      status: 404,
    }),
    restoreVersion: () => ({
      url: `/v1/components/${dosing}/versions/${MISSING}/restore`,
      status: 404,
      payload: { latest: MISSING },
    }),
    listIterations: () => ({
      url: `/v1/components/${dosing}/iterations?session=${MISSING}`,
      status: 404,
    }),
    getIteration: () => ({
      url: `/v1/components/${dosing}/iterations/${MISSING}?session=${MISSING}`,
      status: 404,
    }),
    discardUnsaved: () => ({
      url: `/v1/components/${dosing}/unsaved/discarded`,
      status: 404,
      payload: { upTo: '2026-10-10T17:18:43.000Z' },
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
    // A group is an administrator's of the whole environment, so it is refused before it is looked
    // for: 403, never 404, whether or not the group exists.
    listGroups: () => ({ url: '/v1/groups', status: 403 }),
    createGroup: () => ({ url: '/v1/groups', status: 403, payload: { name: 'Mine' } }),
    setGroupMembers: () => ({
      url: `/v1/groups/${MISSING}/members`,
      status: 403,
      payload: { principals: [] },
    }),
    deleteGroup: () => ({ url: `/v1/groups/${MISSING}`, status: 403 }),
    // A legal hold is an administrator's of the whole environment (AH-G): refused before it is
    // looked for.
    listHolds: () => ({ url: '/v1/holds', status: 403 }),
    // A retention keep is an administrator's of the whole environment (DL-G): refused before the
    // space it names is looked for.
    getRetention: () => ({ url: '/v1/retention', status: 403 }),
    setRetention: () => ({
      url: '/v1/retention',
      status: 403,
      payload: { kind: null, space: MISSING, days: 5 },
    }),
    // A workflow is an administrator's of the whole environment (WF-J): refused before its kind's
    // versions are looked for. A move is decided on reading the artifact first (WF-F).
    listWorkflows: () => ({ url: '/v1/workflows', status: 403 }),
    getWorkflowVersion: () => ({ url: '/v1/workflows/component/versions/9', status: 403 }),
    defineWorkflow: () => ({
      url: '/v1/workflows',
      status: 403,
      payload: {
        kind: 'component',
        states: [{ key: 'draft', name: 'Draft', initial: true }],
        transitions: [],
      },
    }),
    transitionComponent: () => ({
      url: `/v1/components/${dosing}/transitions`,
      status: 404,
      payload: { transition: 'submit', from: 'draft' },
    }),
    transitionDocument: () => ({
      url: `/v1/documents/${MISSING}/transitions`,
      status: 404,
      payload: { transition: 'submit', from: 'draft' },
    }),
    decideComponentGate: () => ({
      url: `/v1/components/${dosing}/approvals`,
      status: 404,
      payload: { transition: 'approve', version: MISSING, decision: 'approved' },
    }),
    decideDocumentGate: () => ({
      url: `/v1/documents/${MISSING}/approvals`,
      status: 404,
      payload: { transition: 'approve', version: MISSING, decision: 'approved' },
    }),
    setComponentDates: () => ({
      url: `/v1/components/${dosing}/dates`,
      status: 404,
      payload: { effectiveAt: null, reviewBy: '2030-01-01', owner: null },
    }),
    previewTemplateMove: () => ({
      url: `/v1/documents/${MISSING}/template-move?to=${MISSING}`,
      status: 404,
    }),
    moveDocumentTemplate: () => ({
      url: `/v1/documents/${MISSING}/template-move`,
      status: 404,
      payload: { latest: MISSING, to: MISSING },
    }),
    setDocumentDates: () => ({
      url: `/v1/documents/${MISSING}/dates`,
      status: 404,
      payload: { effectiveAt: null, reviewBy: '2030-01-01', owner: null },
    }),
    placeHold: () => ({
      url: '/v1/holds',
      status: 403,
      payload: { target: { artifact: dosing }, reason: 'Mine' },
    }),
    releaseHold: () => ({
      url: `/v1/holds/${MISSING}/release`,
      status: 403,
      payload: { reason: 'Mine' },
    }),
    // The audit log is read by an administrator of the whole environment (AU-G).
    listAuditEvents: () => ({ url: '/v1/audit', status: 403 }),
    requestAuditExport: () => ({ url: '/v1/audit/exports', status: 403, payload: {} }),
    getAuditExport: () => ({ url: `/v1/audit/exports/${MISSING}`, status: 403 }),
    downloadAuditExport: () => ({ url: `/v1/audit/exports/${MISSING}/download`, status: 403 }),
    // A space is made, renamed and archived by an administrator of the whole environment (SP-A), so
    // each is refused before the space is looked for: 403, never 404.
    createSpace: () => ({ url: '/v1/spaces', status: 403, payload: { name: 'Mine' } }),
    updateSpace: () => ({
      url: `/v1/spaces/${MISSING}`,
      status: 403,
      payload: { name: 'Mine' },
    }),
    // A person is erased by an administrator of the whole environment (ER-C).
    getErasure: () => ({ url: `/v1/principals/${ids.alice}/erasure`, status: 403 }),
    erasePrincipal: () => ({ url: `/v1/principals/${ids.alice}/erase`, status: 403 }),
    listPrincipalTokens: () => ({ url: `/v1/principals/${ids.alice}/tokens`, status: 403 }),
    revokePrincipalToken: () => ({
      url: `/v1/principals/${ids.alice}/tokens/${MISSING}`,
      status: 403,
    }),
    setEditingSettings: () => ({
      url: '/v1/settings/editing',
      status: 403,
      payload: { iterationRetentionDays: 7 },
    }),
    setDataSettings: () => ({ url: '/v1/settings/data', status: 403, payload: { rows: 10 } }),
    createAssetUpload: () => ({
      url: `/v1/spaces/${clinical}/asset-uploads`,
      status: 404,
      payload: { alternative: null },
    }),
    getAssetVersion: () => ({ url: `/v1/asset-versions/${clinicalImage}`, status: 404 }),
    getAssetVersionContent: () => ({
      url: `/v1/asset-versions/${clinicalImage}/content`,
      status: 404,
    }),
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
