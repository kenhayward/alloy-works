// apps/service/src/component-routes.test.ts
import { randomUUID } from 'node:crypto';
import {
  bootstrapCluster,
  claimLock,
  configureOrganisationSignIn,
  createArtifact,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  latestVersion,
  migrate,
  seedDevelopmentContent,
  STARTER_COMPONENT_TYPE_ID,
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
const MISSING = '00000000-0000-4000-8000-000000000000';

type Json = Record<string, unknown>;

const paragraphs = (...texts: string[]) => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: texts.map((text, index) => ({
    type: 'paragraph',
    id: `p${index + 1}`,
    style: 'body',
    content: [{ type: 'text', value: text, marks: [] }],
  })),
});

describe('finding and opening components through the service', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let hidden: string;

  const call = (
    as: string | undefined,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: Json,
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...(as ? { cookie: cookies[as]! } : {}) },
      ...(payload ? { payload } : {}),
    });

  /** A fresh component in General, which Ada and Grace author and Alice reads, at 0.1. */
  const component = async () =>
    tenantDb.withTenant(tenant, async (trx) => {
      const seeded = await trx
        .selectFrom('artifact')
        .select(['id', 'space_id'])
        .where('kind', '=', 'component')
        .orderBy('created_at')
        .executeTakeFirstOrThrow();
      const first = (await latestVersion(trx, seeded.id))!;
      const made = await createArtifact(trx, {
        author: ids.ada!,
        spaceId: seeded.space_id!,
        substance: {
          kind: 'component',
          content: paragraphs('Unbox the printer.') as never,
          values: {},
          notCarried: [],
          definitions: first.definitions,
        },
      });
      return { id: made.artifactId, openedFrom: made.id };
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
    await configureOrganisationSignIn(db.adminUrl, tenant, {
      issuer: idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    // Ada and Grace author General, as the development environment has them.
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
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const reader = await findRole(trx, 'Reader');
      await grant(trx, {
        roleId: reader!.id,
        subject: { principal: ids.alice! },
        level: { kind: 'space', id: general.id },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      const seeded = await trx
        .selectFrom('artifact')
        .select('id')
        .where('kind', '=', 'component')
        .executeTakeFirstOrThrow();
      const first = (await latestVersion(trx, seeded.id))!;
      const quality = await createSpace(trx, 'Quality');
      hidden = (
        await createArtifact(trx, {
          author: ids.ada!,
          spaceId: quality.id,
          substance: {
            kind: 'component',
            content: paragraphs('Audit the fleet.') as never,
            values: {},
            notCarried: [],
            definitions: first.definitions,
          },
        })
      ).artifactId;
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  describe('finding and opening a component', () => {
    it('lists what the caller may read, with titles and numbers, and nothing else', async () => {
      const response = await call('ada', 'GET', '/v1/components');
      expect(response.statusCode).toBe(200);
      const body = response.json<{ items: { id: string; title: string }[]; next: unknown }>();
      expect(body.items.map((item) => item.id)).not.toContain(hidden);
      expect(body.items).toContainEqual(
        expect.objectContaining({
          id: expect.any(String),
          title: 'Install the printer',
          space: { id: expect.any(String), name: 'General' },
          version: '0.1',
        }),
      );
      expect(body.next).toBeNull();
    });

    it("lists with each component's type, language and last change, a total and the spaces it may filter by", async () => {
      const response = await call('ada', 'GET', '/v1/components');
      const body = response.json<{
        items: { title: string; changedAt: string }[];
        total: number;
        spaces: { id: string; name: string; count: number }[];
      }>();
      const printer = body.items.find((item) => item.title === 'Install the printer');
      expect(printer).toMatchObject({
        type: 'Topic',
        language: 'en-GB',
        changedBy: expect.anything(),
      });
      expect(Number.isNaN(Date.parse(printer!.changedAt))).toBe(false);
      expect(body.total).toBe(body.items.length);
      expect(body.spaces.reduce((sum, space) => sum + space.count, 0)).toBe(body.total);
      expect(body.spaces.map((space) => space.name)).toContain('General');
    });

    it('narrows to the spaces named, and refuses a space list that is not one', async () => {
      const whole = (await call('ada', 'GET', '/v1/components')).json<{
        spaces: { id: string; name: string; count: number }[];
      }>();
      const general = whole.spaces.find((space) => space.name === 'General')!;
      const narrowed = await call('ada', 'GET', `/v1/components?spaces=${general.id}`);
      expect(narrowed.statusCode).toBe(200);
      const body = narrowed.json<{ items: { space: { id: string } }[]; total: number }>();
      expect(body.items.every((item) => item.space.id === general.id)).toBe(true);
      expect(body.total).toBe(general.count);
      for (const bad of ['not-a-space', '', `${general.id},`]) {
        const refused = await call('ada', 'GET', `/v1/components?spaces=${bad}`);
        expect(refused.statusCode).toBe(400);
        expect(refused.json()).toMatchObject({ code: 'invalid_request' });
      }
    });

    it('pages with a cursor it gave out, and refuses one it did not', async () => {
      await component();
      const first = await call('ada', 'GET', '/v1/components?limit=1');
      const { items, next } = first.json<{ items: { id: string }[]; next: string }>();
      expect(items).toHaveLength(1);
      expect(next).toEqual(expect.any(String));
      const second = await call('ada', 'GET', `/v1/components?limit=1&cursor=${next}`);
      expect(second.json<{ items: { id: string }[] }>().items[0]?.id).not.toBe(items[0]?.id);
      const forged = await call('ada', 'GET', '/v1/components?cursor=bm90LWEtdXVpZA');
      expect(forged.statusCode).toBe(400);
      expect(forged.json()).toMatchObject({ code: 'invalid_request' });
    });

    it('opens a component at its latest version, saying whether the caller may edit it', async () => {
      const made = await component();
      const author = await call('ada', 'GET', `/v1/components/${made.id}`);
      expect(author.statusCode).toBe(200);
      expect(author.json()).toEqual({
        id: made.id,
        space: { id: expect.any(String), name: 'General' },
        version: {
          id: made.openedFrom,
          number: '0.1',
          author: ids.ada,
          createdAt: expect.any(String),
          note: null,
        },
        content: paragraphs('Unbox the printer.'),
        mayEdit: true,
        lock: null,
      });
      const reader = await call('alice', 'GET', `/v1/components/${made.id}`);
      expect(reader.json()).toMatchObject({ mayEdit: false });
    });

    it('answers a component the caller may not read exactly as one that does not exist', async () => {
      const unreadable = await call('grace', 'GET', `/v1/components/${hidden}`);
      const missing = await call('grace', 'GET', `/v1/components/${MISSING}`);
      expect(unreadable.statusCode).toBe(404);
      const untraced = (body: Json) =>
        Object.fromEntries(Object.entries(body).filter(([member]) => member !== 'traceId'));
      expect(untraced(unreadable.json())).toEqual(untraced(missing.json()));
    });

    it('answers a definition, not a component, at this address exactly as a missing component', async () => {
      const asDefinition = await call('ada', 'GET', `/v1/components/${STARTER_COMPONENT_TYPE_ID}`);
      const missing = await call('ada', 'GET', `/v1/components/${MISSING}`);
      expect(asDefinition.statusCode).toBe(404);
      const untraced = (body: Json) =>
        Object.fromEntries(Object.entries(body).filter(([member]) => member !== 'traceId'));
      expect(untraced(asDefinition.json())).toEqual(untraced(missing.json()));
    });

    it('refuses a limit outside 1 to 100, and one that is not a number, with 400 invalid_request', async () => {
      for (const limit of ['0', '101', 'abc']) {
        const response = await call('ada', 'GET', `/v1/components?limit=${limit}`);
        expect(response.statusCode, `limit=${limit}`).toBe(400);
        expect(response.json()).toMatchObject({ code: 'invalid_request' });
      }
    });

    it('refuses a cursor sent twice, with 400 invalid_request', async () => {
      const response = await call('ada', 'GET', '/v1/components?cursor=a&cursor=b');
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'invalid_request' });
    });

    it('shows a lock it holds to its own principal, and only that its principal holds it to another', async () => {
      const made = await component();
      const session = randomUUID();
      await tenantDb.withTenant(tenant, (trx) =>
        claimLock(trx, { artifactId: made.id, principal: ids.ada!, session }),
      );
      const holder = await call('ada', 'GET', `/v1/components/${made.id}`);
      expect(holder.json()).toMatchObject({
        lock: {
          holder: { id: ids.ada },
          yours: true,
          session,
        },
      });
      const other = await call('grace', 'GET', `/v1/components/${made.id}`);
      expect(other.json()).toMatchObject({
        lock: {
          holder: { id: ids.ada },
          yours: false,
          session: null,
        },
      });
    });
  });
});
