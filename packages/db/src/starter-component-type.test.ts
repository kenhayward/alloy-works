import {
  DEFINITION_SCHEMA_VERSION,
  readDefinition,
  type ComponentTypeDefinition,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { defaultComponentType, listComponentTypes, STARTER_COMPONENT_TYPE_ID } from './creation.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { versionDigests } from './version-digest.js';

/** What 0015 writes, and what the digests in it are over. */
const starter: ComponentTypeDefinition = {
  schemaVersion: DEFINITION_SCHEMA_VERSION,
  id: STARTER_COMPONENT_TYPE_ID,
  name: 'Topic',
  assignments: [],
};

describe('the component type every environment starts with', () => {
  let db: TestDatabase;
  let service: TenantDatabase;
  let acme: Tenant;
  let other: Tenant;

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    const organisation = { id: 'acme', name: 'Acme' };
    acme = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    other = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service?.close();
    await db?.drop();
  });

  it('is declared as the default in every environment, at 0.1 and authored by nobody', async () => {
    for (const tenant of [acme, other]) {
      const found = await service.withTenant(tenant, async (trx) => {
        const declared = await defaultComponentType(trx);
        const version = await trx
          .selectFrom('artifact_version')
          .selectAll()
          .where('artifact_id', '=', STARTER_COMPONENT_TYPE_ID)
          .executeTakeFirstOrThrow();
        return { declared, version };
      });
      expect(found.declared).toBe(STARTER_COMPONENT_TYPE_ID);
      expect(found.version.author_id).toBeNull();
      expect(found.version.revision_no).toBe(0);
      expect(found.version.version_no).toBe(1);
      expect(found.version.component_type_version_id).toBeNull();
    }
  });

  it('carries the digests the domain computes for what it stores', async () => {
    const version = await service.withTenant(acme, (trx) =>
      trx
        .selectFrom('artifact_version')
        .selectAll()
        .where('artifact_id', '=', STARTER_COMPONENT_TYPE_ID)
        .executeTakeFirstOrThrow(),
    );
    const digests = versionDigests({ kind: 'componentType', content: starter });
    expect(version.content_hash).toBe(digests.contentHash);
    expect(version.version_digest).toBe(digests.versionDigest);
    const read = readDefinition('componentType', version.content, {
      artifact: STARTER_COMPONENT_TYPE_ID,
      version: version.id,
    });
    expect(read.ok && read.definition).toMatchObject({ name: 'Topic', assignments: [] });
  });

  it('lists the environment component types with the default marked', async () => {
    const types = await service.withTenant(acme, (trx) => listComponentTypes(trx));
    expect(types).toEqual([{ id: STARTER_COMPONENT_TYPE_ID, name: 'Topic', isDefault: true }]);
  });

  it('does not list another environment component types', async () => {
    const made = await service.withTenant(other, async (trx) => {
      const artifact = await trx
        .insertInto('artifact')
        .values({ kind: 'componentType', space_id: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      return artifact.id;
    });
    const here = await service.withTenant(acme, (trx) => listComponentTypes(trx));
    expect(here.map((each) => each.id)).not.toContain(made);
  });

  it('still refuses a component version with no author', async () => {
    await expect(
      service.withTenant(acme, async (trx) => {
        const space = await trx
          .selectFrom('space')
          .select('id')
          .where('name', '=', 'General')
          .executeTakeFirstOrThrow();
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'component', space_id: space.id })
          .returning('id')
          .executeTakeFirstOrThrow();
        await trx
          .insertInto('artifact_version')
          .values({
            artifact_id: artifact.id,
            kind: 'component',
            revision_no: 0,
            version_no: 1,
            author_id: null,
            note: null,
            schema_version: 1,
            // S2: otherwise valid, so only the author check can fail - artifact_version_schema_version_is_content
            // (0008) would also reject an empty content object, and a test relying on constraint-name
            // evaluation order is not a test of the constraint it names.
            content: JSON.stringify({ schemaVersion: 1 }),
            content_hash: 'a'.repeat(64),
            metadata_values: '{}',
            not_carried: '[]',
            component_type_version_id: STARTER_COMPONENT_TYPE_ID,
            version_digest: 'b'.repeat(64),
          })
          .execute();
      }),
    ).rejects.toThrow(/artifact_version_component_author/);
  });
});
