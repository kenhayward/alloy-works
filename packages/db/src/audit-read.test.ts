import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordEvent } from './audit.js';
import { readAuditEvents, type AuditPage } from './audit-read.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const ADA = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const GRACE = '6a1d9c2e-7b3f-4e8a-9c5d-1f2e3a4b5c6d';
const CLINICAL = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a';
const SAFETY = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const ADA_ACTS = { actorKind: 'person', actor: ADA, actorLabel: 'Ada', traceId: 'req-1' } as const;
const GRACE_ACTS = { actorKind: 'person', actor: GRACE, actorLabel: 'Grace' } as const;

describe('the audit log read', () => {
  let db: TestDatabase;
  let production: Tenant;
  let development: Tenant;
  let service: TenantDatabase;

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
  }, 120_000);

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const renamed = (space: string, name: string) => (trx: TenantTransaction) =>
    recordEvent(trx, { kind: 'space.renamed', subject: { kind: 'space', id: space }, space }, [
      { role: 'space', text: name, refersTo: space },
    ]);
  const archived = (space: string) => (trx: TenantTransaction) =>
    recordEvent(trx, { kind: 'space.archived', subject: { kind: 'space', id: space }, space });

  const read = (
    tenant: Tenant,
    filter: Parameters<typeof readAuditEvents>[1] = {},
    page: Parameters<typeof readAuditEvents>[2] = { limit: 100 },
  ) => service.withTenant(tenant, (trx) => readAuditEvents(trx, filter, page), ADA_ACTS);
  const sequences = (page: AuditPage) => page.items.map((each) => each.sequence);

  it("ADM-038 reads the tenant's events newest first, filtered by who acted, the kind or its family, what it was about and the space, each with its labels", async () => {
    const first = await service.withTenant(production, renamed(CLINICAL, 'Clinical'), ADA_ACTS);
    const second = await service.withTenant(production, archived(SAFETY), GRACE_ACTS);
    const third = await service.withTenant(production, renamed(SAFETY, 'Safety'), GRACE_ACTS);

    const all = await read(production);
    expect(sequences(all).slice(0, 3)).toEqual([third, second, first]);
    expect(all.items.find((each) => each.sequence === first)).toMatchObject({
      kind: 'space.renamed',
      actorKind: 'person',
      actor: ADA,
      subject: { kind: 'space', id: CLINICAL, version: null },
      space: CLINICAL,
      outcome: 'done',
      traceId: 'req-1',
      labels: {
        actor: { text: 'Ada', erased: false },
        space: { text: 'Clinical', erased: false },
      },
    });

    expect(sequences(await read(production, { actor: GRACE }))).toEqual([third, second]);
    expect(sequences(await read(production, { kind: 'space.renamed', space: SAFETY }))).toEqual([
      third,
    ]);
    expect(sequences(await read(production, { kind: 'space.', subject: SAFETY }))).toEqual([
      third,
      second,
    ]);
  });

  it('ADM-038 reads the events between two instants, both included', async () => {
    const sequence = await service.withTenant(production, archived(CLINICAL), ADA_ACTS);
    const event = (await read(production, { subject: CLINICAL, kind: 'space.archived' })).items[0]!;
    expect(event.sequence).toBe(sequence);
    const at = new Date(event.at);
    expect(sequences(await read(production, { from: at, to: at }))).toContain(sequence);
    expect(sequences(await read(production, { from: new Date(at.getTime() + 1) }))).not.toContain(
      sequence,
    );
    expect(sequences(await read(production, { to: new Date(at.getTime() - 1) }))).not.toContain(
      sequence,
    );
  });

  it('LIF-031 reads no event of another tenant', async () => {
    // Each tenant numbers its own events, so they are told apart by what they hold.
    const theirs = await service.withTenant(development, renamed(CLINICAL, 'Theirs'), ADA_ACTS);
    const named = (page: AuditPage) => page.items.map((each) => each.labels['space']?.text);
    expect(named(await read(production))).not.toContain('Theirs');
    expect(sequences(await read(development))).toEqual([theirs]);
    expect(named(await read(development))).toEqual(['Theirs']);
  });

  it('LIF-028 walks exactly the events its first page could see, none twice, and an event committed during the walk is in the next', async () => {
    for (const name of ['One', 'Two', 'Three']) {
      await service.withTenant(production, renamed(SAFETY, name), ADA_ACTS);
    }
    // An act takes its sequence and has not committed when the walk begins; a later one has.
    let commit!: () => void;
    const held = new Promise<void>((resolve) => (commit = resolve));
    let taken!: (sequence: string) => void;
    const late = new Promise<string>((resolve) => (taken = resolve));
    const open = service.withTenant(
      production,
      async (trx) => {
        taken(await renamed(SAFETY, 'Late')(trx));
        await held;
      },
      ADA_ACTS,
    );
    const lateSequence = await late;
    const after = await service.withTenant(production, renamed(SAFETY, 'After'), ADA_ACTS);

    const filter = { subject: SAFETY, kind: 'space.renamed' };
    const walked: string[] = [];
    let page = await read(production, filter, { limit: 2 });
    walked.push(...sequences(page));
    expect(walked).toContain(after);
    commit();
    await open;
    while (page.next !== null) {
      page = await read(production, filter, {
        limit: 2,
        after: page.next,
        snapshot: page.snapshot,
      });
      walked.push(...sequences(page));
    }
    expect(new Set(walked).size).toBe(walked.length);
    expect(walked).not.toContain(lateSequence);
    expect(walked).toEqual([...walked].sort((a, b) => Number(b) - Number(a)));

    // The next walk sees it.
    expect(sequences(await read(production, filter))).toContain(lateSequence);
  });

  it('reads oldest first where asked, as an export does', async () => {
    const page = await read(production, { kind: 'space.' }, { limit: 100, order: 'asc' });
    expect(sequences(page)).toEqual([...sequences(page)].sort((a, b) => Number(a) - Number(b)));
  });
});
