// apps/service/src/access-targets.test.ts
import {
  bootstrapCluster,
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
import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorise, type PermissionCheck } from './access.js';

const MISSING = '00000000-0000-4000-8000-000000000000';

/** A request as `authorise` reads one: validated parameters, query and body, and nothing else. */
const requestWith = (parts: { params?: object; query?: object; body?: object }) =>
  ({ params: {}, query: {}, ...parts }) as unknown as FastifyRequest;

describe('targets a route names in its body, or by a grant', () => {
  let db: TestDatabase;
  let tenantDb: TenantDatabase;
  let production: Tenant;
  let development: Tenant;
  let ada: string;
  let grace: string;
  let clinical: string;
  let quality: string;
  let atQuality: string;
  let atClinical: string;
  let theirs: string;

  const person = (where: Tenant, subject: string) =>
    tenantDb.withTenant(where, (trx) =>
      trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject, email: null, display_name: null })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );

  const give = async (where: Tenant, input: Omit<NewGrant, 'roleId'> & { role: string }) => {
    const answer = await tenantDb.withTenant(where, async (trx) => {
      const role = await findRole(trx, input.role);
      return grant(trx, { ...input, roleId: role!.id });
    });
    if (!('granted' in answer)) throw new Error(`refused: ${answer.refused}`);
    return answer.granted;
  };

  const administer = (target: PermissionCheck['target']): PermissionCheck => ({
    check: 'permission',
    permission: 'administer',
    target,
  });

  const decideAs = (principal: string, check: PermissionCheck, request: FastifyRequest) =>
    tenantDb.withTenant(production, (trx) => authorise(trx, principal, check, request));

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    tenantDb = createTenantDatabase(db.serviceUrl);
    ada = await person(production, 'ada');
    grace = await person(production, 'grace');
    await tenantDb.withTenant(production, async (trx) => {
      clinical = (await createSpace(trx, 'Clinical')).id;
      quality = (await createSpace(trx, 'Quality')).id;
    });
    // Ada administers the tenant. Grace administers Clinical and reads Quality, where she administers
    // nothing: a grant there is one she may read about the space of, but not manage.
    await give(production, {
      role: 'Administrator',
      subject: { principal: ada },
      level: { kind: 'tenant' },
      effect: 'allow',
      grantedBy: ada,
    });
    await give(production, {
      role: 'Administrator',
      subject: { principal: grace },
      level: { kind: 'space', id: clinical },
      effect: 'allow',
      grantedBy: ada,
    });
    atQuality = (
      await give(production, {
        role: 'Reader',
        subject: { principal: grace },
        level: { kind: 'space', id: quality },
        effect: 'allow',
        grantedBy: ada,
      })
    ).id;
    atClinical = (
      await give(production, {
        role: 'Author',
        subject: { principal: ada },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ada,
      })
    ).id;
    const ivy = await person(development, 'ivy');
    theirs = (
      await give(development, {
        role: 'Reader',
        subject: { principal: ivy },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ivy,
      })
    ).id;
  });

  afterAll(async () => {
    await tenantDb.close();
    await db.drop();
  });

  it('decides against the target a body member names, spelled as a query target is', async () => {
    const check = administer({ body: 'level' });
    await expect(
      decideAs(grace, check, requestWith({ body: { level: `space:${clinical}` } })),
    ).resolves.toMatchObject({
      target: { kind: 'space', id: clinical },
      decision: { allowed: true },
    });
    await expect(
      decideAs(grace, check, requestWith({ body: { level: `space:${quality}` } })),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    await expect(
      decideAs(grace, check, requestWith({ body: { level: 'document:1' } })),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(decideAs(grace, check, requestWith({ body: {} }))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('decides against the level a grant was made at, for the grant a path parameter names', async () => {
    const check = administer({ grant: 'id' });
    await expect(
      decideAs(ada, check, requestWith({ params: { id: atQuality } })),
    ).resolves.toMatchObject({
      target: { kind: 'space', id: quality },
      decision: { allowed: true },
    });
    await expect(
      decideAs(grace, check, requestWith({ params: { id: atClinical } })),
    ).resolves.toMatchObject({ target: { kind: 'space', id: clinical } });
  });

  it('answers a grant the caller may not manage exactly as one that does not exist, even where they read its level', async () => {
    const check = administer({ grant: 'id' });
    const refusals = await Promise.all(
      [atQuality, MISSING, theirs, 'not-a-uuid'].map((id) =>
        decideAs(grace, check, requestWith({ params: { id } })).then(
          () => undefined,
          (error: { status: number; code: string; message: string }) => ({
            status: error.status,
            code: error.code,
            message: error.message,
          }),
        ),
      ),
    );
    expect(refusals).toEqual(
      Array(4).fill({
        status: 404,
        code: 'not_found',
        message: 'There is nothing at this address.',
      }),
    );
  });
});
