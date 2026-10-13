import type { DeletionView, RetentionView } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createComponent,
  createSpace,
  createTenant,
  findRole,
  grant,
  migrate,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const DAY = 86_400_000;

describe('retention keeps over HTTP (the DL plan, Task 2)', () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  let surgical = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (
    method: 'GET' | 'PUT' | 'POST',
    url: string,
    who: string,
    payload?: object,
    headers: Record<string, string> = { cookie: cookies[who] ?? '' },
  ) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, ...headers },
      ...(payload ? { payload } : {}),
    });

  const keep = (
    kind: 'component' | 'document' | null,
    space: string | null,
    days: number | null,
    who = 'ivy',
    headers?: Record<string, string>,
  ) => call('PUT', '/v1/retention', who, { kind, space, days }, headers);

  const component = (space: string, title: string) =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: space,
        title,
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return { id: made.version.artifactId, at: made.version.createdAt };
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
    await configureStandIn(db.adminUrl, tenant, { issuer: idp.issuer, clientId: 'alloy' });
    tenantDb = testTenantDatabase(db.serviceUrl);
    app = buildApp({
      db: tenantDb,
      logLevel: 'silent',
      oidc: createOidcClient({ allowInsecureIssuers: true }),
      secrets: environmentSecrets({}),
      sealingKey: TEST_SEALING_KEY,
    });
    for (const who of ['ivy', 'ada', 'grace', 'alice']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      surgical = (await createSpace(trx, 'Surgical')).id;
      // Ivy administers the environment, and so does Alice, external; Ada authors and administers
      // Clinical; Grace authors it.
      for (const who of ['ivy', 'alice']) {
        await grant(trx, {
          roleId: (await findRole(trx, 'Administrator'))!.id,
          subject: { principal: ids[who]! },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: ids.ivy!,
          ...(who === 'alice' ? { expiresAt: new Date(Date.now() + 7 * DAY) } : {}),
        });
      }
      await trx
        .updateTable('principal')
        .set({ kind: 'external' })
        .where('id', '=', ids.alice!)
        .execute();
      for (const [who, name] of [
        ['ada', 'Author'],
        ['ada', 'Administrator'],
        ['grace', 'Author'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, name))!.id,
          subject: { principal: ids[who]! },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          grantedBy: ids.ivy!,
        });
      }
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await idp?.close();
    await tenantDb?.close();
    await db?.drop();
  });

  it('LIF-019 sets a keep per kind and per space, lists those in force, and clears one', async () => {
    const set = await keep('document', null, 90);
    expect(set.statusCode, set.body).toBe(200);
    expect((await keep(null, surgical, 30)).statusCode).toBe(200);
    expect((await keep('component', surgical, 400)).statusCode).toBe(200);
    const read = await call('GET', '/v1/retention', 'ivy');
    expect(read.statusCode, read.body).toBe(200);
    expect(
      read.json<RetentionView>().keeps.map(({ kind, space, days, by }) => ({
        kind,
        space: space?.name ?? null,
        days,
        by: by.name,
      })),
    ).toEqual([
      { kind: 'document', space: null, days: 90, by: 'Ivy' },
      { kind: null, space: 'Surgical', days: 30, by: 'Ivy' },
      { kind: 'component', space: 'Surgical', days: 400, by: 'Ivy' },
    ]);
    const cleared = await keep('component', surgical, null);
    expect(cleared.json<RetentionView>().keeps.map((each) => each.days)).toEqual([90, 30]);
    await keep('document', null, null);
    await keep(null, surgical, null);
    expect((await call('GET', '/v1/retention', 'ivy')).json<RetentionView>().keeps).toEqual([]);
  });

  it('refuses deleting within a keep, 409 kept with the date it passes', async () => {
    const young = await component(clinical, 'Young procedure');
    await keep('component', clinical, 30);
    const until = new Date(young.at.getTime() + 30 * DAY).toISOString();
    const preview = await call('GET', `/v1/components/${young.id}/deletion`, 'ada');
    expect(preview.json<DeletionView>().refusals).toEqual([{ code: 'kept', until }]);
    const refused = await call('POST', `/v1/components/${young.id}/delete`, 'ada');
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({
      code: 'deletion_refused',
      refusals: [{ code: 'kept', until }],
    });
    await keep('component', clinical, null);
    expect((await call('POST', `/v1/components/${young.id}/delete`, 'ada')).statusCode).toBe(200);
  });

  it('sets and reads keeps only for an environment administrator, never a space administrator or an external one', async () => {
    // Ada administers Clinical, and Grace authors it: neither may. Alice administers the
    // environment, but administering is capped for an external principal.
    for (const who of ['ada', 'grace', 'alice']) {
      expect((await keep(null, clinical, 5, who)).statusCode, who).toBe(403);
      expect((await call('GET', '/v1/retention', who)).statusCode, who).toBe(403);
    }
    expect((await call('GET', '/v1/retention', 'ivy')).json<RetentionView>().keeps).toEqual([]);
  });

  it('refuses a token not scoped to administer', async () => {
    const issue = async (scopes: string[]) =>
      (
        await call('POST', '/v1/tokens', 'ivy', {
          name: `Scoped ${scopes.join(' ') || 'none'}`,
          scopes,
          expiresAt: new Date(Date.now() + DAY).toISOString(),
        })
      ).json<{ secret: string }>().secret;
    const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });
    const refused = await keep(null, clinical, 5, 'ivy', bearer(await issue(['edit'])));
    expect(refused.statusCode, refused.body).toBe(403);
    const allowed = await keep(null, clinical, 5, 'ivy', bearer(await issue(['administer'])));
    expect(allowed.statusCode, allowed.body).toBe(200);
    await keep(null, clinical, null);
  });

  it('refuses neither a kind nor a space, days out of range, and a space the environment does not hold', async () => {
    expect((await keep(null, null, 5)).statusCode).toBe(400);
    expect((await keep('component', null, 0)).statusCode).toBe(400);
    const missing = await keep(null, '00000000-0000-4000-8000-000000000003', 5);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'not_found' });
  });

  it('LIF-019 records retention.changed by whoever set it, and nothing for a keep set again', async () => {
    await keep('document', surgical, 7);
    await keep('document', surgical, 7);
    await keep('document', surgical, null);
    const events = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['actor', 'space', 'detail'])
        .where('kind', '=', 'retention.changed')
        .where('space', '=', surgical)
        .orderBy('sequence')
        .execute(),
    );
    expect(events.filter((each) => (each.detail as { kind?: string }).kind === 'document')).toEqual(
      [
        { actor: ids.ivy, space: surgical, detail: { kind: 'document', space: surgical, days: 7 } },
        {
          actor: ids.ivy,
          space: surgical,
          detail: { kind: 'document', space: surgical, days: null },
        },
      ],
    );
  });
});
