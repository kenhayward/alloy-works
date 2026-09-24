import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createComponent } from './creation.js';
import { createTenant, provisionTenant } from './provision.js';
import { createTenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

describe('migration 0016, which makes a document an artifact', () => {
  let db: TestDatabase;
  let before: string;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    // Every tenant migration up to 0015 and none after, so a tenant can stand where every environment
    // stood - whatever has been added since 0016.
    before = await mkdtemp(join(tmpdir(), 'aw-before-0016-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 16;
      },
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

    // An environment already carrying a component, authored as every component is: the widened author
    // check is validated against it when 0016 adds it back.
    const service = createTenantDatabase(db.serviceUrl);
    const component = await service
      .withTenant(tenant, async (trx) => {
        const ada = await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const general = await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow();
        return createComponent(trx, {
          spaceId: general.id,
          title: 'Install the printer',
          language: 'en-GB',
          direction: 'ltr',
          author: ada.id,
        });
      })
      .finally(() => service.close());
    if (component.answer !== 'created')
      throw new Error(`Expected a component, got ${component.answer}`);

    await expect(
      queryAs(db.adminUrl, `insert into ${schema}.artifact (kind) values ('document')`),
    ).rejects.toThrow(/artifact_kind_check/);

    expect((await migrate(db.migratorUrl)).tenants[id]).toEqual([
      '0016_documents',
      '0017_publishing',
      '0018_layouts',
      '0019_default_layout_lists',
      '0020_assets',
      '0021_default_layout_figures',
      '0022_publication_assets',
      '0023_default_layout_relative_words',
      '0024_themes',
      '0025_table_and_image_styles',
    ]);

    // The component and its version are as they were.
    const { rows: held } = await queryAs(
      db.adminUrl,
      `select a.kind, a.space_id is not null as in_a_space, v.id, v.author_id is not null as authored
       from ${schema}.artifact a join ${schema}.artifact_version v on v.artifact_id = a.id
       where a.id = $1`,
      [component.version.artifactId],
    );
    expect(held).toEqual([
      { kind: 'component', in_a_space: true, id: component.version.id, authored: true },
    ]);

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

  // 0017's starter role, on an environment that already made a role of the same name: its own stays,
  // holding what it held, and no second one arrives beside it.
  it('keeps a Publisher role an environment made itself when 0017 adds the starter one', async () => {
    const id = db.newTenantId();
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    const tenant = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id, name: 'Own roles' },
      hostnames: [`${id}.alloy.test`],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    await queryAs(
      db.adminUrl,
      `insert into ${tenant.schema}.role (name, permissions) values ('Publisher', array['read'])`,
    );

    expect((await migrate(db.migratorUrl)).tenants[id]).toEqual([
      '0016_documents',
      '0017_publishing',
      '0018_layouts',
      '0019_default_layout_lists',
      '0020_assets',
      '0021_default_layout_figures',
      '0022_publication_assets',
      '0023_default_layout_relative_words',
      '0024_themes',
      '0025_table_and_image_styles',
    ]);

    const { rows } = await queryAs(
      db.adminUrl,
      `select permissions from ${tenant.schema}.role where name = 'Publisher'`,
    );
    expect(rows).toEqual([{ permissions: ['read'] }]);
  });
});
