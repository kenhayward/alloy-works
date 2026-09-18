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
import type { FastifyInstance, FastifyRequest, LightMyRequestResponse } from 'fastify';
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

/** A database, provider and tenant of its own: Ada administers; Grace and Alice sign in. */
interface Environment {
  db: TestDatabase;
  idp: StandInProvider;
  tenantDb: TenantDatabase;
  app: FastifyInstance;
  tenant: Tenant;
  cookies: Record<string, string>;
  ids: Record<string, string>;
  reader: string;
  administrator: string;
  clinical: string;
}

/**
 * Registers the hooks that build a fresh environment for the enclosing `describe` and tear it down,
 * and returns it - filled in once `beforeAll` has run - so no two `describe`s share a grant.
 */
function freshEnvironment(): Environment {
  const env = { cookies: {}, ids: {} } as Environment;

  beforeAll(async () => {
    env.db = await freshDatabase();
    await bootstrapCluster(env.db.adminUrl, TEST_PASSWORDS);
    await migrate(env.db.migratorUrl);
    env.idp = await startStandInProvider({
      clients: [
        {
          clientId: 'alloy',
          clientSecret: 'stand-in-secret',
          redirectUris: [`http://${HOST}/v1/sign-in/organisation/callback`],
        },
      ],
    });
    env.tenant = await createTenant(env.db.adminUrl, env.db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: env.db.newTenantId(), name: 'Production' },
      hostnames: [HOST],
    });
    await configureOrganisationSignIn(env.db.adminUrl, env.tenant, {
      issuer: env.idp.issuer,
      clientId: 'alloy',
      secretName: 'stand_in',
    });
    env.tenantDb = createTenantDatabase(env.db.serviceUrl);
    env.app = buildApp({
      db: env.tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({ SECRET_STAND_IN: 'stand-in-secret' }),
    });
    for (const user of ['ada', 'grace', 'alice']) {
      env.cookies[user] = await signIn(env.app, HOST, user, env.idp.issuer);
      env.ids[user] = (
        await env.app.inject({
          url: '/v1/me',
          headers: { host: HOST, cookie: env.cookies[user]! },
        })
      ).json<{ id: string }>().id;
    }
    await env.tenantDb.withTenant(env.tenant, async (trx) => {
      env.administrator = (await findRole(trx, 'Administrator'))!.id;
      env.reader = (await findRole(trx, 'Reader'))!.id;
      env.clinical = (await createSpace(trx, 'Clinical')).id;
      await grant(trx, {
        roleId: env.administrator,
        subject: { principal: env.ids.ada! },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: env.ids.ada!,
      });
    });
  });

  afterAll(async () => {
    await env.app.close();
    await env.tenantDb.close();
    await env.idp.close();
    await env.db.drop();
  });

  return env;
}

/** A request as Ada, the environment's administrator. */
const callAsAda = (
  env: Environment,
  method: 'POST' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
) =>
  env.app.inject({
    method,
    url,
    headers: { host: HOST, cookie: env.cookies.ada! },
    ...(payload ? { payload } : {}),
  });

/**
 * While a decision is in flight, starts `first` and waits until it waits on the epoch, then
 * `second` and waits again, so the two genuinely overlap. Whatever happens, both requests are settled before
 * this returns: a request left running would otherwise outlive the test into `afterAll`. Settled
 * outside the decision's transaction, since until it ends they wait on it.
 */
async function race(
  env: Environment,
  first: () => Promise<LightMyRequestResponse>,
  second: () => Promise<LightMyRequestResponse>,
): Promise<LightMyRequestResponse[]> {
  const started: Promise<LightMyRequestResponse>[] = [];
  try {
    await whileAccessIsDecided(env.tenantDb, env.tenant, async () => {
      started.push(first());
      await untilWaitingOnLocks(env.db.adminUrl, 1);
      started.push(second());
      await untilWaitingOnLocks(env.db.adminUrl, 2);
    });
  } finally {
    await Promise.allSettled(started);
  }
  return Promise.all(started);
}

/** Each response's status, and its body as JSON. */
const answers = (responses: LightMyRequestResponse[]) =>
  responses.map((response) => ({
    status: response.statusCode,
    body: response.json<Record<string, unknown>>(),
  }));

