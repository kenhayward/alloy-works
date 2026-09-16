// apps/service/src/access-routes.test.ts
import { allRoutes } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  configureOrganisationSignIn,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  type NewGrant,
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
      const artifact = (spaceId: string) =>
        trx
          .insertInto('artifact')
          .values({ kind: 'component', space_id: spaceId })
          .returning('id')
          .executeTakeFirstOrThrow()
          .then((row) => row.id);
      dosing = await artifact(clinical);
      audit = await artifact(quality);
    });
    await give({
      role: 'Administrator',
      subject: { principal: ids.ada! },
      level: { kind: 'tenant' },
      effect: 'allow',
    });
    await give({
      role: 'Author',
      subject: { principal: ids.grace! },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
    });
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

  it('answers a target the caller may not read exactly as one that does not exist', async () => {
    const unreadable = await get(`/v1/access?target=artifact:${audit}`, 'grace');
    const missing = await get(`/v1/access?target=artifact:${MISSING}`, 'grace');
    expect(unreadable.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    // Byte for byte but for the trace id, which is every request's own.
    const untraced = (body: Record<string, string>) =>
      Object.fromEntries(Object.entries(body).filter(([member]) => member !== 'traceId'));
    const refused = untraced(unreadable.json());
    const absent = untraced(missing.json());
    expect(refused).toEqual(absent);
    expect(refused).toEqual({ code: 'not_found', message: 'There is nothing at this address.' });

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

  /**
   * For each permission-checked route: an address naming something in this environment that a
   * principal holding nothing is refused. A route missing here fails the harness, as
   * cross-tenant.test.ts does for path parameters.
   */
  const HOLDING_NOTHING: Readonly<
    Record<string, () => { readonly url: string; readonly status: 403 | 404 }>
  > = {
    getAccess: () => ({ url: `/v1/access?target=artifact:${dosing}`, status: 404 }),
    explainAccess: () => ({
      url: `/v1/access/explain?principal=${ids.ada}&target=tenant`,
      status: 403,
    }),
  };

  const checked = allRoutes.filter((route) => route.access.check === 'permission');

  it('refuses a principal holding nothing on every route that checks a permission', async () => {
    expect(checked.length).toBeGreaterThan(0);
    for (const route of checked) {
      const address = HOLDING_NOTHING[route.operationId];
      expect(address, `${route.operationId} has no address in HOLDING_NOTHING`).toBeDefined();
      const { url, status } = address!();
      const response = await app.inject({
        method: route.method,
        url,
        headers: { host: HOST, cookie: cookies.alice! },
      });
      expect(response.statusCode, route.operationId).toBe(status);
    }
  });
});
