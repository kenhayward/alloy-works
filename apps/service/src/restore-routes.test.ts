import type { ComponentVersionList, RestorationView } from '@alloy-works/api-contract';
import {
  bootstrapCluster,
  createComponent,
  createSpace,
  createTenant,
  findRole,
  grant,
  migrate,
  readVersion,
  recordVersion,
  substanceOf,
  type StoredVersion,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from '@alloy-works/db/testing';
import type { ContentDocument } from '@alloy-works/domain';
import { startStandInProvider, type StandInProvider } from '@alloy-works/stand-in-idp';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcClient } from './oidc.js';
import { environmentSecrets } from './secrets.js';
import { configureStandIn, signIn, TEST_SEALING_KEY } from './test/sign-in.js';

const HOST = '127.0.0.1';
const SESSION = '00000000-0000-4000-8000-00000000abcd';

describe("restoring a component's earlier version over HTTP (the RS plan, Task 1)", () => {
  let db: TestDatabase;
  let idp: StandInProvider;
  let tenantDb: TenantDatabase;
  let app: FastifyInstance;
  let tenant: Tenant;
  let clinical = '';
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const call = (method: 'GET' | 'POST', url: string, who: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { host: HOST, cookie: cookies[who]! },
      ...(payload ? { payload } : {}),
    });
  const preview = (version: StoredVersion, who = 'ada') =>
    call('GET', `/v1/components/${version.artifactId}/versions/${version.id}/restoration`, who);
  const restore = (version: StoredVersion, latest: StoredVersion, who = 'ada') =>
    call('POST', `/v1/components/${version.artifactId}/versions/${version.id}/restore`, who, {
      latest: latest.id,
    });

  /** A component at 0.1, then 0.2 saying "Second". */
  const component = () =>
    tenantDb.withTenant(tenant, async (trx) => {
      const made = await createComponent(trx, {
        spaceId: clinical,
        title: 'Install the printer',
        language: 'en-GB',
        direction: 'ltr',
        author: ids.ada!,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const substance = substanceOf(made.version);
      if (substance.kind !== 'component') throw new Error('not a component');
      const next = await recordVersion(trx, {
        artifactId: made.version.artifactId,
        openedFrom: made.version.id,
        author: ids.ada!,
        substance: {
          ...substance,
          content: {
            ...substance.content,
            content: [
              {
                type: 'paragraph',
                id: 'p1',
                style: 'body',
                content: [{ type: 'text', value: 'Second', marks: [] }],
              },
            ],
          } as ContentDocument,
        },
      });
      if (next.answer !== 'recorded') throw new Error(next.answer);
      return { first: made.version, second: next.version };
    });
  const versionsOf = (artifactId: string) =>
    tenantDb.withTenant(
      tenant,
      async (trx) =>
        (
          await trx
            .selectFrom('artifact_version')
            .select('id')
            .where('artifact_id', '=', artifactId)
            .execute()
        ).length,
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
    for (const who of ['ada', 'grace', 'ivy']) {
      cookies[who] = await signIn(app, HOST, who, idp.issuer);
      ids[who] = (await call('GET', '/v1/me', who)).json<{ id: string }>().id;
    }
    await tenantDb.withTenant(tenant, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      // Ada and Grace author Clinical; Ivy reads it.
      for (const [who, name] of [
        ['ada', 'Author'],
        ['grace', 'Author'],
        ['ivy', 'Reader'],
      ] as const) {
        await grant(trx, {
          roleId: (await findRole(trx, name))!.id,
          subject: { principal: ids[who]! },
          level: { kind: 'space', id: clinical },
          effect: 'allow',
          grantedBy: ids.ada!,
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

  it('VER-032 restores an earlier version as a new one, the earlier version untouched', async () => {
    const { first, second } = await component();
    const response = await restore(first, second);
    expect(response.statusCode).toBe(200);
    const { version } = response.json<{ version: { id: string; number: string } }>();
    expect(version.number).toBe('0.3');
    const [restored, earlier] = await tenantDb.withTenant(tenant, async (trx) => [
      await readVersion(trx, version.id),
      await readVersion(trx, first.id),
    ]);
    expect(restored!.content).toEqual(first.content);
    expect(restored!.author).toBe(ids.ada);
    expect(earlier).toEqual(first);
  });

  it('VER-033 lists a restored version with the version it was restored from', async () => {
    const { first, second } = await component();
    await restore(first, second);
    const listed = (
      await call('GET', `/v1/components/${first.artifactId}/versions`, 'ivy')
    ).json<ComponentVersionList>();
    expect(listed.items.map((each) => [each.number, each.restoredFrom])).toEqual([
      ['0.3', { id: first.id, number: '0.1' }],
      ['0.2', null],
      ['0.1', null],
    ]);
  });

  it('CNT-170 VER-033 audits the restore, an act apart from editing, as content.restored by whoever restored, beside the cut', async () => {
    const { first, second } = await component();
    const { version } = (await restore(first, second, 'grace')).json<{ version: { id: string } }>();
    const events = await tenantDb.withTenant(tenant, (trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'actor', 'detail'])
        .where('subject_version', '=', version.id)
        .orderBy('sequence')
        .execute(),
    );
    expect(events).toEqual([
      {
        kind: 'content.version_cut',
        actor: ids.grace,
        detail: { kind: 'component', parent: second.id },
      },
      { kind: 'content.restored', actor: ids.grace, detail: { kind: 'component', from: first.id } },
    ]);
  });

  it('VER-035 previews what a restore would make, inserting nothing, as the restore then makes it', async () => {
    const { first, second } = await component();
    const response = await preview(first);
    expect(response.statusCode).toBe(200);
    expect(response.json<RestorationView>()).toMatchObject({
      component: first.artifactId,
      from: { id: first.id, number: '0.1' },
      latest: { id: second.id, number: '0.2' },
      notCarried: [],
      refusals: [],
    });
    expect(await versionsOf(first.artifactId)).toBe(2);
    expect((await restore(first, second)).statusCode).toBe(200);
    // And what it previewed now refuses, as the write would.
    expect((await preview(first)).json<RestorationView>().refusals).toEqual([
      { code: 'restore_unchanged' },
    ]);
  });

  it('refuses a restore that would change nothing', async () => {
    const { first, second } = await component();
    const response = await restore(second, second);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'restore_unchanged' });
    expect(await versionsOf(first.artifactId)).toBe(2);
  });

  it('refuses a restore while anybody holds the lock, the restorer included, naming the holder', async () => {
    const { first, second } = await component();
    expect(
      (await call('POST', `/v1/components/${first.artifactId}/lock`, 'ada', { session: SESSION }))
        .statusCode,
    ).toBe(200);
    for (const who of ['ada', 'grace']) {
      const response = await restore(first, second, who);
      expect(response.statusCode, who).toBe(409);
      expect(response.json(), who).toMatchObject({
        code: 'restore_locked',
        holder: { id: ids.ada },
      });
    }
    expect((await preview(first, 'grace')).json<RestorationView>().refusals).toEqual([
      { code: 'restore_locked', holder: { id: ids.ada, name: expect.any(String) } },
    ]);
  });

  it('API-037 refuses a restore previewed against a version that is no longer the latest', async () => {
    const { first, second } = await component();
    await restore(first, second);
    const response = await restore(second, second);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'version_precondition',
      current: { number: '0.3' },
    });
  });

  it('refuses a reader who may not edit, and answers one denied read as not found', async () => {
    const { first, second } = await component();
    expect((await preview(first, 'ivy')).statusCode).toBe(403);
    expect((await restore(first, second, 'ivy')).statusCode).toBe(403);
    // Grace authors the space, and is denied Reader on this component itself.
    await tenantDb.withTenant(tenant, async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Reader'))!.id,
        subject: { principal: ids.grace! },
        level: { kind: 'artifact', id: first.artifactId },
        effect: 'deny',
        grantedBy: ids.ada!,
      }),
    );
    expect((await preview(first, 'grace')).statusCode).toBe(404);
    expect((await restore(first, second, 'grace')).statusCode).toBe(404);
    expect(await versionsOf(first.artifactId)).toBe(2);
  });

  it('answers not found for a version of another component', async () => {
    const one = await component();
    const other = await component();
    const response = await call(
      'GET',
      `/v1/components/${one.first.artifactId}/versions/${other.first.id}/restoration`,
      'ada',
    );
    expect(response.statusCode).toBe(404);
  });
});
