import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant } from './provision.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('migration 0016, which makes a document an artifact', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every migration up to 0015 and not 0016, so a tenant can stand where every environment stood.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0016-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => !source.endsWith('0016_documents.sql'),
    });
  });

  afterAll(async () => {
    await rm(before, { recursive: true, force: true });
    await db.drop();
  });

  it('widens the two artifact checks and the author check on an environment already at 0015', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Demonstration' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const schema = tenant.schema;

    await expect(
      queryAs(db.adminUrl, `insert into ${schema}.artifact (kind) values ('document')`),
    ).rejects.toThrow(/artifact_kind_check/);

    expect((await migrate(db.migratorUrl)).tenants[id]).toEqual(['0016_documents']);

    // A document is content, so it lives in exactly one space.
    await expect(
      queryAs(db.adminUrl, `insert into ${schema}.artifact (kind) values ('document')`),
    ).rejects.toThrow(/artifact_space_by_kind/);
    const { rows } = await queryAs(
      db.adminUrl,
      `insert into ${schema}.artifact (kind, space_id)
       values ('document', (select id from ${schema}.space where name = 'General')) returning id, kind`,
    );
    expect(rows[0].kind).toBe('document');

    await expect(
      queryAs(
        db.adminUrl,
        `insert into ${schema}.artifact_version
           (artifact_id, kind, revision_no, version_no, author_id, schema_version, content,
            content_hash, metadata_values, not_carried, version_digest)
         values ($1, 'document', 0, 1, null, 1, '{"schemaVersion":1}'::jsonb,
                 repeat('a', 64), '{}'::jsonb, '[]'::jsonb, repeat('b', 64))`,
        [rows[0].id],
      ),
    ).rejects.toThrow(/artifact_version_component_author/);
  });

  // The path every new environment takes, and the one an upgrade does not exercise: every migration of
  // a tenant runs in one transaction, so 0016 alters artifact_version while 0015's insert of the starter
  // component type still has a deferred check queued against it.
  it('applies with every other migration in the one transaction a new environment is made in', async () => {
    const id = db.newTenantId();
    const { schema } = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Fresh' },
      hostnames: [`${id}.alloy.test`],
    });

    const { rows: applied } = await queryAs(
      db.adminUrl,
      `select version from ${schema}.schema_migration order by version`,
    );
    expect(applied.map((row) => row.version)).toContain('0016_documents');
    const { rows } = await queryAs(
      db.adminUrl,
      `insert into ${schema}.artifact (kind, space_id)
       values ('document', (select id from ${schema}.space where name = 'General')) returning kind`,
    );
    expect(rows).toEqual([{ kind: 'document' }]);
  });
});
