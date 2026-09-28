// packages/db/src/retention.test.ts
import { randomUUID } from 'node:crypto';
import {
  DEFINITION_SCHEMA_VERSION,
  definitionsFor,
  type ComponentTypeDefinition,
  type ContentDocument,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapCluster } from './bootstrap.js';
import { claimLock, ITERATION_RETENTION_DAYS, saveIteration } from './editing.js';
import { migrate } from './migrate.js';
import { cutVersion } from './promotion.js';
import { createTenant, type Tenant } from './provision.js';
import {
  editingPolicy,
  iterationRetained,
  setEditingPolicy,
  sweepIterations,
} from './retention.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, queryAs, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';
import { createArtifact } from './versions.js';

const content = (text: string): ContentDocument => ({
  schemaVersion: 1,
  title: 'Install the printer',
  language: 'en-GB',
  direction: 'ltr',
  content: [
    {
      type: 'paragraph',
      id: 'b1',
      style: 'body',
      content: text === '' ? [] : [{ type: 'text', value: text, marks: [] }],
    },
  ],
});

describe("keeping an iteration until the next cut, and for the tenant's window after it", () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  /** Ada, named the same in both tenants: a principal is one tenant's. */
  const principals = new Map<string, string>();
  const definitions = new Map<string, ReturnType<typeof definitionsFor>>();

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
    // Where the window is changed, so the iterations the tests above leave are not swept by it.
    development = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation,
      tenant: { id: db.newTenantId(), name: 'Development' },
      hostnames: ['dev.acme.alloy.test'],
    });
    service = createTenantDatabase(db.serviceUrl);
    for (const tenant of [production, development]) {
      await service.withTenant(tenant, async (trx) => {
        principals.set(
          tenant.id,
          (
            await trx
              .insertInto('principal')
              .values({
                issuer: 'https://idp.example',
                subject: 'ada',
                email: null,
                display_name: 'Ada',
              })
              .returning('id')
              .executeTakeFirstOrThrow()
          ).id,
        );
        const ada = principals.get(tenant.id)!;
        const type: ComponentTypeDefinition = {
          schemaVersion: DEFINITION_SCHEMA_VERSION,
          id: randomUUID(),
          name: 'Procedure',
          assignments: [],
        };
        const stored = await createArtifact(trx, {
          author: ada,
          substance: { kind: 'componentType', content: type },
        });
        definitions.set(
          tenant.id,
          definitionsFor({ version: stored.id, definition: type }, [], []),
        );
      });
    }
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  /**
   * A new component Ada holds from one session, at its first version. `save` writes an iteration
   * against the version the session is at, and `cut` makes the next version from the latest one.
   */
  const component = async (tenant = production) => {
    const ada = principals.get(tenant.id)!;
    const general = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('space').select('id').where('name', '=', 'General').executeTakeFirstOrThrow(),
    );
    const made = await service.withTenant(tenant, (trx) =>
      createArtifact(trx, {
        author: ada,
        spaceId: general.id,
        substance: {
          kind: 'component',
          content: content(''),
          values: {},
          notCarried: [],
          definitions: definitions.get(tenant.id)!,
        },
      }),
    );
    const session = randomUUID();
    await service.withTenant(tenant, (trx) =>
      claimLock(trx, { artifactId: made.artifactId, principal: ada, session }),
    );
    let at = made.id;
    let sequence = 0;
    const save = async (text: string): Promise<string> => {
      sequence += 1;
      const answer = await service.withTenant(tenant, (trx) =>
        saveIteration(trx, {
          artifactId: made.artifactId,
          principal: ada,
          session,
          sequence,
          openedFrom: at,
          content: content(text),
        }),
      );
      if (answer.answer !== 'accepted') throw new Error(answer.answer);
      const row = await service.withTenant(tenant, (trx) =>
        trx
          .selectFrom('iteration')
          .select('id')
          .where('artifact_id', '=', made.artifactId)
          .where('sequence', '=', sequence)
          .executeTakeFirstOrThrow(),
      );
      return row.id;
    };
    const cut = async (): Promise<string> => {
      const answer = await service.withTenant(tenant, (trx) =>
        cutVersion(trx, { artifactId: made.artifactId, principal: ada, session, openedFrom: at }),
      );
      if (answer.answer !== 'recorded') throw new Error(answer.answer);
      at = answer.version.id;
      return at;
    };
    return { id: made.artifactId, first: made.id, save, cut };
  };

  /** Moves a version's cut back by some days, as the administrator: nothing else may. */
  const cutAgo = (version: string, days: number, tenant = production) =>
    queryAs(
      db.adminUrl,
      `update "${tenant.schema}".artifact_version
          set created_at = now() - make_interval(days => $2) where id = $1`,
      [version, days],
    );

  /** Moves an iteration's writing back by some days, as the administrator. */
  const writtenAgo = (iteration: string, days: number, tenant = production) =>
    queryAs(
      db.adminUrl,
      `update "${tenant.schema}".iteration
          set created_at = now() - make_interval(days => $2) where id = $1`,
      [iteration, days],
    );

  const kept = async (iteration: string, tenant = production) => {
    const row = await service.withTenant(tenant, (trx) =>
      trx.selectFrom('iteration').select('id').where('id', '=', iteration).executeTakeFirst(),
    );
    return row !== undefined;
  };

  const sweep = (tenant = production) => service.withTenant(tenant, (trx) => sweepIterations(trx));

  describe('the sweep, anchored at the next cut', () => {
    it('VER-003 keeps an iteration however old while no later version of its component exists', async () => {
      const made = await component();
      const iteration = await made.save('Unbox the printer.');
      await writtenAgo(iteration, 400);
      await cutAgo(made.first, 400);

      expect(await sweep()).toBe(0);
      expect(await kept(iteration)).toBe(true);
    });

    it('VER-003 keeps an iteration written long before the next cut for the whole window after that cut', async () => {
      const made = await component();
      const iteration = await made.save('Unbox the printer.');
      await writtenAgo(iteration, 400);
      await cutAgo(made.first, 400);
      await cutAgo(await made.cut(), ITERATION_RETENTION_DAYS - 1);

      expect(await sweep()).toBe(0);
      expect(await kept(iteration)).toBe(true);
    });

    it("VER-003 sweeps an iteration once the next cut is past the window, and leaves a later version's iterations alone", async () => {
      const made = await component();
      const before = [await made.save('Unbox the printer.'), await made.save('Plug it in.')];
      const next = await made.cut();
      const after = await made.save('Plug it in and switch it on.');
      for (const iteration of [...before, after]) await writtenAgo(iteration, 400);
      await cutAgo(made.first, 400);
      await cutAgo(next, ITERATION_RETENTION_DAYS + 1);

      expect(await sweep()).toBe(2);
      expect(await kept(before[0]!)).toBe(false);
      expect(await kept(before[1]!)).toBe(false);
      // Opened from the version just cut, which nothing has followed yet.
      expect(await kept(after)).toBe(true);
      expect(await sweep()).toBe(0);
    });

    it('states as a condition which iterations the sweep keeps, for a listing to show only those', async () => {
      const made = await component();
      const before = await made.save('Unbox the printer.');
      const next = await made.cut();
      const after = await made.save('Plug it in.');
      const retained = () =>
        service.withTenant(production, (trx) =>
          trx
            .selectFrom('iteration as i')
            .select('i.id')
            .where('i.artifact_id', '=', made.id)
            .where(iterationRetained('i'))
            .orderBy('i.sequence')
            .execute(),
        );

      expect(await retained()).toEqual([{ id: before }, { id: after }]);
      await cutAgo(next, ITERATION_RETENTION_DAYS);
      expect(await retained()).toEqual([{ id: after }]);
      expect(await sweep()).toBe(1);
      expect(await kept(before)).toBe(false);
    });

    it('VER-003 refuses the runtime role deleting an iteration before its window has passed, and lets it once it has', async () => {
      const uncut = await component();
      const alone = await uncut.save('Unbox the printer.');
      await writtenAgo(alone, 400);
      const made = await component();
      const iteration = await made.save('Unbox the printer.');
      await writtenAgo(iteration, 400);
      const next = await made.cut();
      await cutAgo(next, ITERATION_RETENTION_DAYS - 1);

      for (const id of [alone, iteration]) {
        await expect(
          service.withTenant(production, (trx) =>
            sql`delete from iteration where id = ${id}`.execute(trx),
          ),
        ).rejects.toThrow(/kept until the next version is cut, and for the window after it/);
      }

      await cutAgo(next, ITERATION_RETENTION_DAYS);
      await service.withTenant(production, (trx) =>
        sql`delete from iteration where id = ${iteration}`.execute(trx),
      );
      expect(await kept(iteration)).toBe(false);
      expect(await kept(alone)).toBe(true);
    });
  });

  describe('the window, a tenant setting', () => {
    it('VER-004 states the window as a tenant setting, 30 days unless changed, the default the table itself declares', async () => {
      expect(await service.withTenant(production, (trx) => editingPolicy(trx))).toEqual({
        iterationRetentionDays: 30,
      });
      expect(ITERATION_RETENTION_DAYS).toBe(30);
      const { rows } = await queryAs(
        db.adminUrl,
        `select column_default from information_schema.columns
          where table_schema = $1 and table_name = 'editing_policy'
            and column_name = 'iteration_retention_days'`,
        [production.schema],
      );
      expect(rows).toEqual([{ column_default: String(ITERATION_RETENTION_DAYS) }]);
    });

    it('VER-004 sweeps by the window as it stands when the sweep runs: shortened, it removes what it kept before', async () => {
      // In the development tenant, whose window nothing else changes or sweeps under.
      const tenant = development;
      const earlier = await component(tenant);
      const older = await earlier.save('Unbox the printer.');
      await cutAgo(await earlier.cut(), 20, tenant);
      const later = await component(tenant);
      const newer = await later.save('Unbox the printer.');
      await cutAgo(await later.cut(), 10, tenant);
      const set = (days: number) =>
        service.withTenant(tenant, (trx) =>
          setEditingPolicy(trx, { iterationRetentionDays: days }),
        );

      expect(await sweep(tenant)).toBe(0);

      expect(await set(15)).toEqual({ policy: { iterationRetentionDays: 15 } });
      expect(await service.withTenant(tenant, (trx) => editingPolicy(trx))).toEqual({
        iterationRetentionDays: 15,
      });
      expect(await sweep(tenant)).toBe(1);
      expect(await kept(older, tenant)).toBe(false);
      expect(await kept(newer, tenant)).toBe(true);

      // Lengthened again, it keeps what has not gone, and nothing swept comes back.
      await set(365);
      expect(await sweep(tenant)).toBe(0);
      expect(await kept(newer, tenant)).toBe(true);
      expect(await kept(older, tenant)).toBe(false);

      await set(5);
      expect(await sweep(tenant)).toBe(1);
      expect(await kept(newer, tenant)).toBe(false);
      // The production tenant's window is its own.
      expect(await service.withTenant(production, (trx) => editingPolicy(trx))).toEqual({
        iterationRetentionDays: ITERATION_RETENTION_DAYS,
      });
    });

    it("VER-004 refuses a window outside 1 to 365 days, in the store and by the table's own check, and keeps its one row", async () => {
      for (const days of [0, 366, -1, 1.5]) {
        expect(
          await service.withTenant(production, (trx) =>
            setEditingPolicy(trx, { iterationRetentionDays: days }),
          ),
          String(days),
        ).toEqual({ refused: 'retention.out_of_range' });
      }
      for (const days of [0, 366]) {
        await expect(
          service.withTenant(production, (trx) =>
            sql`update editing_policy set iteration_retention_days = ${days}`.execute(trx),
          ),
        ).rejects.toThrow(/editing_policy_iteration_retention_days_check/);
      }
      for (const statement of [
        sql`insert into editing_policy default values`,
        sql`delete from editing_policy`,
        sql`update editing_policy set singleton = true`,
      ]) {
        await expect(
          service.withTenant(production, (trx) => statement.execute(trx)),
        ).rejects.toThrow(/permission denied/);
      }
      expect(await service.withTenant(production, (trx) => editingPolicy(trx))).toEqual({
        iterationRetentionDays: ITERATION_RETENTION_DAYS,
      });
    });
  });
});
