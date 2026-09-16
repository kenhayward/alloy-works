import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessFactSources, type AccessFactSource } from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

/** Thrown to roll a transaction back once what it held has been looked at. */
class RolledBack extends Error {}

describe('the access epoch', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let author: string;
  let spaceId: string;
  let artifactId: string;
  let groupId: string;

  /** Whether another transaction could take the epoch FOR SHARE right now, without waiting. */
  const shareable = () =>
    service
      .withTenant(production, (trx) =>
        sql`select changed_at from access_epoch for share nowait`.execute(trx),
      )
      .then(
        () => true,
        (error: Error) => {
          if (/could not obtain lock/.test(error.message)) return false;
          throw error;
        },
      );

  /** Runs a write as the runtime role, and answers whether the epoch was still shareable meanwhile. */
  const whileHeld = async (write: (trx: TenantTransaction) => Promise<unknown>) => {
    let answer: boolean | undefined;
    await service
      .withTenant(production, async (trx) => {
        await write(trx);
        answer = await shareable();
        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RolledBack)) throw error;
      });
    return answer;
  };

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    production = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    ({ ada, author, spaceId, artifactId, groupId } = await service.withTenant(
      production,
      async (trx) => {
        const principal = await trx
          .insertInto('principal')
          .values({
            issuer: 'https://idp.example',
            subject: 'ada',
            email: null,
            display_name: 'Ada',
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        const role = await trx
          .selectFrom('role')
          .select('id')
          .where('name', '=', 'Author')
          .executeTakeFirstOrThrow();
        const space = await createSpace(trx, 'Clinical');
        const artifact = await trx
          .insertInto('artifact')
          .values({ kind: 'component', space_id: space.id })
          .returning('id')
          .executeTakeFirstOrThrow();
        const group = await trx
          .insertInto('access_group')
          .values({ name: 'Editors', source: 'tenant', provider_value: null })
          .returning('id')
          .executeTakeFirstOrThrow();
        return {
          ada: principal.id,
          author: role.id,
          spaceId: space.id,
          artifactId: artifact.id,
          groupId: group.id,
        };
      },
    ));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('is one row the runtime role can neither remove nor add to', async () => {
    await expect(shareable()).resolves.toBe(true);
    await expect(
      service.withTenant(production, (trx) => sql`delete from access_epoch`.execute(trx)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      service.withTenant(production, (trx) =>
        sql`insert into access_epoch (singleton) values (true)`.execute(trx),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('is locked by a write to every fact a decision reads', async () => {
    const grant = (trx: TenantTransaction) =>
      trx
        .insertInto('access_grant')
        .values({
          role_id: author,
          principal_id: ada,
          level: 'space',
          space_id: spaceId,
          effect: 'allow',
          granted_by: ada,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

    const writes: Record<AccessFactSource, () => Promise<boolean | undefined>> = {
      access_grant: async () => {
        const made = await whileHeld(grant);
        const kept = await service.withTenant(production, grant);
        const removed = await whileHeld((trx) =>
          trx.deleteFrom('access_grant').where('id', '=', kept.id).execute(),
        );
        await service.withTenant(production, (trx) =>
          trx.deleteFrom('access_grant').where('id', '=', kept.id).execute(),
        );
        return made === false && removed === false ? false : true;
      },
      'artifact.space_id': async () => {
        // The runtime role holds no UPDATE on artifact, so this is the owner's write, as a later
        // migration moving content would be.
        const client = new pg.Client({ connectionString: db.adminUrl });
        await client.connect();
        try {
          await client.query('begin');
          await client.query(
            `update ${client.escapeIdentifier(production.schema)}.artifact set space_id = space_id where id = $1`,
            [artifactId],
          );
          return await shareable();
        } finally {
          await client.query('rollback');
          await client.end();
        }
      },
      group_member: () =>
        whileHeld((trx) =>
          trx.insertInto('group_member').values({ group_id: groupId, principal_id: ada }).execute(),
        ),
      'principal.kind': () =>
        whileHeld((trx) =>
          trx.updateTable('principal').set({ kind: 'external' }).where('id', '=', ada).execute(),
        ),
      'role.permissions': () =>
        whileHeld((trx) =>
          trx
            .updateTable('role')
            .set({ permissions: ['read'] })
            .where('id', '=', author)
            .execute(),
        ),
    };

    for (const fact of accessFactSources) {
      expect(writes[fact], `no write is known to lock ${fact}`).toBeDefined();
      await expect(writes[fact](), fact).resolves.toBe(false);
    }
    expect(Object.keys(writes).sort()).toEqual([...accessFactSources].sort());
  });

  it('is not locked by a write no decision reads', async () => {
    const quiet: Record<string, (trx: TenantTransaction) => Promise<unknown>> = {
      'a new role': (trx) =>
        trx
          .insertInto('role')
          .values({ name: 'Unused', permissions: ['read'] })
          .execute(),
      'renaming a role': (trx) =>
        trx.updateTable('role').set({ name: 'Writer' }).where('id', '=', author).execute(),
      'a new group': (trx) =>
        trx
          .insertInto('access_group')
          .values({ name: 'Nobody', source: 'tenant', provider_value: null })
          .execute(),
      'removing an empty group': (trx) =>
        trx.deleteFrom('access_group').where('id', '=', groupId).execute(),
      'a new space': (trx) => createSpace(trx, 'Quality'),
      'a new artifact': (trx) =>
        trx.insertInto('artifact').values({ kind: 'component', space_id: spaceId }).execute(),
      "a sign-in refreshing a principal's name": (trx) =>
        trx.updateTable('principal').set({ display_name: 'Ada L' }).where('id', '=', ada).execute(),
    };
    for (const [name, write] of Object.entries(quiet)) {
      await expect(whileHeld(write), name).resolves.toBe(true);
    }
    await service.withTenant(production, (trx) =>
      trx
        .insertInto('role')
        .values({ name: 'Unused', permissions: ['read'] })
        .execute(),
    );
    await expect(
      whileHeld((trx) => trx.deleteFrom('role').where('name', '=', 'Unused').execute()),
      'removing an unused role',
    ).resolves.toBe(true);
  });
});
