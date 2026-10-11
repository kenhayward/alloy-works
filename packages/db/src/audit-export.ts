import type { AuditFilter } from '@alloy-works/domain';
import { sql } from 'kysely';
import { auditEntryJson, readAuditEvents } from './audit-read.js';
import { enqueueJob } from './queue.js';
import type { Tenant } from './provision.js';
import type { TenantTransaction } from './tables.js';
import type { TenantDatabase } from './tenant-database.js';

/** Where the store kept an export's bytes, as `put` answers. */
export interface KeptExport {
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
}

/** An export of the audit log as its row holds it (0066). */
export interface AuditExport {
  readonly id: string;
  readonly requestedBy: string | null;
  readonly requestedAt: Date;
  readonly filter: AuditFilter;
  readonly snapshot: string;
  /** The newest event its snapshot saw, or null for an empty log. */
  readonly newest: string | null;
  readonly state: 'queued' | 'done' | 'failed';
  readonly key: string | null;
  readonly sha256: string | null;
  readonly bytes: number | null;
  readonly events: number | null;
  readonly finishedAt: Date | null;
}

/** The filters as the row keeps them: each instant in ISO 8601. */
function storedFilter(filter: AuditFilter): Record<string, string> {
  return Object.fromEntries(
    Object.entries(filter)
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [name, value instanceof Date ? value.toISOString() : String(value)]),
  );
}

function filterOf(stored: Readonly<Record<string, string>>): AuditFilter {
  return {
    ...(stored['actor'] === undefined ? {} : { actor: stored['actor'] }),
    ...(stored['kind'] === undefined ? {} : { kind: stored['kind'] }),
    ...(stored['from'] === undefined ? {} : { from: new Date(stored['from']) }),
    ...(stored['to'] === undefined ? {} : { to: new Date(stored['to']) }),
    ...(stored['subject'] === undefined ? {} : { subject: stored['subject'] }),
    ...(stored['space'] === undefined ? {} : { space: stored['space'] }),
  };
}

/**
 * **An export asked for** (ADM-039, LIF-028; the AU2 plan, AU-N): its filters and the snapshot of this
 * transaction, taken before anything else it writes, the newest event that snapshot sees, and its job,
 * queued in the same transaction. The caller records `export.produced` after, past the newest, so the
 * export never holds it.
 */
export async function requestAuditExport(
  trx: TenantTransaction,
  principalId: string,
  filter: AuditFilter,
): Promise<{ readonly id: string; readonly newest: string | null }> {
  const { rows } = await sql<{ id: string; newest: string | null }>`
    insert into audit_export (requested_by, filters, snapshot, newest)
    select ${principalId}, ${JSON.stringify(storedFilter(filter))}::jsonb, now_seen.snapshot,
      (select max(e.sequence) from audit_event e where pg_visible_in_snapshot(e.xact, now_seen.snapshot))
    from (select pg_current_snapshot() as snapshot) as now_seen
    returning id, newest::text as newest`.execute(trx);
  const asked = rows[0]!;
  await enqueueJob(trx, 'audit_export', asked.id);
  return asked;
}

/** An export by its id, or undefined where the tenant holds none. */
export async function readAuditExport(
  trx: TenantTransaction,
  id: string,
): Promise<AuditExport | undefined> {
  const row = await trx
    .selectFrom('audit_export')
    .selectAll()
    .select(sql<string>`snapshot::text`.as('snapshot_text'))
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    id: row.id,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    filter: filterOf(row.filters),
    snapshot: row.snapshot_text,
    newest: row.newest,
    state: row.state,
    key: row.object_key,
    sha256: row.sha256,
    bytes: row.bytes === null ? null : Number(row.bytes),
    events: row.events,
    finishedAt: row.finished_at,
  };
}

/**
 * **What an export holds**: every event its filters match that its snapshot sees, oldest first, as
 * JSON Lines in the read route's shape, up to the newest it saw, read a hundred at a time, each page in a
 * transaction of its own - the snapshot, not the transaction, is what keeps it complete. Undefined where the export is no
 * longer waiting: another attempt finished it.
 */
export async function auditExportBody(
  db: TenantDatabase,
  tenant: Tenant,
  id: string,
): Promise<{ readonly bytes: Uint8Array; readonly events: number } | undefined> {
  const asked = await db.withTenant(tenant, (trx) => readAuditExport(trx, id));
  if (!asked || asked.state !== 'queued') return undefined;
  const lines: string[] = [];
  // Bounded by the newest event the snapshot saw as well as by the snapshot: the asking
  // transaction's own id may fall below its snapshot's xmax, and Postgres leaves its own id out of
  // the running ones, so the snapshot alone would see the export's own asking (the final review).
  const newest = asked.newest;
  if (newest === null) return { bytes: new Uint8Array(), events: 0 };
  let after: string | undefined;
  for (;;) {
    const page = await db.withTenant(tenant, (trx) =>
      readAuditEvents(trx, asked.filter, {
        limit: 100,
        order: 'asc',
        snapshot: asked.snapshot,
        upTo: newest,
        ...(after === undefined ? {} : { after }),
      }),
    );
    for (const entry of page.items) lines.push(`${JSON.stringify(auditEntryJson(entry))}\n`);
    if (page.next === null) break;
    after = page.next;
  }
  return { bytes: new TextEncoder().encode(lines.join('')), events: lines.length };
}

/** An export written, once: an attempt that finds it no longer waiting changes nothing. */
export async function finishAuditExport(
  trx: TenantTransaction,
  id: string,
  stored: KeptExport,
  events: number,
): Promise<void> {
  await trx
    .updateTable('audit_export')
    .set({
      state: 'done',
      object_key: stored.key,
      sha256: stored.sha256,
      bytes: stored.size,
      events,
      finished_at: new Date(),
    })
    .where('id', '=', id)
    .where('state', '=', 'queued')
    .execute();
}

/** An export its job gave up on, where it was still waiting. */
export async function failAuditExport(trx: TenantTransaction, id: string): Promise<void> {
  await trx
    .updateTable('audit_export')
    .set({ state: 'failed', finished_at: new Date() })
    .where('id', '=', id)
    .where('state', '=', 'queued')
    .execute();
}
