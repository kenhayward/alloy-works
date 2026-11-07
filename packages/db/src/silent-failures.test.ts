import type { AuditContext } from '@alloy-works/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordBackgroundWork } from './background-work.js';
import { bootstrapCluster } from './bootstrap.js';
import { embeddingWaitSeconds } from './embeddings.js';
import { grant } from './grants.js';
import { listInbox } from './inbox.js';
import { setMailChannel } from './mail.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import { createRole, findRole } from './roles.js';
import { silentFailuresOf, tellSilentFailures } from './silent-failures.js';
import { createSpace } from './spaces.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  TEST_PASSWORDS,
  type TestDatabase,
  testTenantDatabase,
} from './testing/database.js';

const SYSTEM: AuditContext = { actorKind: 'system' };

describe('silent failures told (diagnostics.md, "Who else is told"; the DG plan, DGe4)', () => {
  let db: TestDatabase;
  let tenant: Tenant;
  let service: TenantDatabase;
  let ada = '';
  let grace = '';

  const as = <T>(work: (trx: TenantTransaction) => Promise<T>) =>
    service.withTenant(tenant, work, SYSTEM);

  const person = (name: string) =>
    as(async (trx) => {
      const { id } = await trx
        .insertInto('principal')
        .values({
          issuer: 'https://idp.example',
          subject: name,
          email: `${name}@example.test`,
          email_verified: true,
          display_name: name,
          kind: 'user',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return id;
    });

  const told = (who: string) =>
    as(async (trx) =>
      (await listInbox(trx, who, { limit: 100 })).notifications
        .filter((each) => each.kind === 'diagnostics')
        .map((each) => each.diagnostics),
    );

  const work = (outcome: 'succeeded' | 'failed') =>
    as((trx) =>
      recordBackgroundWork(trx, {
        work: 'sweepDates',
        startedAt: new Date(),
        finishedAt: new Date(),
        outcome,
        ...(outcome === 'failed' ? { failure: 'database_unavailable' } : {}),
      }),
    );

  const sweep = () => as(async (trx) => tellSilentFailures(trx, await silentFailuresOf(trx)));

  beforeAll(async () => {
    db = await freshDatabase();
    await bootstrapCluster(db.adminUrl, TEST_PASSWORDS);
    await migrate(db.migratorUrl);
    tenant = await createTenant(db.adminUrl, db.migratorUrl, {
      organisation: { id: 'acme', name: 'Acme' },
      tenant: { id: db.newTenantId(), name: 'Production' },
      hostnames: ['acme.alloy.test'],
    });
    service = testTenantDatabase(db.serviceUrl);
    ada = await person('ada');
    grace = await person('grace');
    await as(async (trx) => {
      const clinical = (await createSpace(trx, 'Clinical')).id;
      await grant(trx, {
        roleId: (await findRole(trx, 'Author'))!.id,
        subject: { principal: grace },
        level: { kind: 'space', id: clinical },
        effect: 'allow',
        grantedBy: ada,
      });
    });
  });

  beforeEach(async () => {
    await as(async (trx) => {
      await sql`delete from notification`.execute(trx);
      await sql`delete from silent_failure_told`.execute(trx);
      await sql`delete from background_work`.execute(trx);
      await sql`delete from access_grant where level = 'tenant'`.execute(trx);
    });
  });

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const administers = (who: string) =>
    as(async (trx) =>
      grant(trx, {
        roleId: (await findRole(trx, 'Administrator'))!.id,
        subject: { principal: who },
        level: { kind: 'tenant' },
        effect: 'allow',
        grantedBy: ada,
      }),
    );

  it('ADM-037 tells those who administer of a silent failure once until it clears, and again when it returns, never by mail', async () => {
    await administers(ada);
    await as((trx) =>
      setMailChannel(trx, {
        enabled: true,
        relay: 'platform',
        host: null,
        port: null,
        username: null,
        fromAddress: null,
        fromName: null,
        kindsOff: [],
        by: ada,
      }),
    );
    await work('failed');
    expect(await sweep()).toBe(1);
    expect(await sweep()).toBe(0);
    expect(await told(ada)).toEqual([{ kind: 'work_failing', subject: 'sweepDates' }]);
    expect(await told(grace)).toEqual([]);
    expect((await as((trx) => sql`select 1 from email_delivery`.execute(trx))).rows).toEqual([]);
    // It clears, and is forgotten; its return tells again.
    await work('succeeded');
    expect(await sweep()).toBe(0);
    expect(
      (await as((trx) => sql`select failure from silent_failure_told`.execute(trx))).rows,
    ).toEqual([]);
    await work('failed');
    expect(await sweep()).toBe(1);
    expect(await told(ada)).toHaveLength(2);
  });

  it('tells whoever reads Diagnostics, and not who administers without reading it (the SA plan, SAa)', async () => {
    const holding = (name: string, held: readonly string[], who: string) =>
      as(async (trx) => {
        const made = await createRole(trx, name, held);
        if (!('role' in made)) throw new Error(`role refused: ${made.refused}`);
        await grant(trx, {
          roleId: made.role.id,
          subject: { principal: who },
          level: { kind: 'tenant' },
          effect: 'allow',
          grantedBy: ada,
        });
      });
    await holding('Diagnostics reader', ['read', 'read_diagnostics'], grace);
    await holding('Administers blind', ['read', 'administer'], ada);
    await work('failed');
    expect(await sweep()).toBe(1);
    expect(await told(grace)).toEqual([{ kind: 'work_failing', subject: 'sweepDates' }]);
    expect(await told(ada)).toEqual([]);
  });

  it('keeps the telling for later where nobody administers', async () => {
    await work('failed');
    expect(await sweep()).toBe(0);
    await administers(ada);
    expect(await sweep()).toBe(1);
  });

  it('reads the index lagging from the oldest version waiting to be embedded', async () => {
    await as(async (trx) => {
      await sql`delete from embedding_queued`.execute(trx);
      expect(await embeddingWaitSeconds(trx)).toBeNull();
      await sql`insert into embedding_queued (artifact_id, queued_at)
        values (gen_random_uuid(), now() - interval '6 minutes')`.execute(trx);
      expect(await embeddingWaitSeconds(trx)).toBeGreaterThan(300);
      expect(await silentFailuresOf(trx)).toContainEqual({ kind: 'index_lagging', subject: '' });
      await sql`delete from embedding_queued`.execute(trx);
    });
  });
});
