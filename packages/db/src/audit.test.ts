import { auditKinds } from '@alloy-works/domain';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditContextMissing, eraseLabels, recordEvent, recordEventSql } from './audit.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import {
  freshDatabase,
  queryAs,
  TEST_PASSWORDS,
  testTenantDatabase,
  type TestDatabase,
} from './testing/database.js';

const ADA = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const GRACE = '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d';
const SPACE = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a';
const ADA_ACTS = { actorKind: 'person', actor: ADA, actorLabel: 'Ada', traceId: 'req-1' } as const;

describe('the audit log as stored', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;
  let seeding: TenantDatabase;

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
    seeding = testTenantDatabase(db.serviceUrl);
  });

  afterAll(async () => {
    await service.close();
    await seeding.close();
    await db.drop();
  });

  const renamed = (trx: TenantTransaction) =>
    recordEvent(
      trx,
      { kind: 'space.renamed', subject: { kind: 'space', id: SPACE }, space: SPACE },
      [{ role: 'space', text: 'Clinical', refersTo: SPACE }],
    );

  async function eventsAfter(after: string) {
    return service.withTenant(production, (trx) =>
      trx
        .selectFrom('audit_event')
        .selectAll()
        .where('sequence', '>', after)
        .orderBy('sequence')
        .execute(),
    );
  }

  const newest = () =>
    service.withTenant(production, async (trx) => {
      const row = await trx
        .selectFrom('audit_event')
        .select(sql<string>`coalesce(max(sequence), 0)::text`.as('newest'))
        .executeTakeFirstOrThrow();
      return row.newest;
    });

  /** As the schema's owner, which the migrations run as and erase_labels runs as. */
  async function asOwner(tenant: Tenant, text: string, values: unknown[] = []) {
    const client = new pg.Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`set local role "${tenant.role}_owner"`);
      await client.query(`select set_config('search_path', $1, true)`, [tenant.schema]);
      const result = await client.query(text, values);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      await client.end();
    }
  }

  it('records an event and its labels from the context the transaction acts in', async () => {
    const before = await newest();
    const sequence = await service.withTenant(production, renamed, ADA_ACTS);
    const [event] = await eventsAfter(before);
    expect(event).toMatchObject({
      sequence,
      kind: 'space.renamed',
      actor_kind: 'person',
      actor: ADA,
      token: null,
      subject_kind: 'space',
      subject: SPACE,
      space: SPACE,
      outcome: 'done',
      detail: {},
      trace_id: 'req-1',
    });
    const labels = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('audit_label')
        .select(['role', 'text', 'refers_to', 'erased_at'])
        .where('sequence', '=', sequence)
        .orderBy('role')
        .execute(),
    );
    expect(labels).toEqual([
      { role: 'actor', text: 'Ada', refers_to: ADA, erased_at: null },
      { role: 'space', text: 'Clinical', refers_to: SPACE, erased_at: null },
    ]);
  });

  it('refuses an event in a transaction that names nobody, and writes nothing', async () => {
    const before = await newest();
    await expect(service.withTenant(production, renamed)).rejects.toBeInstanceOf(
      AuditContextMissing,
    );
    expect(await eventsAfter(before)).toEqual([]);
  });

  it("a test's database acts as the system unless told otherwise, and a job's requester joins the detail", async () => {
    const before = await newest();
    await seeding.withTenant(production, renamed);
    await seeding.withTenant(production, renamed, { actorKind: 'system', requestedBy: GRACE });
    const events = await eventsAfter(before);
    expect(events.map((event) => [event.actor_kind, event.actor, event.detail])).toEqual([
      ['system', null, {}],
      ['system', null, { requestedBy: GRACE }],
    ]);
  });

  it('records through a raw client in a transaction with its context set', async () => {
    const before = await newest();
    const client = new pg.Client({ connectionString: db.serviceUrl });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`set local role "${production.role}"`);
      await client.query(`select set_config('search_path', $1, true)`, [production.schema]);
      await client.query(`select set_config('alloy.audit', $1, true)`, [
        JSON.stringify({ actorKind: 'vendor' }),
      ]);
      await recordEventSql(client, { kind: 'tenant.invited' });
      await client.query('commit');
    } finally {
      await client.end();
    }
    const [event] = await eventsAfter(before);
    expect(event).toMatchObject({ kind: 'tenant.invited', actor_kind: 'vendor', actor: null });
  });

  it('holds its kinds to the closed list the domain declares', async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select pg_get_constraintdef(c.oid) as definition
       from pg_constraint c join pg_namespace n on n.oid = c.connamespace
       where c.conname = 'audit_event_kind' and n.nspname = $1`,
      [production.schema],
    );
    const listed = [...(rows[0]!.definition as string).matchAll(/'([^']+)'::text/g)].map(
      (match) => match[1],
    );
    expect(listed.sort()).toEqual([...auditKinds].sort());
  });

  it("pins erasure's search path to the tenant's schema, pg_temp last", async () => {
    const { rows } = await queryAs(
      db.adminUrl,
      `select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.proname = 'erase_labels' and n.nspname = $1`,
      [production.schema],
    );
    expect(rows[0]!.proconfig).toEqual([`search_path=${production.schema}, pg_temp`]);
  });

  it('LIF-030 refuses a detail holding a value where a name belongs', async () => {
    const before = await newest();
    await expect(
      seeding.withTenant(production, (trx) =>
        recordEvent(trx, {
          kind: 'connection.changed',
          subject: { kind: 'connection', id: SPACE },
          detail: { settings: ['host=db.example.com'] },
        }),
      ),
    ).rejects.toThrow(/connection\.changed/);
    await expect(
      seeding.withTenant(production, (trx) =>
        recordEvent(trx, {
          kind: 'connection.credential_set',
          detail: { password: 'swordfish' },
        }),
      ),
    ).rejects.toThrow(/connection\.credential_set/);
    expect(await eventsAfter(before)).toEqual([]);
  });

  it('LIF-025 refuses the tenant role any update, delete or truncate of an event or a label, and changes a label only by erasure', async () => {
    const sequence = await service.withTenant(
      production,
      (trx) =>
        recordEvent(
          trx,
          {
            kind: 'access.granted',
            subject: { kind: 'grant', id: SPACE },
            detail: {
              role: SPACE,
              level: 'tenant',
              effect: 'allow',
              grantee: GRACE,
              granteeKind: 'principal',
            },
          },
          [{ role: 'grantee', text: 'Grace', refersTo: GRACE }],
        ),
      ADA_ACTS,
    );
    const [original] = await eventsAfter(String(BigInt(sequence) - 1n));
    for (const statement of [
      sql`update audit_event set kind = 'access.revoked' where sequence = ${sequence}`,
      sql`delete from audit_event where sequence = ${sequence}`,
      sql`truncate audit_event cascade`,
      sql`update audit_label set text = 'Someone' where sequence = ${sequence}`,
      sql`delete from audit_label where sequence = ${sequence}`,
      sql`truncate audit_label`,
    ]) {
      await expect(service.withTenant(production, (trx) => statement.execute(trx))).rejects.toThrow(
        /permission denied/,
      );
    }
    // Not even the schema's owner updates an event, nor gives a label any text but erasure's.
    await expect(
      asOwner(production, `update audit_event set kind = 'access.revoked' where sequence = $1`, [
        sequence,
      ]),
    ).rejects.toThrow(/never changed/);
    await expect(
      asOwner(production, `update audit_label set text = 'Someone' where sequence = $1`, [
        sequence,
      ]),
    ).rejects.toThrow(/only by erasure/);

    // Erasure changes the label, and nothing else.
    const erased = await service.withTenant(production, (trx) => eraseLabels(trx, GRACE), ADA_ACTS);
    expect(erased).toBe(1);
    const [after] = await eventsAfter(String(BigInt(sequence) - 1n));
    expect(after).toEqual(original);
    const labels = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('audit_label')
        .select(['role', 'text', 'refers_to'])
        .select(sql<boolean>`erased_at is not null`.as('erased'))
        .where('sequence', '=', sequence)
        .orderBy('role')
        .execute(),
    );
    expect(labels).toEqual([
      { role: 'actor', text: 'Ada', refers_to: ADA, erased: false },
      { role: 'grantee', text: 'erased', refers_to: GRACE, erased: true },
    ]);
  });

  it("erases every label referring to a person, as an event of its own, and leaves everyone else's", async () => {
    const before = await newest();
    const grace = { actorKind: 'person', actor: GRACE, actorLabel: 'Grace' } as const;
    await service.withTenant(production, renamed, grace);
    await service.withTenant(production, renamed, grace);
    await service.withTenant(production, renamed, ADA_ACTS);
    const erased = await service.withTenant(production, (trx) => eraseLabels(trx, GRACE), {
      actorKind: 'person',
      actor: ADA,
      traceId: 'req-9',
    });
    expect(erased).toBe(2);
    const events = await eventsAfter(before);
    expect(events.at(-1)).toMatchObject({
      kind: 'audit.label_erased',
      actor_kind: 'person',
      actor: ADA,
      subject_kind: 'principal',
      subject: GRACE,
      detail: { labels: 2 },
      trace_id: 'req-9',
    });
    const remaining = await service.withTenant(production, (trx) =>
      trx
        .selectFrom('audit_label')
        .select(['text'])
        .where('sequence', '>', before)
        .where('role', '=', 'actor')
        .orderBy('sequence')
        .execute(),
    );
    expect(remaining.map((label) => label.text)).toEqual(['erased', 'erased', 'Ada']);
    // And without a context, no erasure.
    await expect(service.withTenant(production, (trx) => eraseLabels(trx, ADA))).rejects.toThrow(
      /no audit context/,
    );
  });

  it('LIF-032 takes increasing sequences across concurrent writers, leaves a gap for a rolled-back act, and a read bounded by xmin never passes a late commit', async () => {
    const before = await newest();
    const concurrent = await Promise.all(
      Array.from({ length: 6 }, () => seeding.withTenant(production, renamed)),
    );
    expect(new Set(concurrent).size).toBe(6);
    expect((await eventsAfter(before)).map((event) => event.sequence)).toEqual(
      [...concurrent].sort((a, b) => Number(a) - Number(b)),
    );

    // A rolled-back act leaves its sequence unused.
    const rolledBack = await seeding
      .withTenant(production, async (trx) => {
        await renamed(trx);
        throw new Error('the act failed');
      })
      .catch(() => undefined);
    expect(rolledBack).toBeUndefined();
    const last = concurrent
      .map(Number)
      .sort((a, b) => a - b)
      .at(-1)!;
    const next = Number(await seeding.withTenant(production, renamed));
    expect(next).toBeGreaterThan(last + 1);

    // A late commit: the earlier sequence is taken first and committed last.
    const mark = await newest();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let taken!: () => void;
    const takenEarly = new Promise<void>((resolve) => (taken = resolve));
    const late = seeding.withTenant(production, async (trx) => {
      const sequence = await renamed(trx);
      taken();
      await held;
      return sequence;
    });
    await takenEarly;
    const prompt = await seeding.withTenant(production, renamed);
    const read = (bounded: boolean) =>
      service.withTenant(production, async (trx) => {
        const rows = await trx
          .selectFrom('audit_event')
          .select('sequence')
          .where('sequence', '>', mark)
          .$if(bounded, (query) =>
            query.where(sql<boolean>`xact < pg_snapshot_xmin(pg_current_snapshot())`),
          )
          .orderBy('sequence')
          .execute();
        return rows.map((row) => row.sequence);
      });
    // Unbounded, a reader sees the later sequence alone, and a cursor past it would skip the earlier.
    expect(await read(false)).toEqual([prompt]);
    // Bounded by xmin, it sees neither until the earlier commits.
    expect(await read(true)).toEqual([]);
    release();
    const lateSequence = await late;
    expect(Number(lateSequence)).toBeLessThan(Number(prompt));
    // xmin is the cluster's, so a transaction another suite holds open may bound it a moment longer.
    const deadline = Date.now() + 5_000;
    let seen = await read(true);
    while (seen.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      seen = await read(true);
    }
    expect(seen).toEqual([lateSequence, prompt]);
  });

  it("LIF-031 keeps a tenant's events out of every other tenant's reach", async () => {
    await service.withTenant(production, renamed, ADA_ACTS);
    for (const statement of [
      sql`select count(*) from ${sql.id(production.schema, 'audit_event')}`,
      sql`select count(*) from ${sql.id(production.schema, 'audit_label')}`,
      sql`select ${sql.id(production.schema, 'erase_labels')}(${ADA}::uuid)`,
    ]) {
      await expect(
        service.withTenant(development, (trx) => statement.execute(trx), ADA_ACTS),
      ).rejects.toThrow(/permission denied/);
    }
    const theirs = await service.withTenant(development, (trx) =>
      trx.selectFrom('audit_event').select('sequence').execute(),
    );
    expect(theirs).toEqual([]);
  });
});
