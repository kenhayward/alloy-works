// packages/db/src/versions.test.ts
import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  definitionsFor,
  type ComponentSubstance,
  type ComponentTypeDefinition,
  type FieldDefinition,
  type MetadataSchemaDefinition,
} from '@alloy-works/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { versionDigests } from './version-digest.js';
import {
  createArtifact,
  latestVersion,
  readVersion,
  substanceOf,
  type StoredVersion,
} from './versions.js';

const identity = (id: string, name: string) =>
  ({ schemaVersion: DEFINITION_SCHEMA_VERSION, id, name }) as const;

const content = (title: string): ComponentSubstance['content'] => ({
  schemaVersion: 1,
  title,
  language: 'en-GB',
  direction: 'ltr',
  content: [{ type: 'paragraph', id: 'b1', style: 'body', content: [] }],
});

describe('creating and reading versions', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let author: string;
  let spaceId: string;
  let definitions: ComponentSubstance['definitions'];

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
    service = createTenantDatabase(db.serviceUrl);

    ({ author, spaceId, definitions } = await service.withTenant(production, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const space = await createSpace(trx, 'Clinical');
      const by = { author: principal.id };

      const field: FieldDefinition = {
        ...identity(randomUUID(), 'Study'),
        dataType: 'text',
        multiplicity: 'one',
        validation: {},
      };
      const schema: MetadataSchemaDefinition = {
        ...identity(randomUUID(), 'Regulatory'),
        entries: [{ field: field.id, required: true, fixed: false }],
      };
      const type: ComponentTypeDefinition = {
        ...identity(randomUUID(), 'Protocol'),
        assignments: [{ schema: schema.id, requires: [] }],
      };
      const storedField = await createArtifact(trx, {
        ...by,
        substance: { kind: 'field', content: field },
      });
      const storedSchema = await createArtifact(trx, {
        ...by,
        substance: { kind: 'metadataSchema', content: schema },
      });
      const storedType = await createArtifact(trx, {
        ...by,
        substance: { kind: 'componentType', content: type },
      });
      return {
        author: principal.id,
        spaceId: space.id,
        definitions: definitionsFor(
          { version: storedType.id, definition: type },
          [{ version: storedSchema.id, definition: schema }],
          [{ version: storedField.id, definition: field }],
        ),
      };
    }));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const substance = (overrides: Partial<ComponentSubstance> = {}): ComponentSubstance => ({
    kind: 'component',
    content: content('Dosing'),
    values: { [definitions.find((each) => each.kind === 'field')!.id]: 'S-1' },
    notCarried: [],
    definitions,
    ...overrides,
  });

  const create = (tenant: Tenant, input: Parameters<typeof createArtifact>[1]) =>
    service.withTenant(tenant, (trx) => createArtifact(trx, input));

  it('creates a definition in no space, identified by the id its payload carries, as version 0.1', async () => {
    const id = randomUUID();
    const stored = await create(production, {
      author,
      substance: {
        kind: 'field',
        content: { ...identity(id, 'Site'), dataType: 'text', multiplicity: 'one', validation: {} },
      },
    });
    expect(stored).toMatchObject({
      artifactId: id,
      kind: 'field',
      revision: 0,
      version: 1,
      values: {},
      notCarried: [],
      componentType: null,
      definitions: [],
    });
    const artifact = await service.withTenant(production, (trx) =>
      trx.selectFrom('artifact').selectAll().where('id', '=', id).executeTakeFirstOrThrow(),
    );
    expect(artifact.space_id).toBeNull();
  });

  it('refuses a definition whose payload is not identified by an artifact id', async () => {
    await expect(
      create(production, {
        author,
        substance: {
          kind: 'field',
          content: {
            ...identity('field-site', 'Site'),
            dataType: 'text',
            multiplicity: 'one',
            validation: {},
          },
        },
      }),
    ).rejects.toThrow(/identified by its artifact's id, not field-site/);
  });

  it('VER-007 records who cut a version, when, and the note when there is one', async () => {
    const before = Date.now();
    const noted = await create(production, {
      author,
      note: 'First draft',
      spaceId,
      substance: substance(),
    });
    const plain = await create(production, { author, spaceId, substance: substance() });

    expect(noted).toMatchObject({ author, note: 'First draft' });
    expect(plain).toMatchObject({ author, note: null });
    expect(noted.createdAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(noted.createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('VER-010 records the schema version the content was written against', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    expect(stored.schemaVersion).toBe(1);
    expect((stored.content as { schemaVersion: number }).schemaVersion).toBe(stored.schemaVersion);
  });

  it('MET-016 holds metadata values beside the content, and refuses content that carries them', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    expect(stored.values).toEqual(substance().values);
    expect(stored.content).not.toHaveProperty('values');

    const carrying = { ...content('Dosing'), values: substance().values };
    await expect(
      create(production, {
        author,
        spaceId,
        substance: substance({ content: carrying as ComponentSubstance['content'] }),
      }),
    ).rejects.toThrow(/values/);
  });

  it('CNT-145 stores a component as its identifier, its type, its title, its base language and its schema version', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    expect(stored.artifactId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.componentType).toBe(
      definitions.find((each) => each.kind === 'componentType')!.version,
    );
    expect(stored.content).toMatchObject({ title: 'Dosing', language: 'en-GB', schemaVersion: 1 });
    expect(stored.schemaVersion).toBe(1);
  });

  it('records every definition version the component was written against, as the digest names them', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    expect(stored.definitions).toEqual(definitions);
  });

  it('refuses a component version naming a definition version this tenant does not hold', async () => {
    const missing = definitions.map((each) =>
      each.kind === 'field' ? { ...each, version: randomUUID() } : each,
    );
    await expect(
      create(production, { author, spaceId, substance: substance({ definitions: missing }) }),
    ).rejects.toThrow(/version_definition_definition_version_id_definition_artifa_fkey/);
  });

  it('VER-042 records both digests, recomputable from the row, so a changed row is detectable', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    expect(versionDigests(substanceOf(stored))).toEqual({
      contentHash: stored.contentHash,
      versionDigest: stored.versionDigest,
    });

    // Tampering needs more than the application role has, so it is done as an administrator.
    await queryAs(
      db.adminUrl,
      `update ${production.schema}.artifact_version set metadata_values = $1 where id = $2`,
      [JSON.stringify({ [Object.keys(stored.values)[0]!]: 'S-9' }), stored.id],
    );
    const tampered = (await service.withTenant(production, (trx) =>
      readVersion(trx, stored.id),
    )) as StoredVersion;
    const recomputed = versionDigests(substanceOf(tampered));
    expect(recomputed.contentHash).toBe(tampered.contentHash);
    expect(recomputed.versionDigest).not.toBe(tampered.versionDigest);
  });

  it('reads the latest version of an artifact, and nothing for one it does not hold', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    await service.withTenant(production, async (trx) => {
      expect(await latestVersion(trx, stored.artifactId)).toEqual(stored);
      expect(await readVersion(trx, stored.id)).toEqual(stored);
      expect(await latestVersion(trx, randomUUID())).toBeUndefined();
      expect(await readVersion(trx, randomUUID())).toBeUndefined();
      expect(await readVersion(trx, 'not-a-version')).toBeUndefined();
    });
  });

  it("cannot read another tenant's versions, or create one in its space, by its author or on its definitions", async () => {
    const theirs = await create(production, { author, spaceId, substance: substance() });

    await service.withTenant(development, async (trx) => {
      expect(await readVersion(trx, theirs.id)).toBeUndefined();
      expect(await latestVersion(trx, theirs.artifactId)).toBeUndefined();
    });

    const { ownAuthor, ownSpace } = await service.withTenant(development, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: 'grace',
          email: null,
          display_name: 'Grace',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { ownAuthor: principal.id, ownSpace: (await createSpace(trx, 'Clinical')).id };
    });

    await expect(
      create(development, { author: ownAuthor, spaceId, substance: substance() }),
    ).rejects.toThrow(/artifact_space_id_fkey/);
    await expect(
      create(development, { author, spaceId: ownSpace, substance: substance() }),
    ).rejects.toThrow(/artifact_version_author_id_fkey/);
    await expect(
      create(development, { author: ownAuthor, spaceId: ownSpace, substance: substance() }),
    ).rejects.toThrow(/artifact_version_component_type_version_id_fkey/);
  });
});
