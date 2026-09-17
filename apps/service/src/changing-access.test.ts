// apps/service/src/changing-access.test.ts
import { allRoutes, routes } from '@alloy-works/api-contract';
import {
  addToGroup,
  bootstrapCluster,
  configureOrganisationSignIn,
  createGroup,
  createSpace,
  createTenant,
  createTenantDatabase,
  findRole,
  grant,
  migrate,
  removeGrant,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  untilWaitingOnLocks,
  whileAccessIsDecided,
  type TestDatabase,
} from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorise, beforeDeciding, type PermissionCheck } from './access.js';
import { buildApp } from './app.js';
import { managingAccessHandlers } from './managing-access.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { signIn } from './test/sign-in.js';

const HOST = 'acme.alloy.test';
const MISSING = '00000000-0000-4000-8000-000000000000';

/** A permission check that only decides: `administer` at the tenant. */
const administers: PermissionCheck = {
  check: 'permission',
  permission: 'administer',
  target: { tenant: true },
};

describe('a route that changes access', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let reader: string;
  let clinical: string;

  const call = (method: 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies.ada! },
      ...(payload ? { payload } : {}),
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
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    for (const user of ['ada', 'grace', 'alice']) {
      cookies[user] = await signIn(app, HOST, user, idp.issuer);
      ids[user] = (
        await app.inject({ url: '/v1/me', headers: { host: HOST, cookie: cookies[user]! } })
      ).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      const administrator = await findRole(trx, 'Administrator');
      reader = (await findRole(trx, 'Reader'))!.id;
      clinical = (await createSpace(trx, 'Clinical')).id;
      await grant(trx, {
        roleId: administrator!.id,
        subject: { principal: ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
    });
  });

  afterAll(async () => {
    await app.close();
    await tenantDb.close();
    await idp.close();
    await db.drop();
  });

  it('is declared by exactly the routes that make and remove grants, each checking administer', () => {
    const declaring = allRoutes.filter(
      (route) => route.access.check === 'permission' && route.access.changesAccess === true,
    );
    expect(declaring.map((route) => route.operationId).sort()).toEqual([
      'makeGrant',
      'removeGrant',
    ]);
    for (const route of declaring) {
      expect(route.access, route.operationId).toMatchObject({ permission: 'administer' });
    }
  });

  it('takes the epoch for update before it decides, so two at once while a decision is in flight both land', async () => {
    const standing = await tenantDb.withTenant(tenant, async (trx) => {
      const made = await grant(trx, {
        roleId: reader,
        subject: { principal: ids.grace! },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ids.ada!,
      });
      if (!('granted' in made)) throw new Error(`refused: ${made.refused}`);
      return made.granted.id;
    });

    // A decision in flight holds the epoch FOR SHARE. The first change reaches its wait, then the
    // second: had either decided first under a shared lock of its own, each would now wait for the
    // other's, and Postgres would abort one as a deadlock once the decision let go.
    const [made, removed] = await whileAccessIsDecided(tenantDb, tenant, async () => {
      const first = call('POST', '/v1/grants', {
        role: reader,
        subject: { principal: ids.alice },
        level: `space:${clinical}`,
        effect: 'allow',
      });
      await untilWaitingOnLocks(db.adminUrl, 1);
      const second = call('DELETE', `/v1/grants/${standing}`);
      await untilWaitingOnLocks(db.adminUrl, 2);
      return [first, second] as const;
    });

    expect((await made).statusCode).toBe(200);
    expect((await removed).statusCode).toBe(200);
  });

  it("refuses a change in a route's transaction that did not declare one, before any lock is upgraded", async () => {
    const decidesOnly: PermissionCheck = {
      check: 'permission',
      permission: 'administer',
      target: { tenant: true },
    };
    const request = { params: {}, query: {} } as unknown as FastifyRequest;
    await expect(
      tenantDb.withTenant(tenant, async (trx) => {
        await beforeDeciding(trx, decidesOnly);
        const { principalId } = await authorise(trx, ids.ada!, decidesOnly, request);
        return grant(trx, {
          roleId: reader,
          subject: { principal: ids.grace! },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: principalId,
        });
      }),
    ).rejects.toThrow(/declared that it only decides/);
    await expect(
      tenantDb.withTenant(tenant, async (trx) => {
        await beforeDeciding(trx, { ...decidesOnly, changesAccess: true });
        await authorise(trx, ids.ada!, decidesOnly, request);
        return removeGrant(trx, '00000000-0000-4000-8000-000000000000');
      }),
    ).resolves.toEqual({ refused: 'grant.missing' });
  });

  it('declares nothing on the routes that only decide, which therefore cannot change access', () => {
    for (const name of [
      'getAccess',
      'explainAccess',
      'listGrants',
      'claimLock',
      'getComponent',
    ] as const) {
      expect(routes[name].access, name).not.toHaveProperty('changesAccess');
    }
  });

  it('answers two grants made at once, while a decision is in flight, without a failure', async () => {
    const responses = await whileAccessIsDecided(tenantDb, tenant, async () => {
      const first = call('POST', '/v1/grants', {
        role: reader,
        subject: { principal: ids.grace },
        level: 'tenant',
        effect: 'allow',
      });
      await untilWaitingOnLocks(db.adminUrl, 1);
      const second = call('POST', '/v1/grants', {
        role: reader,
        subject: { principal: ids.alice },
        level: 'tenant',
        effect: 'allow',
      });
      await untilWaitingOnLocks(db.adminUrl, 2);
      return [first, second] as const;
    });

    for (const response of await Promise.all(responses)) {
      expect(response.statusCode, response.body).toBe(200);
    }
  });

  it('answers the removal that lost a race for the same grant as not found', async () => {
    const standing = await tenantDb.withTenant(tenant, async (trx) => {
      const made = await grant(trx, {
        roleId: reader,
        subject: { principal: ids.alice! },
        level: { kind: 'space', id: clinical },
        effect: 'deny',
        grantedBy: ids.ada!,
      });
      if (!('granted' in made)) throw new Error(`refused: ${made.refused}`);
      return made.granted.id;
    });

    const responses = await whileAccessIsDecided(tenantDb, tenant, async () => {
      const first = call('DELETE', `/v1/grants/${standing}`);
      await untilWaitingOnLocks(db.adminUrl, 1);
      const second = call('DELETE', `/v1/grants/${standing}`);
      await untilWaitingOnLocks(db.adminUrl, 2);
      return [first, second] as const;
    });

    const answered = (await Promise.all(responses)).map((response) => ({
      status: response.statusCode,
      body: response.json<Record<string, unknown>>(),
    }));
    expect(answered.map((answer) => answer.status).sort()).toEqual([200, 404]);
    expect(answered.find((answer) => answer.status === 404)!.body).toMatchObject({
      code: 'not_found',
    });
  });

  it("answers a removal whose grant is gone by the time the handler runs as not found, the handler's own branch", async () => {
    const handlers = managingAccessHandlers();
    const request = { params: { id: MISSING }, query: {} } as unknown as FastifyRequest;
    await expect(
      tenantDb.withTenant(tenant, async (trx) => {
        await beforeDeciding(trx, { ...administers, changesAccess: true });
        const authorised = await authorise(trx, ids.ada!, administers, request);
        return handlers.removeGrant(request, authorised);
      }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('removes one of the last two administering grants removed at once, and refuses the other', async () => {
    // Ada administers through a group, which the lock-out guard does not count, so she can still ask
    // for the second removal once the first has landed; the two it counts are Grace's and Alice's.
    const [graceAdministers, aliceAdministers] = await tenantDb.withTenant(tenant, async (trx) => {
      const administrator = (await findRole(trx, 'Administrator'))!.id;
      const group = await createGroup(trx, 'Administrators');
      if (!('group' in group)) throw new Error(`refused: ${group.refused}`);
      await addToGroup(trx, group.group.id, ids.ada!);
      const made: string[] = [];
      for (const subject of [
        { group: group.group.id },
        { principal: ids.grace! },
        { principal: ids.alice! },
      ]) {
        const answer = await grant(trx, {
          roleId: administrator,
          subject,
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: ids.ada!,
        });
        if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
        made.push(answer.granted.id);
      }
      const direct = await trx
        .selectFrom('access_grant')
        .select('id')
        .where('principal_id', '=', ids.ada!)
        .where('level', '=', 'tenant')
        .where('effect', '=', 'allow')
        .execute();
      for (const row of direct) {
        const removed = await removeGrant(trx, row.id);
        if (!('removed' in removed)) throw new Error(`refused: ${removed.refused}`);
      }
      return [made[1]!, made[2]!];
    });

    const responses = await whileAccessIsDecided(tenantDb, tenant, async () => {
      const first = call('DELETE', `/v1/grants/${graceAdministers}`);
      await untilWaitingOnLocks(db.adminUrl, 1);
      const second = call('DELETE', `/v1/grants/${aliceAdministers}`);
      await untilWaitingOnLocks(db.adminUrl, 2);
      return [first, second] as const;
    });

    const answered = (await Promise.all(responses)).map((response) => ({
      status: response.statusCode,
      body: response.json<Record<string, unknown>>(),
    }));
    expect(answered.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answered.find((answer) => answer.status === 409)!.body).toMatchObject({
      code: 'grant_last_administrator',
    });
  });
});