describe('a route that changes access', () => {
  const env = freshEnvironment();

  it('is declared by exactly the routes that make and remove grants and withdraw an invitation, each checking administer', () => {
    const declaring = allRoutes.filter(
      (route) => route.access.check === 'permission' && route.access.changesAccess === true,
    );
    expect(declaring.map((route) => route.operationId).sort()).toEqual([
      'makeGrant',
      'removeGrant',
      'withdrawInvitation',
    ]);
    for (const route of declaring) {
      expect(route.access, route.operationId).toMatchObject({ permission: 'administer' });
    }
  });

  it('takes the epoch for update before it decides, so two at once while a decision is in flight both land', async () => {
    const standing = await env.tenantDb.withTenant(env.tenant, async (trx) => {
      const made = await grant(trx, {
        roleId: env.reader,
        subject: { principal: env.ids.grace! },
        level: { kind: 'space', id: env.clinical },
        effect: 'allow',
        grantedBy: env.ids.ada!,
      });
      if (!('granted' in made)) throw new Error(`refused: ${made.refused}`);
      return made.granted.id;
    });

    // A decision in flight holds the epoch FOR SHARE. The first change reaches its wait, then the
    // second: had either decided first under a shared lock of its own, each would now wait for the
    // other's, and Postgres would abort one as a deadlock once the decision let go.
    const [made, removed] = await race(
      env,
      () =>
        callAsAda(env, 'POST', '/v1/grants', {
          role: env.reader,
          subject: { principal: env.ids.alice },
          level: `space:${env.clinical}`,
          effect: 'allow',
        }),
      () => callAsAda(env, 'DELETE', `/v1/grants/${standing}`),
    );

    expect(made!.statusCode).toBe(200);
    expect(removed!.statusCode).toBe(200);
  });

  it('refuses a change in the transaction of a route that did not declare one, and allows it in one that did', async () => {
    const request = { params: {}, query: {} } as unknown as FastifyRequest;
    await expect(
      env.tenantDb.withTenant(env.tenant, async (trx) => {
        await beforeDeciding(trx, administers);
        const { principalId } = await authorise(trx, env.ids.ada!, administers, request);
        return grant(trx, {
          roleId: env.reader,
          subject: { principal: env.ids.grace! },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: principalId,
        });
      }),
    ).rejects.toThrow(/declared that it only decides/);
    await expect(
      env.tenantDb.withTenant(env.tenant, async (trx) => {
        await beforeDeciding(trx, { ...administers, changesAccess: true });
        await authorise(trx, env.ids.ada!, administers, request);
        return removeGrant(trx, MISSING);
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
      'listComponentTypes',
      'createComponent',
      'createDocument',
      'getDocument',
      'editOutline',
    ] as const) {
      expect(routes[name].access, name).not.toHaveProperty('changesAccess');
    }
  });

  it('answers two grants made at once, while a decision is in flight, without a failure', async () => {
    const responses = await race(
      env,
      () =>
        callAsAda(env, 'POST', '/v1/grants', {
          role: env.reader,
          subject: { principal: env.ids.grace },
          level: 'tenant',
          effect: 'allow',
        }),
      () =>
        callAsAda(env, 'POST', '/v1/grants', {
          role: env.reader,
          subject: { principal: env.ids.alice },
          level: 'tenant',
          effect: 'allow',
        }),
    );

    for (const response of responses) {
      expect(response.statusCode, response.body).toBe(200);
    }
  });

  it('answers the removal that lost a race for the same grant as not found', async () => {
    const standing = await env.tenantDb.withTenant(env.tenant, async (trx) => {
      const made = await grant(trx, {
        roleId: env.reader,
        subject: { principal: env.ids.alice! },
        level: { kind: 'space', id: env.clinical },
        effect: 'deny',
        grantedBy: env.ids.ada!,
      });
      if (!('granted' in made)) throw new Error(`refused: ${made.refused}`);
      return made.granted.id;
    });

    const answered = answers(
      await race(
        env,
        () => callAsAda(env, 'DELETE', `/v1/grants/${standing}`),
        () => callAsAda(env, 'DELETE', `/v1/grants/${standing}`),
      ),
    );
    expect(answered.map((answer) => answer.status).sort()).toEqual([200, 404]);
    expect(answered.find((answer) => answer.status === 404)!.body).toMatchObject({
      code: 'not_found',
    });
  });

  it("answers a removal whose grant is gone by the time the handler runs as not found, the handler's own branch", async () => {
    const handlers = managingAccessHandlers();
    const request = { params: { id: MISSING }, query: {} } as unknown as FastifyRequest;
    await expect(
      env.tenantDb.withTenant(env.tenant, async (trx) => {
        await beforeDeciding(trx, { ...administers, changesAccess: true });
        const authorised = await authorise(trx, env.ids.ada!, administers, request);
        return handlers.removeGrant(request, authorised);
      }),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});

describe('the last two administering grants removed at once', () => {
  const env = freshEnvironment();

  it('removes one of the last two administering grants removed at once, and refuses the other', async () => {
    // Ada administers through a group, which the lock-out guard does not count, so she can still ask
    // for the second removal once the first has landed; the two it counts are Grace's and Alice's.
    const [graceAdministers, aliceAdministers] = await env.tenantDb.withTenant(
      env.tenant,
      async (trx) => {
        const group = await createGroup(trx, 'Administrators');
        if (!('group' in group)) throw new Error(`refused: ${group.refused}`);
        await addToGroup(trx, group.group.id, env.ids.ada!);
        const made: string[] = [];
        for (const subject of [
          { group: group.group.id },
          { principal: env.ids.grace! },
          { principal: env.ids.alice! },
        ]) {
          const answer = await grant(trx, {
            roleId: env.administrator,
            subject,
            level: { kind: 'tenant' },
            effect: 'allow',
            grantedBy: env.ids.ada!,
          });
          if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
          made.push(answer.granted.id);
        }
        const direct = await trx
          .selectFrom('access_grant')
          .select('id')
          .where('principal_id', '=', env.ids.ada!)
          .where('level', '=', 'tenant')
          .where('effect', '=', 'allow')
          .execute();
        expect(direct).toHaveLength(1);
        const removed = await removeGrant(trx, direct[0]!.id);
        if (!('removed' in removed)) throw new Error(`refused: ${removed.refused}`);
        return [made[1]!, made[2]!];
      },
    );

    const answered = answers(
      await race(
        env,
        () => callAsAda(env, 'DELETE', `/v1/grants/${graceAdministers}`),
        () => callAsAda(env, 'DELETE', `/v1/grants/${aliceAdministers}`),
      ),
    );
    expect(answered.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answered.find((answer) => answer.status === 409)!.body).toMatchObject({
      code: 'grant_last_administrator',
    });
  });
});
