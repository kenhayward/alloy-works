import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Provenance } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAssetUpload, uploadForDatasetImage } from './assets.js';
import { bootstrapCluster } from './bootstrap.js';
import { pendingResult, recordResolution } from './datasets.js';
import { migrate } from './migrate.js';
import { createTenant, provisionTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { everyKind } from './testing/every-kind.js';
import { latestVersion } from './versions.js';

const ISSUER = 'https://idp.example';
const MADE = ['asset_upload', 'dataset_pending'] as const;
const NODE = 'n'.repeat(26);

describe('migration 0051, which keeps a result waiting on its images', () => {
  let db: TestDatabase;
  let before: string;
  let service: TenantDatabase;
  let upgraded: Tenant;
  let fresh: Tenant;
  let earlier: string;

  /** Every constraint and index on the tables 0051 makes or changes. */
  const constraints = async (schema: string) => {
    const out: Record<string, string> = {};
    for (const table of MADE) {
      const rows = await queryAs(
        db.adminUrl,
        `select c.conname, pg_get_constraintdef(c.oid) as def from pg_constraint c
           join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
          where n.nspname = $1 and t.relname = $2 order by c.conname`,
        [schema, table],
      );
      for (const row of rows.rows) {
        out[row.conname as string] = (row.def as string).replaceAll(`${schema}.`, '');
      }
      const indexes = await queryAs(
        db.adminUrl,
        `select indexname, indexdef from pg_indexes where schemaname = $1 and tablename = $2
          order by indexname`,
        [schema, table],
      );
      for (const row of indexes.rows) {
        out[row.indexname as string] = (row.indexdef as string).replaceAll(`${schema}.`, '');
      }
    }
    return out;
  };

  /** The runtime role's privileges on those tables, by table and by column. */
  const privileges = async (schema: string) => {
    const tables = await queryAs(
      db.adminUrl,
      `select table_name, privilege_type from information_schema.table_privileges
        where table_schema = $1 and grantee = $1 and table_name = any($2)
        order by table_name, privilege_type`,
      [schema, [...MADE]],
    );
    const columns = await queryAs(
      db.adminUrl,
      `select table_name, column_name, privilege_type from information_schema.column_privileges
        where table_schema = $1 and grantee = $1 and table_name = any($2)
          and privilege_type <> 'SELECT'
        order by table_name, column_name, privilege_type`,
      [schema, [...MADE]],
    );
    return { tables: tables.rows, columns: columns.rows };
  };

  const person = (trx: TenantTransaction) =>
    trx
      .insertInto('principal')
      .values({ issuer: ISSUER, subject: 'ada', email: null, display_name: 'Ada' })
      .returning('id')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  const generalOf = (trx: TenantTransaction) =>
    trx
      .selectFrom('space')
      .select('id')
      .where('name', '=', 'General')
      .executeTakeFirstOrThrow()
      .then((row) => row.id);

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    before = await mkdtemp(join(tmpdir(), 'aw-before-0051-'));
    await cp(new URL('../migrations/', import.meta.url), before, {
      recursive: true,
      filter: (source) => {
        const numbered = /[\\/]tenant[\\/](\d{4})_[a-z0-9_]+\.sql$/.exec(source);
        return numbered === null || Number(numbered[1]) < 51;
      },
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    upgraded = await provisionTenant(db.adminUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    await migrate(db.migratorUrl, { migrationsDir: pathToFileURL(`${before}/`) });
    service = createTenantDatabase(db.serviceUrl);
    // An upload made before 0051, described as a person describes one.
    earlier = await service.withTenant(upgraded, async (trx) => {
      const made = await trx
        .insertInto('asset_upload')
        .values({
          space_id: await generalOf(trx),
          uploader: await person(trx),
          alternative: JSON.stringify({ text: 'A pump', language: 'en' }),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return made.id;
    });
  });

  afterAll(async () => {
    await service?.close();
    await rm(before, { recursive: true, force: true });
    await db?.drop();
  });

  it('migrates every environment made before it, its uploads a person made, to what a fresh environment is', async () => {
    expect((await migrate(db.migratorUrl)).tenants[upgraded.id]).toEqual([
      '0051_dataset_pending',
      '0052_bound_images',
      '0053_dataset_image_index',
      '0054_connection_test_privilege',
    ]);
    const kept = await queryAs(
      db.adminUrl,
      `select origin, alternative from ${upgraded.schema}.asset_upload where id = $1`,
      [earlier],
    );
    expect(kept.rows).toEqual([
      { origin: 'upload', alternative: { text: 'A pump', language: 'en' } },
    ]);

    fresh = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    const upgradedConstraints = await constraints(upgraded.schema);
    expect(upgradedConstraints).toEqual(await constraints(fresh.schema));
    // 0020's checks on an upload's states are unchanged.
    for (const name of [
      'asset_upload_awaiting',
      'asset_upload_has_bytes',
      'asset_upload_ready_names_its_version',
    ]) {
      expect(upgradedConstraints[name], name).toBeDefined();
    }

    const upgradedPrivileges = await privileges(upgraded.schema);
    expect(upgradedPrivileges).toEqual(await privileges(fresh.schema));
    expect(upgradedPrivileges.tables).toEqual([
      { table_name: 'asset_upload', privilege_type: 'SELECT' },
      { table_name: 'dataset_pending', privilege_type: 'DELETE' },
      { table_name: 'dataset_pending', privilege_type: 'SELECT' },
    ]);
    const granted = (table: string, privilege: string) =>
      upgradedPrivileges.columns
        .filter((row) => row.table_name === table && row.privilege_type === privilege)
        .map((row) => row.column_name as string);
    expect(granted('asset_upload', 'INSERT')).toEqual([
      'alternative',
      'origin',
      'space_id',
      'uploader',
    ]);
    expect(granted('asset_upload', 'UPDATE')).not.toContain('origin');
    expect(granted('dataset_pending', 'INSERT')).toEqual([
      'act',
      'binding_digest',
      'binding_id',
      'checksum',
      'definition_id',
      'definition_kind',
      'definition_version',
      'document_id',
      'document_kind',
      'holding',
      'node_id',
      'provenance',
      'requested_by',
      'session',
      'uploads',
    ]);
    expect(granted('dataset_pending', 'UPDATE')).toEqual(['failure', 'state']);
  });

  describe('every write path over a fresh environment', () => {
    let ada: string;
    let general: string;
    let quality: string;
    let document: string;
    let provenance: Provenance;
    let upload: string;
    let elsewhere: string;
    /** A resolution of another binding at the same node. */
    let another: string;

    const tenant = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
      service.withTenant(fresh, work);
    const key = (letter: string) => `${fresh.schema}/sha256/${letter.repeat(64)}`;
    const pending = (over: Partial<Parameters<typeof pendingResult>[1]> = {}) =>
      tenant((trx) =>
        pendingResult(trx, {
          act: 'resolve',
          document,
          node: NODE,
          binding: 'b1',
          digest: 'c'.repeat(64),
          holding: null,
          session: null,
          provenance,
          uploads: [upload],
          by: ada,
          ...over,
        }),
      );

    beforeAll(async () => {
      fresh ??= await createTenant(db.adminUrl, db.migratorUrl, {
        organisation: { id: 'acme', name: 'Acme' },
        tenant: { id: db.newTenantId(), name: 'Development' },
        hostnames: ['dev.acme.alloy.test'],
      });
      await tenant(async (trx) => {
        ada = await person(trx);
        general = await generalOf(trx);
        quality = (await createSpace(trx, 'Quality')).id;
        const made = await everyKind(trx, {
          author: ada,
          spaceId: general,
          word: 'pending',
          role: fresh.schema,
        });
        document = made.document;
        another = (
          await recordResolution(trx, {
            document,
            node: NODE,
            binding: 'b2',
            digest: 'c'.repeat(64),
            version: (await latestVersion(trx, made.dataset!))!.id,
            replaces: null,
            act: 'resolve',
            by: ada,
          })
        ).id;
        const definition = (await latestVersion(trx, made.queryDefinition!))!;
        const connection = (definition.content as { connection: string }).connection;
        provenance = {
          schemaVersion: 1,
          queryDefinition: { artifact: made.queryDefinition!, version: definition.id },
          connection: { artifact: connection, version: (await latestVersion(trx, connection))!.id },
          parameters: {},
          ran: { sql: 'select id from sample.site order by id' },
          identity: { kind: 'service' },
          at: '2026-10-05T09:00:00.000Z',
          durationMs: 1,
          rowCount: 0,
          columns: [{ name: 'id', from: { column: 'id' }, type: { base: 'integer' } }],
          canonical: 1,
          checksum: 'e'.repeat(64),
          images: {},
        };
        upload = (
          await uploadForDatasetImage(trx, {
            spaceId: general,
            uploader: ada,
            key: key('1'),
            format: 'png',
            bytes: 10,
          })
        ).upload.id;
        elsewhere = (
          await uploadForDatasetImage(trx, {
            spaceId: quality,
            uploader: ada,
            key: key('2'),
            format: 'png',
            bytes: 10,
          })
        ).upload.id;
      });
    });

    it('makes a dataset upload undescribed, and never changes where an upload came from', async () => {
      await expect(
        tenant((trx) =>
          trx
            .insertInto('asset_upload')
            .values({
              space_id: general,
              uploader: ada,
              alternative: JSON.stringify({ text: 'A pump', language: 'en' }),
              origin: 'dataset',
            })
            .execute(),
        ),
      ).rejects.toThrow(/asset_upload_dataset_undescribed/);
      const described = await tenant((trx) =>
        createAssetUpload(trx, {
          spaceId: general,
          uploader: ada,
          alternative: { text: 'A pump', language: 'en' },
        }),
      );
      expect(described.origin).toBe('upload');
      await expect(
        tenant((trx) =>
          sql`update asset_upload set origin = 'dataset' where id = ${described.id}`.execute(trx),
        ),
      ).rejects.toThrow(/permission denied/);
      // The migration's own role, which the grant does not hold back, is held by the trigger.
      await expect(
        queryAs(
          db.adminUrl,
          `update ${fresh.schema}.asset_upload set origin = 'dataset', alternative = null, state = 'refused', reason = 'malformed', finished_at = now() where id = $1`,
          [described.id],
        ),
      ).rejects.toThrow(/moves forwards/);
    });

    it("keeps a pending result naming uploads in its definition's space, each once, and the act's session only for a resolve from one", async () => {
      const made = await pending();
      expect(made).toMatchObject({ state: 'pending', uploads: [upload], session: null });
      for (const [over, refusal] of [
        [{ uploads: [elsewhere] }, /dataset_pending: each upload/],
        [{ uploads: [upload, upload] }, /dataset_pending: each upload/],
        [{ uploads: [] }, /dataset_pending_uploads/],
        [{ act: 'session' as const }, /dataset_pending_session/],
        [{ session: '00000000-0000-4000-8000-000000000001' }, /dataset_pending_session/],
        [{ node: 'n1' }, /dataset_pending_node/],
        [{ holding: another }, /what the binding held/],
        [{ holding: '999999' }, /dataset_pending/],
      ] as const) {
        await expect(pending(over), JSON.stringify(over)).rejects.toThrow(refusal);
      }
      // A checksum or a definition version other than the provenance's.
      for (const column of ['checksum', 'definition_version'] as const) {
        await expect(
          tenant((trx) =>
            trx
              .insertInto('dataset_pending')
              .values({
                act: 'resolve',
                document_id: document,
                node_id: NODE,
                binding_id: 'b1',
                binding_digest: 'c'.repeat(64),
                session: null,
                definition_id: provenance.queryDefinition.artifact,
                definition_version:
                  column === 'definition_version'
                    ? provenance.connection.version
                    : provenance.queryDefinition.version,
                checksum: column === 'checksum' ? 'f'.repeat(64) : provenance.checksum,
                provenance: JSON.stringify(provenance),
                uploads: [upload],
                requested_by: ada,
              })
              .execute(),
          ),
          column,
        ).rejects.toThrow(/dataset_pending/);
      }
    });

    it('moves a pending result once, to refused, saying why, keeps a refused one, and deletes a pending one', async () => {
      const refused = await pending();
      const refuse = (id: string, set: string) =>
        tenant((trx) =>
          sql`update dataset_pending set ${sql.raw(set)} where id = ${id}`.execute(trx),
        );
      await expect(refuse(refused.id, `state = 'refused'`)).rejects.toThrow(
        /dataset_pending_refused_says_why/,
      );
      await refuse(refused.id, `state = 'refused', failure = '{"code":"image_refused"}'`);
      await expect(refuse(refused.id, `failure = '{"code":"other"}'`)).rejects.toThrow(
        /moves once/,
      );
      await expect(
        tenant((trx) => trx.deleteFrom('dataset_pending').where('id', '=', refused.id).execute()),
      ).rejects.toThrow(/record of its refusal/);
      await expect(
        tenant((trx) =>
          sql`update dataset_pending set node_id = ${'m'.repeat(26)} where id = ${refused.id}`.execute(
            trx,
          ),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        queryAs(
          db.adminUrl,
          `update ${fresh.schema}.dataset_pending set node_id = $2 where id = $1`,
          [(await pending()).id, 'm'.repeat(26)],
        ),
      ).rejects.toThrow(/moves once/);
      const waiting = await pending();
      await tenant((trx) =>
        trx.deleteFrom('dataset_pending').where('id', '=', waiting.id).execute(),
      );
      expect(
        (
          await queryAs(
            db.adminUrl,
            `select count(*)::int as n from ${fresh.schema}.dataset_pending where id = $1`,
            [waiting.id],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
    });
  });
});
