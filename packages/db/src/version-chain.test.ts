import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ArtifactKind } from './artifact-kind.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const DIGEST = 'a'.repeat(64);
const content = (schemaVersion: unknown = 1) => ({ schemaVersion, title: 'Dosing' });

describe('the version chain as stored', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let author: string;
  let spaceId: string;

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
    ({ author, spaceId } = await service.withTenant(production, async (trx) => {
      const principal = await trx
        .insertInto('principal')
        .values({ issuer: 'https://idp.example', subject: 'ada', email: null, display_name: 'Ada' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const space = await createSpace(trx, 'Clinical');
      return { author: principal.id, spaceId: space.id };
    }));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const artifact = (trx: TenantTransaction, kind: ArtifactKind) =>
    trx
      .insertInto('artifact')
      .values({ kind, space_id: kind === 'component' ? spaceId : null })
      .returning('id')
      .executeTakeFirstOrThrow();

  type Row = {
    artifactId: string;
    kind: ArtifactKind;
    versionNo?: number;
    content?: unknown;
    schemaVersion?: number;
    values?: string;
    notCarried?: string;
    componentType?: string | null;
  };

  const version = (trx: TenantTransaction, row: Row) =>
    trx
      .insertInto('artifact_version')
      .values({
        artifact_id: row.artifactId,
        kind: row.kind,
        revision_no: 0,
        version_no: row.versionNo ?? 1,
        author_id: author,
        note: null,
        schema_version: row.schemaVersion ?? 1,
        content: JSON.stringify(row.content ?? content()),
        content_hash: DIGEST,
        metadata_values: row.values ?? '{}',
        not_carried: row.notCarried ?? '[]',
        component_type_version_id: row.componentType ?? null,
        version_digest: DIGEST,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

  /** A component type version, and a component version written against it. */
  const component = async (trx: TenantTransaction) => {
    const type = await artifact(trx, 'componentType');
    const typeVersion = await version(trx, { artifactId: type.id, kind: 'componentType' });
    const made = await artifact(trx, 'component');
    const first = await version(trx, {
      artifactId: made.id,
      kind: 'component',
      componentType: typeVersion.id,
    });
    return { type, typeVersion, component: made, version: first };
  };

  it('VER-008 gives the runtime role no update, delete or truncate on a version or what it records', async () => {
    const stored = await service.withTenant(production, async (trx) => {
      const made = await component(trx);
      await trx
        .insertInto('version_definition')
        .values({
          version_id: made.version.id,
          definition_version_id: made.typeVersion.id,
          definition_artifact_id: made.type.id,
          definition_kind: 'componentType',
        })
        .execute();
      return made;
    });

    const refused = [
      sql`update artifact_version set note = 'changed' where id = ${stored.version.id}`,
      sql`delete from artifact_version where id = ${stored.version.id}`,
      sql`truncate artifact_version cascade`,
      sql`update version_definition set definition_kind = 'field' where version_id = ${stored.version.id}`,
      sql`delete from version_definition where version_id = ${stored.version.id}`,
      sql`truncate version_definition`,
    ];
    for (const statement of refused) {
      await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }

    const still = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('artifact_version')
        .select(['note'])
        .where('id', '=', stored.version.id)
        .executeTakeFirstOrThrow(),
    );
    expect(still.note).toBeNull();
  });

  it('VER-010 refuses a version whose schema version is not the one its content records', async () => {
    await service.withTenant(production, async (trx) => {
      const field = await artifact(trx, 'field');
      await expect(
        version(trx, {
          artifactId: field.id,
          kind: 'field',
          content: content(2),
          schemaVersion: 1,
        }),
      ).rejects.toThrow(/artifact_version_schema_version_is_content/);
    });
    await service.withTenant(production, async (trx) => {
      const field = await artifact(trx, 'field');
      await expect(
        version(trx, { artifactId: field.id, kind: 'field', content: { title: 'None' } }),
      ).rejects.toThrow(/artifact_version_schema_version_is_content/);
    });
  });

  it("refuses a version whose kind is not its artifact's", async () => {
    await service.withTenant(production, async (trx) => {
      const field = await artifact(trx, 'field');
      await expect(version(trx, { artifactId: field.id, kind: 'metadataSchema' })).rejects.toThrow(
        /artifact_version_artifact_id_kind_fkey/,
      );
    });
  });

  it('records a component type on a component version and on nothing else', async () => {
    await service.withTenant(production, async (trx) => {
      const made = await artifact(trx, 'component');
      await expect(version(trx, { artifactId: made.id, kind: 'component' })).rejects.toThrow(
        /artifact_version_type_by_kind/,
      );
    });
    await service.withTenant(production, async (trx) => {
      const { typeVersion } = await component(trx);
      const field = await artifact(trx, 'field');
      await expect(
        version(trx, { artifactId: field.id, kind: 'field', componentType: typeVersion.id }),
      ).rejects.toThrow(/artifact_version_type_by_kind/);
    });
  });

  it('refuses, at commit, a component version whose type is not the component type it records', async () => {
    const record = (
      trx: TenantTransaction,
      versionId: string,
      definition: { version: string; artifact: string; kind: 'field' | 'componentType' },
    ) =>
      trx
        .insertInto('version_definition')
        .values({
          version_id: versionId,
          definition_version_id: definition.version,
          definition_artifact_id: definition.artifact,
          definition_kind: definition.kind,
        })
        .execute();

    /**
     * A component version recording a type and a field, whose type column names `typeOf`'s answer.
     * Every statement succeeds; only the commit is left to refuse it.
     */
    const cut = (typeOf: (made: { field: string; second: string }) => string) => {
      const reached = { commit: false };
      const work = service.withTenant(production, async (trx) => {
        const type = await artifact(trx, 'componentType');
        const typeVersion = await version(trx, { artifactId: type.id, kind: 'componentType' });
        const second = await version(trx, {
          artifactId: type.id,
          kind: 'componentType',
          versionNo: 2,
        });
        const field = await artifact(trx, 'field');
        const fieldVersion = await version(trx, { artifactId: field.id, kind: 'field' });
        const made = await artifact(trx, 'component');
        const cutVersion = await version(trx, {
          artifactId: made.id,
          kind: 'component',
          componentType: typeOf({ field: fieldVersion.id, second: second.id }),
        });
        await record(trx, cutVersion.id, {
          version: typeVersion.id,
          artifact: type.id,
          kind: 'componentType',
        });
        await record(trx, cutVersion.id, {
          version: fieldVersion.id,
          artifact: field.id,
          kind: 'field',
        });
        reached.commit = true;
      });
      return { work, reached };
    };

    const naming = [
      // A version that is not a component type's, though the component records it.
      ({ field }: { field: string }) => field,
      // A component type's version, though not the one the component records.
      ({ second }: { second: string }) => second,
    ];
    for (const typeOf of naming) {
      const { work, reached } = cut(typeOf);
      await expect(work).rejects.toThrow(/artifact_version_component_type_recorded/);
      expect(reached.commit).toBe(true);
    }
  });

  it('holds metadata values as an object and what was not carried as a list, on a component only', async () => {
    const refusals: [Partial<Row>, RegExp][] = [
      [{ values: '[]' }, /artifact_version_metadata_shape/],
      [{ notCarried: '{}' }, /artifact_version_metadata_shape/],
    ];
    for (const [row, refusal] of refusals) {
      await service.withTenant(production, async (trx) => {
        const { typeVersion } = await component(trx);
        const made = await artifact(trx, 'component');
        await expect(
          version(trx, {
            artifactId: made.id,
            kind: 'component',
            componentType: typeVersion.id,
            ...row,
          }),
        ).rejects.toThrow(refusal);
      });
    }
    await service.withTenant(production, async (trx) => {
      const field = await artifact(trx, 'field');
      await expect(
        version(trx, { artifactId: field.id, kind: 'field', values: '{"field-study":"S-1"}' }),
      ).rejects.toThrow(/artifact_version_values_by_kind/);
    });
  });

  it('numbers a version once within its artifact', async () => {
    await service.withTenant(production, async (trx) => {
      const field = await artifact(trx, 'field');
      await version(trx, { artifactId: field.id, kind: 'field' });
      await expect(version(trx, { artifactId: field.id, kind: 'field' })).rejects.toThrow(
        /artifact_version_artifact_id_revision_no_version_no_key/,
      );
    });
  });

  it('records a definition only as the version, artifact and kind it is, and one version of each', async () => {
    const record = (
      trx: TenantTransaction,
      versionId: string,
      definition: {
        version: string;
        artifact: string;
        kind: 'field' | 'metadataSchema' | 'componentType';
      },
    ) =>
      trx
        .insertInto('version_definition')
        .values({
          version_id: versionId,
          definition_version_id: definition.version,
          definition_artifact_id: definition.artifact,
          definition_kind: definition.kind,
        })
        .execute();

    await service.withTenant(production, async (trx) => {
      const made = await component(trx);
      await expect(
        record(trx, made.version.id, {
          version: made.typeVersion.id,
          artifact: made.type.id,
          kind: 'field',
        }),
      ).rejects.toThrow(/version_definition_definition_version_id_definition_artifa_fkey/);
    });

    await service.withTenant(production, async (trx) => {
      const made = await component(trx);
      const second = await version(trx, {
        artifactId: made.type.id,
        kind: 'componentType',
        versionNo: 2,
      });
      await record(trx, made.version.id, {
        version: made.typeVersion.id,
        artifact: made.type.id,
        kind: 'componentType',
      });
      await expect(
        record(trx, made.version.id, {
          version: second.id,
          artifact: made.type.id,
          kind: 'componentType',
        }),
      ).rejects.toThrow(/version_definition_version_id_definition_artifact_id_key/);
    });
  });

  it('CNT-145 holds a component in closed columns, with no general attribute column to add one to', async () => {
    const columns = (table: string) =>
      service.withTenant(production, async (trx) => {
        const { rows } = await sql<{ column_name: string }>`
          select column_name from information_schema.columns
          where table_schema = current_schema() and table_name = ${table}
          order by column_name
        `.execute(trx);
        return rows.map((row) => row.column_name);
      });

    expect(await columns('artifact')).toEqual(['created_at', 'id', 'kind', 'space_id']);
    expect(await columns('artifact_version')).toEqual(
      [
        'artifact_id',
        'author_id',
        'component_type_kind',
        'component_type_version_id',
        'content',
        'content_hash',
        'created_at',
        'id',
        'kind',
        'metadata_values',
        'not_carried',
        'note',
        'revision_no',
        'schema_version',
        'version_digest',
        'version_no',
      ].sort(),
    );
  });

  it("cannot read another tenant's versions, or write one naming another tenant's author", async () => {
    const theirs = await service.withTenant(development, async (trx) => {
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
      const field = await trx
        .insertInto('artifact')
        .values({ kind: 'field', space_id: null })
        .returning('id')
        .executeTakeFirstOrThrow();
      const stored = await trx
        .insertInto('artifact_version')
        .values({
          artifact_id: field.id,
          kind: 'field',
          revision_no: 0,
          version_no: 1,
          author_id: principal.id,
          note: null,
          schema_version: 1,
          content: JSON.stringify(content()),
          content_hash: DIGEST,
          metadata_values: '{}',
          not_carried: '[]',
          component_type_version_id: null,
          version_digest: DIGEST,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { author: principal.id, version: stored.id };
    });

    const seen = await service.withTenant(production, (trx) =>
      trx.selectFrom('artifact_version').select('id').where('id', '=', theirs.version).execute(),
    );
    expect(seen).toEqual([]);

    await expect(
      service.withTenant(production, async (trx) => {
        const field = await artifact(trx, 'field');
        await trx
          .insertInto('artifact_version')
          .values({
            artifact_id: field.id,
            kind: 'field',
            revision_no: 0,
            version_no: 1,
            author_id: theirs.author,
            note: null,
            schema_version: 1,
            content: JSON.stringify(content()),
            content_hash: DIGEST,
            metadata_values: '{}',
            not_carried: '[]',
            component_type_version_id: null,
            version_digest: DIGEST,
          })
          .execute();
      }),
    ).rejects.toThrow(/artifact_version_author_id_fkey/);
  });
});
