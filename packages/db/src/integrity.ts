import { createHash } from 'node:crypto';
import {
  INTEGRITY_CLASSES,
  INTEGRITY_PERIOD_DAYS,
  integrityShare,
  type IntegrityClass,
  type IntegrityFailure,
} from '@alloy-works/domain';
import { sql, type RawBuilder } from 'kysely';
import { recordEvent } from './audit.js';
import type { TenantTransaction } from './tables.js';
import { versionDigests } from './version-digest.js';
import { readVersion, substanceOf } from './versions.js';

/**
 * Stored artifacts re-verified (diagnostics.md, "Integrity"; the DG plan, DG-K; ADM-044): each night a
 * share of each class, least recently checked first, so every item is checked within the period.
 */

/** An item due a check: a version is recomputed; the rest are read from the store and hashed. */
export type IntegrityItem =
  | { readonly class: 'version'; readonly item: string }
  | {
      readonly class: Exclude<IntegrityClass, 'version'>;
      readonly item: string;
      readonly key: string;
      readonly sha256: string;
    };

/** An object's bytes by its key, or null where the store holds none. */
export type ReadObject = (key: string) => Promise<Uint8Array | null>;

/** Each class's items as held now: an id, and for an object its key and the hash it must have. */
const ITEMS: Record<IntegrityClass, RawBuilder<{ item: string; key: string; sha256: string }>> = {
  // An original's key ends in its hash (AST-042).
  asset: sql`select id as item, object_key as key, substring(object_key from '[0-9a-f]{64}$') as sha256
    from asset_upload where state = 'ready' and object_key is not null`,
  version: sql`select id as item, null as key, null as sha256 from artifact_version`,
  audit_export: sql`select id as item, object_key as key, sha256 from audit_export
    where state = 'done' and sha256 is not null`,
  tenant_export: sql`select id as item, object_key as key, sha256 from tenant_export
    where state = 'done'`,
};

const startOfDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/**
 * Tonight's share of each class (`integrityShare`), never-checked first, then least recently checked;
 * null where this tenant was checked already this UTC day.
 */
export async function integrityDue(
  trx: TenantTransaction,
  now: Date = new Date(),
): Promise<IntegrityItem[] | null> {
  const done = await trx
    .selectFrom('integrity_check')
    .select('item')
    .where('checked_at', '>=', startOfDay(now))
    .limit(1)
    .executeTakeFirst();
  if (done) return null;
  const due: IntegrityItem[] = [];
  for (const kind of INTEGRITY_CLASSES) {
    const total = await sql<{ n: string }>`select count(*) as n from (${ITEMS[kind]}) held`.execute(
      trx,
    );
    const share = integrityShare(Number(total.rows[0]!.n));
    if (share === 0) continue;
    const { rows } = await sql<{ item: string; key: string; sha256: string }>`
      select held.item, held.key, held.sha256 from (${ITEMS[kind]}) held
      left join integrity_check c on c.class = ${kind} and c.item = held.item
      order by c.checked_at nulls first, held.item
      limit ${share}`.execute(trx);
    for (const row of rows)
      due.push(kind === 'version' ? { class: kind, item: row.item } : { class: kind, ...row });
  }
  return due;
}

/** Whether an object's bytes are there and have their hash. */
export function objectFailure(bytes: Uint8Array | null, sha256: string): IntegrityFailure | null {
  if (bytes === null) return 'object_missing';
  return createHash('sha256').update(bytes).digest('hex') === sha256 ? null : 'hash_mismatch';
}

/** A version's digests recomputed from its row (VER-042); a row that no longer reads has changed. */
async function versionFailure(
  trx: TenantTransaction,
  id: string,
): Promise<IntegrityFailure | null> {
  const stored = await readVersion(trx, id);
  if (!stored) return null;
  try {
    const recomputed = versionDigests(substanceOf(stored));
    return recomputed.contentHash === stored.contentHash &&
      recomputed.versionDigest === stored.versionDigest
      ? null
      : 'digest_mismatch';
  } catch {
    return 'digest_mismatch';
  }
}

/**
 * Checks one item and records the check. A failure is audited as `integrity.failed`, by the system, in
 * the same transaction, once until it clears or changes: never only logged (ADM-044). Answers it.
 */
export async function verifyIntegrity(
  trx: TenantTransaction,
  item: IntegrityItem,
  read: ReadObject,
  now: Date = new Date(),
): Promise<IntegrityFailure | null> {
  const failure =
    item.class === 'version'
      ? await versionFailure(trx, item.item)
      : objectFailure(await read(item.key), item.sha256);
  const before = await trx
    .selectFrom('integrity_check')
    .select('failure')
    .where('class', '=', item.class)
    .where('item', '=', item.item)
    .executeTakeFirst();
  await trx
    .insertInto('integrity_check')
    .values({ class: item.class, item: item.item, checked_at: now, ok: failure === null, failure })
    .onConflict((oc) =>
      oc.columns(['class', 'item']).doUpdateSet({ checked_at: now, ok: failure === null, failure }),
    )
    .execute();
  if (failure !== null && before?.failure !== failure) {
    await recordEvent(trx, {
      kind: 'integrity.failed',
      subject: { kind: item.class, id: item.item },
      detail: { class: item.class, item: item.item, failure },
    });
  }
  return failure;
}

export interface IntegrityClassSummary {
  readonly class: IntegrityClass;
  /** Items held now. */
  readonly items: number;
  readonly checkedInPeriod: number;
  /** Items whose last check failed. */
  readonly failing: number;
  readonly lastFailure: {
    readonly item: string;
    readonly failure: IntegrityFailure;
    readonly at: Date;
  } | null;
}

/** Each class as Diagnostics shows it: items held, checked in the period, failing, the latest failure. */
export async function integrityOf(
  trx: TenantTransaction,
  now: Date = new Date(),
): Promise<{ readonly periodDays: number; readonly classes: IntegrityClassSummary[] }> {
  const since = new Date(now.getTime() - INTEGRITY_PERIOD_DAYS * 86_400_000);
  const classes: IntegrityClassSummary[] = [];
  for (const kind of INTEGRITY_CLASSES) {
    const { rows } = await sql<{
      items: string;
      checked: string;
      failing: string;
      item: string | null;
      failure: IntegrityFailure | null;
      at: Date | null;
    }>`
      with held as (${ITEMS[kind]}),
      checks as (
        select c.* from integrity_check c join held on held.item = c.item where c.class = ${kind}
      ),
      latest as (select item, failure, checked_at from checks where not ok
                 order by checked_at desc, item limit 1)
      select (select count(*) from held) as items,
        (select count(*) from checks where checked_at > ${since}) as checked,
        (select count(*) from checks where not ok) as failing,
        latest.item, latest.failure, latest.checked_at as at
      from (select 1) one left join latest on true`.execute(trx);
    const row = rows[0]!;
    classes.push({
      class: kind,
      items: Number(row.items),
      checkedInPeriod: Number(row.checked),
      failing: Number(row.failing),
      lastFailure:
        row.item === null || row.failure === null || row.at === null
          ? null
          : { item: row.item, failure: row.failure, at: row.at },
    });
  }
  return { periodDays: INTEGRITY_PERIOD_DAYS, classes };
}
