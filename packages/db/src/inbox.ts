import { labelFor } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { readableArtifacts } from './readable-artifacts.js';
import type { TenantTransaction } from './tables.js';

/** What a person may be told of (COL-034). */
export type NotificationKind = 'mention' | 'reply' | 'resolution';
export type Cadence = 'at_once' | 'daily' | 'never';
export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['mention', 'reply', 'resolution'];

/** Each kind's cadence where a person has chosen none (TH-F). */
export const DEFAULT_CADENCES: Readonly<Record<NotificationKind, Cadence>> = {
  mention: 'at_once',
  reply: 'at_once',
  resolution: 'daily',
};

/** How long a notification is kept (TH-H; COL-062). */
export const NOTIFICATIONS_KEPT_DAYS = 90;

/** What a digest counts (COL-035, COL-053): how many of each kind, and where, by identifier alone. */
export interface DigestCounts {
  readonly mention: number;
  readonly reply: number;
  readonly resolution: number;
  readonly threads: readonly string[];
  readonly artifacts: readonly string[];
}

/** A notification as its recipient holds it (COL-063): identifiers, never the text (COL-036). */
export interface StoredNotification {
  readonly id: string;
  readonly kind: NotificationKind | 'digest';
  readonly actor: { readonly id: string; readonly name: string | null } | null;
  readonly thread: string | null;
  readonly artifact: string | null;
  readonly counts: DigestCounts | null;
  readonly at: Date;
  readonly readAt: Date | null;
}

/** Which of these artifacts a person may read now, decided on their grants as every read is. */
export async function readableOf(
  trx: TenantTransaction,
  principal: string,
  artifacts: readonly string[],
): Promise<ReadonlySet<string>> {
  const asked = [...new Set(artifacts)];
  if (asked.length === 0) return new Set();
  const readable = await loadReadableSet(trx, principal);
  if (!readable) return new Set();
  const rows = await trx
    .selectFrom('artifact as a')
    .select('a.id')
    .where('a.id', 'in', asked)
    .where((eb) => readableArtifacts(eb, readable))
    .execute();
  return new Set(rows.map((row) => row.id));
}

/** A person's cadence for each kind: their choice, or the default (COL-034). */
export async function cadencesOf(
  trx: TenantTransaction,
  principal: string,
): Promise<Record<NotificationKind, Cadence>> {
  const rows = await trx
    .selectFrom('notification_preference')
    .select(['kind', 'cadence'])
    .where('principal_id', '=', principal)
    .execute();
  const chosen = { ...DEFAULT_CADENCES };
  for (const row of rows) chosen[row.kind] = row.cadence;
  return chosen;
}

/** Changes a person's cadences, the kinds named alone. */
export async function setCadences(
  trx: TenantTransaction,
  principal: string,
  cadences: { readonly [kind in NotificationKind]?: Cadence | undefined },
): Promise<void> {
  for (const kind of NOTIFICATION_KINDS) {
    const cadence = cadences[kind];
    if (cadence === undefined) continue;
    await trx
      .insertInto('notification_preference')
      .values({ principal_id: principal, kind, cadence })
      .onConflict((conflict) => conflict.columns(['principal_id', 'kind']).doUpdateSet({ cadence }))
      .execute();
  }
}

/**
 * Tells each recipient of an act on a thread, in the act's transaction (TH-G): but its actor, each
 * only where they may read what the thread is on, decided now (TH-E), and by their cadence - a
 * notification at once, an event held for the day's digest, or nothing. Answers those who may not read
 * it, who are told nothing, for the author's composer to say so (COL-015).
 */
export async function tell(
  trx: TenantTransaction,
  input: {
    readonly kind: NotificationKind;
    readonly actor: string;
    readonly thread: string;
    readonly artifact: string;
    readonly recipients: readonly string[];
  },
): Promise<string[]> {
  const untold: string[] = [];
  for (const recipient of new Set(input.recipients)) {
    if (recipient === input.actor) continue;
    if (!(await readableOf(trx, recipient, [input.artifact])).has(input.artifact)) {
      untold.push(recipient);
      continue;
    }
    const cadence = (await cadencesOf(trx, recipient))[input.kind];
    if (cadence === 'never') continue;
    const row = {
      recipient,
      kind: input.kind,
      actor: input.actor,
      thread_id: input.thread,
      artifact_id: input.artifact,
    };
    if (cadence === 'at_once') await trx.insertInto('notification').values(row).execute();
    else await trx.insertInto('notification_held').values(row).execute();
  }
  return untold;
}

/**
 * A page of a person's inbox, newest first (COL-063), after where the last ended, and how many are
 * unread. Their own alone: nobody reads another's.
 */
