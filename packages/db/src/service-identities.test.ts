import { createHash, randomBytes } from 'node:crypto';
import type { AuditContext } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listPrincipals } from './access-listings.js';
import { issueApiToken } from './api-tokens.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import {
  changeServiceIdentity,
  createServiceIdentity,
  disableServiceIdentity,
  listServiceIdentities,
} from './service-identities.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const SYSTEM: AuditContext = { actorKind: 'system' };
const DAY_MS = 24 * 60 * 60 * 1000;

describe('service identities (the G8 plan, G8-G)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, SYSTEM);

  const events = (subject: string) =>
    as((trx) =>
      trx
        .selectFrom('audit_event')
        .select(['kind', 'detail'])
        .where('subject', '=', subject)
        .orderBy('sequence')
        .execute(),
    );

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    ada = (
      await as((trx) =>
        trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow(),
      )
    ).id;
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('IAM-033 makes a service a principal of its own kind, with no identity a sign-in would find, never shown as invited', async () => {
    const made = await as((trx) =>
      createServiceIdentity(trx, { name: 'Nightly importer', description: 'Imports', by: ada }),
    );
    const principal = await as((trx) =>
      trx
        .selectFrom('principal')
        .select(['kind', 'issuer', 'subject', 'email', 'display_name'])
        .where('id', '=', made.id)
        .executeTakeFirstOrThrow(),
    );
    expect(principal).toEqual({
      kind: 'service',
      issuer: null,
      subject: null,
      email: null,
      display_name: 'Nightly importer',
    });
    expect(made).toMatchObject({
      name: 'Nightly importer',
      description: 'Imports',
      createdBy: ada,
    });
    const listed = await as((trx) => listPrincipals(trx, { limit: 100 }));
    expect(listed.items.find((each) => each.id === made.id)).toMatchObject({
      kind: 'service',
      invited: false,
    });
    expect((await events(made.id)).map((each) => each.kind)).toEqual(['service_identity.created']);
  });

  it('IAM-033 never turns a person into a service, a service into a person, or gives a service an identity', async () => {
    const robot = await as((trx) =>
      createServiceIdentity(trx, { name: 'Robot', description: '', by: ada }),
    );
    await expect(
      as((trx) => sql`update principal set kind = 'service' where id = ${ada}`.execute(trx)),
    ).rejects.toThrow(/never becomes or stops being a service/);
    await expect(
      as((trx) => sql`update principal set kind = 'user' where id = ${robot.id}`.execute(trx)),
    ).rejects.toThrow(/never becomes or stops being a service/);
    await expect(
      as((trx) =>
        sql`update principal set issuer = 'https://idp.example', subject = 'robot'
            where id = ${robot.id}`.execute(trx),
      ),
    ).rejects.toThrow(/no issuer, subject or address/);
    await expect(
      as((trx) =>
        sql`insert into principal (issuer, subject, kind)
            values ('https://idp.example', 'grace', 'service')`.execute(trx),
      ),
    ).rejects.toThrow(/no issuer, subject or address/);
    // And a person's principal is never a service identity's.
    await expect(
      as((trx) =>
        trx.insertInto('service_identity').values({ principal_id: ada, created_by: ada }).execute(),
      ),
    ).rejects.toThrow(/a service identity is a service principal/);
  });

  it('renames a service identity, recording it only when something changed', async () => {
    const made = await as((trx) =>
      createServiceIdentity(trx, { name: 'Exporter', description: '', by: ada }),
    );
    await as((trx) => changeServiceIdentity(trx, made.id, { name: 'Exporter' }));
    const changed = await as((trx) =>
      changeServiceIdentity(trx, made.id, { name: 'Weekly exporter', description: 'Weekly' }),
    );
    expect(changed).toMatchObject({ name: 'Weekly exporter', description: 'Weekly' });
    expect((await events(made.id)).map((each) => each.kind)).toEqual([
      'service_identity.created',
      'service_identity.renamed',
    ]);
    expect(
      await as((trx) =>
        changeServiceIdentity(trx, '00000000-0000-4000-8000-000000000001', { name: 'Nobody' }),
      ),
    ).toBeUndefined();
  });

  it('IAM-035 disables a service identity by revoking every token it holds at once, each recorded', async () => {
    const made = await as((trx) =>
      createServiceIdentity(trx, { name: 'Publisher', description: '', by: ada }),
    );
    const tokens = await as(async (trx) => [
      await issueApiToken(trx, {
        principalId: made.id,
        name: 'One',
        tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
        scopes: ['comment'],
        expiresAt: new Date(Date.now() + 30 * DAY_MS),
      }),
      await issueApiToken(trx, {
        principalId: made.id,
        name: 'Two',
        tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
        scopes: [],
        expiresAt: new Date(Date.now() + 30 * DAY_MS),
      }),
    ]);
    const listed = await as((trx) => listServiceIdentities(trx, { limit: 100 }));
    expect(listed.items.find((each) => each.id === made.id)?.tokens).toBe(2);
    const disabled = await as((trx) => disableServiceIdentity(trx, made.id));
    expect(disabled?.revoked.toSorted()).toEqual(tokens.map((each) => each.id).toSorted());
    expect(disabled?.identity).toMatchObject({ tokens: 0, disabledAt: expect.any(Date) });
    const held = await as((trx) =>
      trx.selectFrom('api_token').select('id').where('principal_id', '=', made.id).execute(),
    );
    expect(held).toEqual([]);
    const disabledEvents = (await events(made.id)).filter(
      (each) => each.kind === 'service_identity.disabled',
    );
    expect(disabledEvents).toEqual([{ kind: 'service_identity.disabled', detail: { tokens: 2 } }]);
    const revoked = await as((trx) =>
      trx
        .selectFrom('audit_event')
        .select('subject')
        .where('kind', '=', 'token.revoked')
        .where(
          'subject',
          'in',
          tokens.map((each) => each.id),
        )
        .execute(),
    );
    expect(revoked).toHaveLength(2);
    // Disabling again changes nothing and records nothing.
    expect((await as((trx) => disableServiceIdentity(trx, made.id)))?.revoked).toEqual([]);
    expect(
      (await events(made.id)).filter((each) => each.kind === 'service_identity.disabled'),
    ).toHaveLength(1);
  });
});
