import { randomUUID } from 'node:crypto';
import { DEFINITION_SCHEMA_VERSION } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createDefinition, listDefinitions, variablesByKey } from './definitions.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

describe('variable definitions (the R5 plan, R5-A)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);
  const define = (kind: 'field' | 'variable', definition: object) =>
    as((trx) =>
      createDefinition(trx, {
        kind,
        definition: { schemaVersion: DEFINITION_SCHEMA_VERSION, ...definition },
        author: ada,
      }),
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
    ada = await as((trx) =>
      trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: randomUUID(),
          email: null,
          display_name: 'Ada',
        })
        .returning('id')
        .executeTakeFirstOrThrow()
        .then((row) => row.id),
    );
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('REU-018 declares a variable by its key, its type and its sources, which a publish reads it by', async () => {
    const field = await define('field', {
      name: 'Next review',
      dataType: 'date',
      multiplicity: 'one',
      validation: {},
    });
    if (field.answer !== 'created') throw new Error(field.answer);
    const made = await define('variable', {
      name: 'Review date',
      key: 'review_date',
      type: { base: 'date' },
      sources: { parameter: 'review', field: field.definition.id },
    });
    if (made.answer !== 'created') throw new Error(made.answer);
    const byKey = await as((trx) => variablesByKey(trx));
    expect(byKey.get('review_date')).toMatchObject({
      name: 'Review date',
      sources: { parameter: 'review', field: field.definition.id },
    });
    // Listed with its key, which an author chooses it by and text names it by (R5b).
    const listed = await as((trx) => listDefinitions(trx));
    expect(listed.items.find((each) => each.kind === 'variable')).toMatchObject({
      name: 'Review date',
      key: 'review_date',
    });
    expect(listed.items.find((each) => each.kind === 'field')).not.toHaveProperty('key');
  });

  it('refuses a variable taking a value from what is no field, and a key another variable has', async () => {
    expect(
      await define('variable', {
        name: 'Site',
        key: 'site',
        type: { base: 'text' },
        sources: { field: randomUUID() },
      }),
    ).toMatchObject({ answer: 'definition.unresolved' });
    const first = await define('variable', {
      name: 'Plant',
      key: 'plant',
      type: { base: 'text' },
      sources: { parameter: 'plant' },
    });
    expect(first.answer).toBe('created');
    expect(
      await define('variable', {
        name: 'Plant again',
        key: 'plant',
        type: { base: 'text' },
        sources: { parameter: 'plant' },
      }),
    ).toMatchObject({ answer: 'definition.name_taken' });
  });
});