export async function listInbox(
  trx: TenantTransaction,
  recipient: string,
  input: {
    readonly unread?: boolean;
    readonly after?: { readonly at: Date; readonly id: string };
    readonly limit: number;
  },
): Promise<{ notifications: StoredNotification[]; unread: number }> {
  // Keyed to the millisecond a cursor can carry, not Postgres' microsecond.
  const at = sql<Date>`date_trunc('milliseconds', n.at)`;
  let query = trx
    .selectFrom('notification as n')
    .leftJoin('principal as p', 'p.id', 'n.actor')
    .select([
      'n.id',
      'n.kind',
      'n.actor',
      'p.display_name',
      'n.thread_id',
      'n.artifact_id',
      'n.counts',
      'n.at',
      'n.read_at',
    ])
    .where('n.recipient', '=', recipient);
  if (input.unread) query = query.where('n.read_at', 'is', null);
  if (input.after !== undefined) {
    query = query.where(sql<boolean>`(${at}, n.id) < (${input.after.at}, ${input.after.id}::uuid)`);
  }
  const rows = await query.orderBy(at, 'desc').orderBy('n.id', 'desc').limit(input.limit).execute();
  const count = await trx
    .selectFrom('notification')
    .select((eb) => eb.fn.countAll<string>().as('unread'))
    .where('recipient', '=', recipient)
    .where('read_at', 'is', null)
    .executeTakeFirstOrThrow();
  return {
    notifications: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      actor: row.actor === null ? null : { id: row.actor, name: row.display_name },
      thread: row.thread_id,
      artifact: row.artifact_id,
      counts: row.counts as DigestCounts | null,
      at: row.at,
      readAt: row.read_at,
    })),
    unread: Number(count.unread),
  };
}

/**
 * The titles of those of these artifacts the person may read now (COL-036): a title is shown only to a
 * reader of it, at the moment it is read. Each at its latest version.
 */
export async function titlesFor(
  trx: TenantTransaction,
  principal: string,
  artifacts: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const readable = [...(await readableOf(trx, principal, artifacts))];
  if (readable.length === 0) return new Map();
  const rows = await trx
    .selectFrom('artifact_version as v')
    .innerJoin('artifact as a', 'a.id', 'v.artifact_id')
    .select(['v.artifact_id', 'a.kind', 'v.content'])
    .distinctOn('v.artifact_id')
    .where('v.artifact_id', 'in', readable)
    .orderBy('v.artifact_id')
    .orderBy('v.revision_no', 'desc')
    .orderBy('v.version_no', 'desc')
    .execute();
  const titles = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== 'component' && row.kind !== 'document') continue;
    const title = labelFor(row.kind, row.content as Record<string, unknown>);
    if (title !== undefined) titles.set(row.artifact_id, title);
  }
  return titles;
}

/** Marks one of a person's own notifications read; false where it is not theirs or not there. */
export async function markRead(
  trx: TenantTransaction,
  recipient: string,
  id: string,
): Promise<boolean> {
  const found = await trx
    .selectFrom('notification')
    .select(['id', 'read_at'])
    .where('id', '=', id)
    .where('recipient', '=', recipient)
    .executeTakeFirst();
  if (!found) return false;
  if (found.read_at === null) {
    await trx
      .updateTable('notification')
      .set({ read_at: new Date() })
      .where('id', '=', id)
      .execute();
  }
  return true;
}

/** Deletes one of a person's own notifications (COL-062); false where it is not theirs or not there. */
export async function deleteNotification(
  trx: TenantTransaction,
  recipient: string,
  id: string,
): Promise<boolean> {
  const removed = await trx
    .deleteFrom('notification')
    .where('id', '=', id)
    .where('recipient', '=', recipient)
    .executeTakeFirst();
  return removed.numDeletedRows > 0n;
}

/** The latest 07:00 UTC at or before `now`: the boundary a day's digest is folded at (TH-F). */
export function digestBoundary(now: Date): Date {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 0, 0, 0),
  );
  return today.getTime() <= now.getTime() ? today : new Date(today.getTime() - 86_400_000);
}

/**
 * Folds every event held from before the latest 07:00 UTC boundary into one digest per person
 * (COL-035), deciding again what each may read (TH-F): an event on something they may no longer read
 * is dropped. The held rows are claimed by deleting them, so two workers folding at once never fold one
 * twice - the second waits on the first's rows and finds them gone. Answers how many digests it made.
 */
export async function foldDigests(trx: TenantTransaction, now: Date): Promise<number> {
  const boundary = digestBoundary(now);
  const held = await trx
    .deleteFrom('notification_held')
    .where('at', '<', boundary)
    .returning(['recipient', 'kind', 'thread_id', 'artifact_id'])
    .execute();
  const byRecipient = new Map<string, typeof held>();
  for (const row of held) {
    const rows = byRecipient.get(row.recipient) ?? [];
    rows.push(row);
    byRecipient.set(row.recipient, rows);
  }
  let made = 0;
  for (const [recipient, rows] of byRecipient) {
    const readable = await readableOf(
      trx,
      recipient,
      rows.map((row) => row.artifact_id),
    );
    const kept = rows.filter((row) => readable.has(row.artifact_id));
    if (kept.length === 0) continue;
    const counts: DigestCounts = {
      mention: kept.filter((row) => row.kind === 'mention').length,
      reply: kept.filter((row) => row.kind === 'reply').length,
      resolution: kept.filter((row) => row.kind === 'resolution').length,
      threads: [...new Set(kept.map((row) => row.thread_id))],
      artifacts: [...new Set(kept.map((row) => row.artifact_id))],
    };
    await trx
      .insertInto('notification')
      .values({ recipient, kind: 'digest', counts: JSON.stringify(counts), at: boundary })
      .execute();
    made += 1;
  }
  return made;
}

/** Deletes the notifications older than they are kept (COL-062); answers how many. */
export async function sweepNotifications(trx: TenantTransaction, now: Date): Promise<number> {
  const before = new Date(now.getTime() - NOTIFICATIONS_KEPT_DAYS * 86_400_000);
  const removed = await trx.deleteFrom('notification').where('at', '<', before).executeTakeFirst();
  return Number(removed.numDeletedRows);
}
