import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/** Minutes probed are kept 13 months, as measurements are (DG-B). */
const PROBES_KEPT_DAYS = 396;

/** Anything that answers a query: the worker's pool. */
export interface Queryable {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
}

/**
 * Records that the worker probed the service in `at`'s minute (ADR-0101): up if any probe in the minute
 * was. On the hour, minutes past 13 months go.
 */
export async function recordServiceProbe(db: Queryable, at: Date, up: boolean): Promise<void> {
  await db.query(
    `insert into platform.service_probe (minute, up) values (date_trunc('minute', $1::timestamptz), $2)
     on conflict (minute) do update set up = service_probe.up or excluded.up`,
    [at, up],
  );
  if (at.getUTCMinutes() === 0) {
    await db.query(
      `delete from platform.service_probe where minute < $1::timestamptz - make_interval(days => $2)`,
      [at, PROBES_KEPT_DAYS],
    );
  }
}

export interface ServiceAvailability {
  /** The first minute ever probed; null where nothing probes. */
  readonly firstProbe: Date | null;
  readonly probed: number;
  readonly up: number;
}

/** The minutes probed and up since `since`, through the definer (ADR-0101). */
export async function serviceAvailability(
  trx: TenantTransaction,
  since: Date,
): Promise<ServiceAvailability> {
  const { rows } = await sql<{ first_probe: Date | null; probed: string; up: string }>`
    select * from platform.service_availability(${since})`.execute(trx);
  const row = rows[0]!;
  return { firstProbe: row.first_probe, probed: Number(row.probed), up: Number(row.up) };
}

export interface BackupRecord {
  readonly class: 'databases' | 'objects';
  readonly act: 'backup' | 'drill';
  readonly lastStartedAt: Date;
  readonly lastSeconds: number;
  readonly lastOutcome: 'succeeded' | 'failed';
  /** When one last finished well; null where none has. */
  readonly succeededAt: Date | null;
}

/** The latest backup and drill of each class (pre-flight 2): none where nothing records them. */
export async function backupRecord(trx: TenantTransaction): Promise<BackupRecord[]> {
  const { rows } = await sql<{
    class: BackupRecord['class'];
    act: BackupRecord['act'];
    last_started_at: Date;
    last_seconds: number;
    last_outcome: BackupRecord['lastOutcome'];
    succeeded_at: Date | null;
  }>`select * from platform.backup_record()`.execute(trx);
  return rows.map((row) => ({
    class: row.class,
    act: row.act,
    lastStartedAt: row.last_started_at,
    lastSeconds: Number(row.last_seconds),
    lastOutcome: row.last_outcome,
    succeededAt: row.succeeded_at,
  }));
}
