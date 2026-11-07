import {
  bootstrapCluster,
  createComponent,
  createDocument,
  createSpace,
  createTenant,
  findRole,
  grant,
  listenToTenants,
  migrate,
  type Tenant,
  type TenantDatabase,
  type TenantListener,
} from '@alloy-works/db';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allRoutes } from '@alloy-works/api-contract';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { decidedBySpace } from './support.js';
import { openStream } from './test/frames.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

// A hostname that resolves to this machine: the stream is read over a real socket.
const HOST = '127.0.0.1';
const DAY = 86_400_000;
const MISSING = '00000000-0000-4000-8000-000000000000';
const SUPPORT = ['sam', 'cam', 'dot', 'rex', 'tia', 'una'];

type Json = Record<string, unknown>;

describe('support access (support.md; the SA plan, SAb)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let events: TenantListener;
  let app: FastifyInstance;
  let address = '';
  let tenant: Tenant;
  let clinical = '';
  let quality = '';
  let inClinical = '';
  let inQuality = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const supports: Record<string, string> = {};

  const call = (
    who: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Json,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[who]!, ...headers },
      ...(payload ? { payload } : {}),
    });
  const get = (who: string, url: string, headers?: Record<string, string>) =>
    call(who, 'GET', url, undefined, headers);
  const granting = (who: string, payload: Json) => call(who, 'POST', '/v1/support-access', payload);
  const supportFor = (
    user: string,
    scope: 'diagnostics' | 'metadata' | 'content',
    spaces: string[],
    days = 7,
  ) => ({
    email: `${user}@vendor.example`,
    scope,
    spaces,
    purpose: `Looking at ${user}'s ticket`,
    expiresAt: new Date(Date.now() + days * DAY).toISOString(),
  });
  const events_ = (kind: string) =>
    tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['actor', 'subject', 'detail'])
        .where('kind', '=', kind as never)
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
      users: [
        { id: 'ada', name: 'Ada', email: 'ada@acme.example' },
        { id: 'hedy', name: 'Hedy', email: 'hedy@acme.example' },
        ...SUPPORT.map((id) => ({ id, name: id, email: `${id}@vendor.example` })),
      ],
    });
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureStandIn(db.adminUrl, tenant, { issuer: idp.issuer, clientId: 'alloy' });
    tenantDb = testTenantDatabase(db.serviceUrl);
    events = listenToTenants(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
      events,
    });
    address = await app.listen({ port: 0, host: HOST });
    for (const who of ['ada', 'hedy']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await get(who, '/v1/me')).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
      // Ada administers; Hedy administers without granting support.
      await grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      const plain = await trx
        .insertInto('role')
        .values({ name: 'Plain administrator', permissions: ['read', 'administer'] })
        .returning('id')
        .executeTakeFirstOrThrow();
      await grant(trx, {
        roleId: plain.id,
        subject: { principal: ids.hedy! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      const component = async (spaceId: string, title: string) => {
        const made = await createComponent(trx, {
          spaceId,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ids.ada!,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        return made.version.artifactId;
      };
      inClinical = await component(clinical, 'Dosing table');
      inQuality = await component(quality, 'Audit checklist');
    });
    // Each support person is granted by address before they first sign in, which claims it.
    const given: Record<string, ['diagnostics' | 'metadata' | 'content', string[]]> = {
      sam: ['metadata', [clinical]],
      cam: ['content', [clinical]],
      dot: ['diagnostics', [clinical]],
      rex: ['metadata', [clinical]],
      tia: ['metadata', [clinical]],
      // Una's lasts a month, so a cap lowered to 20 days ends hers alone.
      una: ['metadata', [clinical]],
    };
    for (const who of SUPPORT) {
      const [scope, spaces] = given[who]!;
      const made = await granting('ada', supportFor(who, scope, spaces, who === 'una' ? 30 : 7));
      expect(made.statusCode, made.body).toBe(200);
      supports[who] = made.json<{ support: { id: string } }>().support.id;
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await get(who, '/v1/me')).json<{ id: string }>().id;
    }
  });

  afterAll(async () => {
    await app.close();
    await events.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('IAM-070 grants support only to whoever holds grant_support, and lets nobody give grant_support who does not hold it', async () => {
    const refused = await granting('hedy', supportFor('zed', 'metadata', [clinical]));
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'forbidden' });
    // ADR-0091: Hedy administers, and cannot hand anybody the Administrator role, which holds it.
    const administrator = await tenantDb.withTenant(
      tenant,
      async (trx) => (await findRole(trx, 'Administrator'))!.id,
    );
    const beyond = await call('hedy', 'POST', '/v1/grants', {
      role: administrator,
      subject: { principal: ids.hedy },
      level: 'tenant',
      effect: 'allow',
    });
    expect(beyond.statusCode, beyond.body).toBe(403);
    expect(beyond.json()).toMatchObject({ code: 'grant_beyond_held' });
    expect(beyond.json<{ message: string }>().message).toContain('grant_support');
  });

  it('ADM-042 grants support with its scope, spaces, purpose, expiry and person, audited, and lists it to every administrator', async () => {
    const listed = await get('hedy', '/v1/support-access');
    expect(listed.statusCode).toBe(200);
    const sam = listed
      .json<{ items: Json[]; active: number }>()
      .items.find((each) => each.id === supports.sam);
    expect(sam).toMatchObject({
      person: { id: ids.sam, email: 'sam@vendor.example' },
      scope: 'metadata',
      spaces: [clinical],
      purpose: "Looking at sam's ticket",
      grantedBy: { id: ids.ada, name: 'Ada' },
      revokedAt: null,
      revokedReason: null,
      active: true,
    });
    // What a grant may last, for the form that makes one: the policy on access from outside.
    expect(listed.json()).toMatchObject({ defaultDays: 30, capDays: 90 });
    expect((await events_('support.granted')).map((each) => each.subject)).toEqual(
      expect.arrayContaining([supports.sam, supports.cam]),
    );
    // Somebody inside is never support, and a second while one is active is refused.
    expect(
      (
        await granting('ada', {
          ...supportFor('ada', 'metadata', [clinical]),
          email: 'ada@acme.example',
        })
      ).json(),
    ).toMatchObject({ code: 'support_member' });
    expect((await granting('ada', supportFor('sam', 'content', [clinical]))).json()).toMatchObject({
      code: 'support_active',
    });
    expect(
      (await granting('ada', supportFor('zed', 'metadata', [clinical], 400))).json(),
    ).toMatchObject({ code: 'support_past_cap' });
    expect((await granting('ada', supportFor('zed', 'content', []))).json()).toMatchObject({
      code: 'support_spaces_required',
    });
  });

  it('ADM-022 lets a metadata-scope support person read metadata in a granted space, and refuses content, another space, every write and a token', async () => {
    const activity = await get('sam', `/v1/components/${inClinical}/activity`);
    expect(activity.statusCode, activity.body).toBe(200);
    const spaces = (await get('sam', '/v1/spaces')).json<{ items: { id: string }[] }>().items;
    expect(spaces.map((each) => each.id)).toEqual([clinical]);
    // Content, even with a reason given, is beyond a metadata grant.
    const content = await get('sam', `/v1/components/${inClinical}`, { 'support-read': 'Why' });
    expect(content.statusCode).toBe(403);
    expect(content.json()).toMatchObject({ code: 'support_scope' });
    expect((await get('sam', `/v1/components/${inQuality}/activity`)).statusCode).toBe(404);
    for (const [method, url, payload] of [
      ['POST', `/v1/components/${inClinical}/threads`, { parts: [{ text: 'Hello' }] }],
      ['POST', '/v1/spaces', { name: 'Support space' }],
      [
        'POST',
        '/v1/tokens',
        { name: 'Mine', scopes: [], expiresAt: new Date(Date.now() + DAY).toISOString() },
      ],
    ] as const) {
      const answer = await call('sam', method, url, payload);
      expect(answer.statusCode, url).toBe(403);
      expect(answer.json(), url).toMatchObject({ code: 'support_scope' });
    }
    // Diagnostics are every scope's, and their own inbox and sessions stay theirs.
    expect((await get('sam', '/v1/diagnostics')).statusCode).toBe(200);
    expect((await get('sam', '/v1/inbox')).statusCode).toBe(200);
    expect((await get('sam', '/v1/sessions')).statusCode).toBe(200);
    // Refused is recorded as support's refusal.
    const refusals = (await events_('access.refused')).filter((each) => each.actor === ids.sam);
    expect(refusals.map((each) => (each.detail as Json).reason)).toContain('support');
  });

  it('ADM-024 refuses a content-scope support person content without Support-Read, and answers it with one, audited with its purpose', async () => {
    const refused = await get('cam', `/v1/components/${inClinical}`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'support_read_required' });
    const read = await get('cam', `/v1/components/${inClinical}`, {
      'support-read': 'The dosing table will not render',
    });
    expect(read.statusCode, read.body).toBe(200);
    expect(
      (await get('cam', `/v1/components/${inQuality}`, { 'support-read': 'Why' })).statusCode,
    ).toBe(404);
    const used = (await events_('support.used')).filter((each) => each.actor === ids.cam);
    expect(used).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: supports.cam, detail: { scope: 'content' } }),
        expect.objectContaining({
          subject: supports.cam,
          detail: {
            scope: 'content',
            route: 'getComponent',
            on: { id: inClinical },
            purpose: 'The dosing table will not render',
          },
        }),
      ]),
    );
    // Only a read that was answered is recorded: the refused one in Quality is not.
    expect(used.some((each) => JSON.stringify(each.detail).includes(inQuality))).toBe(false);
    // Once a day for its scope, however many requests.
    expect(used.filter((each) => !('route' in (each.detail as Json)))).toHaveLength(1);
  });

  it('ADM-022 lets a diagnostics-scope support person read Diagnostics alone, naming only what lives in its spaces', async () => {
    const [clinicalReport, qualityReport] = await tenantDb.withTenant(tenant, async (trx) => {
      const report = async (spaceId: string, title: string) => {
        const made = await createDocument(trx, {
          spaceId,
          title,
          language: 'en-GB',
          direction: 'ltr',
          author: ids.ada!,
        });
        if (made.answer !== 'created') throw new Error(made.answer);
        return made.version.artifactId;
      };
      return [await report(clinical, 'Clinical report'), await report(quality, 'Quality report')];
    });
    const connection = (spaceId: string) =>
      tenantDb.withTenant(
        tenant,
        async (trx) =>
          (
            await trx
              .insertInto('artifact')
              .values({ kind: 'connection', space_id: spaceId })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id,
      );
    const runs = [
      [await connection(clinical), clinicalReport],
      [await connection(quality), qualityReport],
    ] as const;
    for (const [on, document] of runs) {
      await queryAs(
        db.adminUrl,
        `insert into ${tenant.schema}.query_run (act, connection_id, document_id, duration_ms, outcome)
           values ('resolve', $1, $2, 5, 'ran')`,
        [on, document],
      );
    }
    for (const url of ['/v1/diagnostics', '/v1/usage', '/v1/data/usage', '/v1/model-usage']) {
      expect((await get('dot', url)).statusCode, url).toBe(200);
    }
    const usage = (await get('dot', '/v1/data/usage')).json<{ byDocument: { title: string }[] }>();
    expect(usage.byDocument.map((each) => each.title)).toEqual(['Clinical report']);
    const csv = (await get('dot', '/v1/data/usage/runs.csv')).body;
    expect(csv).toContain(clinicalReport);
    expect(csv).not.toContain(qualityReport);
    const diagnostics = (await get('dot', '/v1/diagnostics')).json<{
      connections: { connection: string }[];
    }>();
    expect(diagnostics.connections.map((each) => each.connection)).toEqual([runs[0][0]]);
    // An administrator still reads everything.
    const all = (await get('ada', '/v1/data/usage')).json<{ byDocument: { title: string }[] }>();
    expect(all.byDocument.map((each) => each.title).sort()).toEqual([
      'Clinical report',
      'Quality report',
    ]);
    // Nothing of a space's metadata.
    expect((await get('dot', `/v1/components/${inClinical}/activity`)).json()).toMatchObject({
      code: 'support_scope',
    });
    expect((await get('dot', '/v1/spaces')).json()).toMatchObject({ code: 'support_scope' });
  });

  it('ADM-023 ends support at the next request once revoked, expired or past a lowered cap, and revoking ends its open stream', async () => {
    const reads = (who: string) => get(who, `/v1/components/${inClinical}/activity`);
    expect((await reads('rex')).statusCode).toBe(200);
    const stream = openStream(`${address}/v1/stream`, cookies.rex!);
    try {
      expect((await stream.next()).event).toBe('snapshot');
      const revoked = await call('ada', 'DELETE', `/v1/support-access/${supports.rex}`);
      expect(revoked.statusCode, revoked.body).toBe(200);
      expect(revoked.json()).toMatchObject({ active: false, revokedBy: { id: ids.ada } });
      await stream.ended;
    } finally {
      stream.close();
    }
    // Decided without it: an outsider holding no grant reads nothing.
    expect((await reads('rex')).statusCode).toBe(404);
    expect(
      (await call('ada', 'DELETE', `/v1/support-access/${supports.rex}`)).json(),
    ).toMatchObject({ code: 'support_revoked' });
    expect((await events_('support.revoked')).map((each) => each.subject)).toContain(supports.rex);

    expect((await reads('tia')).statusCode).toBe(200);
    await queryAs(
      db.adminUrl,
      `update ${tenant.schema}.support_grant
          set granted_at = now() - interval '2 days', expires_at = now() - interval '1 second'
        where id = $1`,
      [supports.tia],
    );
    expect((await reads('tia')).statusCode).toBe(404);

    expect((await reads('una')).statusCode).toBe(200);
    await tenantDb.withTenant(tenant, (trx) =>
      trx
        .updateTable('access_policy')
        .set({ external_default_days: 20, external_cap_days: 20 })
        .execute(),
    );
    try {
      expect((await reads('una')).statusCode).toBe(404);
      await tenantDb.withTenant(tenant, (trx) =>
        trx
          .updateTable('access_policy')
          .set({ external_default_days: 30, external_cap_days: 90 })
          .execute(),
      );
      // Ended, not paused: raising the cap again revives nothing.
      expect((await reads('una')).statusCode).toBe(404);
    } finally {
      await tenantDb.withTenant(tenant, (trx) =>
        trx
          .updateTable('access_policy')
          .set({ external_default_days: 30, external_cap_days: 90 })
          .execute(),
      );
    }
    const una = (await get('ada', '/v1/support-access'))
      .json<{ items: Json[] }>()
      .items.find((each) => each.id === supports.una);
    expect(una).toMatchObject({
      active: false,
      revokedAt: expect.any(String),
      revokedBy: null,
      revokedReason: 'cap_lowered',
    });
    const ended = (await events_('support.revoked')).find((each) => each.subject === supports.una);
    expect(ended?.detail).toMatchObject({ reason: 'cap_lowered', principal: ids.una });
  });

  it('answers a support person their own grant on /v1/me, its spaces by name, and nobody else any', async () => {
    const cam = (await get('cam', '/v1/me')).json<{ support: unknown }>();
    expect(cam.support).toEqual({
      scope: 'content',
      spaces: [{ id: clinical, name: 'Clinical' }],
      purpose: "Looking at cam's ticket",
      expiresAt: expect.any(String),
    });
    expect((await get('ada', '/v1/me')).json()).toMatchObject({ support: null });
  });

  it('keeps every support grant: an invitation is withdrawn by revoking the support that made it, audited, never by removing its person', async () => {
    const made = await granting('ada', supportFor('vic', 'metadata', [clinical]));
    expect(made.statusCode, made.body).toBe(200);
    const { support, invitation } = made.json<{
      support: { id: string };
      invitation: { id: string };
    }>();
    const withdrawn = await call('ada', 'DELETE', `/v1/invitations/${invitation.id}`);
    expect(withdrawn.statusCode).toBe(409);
    expect(withdrawn.json()).toMatchObject({ code: 'invitation_supported' });
    expect((await call('ada', 'DELETE', `/v1/support-access/${support.id}`)).statusCode).toBe(200);
    const invitations = (await get('ada', '/v1/invitations?limit=100')).json<{
      items: { id: string; lapsed: boolean }[];
    }>();
    expect(invitations.items.find((each) => each.id === invitation.id)).toMatchObject({
      lapsed: true,
    });
    const ended = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select('subject')
        .where('kind', '=', 'invitation.withdrawn')
        .execute(),
    );
    expect(ended.map((each) => each.subject)).toContain(invitation.id);
    // Its person stays, with the grant they held.
    expect((await call('ada', 'DELETE', `/v1/invitations/${invitation.id}`)).statusCode).toBe(409);
    expect(
      (await get('ada', '/v1/support-access'))
        .json<{ items: Json[] }>()
        .items.some((each) => each.id === support.id),
    ).toBe(true);
  });

  it('refuses a content-scope support person every content route not decided by a space, and lists no people', async () => {
    const asked = { 'support-read': 'An old export' };
    for (const url of [
      '/v1/me/prompts',
      `/v1/jobs/${MISSING}/download`,
      `/v1/conversations/${MISSING}`,
    ]) {
      const answer = await get('cam', url, asked);
      expect(answer.statusCode, url).toBe(403);
      expect(answer.json(), url).toMatchObject({ code: 'support_scope' });
    }
    const refused = allRoutes
      .filter((route) => route.method === 'GET' && !decidedBySpace(route))
      .filter((route) => route.reads === 'content')
      .map((route) => route.operationId)
      .sort();
    expect(refused).toEqual([
      'downloadAuditExport',
      'downloadJob',
      'downloadTenantExport',
      'exportThemeCatalogue',
      'exportVocabulary',
      'getAssistantRun',
      'getCitationStyle',
      'getConversation',
      'getConversationContext',
      'getImport',
      'getImportPart',
      'getLicence',
      'getPendingResult',
      'getPromptLibrary',
      'getPublicationRequest',
      'getTranslationSettings',
      'getTranslationSettingsHistory',
      'getVocabulary',
      'getVocabularyUses',
      'getWebhook',
      'getWebhookDelivery',
      'listAuditEvents',
      'listGuardrails',
      'listHolds',
      'listLicences',
      'listMail',
      'listPersonalPrompts',
      'listServiceIdentities',
      'listWebhookDeliveries',
      'listWebhooks',
      'searchImportParts',
    ]);
    expect((await get('sam', '/v1/people')).json()).toMatchObject({ items: [] });
    expect(
      (await get('ada', '/v1/people')).json<{ items: unknown[] }>().items.length,
    ).toBeGreaterThan(0);
    // Revoking a token of their own is still theirs.
    const revoke = await call('sam', 'DELETE', `/v1/tokens/${MISSING}`);
    expect(revoke.json()).not.toMatchObject({ code: 'support_scope' });
  });

  it("ADM-042 explains a support person's access as support: its scope, spaces, purpose and end", async () => {
    const explained = await get(
      'ada',
      `/v1/access/explain?principal=${ids.sam}&target=artifact:${inClinical}`,
    );
    expect(explained.statusCode, explained.body).toBe(200);
    const answer = explained.json<{
      support: Json | null;
      permissions: { permission: string; allowed: boolean; reason: string }[];
    }>();
    expect(answer.support).toMatchObject({
      id: supports.sam,
      scope: 'metadata',
      spaces: [clinical],
      purpose: "Looking at sam's ticket",
    });
    const of = (permission: string) =>
      answer.permissions.find((each) => each.permission === permission);
    expect(of('read')).toMatchObject({ allowed: true, reason: 'support' });
    expect(of('comment')).toMatchObject({ allowed: false, reason: 'support' });
    const ada = await get('ada', `/v1/access/explain?principal=${ids.ada}&target=tenant`);
    expect(ada.json()).toMatchObject({ support: null });
  });
});
