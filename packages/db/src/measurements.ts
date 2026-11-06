import {
  addBuckets,
  BUCKETS_VERSION,
  MEASUREMENT_TIERS,
  type MeasurementSpan,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';

/** What a capability did in a span (diagnostics.md; the DG plan, DG-B). */
export interface CapabilityCount {
  readonly capability: string;
  readonly requests: number;
  readonly clientErrors: number;
  readonly serverErrors: number;
  readonly refused: number;
  /** Counts by `LATENCY_BOUNDS_MS`, the overflow last. */
  readonly buckets: readonly number[];
}

export interface CapabilityUsage extends CapabilityCount {
  readonly at: Date;
  readonly bucketsVersion: number;
}

/**
 * Adds a minute's counts to what is held for it (pre-flight 4): every process flushing the same
 * minute adds to one row, so nothing is lost to another's write.
 */
export async function recordCapabilityMinute(
  trx: TenantTransaction,
  minute: Date,
  counts: readonly CapabilityCount[],
): Promise<void> {
  await add(trx, 'minute', minute, BUCKETS_VERSION, counts);
}

async function add(
  trx: TenantTransaction,
  span: MeasurementSpan,
  at: Date,
  version: number,
  counts: readonly CapabilityCount[],
): Promise<void> {
  for (const each of counts) {
    await sql`
      insert into capability_usage
        (span, at, capability, buckets_version, requests, client_errors, server_errors, refused, buckets)
      values (${span}, ${at}, ${each.capability}, ${version}, ${each.requests}, ${each.clientErrors},
              ${each.serverErrors}, ${each.refused}, ${[...each.buckets]}::integer[])
      on conflict (span, at, capability, buckets_version) do update set
        requests = capability_usage.requests + excluded.requests,
        client_errors = capability_usage.client_errors + excluded.client_errors,
        server_errors = capability_usage.server_errors + excluded.server_errors,
        refused = capability_usage.refused + excluded.refused,
        buckets = (select array_agg(coalesce(held, 0) + coalesce(adding, 0) order by at)
                     from unnest(capability_usage.buckets, excluded.buckets)
                          with ordinality as pair (held, adding, at))`.execute(trx);
  }
}

/** What each capability did, by `span`, from `since`, in order. */
export async function capabilityUsage(
  trx: TenantTransaction,
  span: MeasurementSpan,
  since: Date,
): Promise<CapabilityUsage[]> {
  const rows = await trx
    .selectFrom('capability_usage')
    .selectAll()
    .where('span', '=', span)
    .where('at', '>=', since)
    .orderBy('at')
    .orderBy('capability')
    .execute();
  return rows.map((row) => ({
    at: row.at,
    capability: row.capability,
    bucketsVersion: row.buckets_version,
    requests: row.requests,
    clientErrors: row.client_errors,
    serverErrors: row.server_errors,
    refused: row.refused,
    buckets: row.buckets,
  }));
}

const DAY_MS = 86_400_000;
const kept = (span: MeasurementSpan) =>
  MEASUREMENT_TIERS.find((tier) => tier.span === span)!.keptDays * DAY_MS;

/**
 * Rolls each precision past its keeping into the next (DG-B): minutes into hours after 7 days, hours
 * into days after 90, by adding, so the totals and the buckets are exactly what was counted; days past
 * 13 months are forgotten. Answers how many rows went.
 */
export async function rollUpMeasurements(
  trx: TenantTransaction,
  now: Date = new Date(),
): Promise<number> {
  let gone = 0;
  for (const [from, into, unit] of [
    ['minute', 'hour', 3_600_000],
    ['hour', 'day', DAY_MS],
  ] as const) {
    const old = await trx
      .deleteFrom('capability_usage')
      .where('span', '=', from)
      .where('at', '<', new Date(now.getTime() - kept(from)))
      .returningAll()
      .execute();
    gone += old.length;
    const summed = new Map<string, { at: Date; version: number; count: CapabilityCount }>();
    for (const row of old) {
      const at = new Date(Math.floor(row.at.getTime() / unit) * unit);
      const key = `${at.toISOString()} ${row.buckets_version} ${row.capability}`;
      const held = summed.get(key);
      const count: CapabilityCount = {
        capability: row.capability,
        requests: row.requests + (held?.count.requests ?? 0),
        clientErrors: row.client_errors + (held?.count.clientErrors ?? 0),
        serverErrors: row.server_errors + (held?.count.serverErrors ?? 0),
        refused: row.refused + (held?.count.refused ?? 0),
        buckets: held ? addBuckets(held.count.buckets, row.buckets) : row.buckets,
      };
      summed.set(key, { at, version: row.buckets_version, count });
    }
    for (const { at, version, count } of summed.values()) {
      await add(trx, into, at, version, [count]);
    }
  }
  const forgotten = await trx
    .deleteFrom('capability_usage')
    .where('span', '=', 'day')
    .where('at', '<', new Date(now.getTime() - kept('day')))
    .executeTakeFirst();
  return gone + Number(forgotten.numDeletedRows);
}
