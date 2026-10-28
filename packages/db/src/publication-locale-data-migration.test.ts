import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultNumberingScheme } from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { createDocument } from './documents.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import { readPublication, recordPublication, requestPublication } from './publishing.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const LOCALE_DATA = { icu: '77.1', unicode: '16.0', cldr: '47.0' };

describe('migration 0171, which records the locale data a publication was made with', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;
  let tenant: Tenant & { id: string };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0170 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0171-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 171;
      },
    });
    service = testTenantDatabase(db.serviceUrl);
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    tenant = {
      ...(await provisionTenant(db.adminUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id, name: 'Production' },
        hostnames: [`${id}.alloy.test`],
      })),
      id,
    };
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) => service.withTenant(tenant, work);

  /** A publication of a new document, recorded with the worker's locale data. */
  const published = (person: string) =>
    as(async (trx) => {
      const general = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const made = await createDocument(trx, {
        spaceId: general.id,
        title: 'Pond survey',
        language: 'en-GB',
        direction: 'ltr',
        author: person,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      const asked = await requestPublication(trx, {
        documentId: made.version.artifactId,
        version: made.version.id,
        formats: ['pdf'],
        requester: person,
      });
      if (asked.answer !== 'requested') throw new Error(asked.answer);
      const id = await recordPublication(trx, {
        requestId: asked.request.id,
        pipelineVersion: '2',
        fonts: [{ file: 'LiberationSerif-Regular.ttf', sha256: 'a'.repeat(64) }],
        dataSha256: 'b'.repeat(64),
        numbering: { scheme: defaultNumberingScheme.id, entries: [] },
        outputs: [
          {
            format: 'pdf',
            engineVersion: '0.15.1',
            templateVersion: 2,
            key: `${tenant.role}/sha256/${'c'.repeat(64)}`,
            sha256: 'c'.repeat(64),
            bytes: 1000,
          },
        ],
        localeData: LOCALE_DATA,
      });
      return id!;
    });

  it('LOC-044 runs today’s code on a schema before it, then records the locale data of each publication after', async () => {
    const ada = await as(async (trx) => {
      const person = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      return person.id;
    });
    // At 0170: published as ever, with nowhere to record its locale data.
    const earlier = await published(ada);
    expect((await as((trx) => readPublication(trx, earlier)))?.localeData).toBeNull();

    await migrate(db.migratorUrl);
    const later = await published(ada);
    expect((await as((trx) => readPublication(trx, later)))?.localeData).toEqual(LOCALE_DATA);
    // One made before it records none.
    expect((await as((trx) => readPublication(trx, earlier)))?.localeData).toBeNull();
  });
});
