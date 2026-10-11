import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordEvent } from './audit.js';
import {
  auditExportBody,
  failAuditExport,
  finishAuditExport,
  readAuditExport,
  requestAuditExport,
} from './audit-export.js';
import { bootstrapCluster } from './bootstrap.js';
import { migrate } from './migrate.js';
import { createTenant, type Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import { createTenantDatabase, type TenantDatabase } from './tenant-database.js';
import { freshDatabase, TEST_PASSWORDS, type TestDatabase } from './testing/database.js';

const ADA = '0b6f6b8e-4a39-4c1e-9d0f-3c0a8f1e2d41';
const CLINICAL = '3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a';
const SAFETY = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const ADA_ACTS = { actorKind: 'person', actor: ADA, actorLabel: 'Ada' } as const;

describe('the audit log exported', () => {
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
    // Ada is a principal of production's, whom an export's row names.
    await service.withTenant(production, (trx) =>
      trx
        .insertInto('principal')
        .values({
          id: ADA,
          issuer: null,
          subject: null,
          display_name: 'Ada',
          email: 'ada@example.com',
        })
        .execute(),
    );
  }, 120_000);

  afterAll(async () => {
    await service.close();
    await db.drop();
  });

  const renamed = (space: string, name: string) => (trx: TenantTransaction) =>
    recordEvent(trx, { kind: 'space.renamed', subject: { kind: 'space', id: space }, space }, [
      { role: 'space', text: name, refersTo: space },
    ]);

  const request = (tenant: Tenant, filter: Parameters<typeof requestAuditExport>[2] = {}) =>
    service.withTenant(tenant, (trx) => requestAuditExport(trx, ADA, filter), ADA_ACTS);

  const lines = async (tenant: Tenant, id: string) => {
    const body = await auditExportBody(service, tenant, id);
    return new TextDecoder()
      .decode(body!.bytes)
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { sequence: string; kind: string; labels: object });
  };

  it('ADM-039 exports every event matching its filters that was visible when it was asked for, oldest first, and none of another tenant', async () => {
    const before = await service.withTenant(production, renamed(SAFETY, 'Before'), ADA_ACTS);
    await service.withTenant(development, renamed(SAFETY, 'Theirs'), ADA_ACTS);
    // An act holding its sequence, uncommitted as the export is asked for.
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

    const asked = await request(production, { kind: 'space.renamed', subject: SAFETY });
    commit();
    await open;
    const after = await service.withTenant(production, renamed(SAFETY, 'After'), ADA_ACTS);

    const exported = await lines(production, asked.id);
    expect(exported.map((each) => each.sequence)).toEqual([before]);
    expect(exported[0]).toMatchObject({
      kind: 'space.renamed',
      labels: { space: { text: 'Before', erased: false } },
    });
    expect(exported.map((each) => each.sequence)).not.toContain(lateSequence);
    expect(exported.map((each) => each.sequence)).not.toContain(after);
    expect(asked.newest).not.toBeNull();
    // The request is itself an event, recorded with the act and outside what it exports.
    const row = await service.withTenant(production, (trx) => readAuditExport(trx, asked.id));
    expect(row).toMatchObject({
      id: asked.id,
      requestedBy: ADA,
      state: 'queued',
      filter: { kind: 'space.renamed', subject: SAFETY },
    });
  });

  it('LIF-028 exports every event, not a page of them', async () => {
    await service.withTenant(
      production,
      async (trx) => {
        for (let each = 0; each < 250; each += 1) await renamed(CLINICAL, `Name ${each}`)(trx);
      },
      ADA_ACTS,
    );
    const asked = await request(production, { subject: CLINICAL });
    const exported = await lines(production, asked.id);
    expect(exported).toHaveLength(250);
    const sequences = exported.map((each) => Number(each.sequence));
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(String(sequences.at(-1))).toBe(asked.newest);
  });

  it('ADM-039 holds nothing past the newest event it saw: never the asking of itself, though its own transaction began before a later one committed', async () => {
    // The asking transaction takes its id first, as deciding the route does by locking the epoch;
    // one that began after it then commits, so the snapshot's xmax passes the asker's own id.
    let proceed!: () => void;
    const later = new Promise<void>((resolve) => (proceed = resolve));
    let began!: () => void;
    const hasId = new Promise<void>((resolve) => (began = resolve));
    const asking = service.withTenant(
      production,
      async (trx) => {
        await sql`select pg_current_xact_id()`.execute(trx);
        began();
        await later;
        const asked = await requestAuditExport(trx, ADA, { kind: 'export.' });
        await recordEvent(trx, {
          kind: 'export.produced',
          subject: { kind: 'audit_export', id: asked.id },
          detail: { export: asked.id, of: 'audit' },
        });
        return asked;
      },
      ADA_ACTS,
    );
    await hasId;
    await service.withTenant(production, renamed(SAFETY, 'Between'), ADA_ACTS);
    proceed();
    const asked = await asking;

    const exported = await lines(production, asked.id);
    expect(
      exported.filter(
        (each) => (each as { detail?: { export?: string } }).detail?.export === asked.id,
      ),
    ).toEqual([]);
    for (const each of exported)
      expect(Number(each.sequence)).toBeLessThanOrEqual(Number(asked.newest));
  });

  it('records an export finished, or failed, once', async () => {
    const asked = await request(production, { subject: CLINICAL });
    await service.withTenant(production, (trx) =>
      finishAuditExport(trx, asked.id, { key: 'k1', sha256: 'a'.repeat(64), size: 10 }, 3),
    );
    expect(
      await service.withTenant(production, (trx) => readAuditExport(trx, asked.id)),
    ).toMatchObject({
      state: 'done',
      key: 'k1',
      events: 3,
    });
    await service.withTenant(production, (trx) => failAuditExport(trx, asked.id));
    expect(
      (await service.withTenant(production, (trx) => readAuditExport(trx, asked.id)))!.state,
    ).toBe('done');
    // Nothing to write once it is not waiting.
    expect(await auditExportBody(service, production, asked.id)).toBeUndefined();
  });
});
