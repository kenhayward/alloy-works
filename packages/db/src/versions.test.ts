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
import { sql } from 'kysely';
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
    // The database's clock, not the host's: Docker Desktop's VM clock can drift from the host's.
    const now = () =>
      service.withTenant(production, async (trx) => {
        const { rows } = await sql<{ now: Date }>`select now() as now`.execute(trx);
        return rows[0]!.now.getTime();
      });
    const before = await now();
    const noted = await create(production, {
      author,
      note: 'First draft',
      spaceId,
      substance: substance(),
    });
    const plain = await create(production, { author, spaceId, substance: substance() });
    const after = await now();

    expect(noted).toMatchObject({ author, note: 'First draft' });
    expect(plain).toMatchObject({ author, note: null });
    expect(noted.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(noted.createdAt.getTime()).toBeLessThanOrEqual(after);
  });

  it('refuses an empty note, which is a caller leaving out a note it does not have', async () => {
    await expect(
      create(production, { author, note: '', spaceId, substance: substance() }),
    ).rejects.toThrow(/A version's note is left out when there is none, never an empty string/);
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

    // Closed: a structural attribute the set does not name is refused, not stored beside the rest.
    const widened = { ...content('Dosing'), audience: 'Clinicians' };
    await expect(
      create(production, {
        author,
        spaceId,
        substance: substance({ content: widened as ComponentSubstance['content'] }),
      }),
    ).rejects.toThrow(/audience/);
  });

  it('records every definition version the component was written against, as the digest names them', async () => {
    const stored = await create(production, { author, spaceId, substance: substance() });
    expect(stored.definitions).toEqual(definitions);
  });

  it('refuses a component naming a definition by anything but a lower-case hyphenated UUID, naming it', async () => {
    const field = definitions.find((each) => each.kind === 'field')!;
    const shouted = definitions.map((each) =>
      each.kind === 'field' ? { ...each, version: each.version.toUpperCase() } : each,
    );
    await expect(
      create(production, { author, spaceId, substance: substance({ definitions: shouted }) }),
    ).rejects.toThrow(
      `A component version names each definition by lower-case hyphenated UUIDs, not field ${field.id} at ${field.version.toUpperCase()}`,
    );

    const braced = definitions.map((each) =>
      each.kind === 'field' ? { ...each, id: `{${each.id}}` } : each,
    );
    await expect(
      create(production, { author, spaceId, substance: substance({ definitions: braced }) }),
    ).rejects.toThrow(`not field {${field.id}} at ${field.version}`);
  });

  it('recomputes both digests from a version read back in another transaction', async () => {
    const created = await create(production, { author, spaceId, substance: substance() });
    const read = (await service.withTenant(production, (trx) =>
      readVersion(trx, created.id),
    )) as StoredVersion;
    expect(versionDigests(substanceOf(read))).toEqual({
      contentHash: created.contentHash,
      versionDigest: created.versionDigest,
    });
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
    ).rejects.toThrow(/version_definition_definition_version_id_definition_artifa_fkey/);
  });
});
