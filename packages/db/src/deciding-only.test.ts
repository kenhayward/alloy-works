import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accessFactSources,
  decideOnly,
  lockAccessForChange,
  type AccessFactSource,
} from './access-facts.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const REFUSED = /declared that it only decides/;

/** Thrown to roll a transaction back once a write has been seen to land. */
class RolledBack extends Error {}

describe('a transaction that declared it only decides', () => {
  let db: TestDatabase;
  let production: Tenant;
  let service: TenantDatabase;
  let ada: string;
  let author: string;
  let spaceId: string;
  let artifactId: string;
  let groupId: string;
  let grantId: string;

  /** Runs `write` after `decideOnly`, then rolls back whatever landed. */
  const deciding = (write: (trx: TenantTransaction) => Promise<unknown>) =>
    service
      .withTenant(production, async (trx) => {
        await decideOnly(trx);
        await write(trx);
        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (error instanceof RolledBack) return 'written';
        throw error;
      });

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
    ({ ada, author, spaceId, artifactId, groupId, grantId } = await service.withTenant(
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
        const made = await trx
          .insertInto('access_grant')
          .values({
            role_id: role.id,
            principal_id: principal.id,
            level: 'space',
            space_id: space.id,
            effect: 'allow',
            granted_by: principal.id,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        return {
          ada: principal.id,
          author: role.id,
          spaceId: space.id,
          artifactId: artifact.id,
          groupId: group.id,
          grantId: made.id,
        };
      },
    ));
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  it('may not write any fact a decision reads', async () => {
    const writes: Record<AccessFactSource, () => Promise<unknown>> = {
      access_grant: async () => {
        await expect(
          deciding((trx) =>
            trx
              .insertInto('access_grant')
              .values({
                role_id: author,
                group_id: groupId,
                level: 'space',
                space_id: spaceId,
                effect: 'allow',
                granted_by: ada,
              })
              .execute(),
          ),
        ).rejects.toThrow(REFUSED);
        return deciding((trx) =>
          trx.deleteFrom('access_grant').where('id', '=', grantId).execute(),
        );
      },
      'artifact.space_id': async () => {
        // The owner's write, as the runtime role holds no UPDATE on artifact: the trigger refuses it
        // whoever makes it.
        const client = new pg.Client({ connectionString: db.adminUrl });
        await client.connect();
        try {
          await client.query('begin');
          await client.query(`select set_config('alloy.deciding_only', 'on', true)`);
          await client.query(
            `update ${client.escapeIdentifier(production.schema)}.artifact set space_id = space_id where id = $1`,
            [artifactId],
          );
          return 'written';
        } finally {
          await client.query('rollback');
          await client.end();
        }
      },
      group_member: () =>
        deciding((trx) =>
          trx.insertInto('group_member').values({ group_id: groupId, principal_id: ada }).execute(),
        ),
      'principal.kind': () =>
        deciding((trx) =>
          trx.updateTable('principal').set({ kind: 'external' }).where('id', '=', ada).execute(),
        ),
      'role.permissions': () =>
        deciding((trx) =>
          trx
            .updateTable('role')
            .set({ permissions: ['read'] })
            .where('id', '=', author)
            .execute(),
        ),
    };
    for (const fact of accessFactSources) {
      expect(writes[fact], `no write is known for ${fact}`).toBeDefined();
      await expect(writes[fact](), fact).rejects.toThrow(REFUSED);
    }
  });

  it('may not take the epoch for a change, even one that then writes nothing', async () => {
    await expect(deciding((trx) => lockAccessForChange(trx))).rejects.toThrow(REFUSED);
  });

  it('may still write what no decision reads, and binds only its own transaction', async () => {
    await expect(
      deciding((trx) =>
        trx.updateTable('principal').set({ display_name: 'Ada L' }).where('id', '=', ada).execute(),
      ),
    ).resolves.toBe('written');
    await expect(
      service.withTenant(production, (trx) =>
        trx.updateTable('principal').set({ kind: 'user' }).where('id', '=', ada).execute(),
      ),
    ).resolves.toBeDefined();
    await expect(
      service.withTenant(production, async (trx) => {
        await lockAccessForChange(trx);
        return 'locked';
      }),
    ).resolves.toBe('locked');
  });
});
