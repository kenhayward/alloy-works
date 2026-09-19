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
  recordVersion,
  seedDevelopmentContent,
  substanceOf,
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
const UNKNOWN = '11111111-1111-4111-8111-111111111111';

type Json = Record<string, unknown>;

interface Contributions {
  document: string;
  version: { id: string; number: string };
  occurrences: { node: string; version: string | null }[];
  versions: {
    id: string;
    contributions: { block: string; sequence: string; numbered: boolean; caption: string | null }[];
  }[];
}

interface DocumentBody {
  id: string;
  version: { id: string };
  outline: { nodes: { id: string; children: { id: string; children: { id: string }[] }[] }[] };
}

const text = (value: string) => [{ type: 'text', value, marks: [] }];

const figure = (id: string, caption: string) => ({
  type: 'figure',
  id,
  asset: 'asset',
  imageStyle: 'wide',
  caption,
  alternative: { kind: 'decorative' },
});

describe('what each occurrence contributes, through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let general: string;
  let quality: string;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (as: string | undefined, method: 'GET' | 'POST', url: string, payload?: Json) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  /** A component at 0.2 holding these blocks, made through the store: the editor writes none yet. */
  const componentWith = (space: string, title: string, blocks: unknown[]) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.grace!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const recorded = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ids.grace!,
        substance: { ...substance, content: { ...substance.content, content: blocks } as never },
      });
      if (recorded.answer !== 'recorded') throw new Error(recorded.answer);
      return { id: made.version.artifactId, version: recorded.version.id };
    });

  const create = (title: string) =>
    call('grace', 'POST', `/v1/spaces/${general}/documents`, {
      title,
      language: 'en-GB',
      direction: 'ltr',
    }).then((made) => made.json<DocumentBody>());

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
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    for (const user of ['ada', 'grace', 'alice']) {
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
      const reader = await findRole(trx, 'Reader');
      const author = await findRole(trx, 'Author');
      // Alice reads General; Grace authors in General and in Quality. The seed gives Ada Author on
      // General and nothing else, so neither Ada nor Alice may read Quality.
      for (const [role, principal, space] of [
        [reader!, ids.alice!, general],
        [author!, ids.grace!, general],
        [author!, ids.grace!, quality],
      ] as const) {
        await grant(trx, {
          roleId: role.id,
          subject: { principal },
          level: { kind: 'space', id: space },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
      }
    });
  });

  afterAll(async () => {
    await app?.close();
    await tenantDb?.close();
    await idp?.close();
    await db?.drop();
  });

  it('answers each occurrence its version and what it contributes, captions included, and nothing of a component the caller may not read', async () => {
    const shared = await componentWith(general, 'Install the printer', [
      figure('f1', 'The paper tray'),
    ]);
    const secret = await componentWith(quality, 'Calibration', [figure('s1', 'The secret bench')]);
    let doc = await create('The dosing report');
    const act = async (operation: Json) => {
      const answer = await call('grace', 'POST', `/v1/documents/${doc.id}/outline`, {
        openedFrom: doc.version.id,
        operation,
      });
      expect(answer.statusCode, answer.body).toBe(200);
      doc = answer.json<DocumentBody>();
    };
    await act({
      operation: 'insert',
      parent: null,
      position: 0,
      node: { type: 'section', title: text('Introduction') },
    });
    const introduction = doc.outline.nodes[0]!.id;
    for (const [position, component] of [shared.id, secret.id, shared.id].entries()) {
      await act({
        operation: 'insert',
        parent: introduction,
        position,
        node: { type: 'reference', component, mode: { kind: 'latest' } },
      });
    }
    const [first, hidden, again] = doc.outline.nodes[0]!.children.map((child) => child.id);
    const route = `/v1/documents/${doc.id}/contributions`;
    const tray = { block: 'f1', sequence: 'figure', numbered: true, caption: 'The paper tray' };

    const forGrace = await call('grace', 'GET', route);
    expect(forGrace.statusCode, forGrace.body).toBe(200);
    // One component placed twice is two occurrences naming one version, whose contributions are
    // answered once.
    expect(forGrace.json<Contributions>()).toEqual({
      document: doc.id,
      version: { id: doc.version.id, number: '0.5' },
      occurrences: [
        { node: first, version: shared.version },
        { node: hidden, version: secret.version },
        { node: again, version: shared.version },
      ],
      versions: [
        { id: shared.version, contributions: [tray] },
        {
          id: secret.version,
          contributions: [
            { block: 's1', sequence: 'figure', numbered: true, caption: 'The secret bench' },
          ],
        },
      ],
    });

    for (const reader of ['alice', 'ada']) {
      const answer = await call(reader, 'GET', route);
      expect(answer.statusCode, answer.body).toBe(200);
      expect(answer.json<Contributions>()).toEqual({
        document: doc.id,
        version: { id: doc.version.id, number: '0.5' },
        occurrences: [
          { node: first, version: shared.version },
          { node: hidden, version: null },
          { node: again, version: shared.version },
        ],
        versions: [{ id: shared.version, contributions: [tray] }],
      });
      expect(answer.body).not.toContain('The secret bench');
      expect(answer.body).not.toContain('"s1"');
      expect(answer.body).not.toContain(secret.version);
      expect(answer.body).not.toContain(secret.id);
    }
  });

  it('answers an empty outline with no occurrences, and 404 for what is not a readable document', async () => {
    const doc = await create('Empty');
    const empty = await call('alice', 'GET', `/v1/documents/${doc.id}/contributions`);
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json<Contributions>().occurrences).toEqual([]);
    expect((await call('grace', 'GET', `/v1/documents/${UNKNOWN}/contributions`)).statusCode).toBe(
      404,
    );
    const component = await componentWith(general, 'Not a document', [figure('x1', 'A tray')]);
    expect(
      (await call('grace', 'GET', `/v1/documents/${component.id}/contributions`)).statusCode,
    ).toBe(404);
    expect((await call(undefined, 'GET', `/v1/documents/${doc.id}/contributions`)).statusCode).toBe(
      401,
    );
  });
});
