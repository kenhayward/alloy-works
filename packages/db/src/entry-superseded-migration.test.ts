import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEntry } from './bibliography.js';
import { bootstrapCluster } from './bootstrap.js';
import { readEntryStatus, recordEntryCheck } from './entry-status.js';
import { migrate } from './migrate.js';
import { provisionTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

describe('migration 0175, which stores an entry superseded', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let before: string;
  let tenant: Tenant & { id: string };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0174 and none after.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0175-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 175;
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

  const superseded = (entryId: string) =>
    as((trx) =>
      recordEntryCheck(trx, {
        entryId,
        source: 'crossref',
        check: {
          outcome: 'superseded',
          differs: [],
          notice: { kind: 'supersession', identifier: '10.5555/s.v2' },
        },
      }),
    );

  it('LIB-035 refuses an entry superseded before it, keeps each status it held, and stores one after', async () => {
    const entry = await as(async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const space = await trx
        .selectFrom('space')
        .select('id')
        .where('name', '=', 'General')
        .executeTakeFirstOrThrow();
      const made = await createEntry(trx, {
        author: principal.id,
        spaceId: space.id,
        entry: {
          csl: { type: 'book', title: 'Superseded' },
          obtained: { from: 'crossref:10.5555/s', at: '2026-01-02T03:04:05Z' },
        },
        despiteMatches: true,
      });
      if (made.answer !== 'created') throw new Error(made.answer);
      return made.entry.id;
    });
    // At 0174: superseded is no outcome, and nobody was told of one.
    await expect(superseded(entry)).rejects.toThrow(/outcome_check/);
    await expect(
      as((trx) =>
        sql`insert into bibliography_entry_told (entry_id, recipient, outcome)
            select ${entry}, id, 'superseded' from principal limit 1`.execute(trx),
      ),
    ).rejects.toThrow(/outcome_check/);
    await as((trx) =>
      recordEntryCheck(trx, {
        entryId: entry,
        source: 'crossref',
        check: { outcome: 'corrected', differs: [], notice: { kind: 'correction' } },
      }),
    );

    await migrate(db.migratorUrl);

    expect(await as((trx) => readEntryStatus(trx, entry))).toMatchObject({
      outcome: 'corrected',
    });
    await superseded(entry);
    expect(await as((trx) => readEntryStatus(trx, entry))).toMatchObject({
      outcome: 'superseded',
      notice: { kind: 'supersession', identifier: '10.5555/s.v2' },
    });
    await as((trx) =>
      sql`insert into bibliography_entry_told (entry_id, recipient, outcome)
          select ${entry}, id, 'superseded' from principal limit 1`.execute(trx),
    );
  });
});
