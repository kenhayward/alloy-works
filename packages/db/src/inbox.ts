import { personView } from './person-view.js';
import type { BudgetCounts } from './generation-budget.js';
import { internalHeld } from './internal-held.js';
import { labelFor } from '@alloy-works/domain';
import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { notDeletedAs } from './deletion.js';
import { readableArtifacts } from './readable-artifacts.js';
import { notifyTenant } from './realtime.js';
import type { TenantTransaction } from './tables.js';

/** What a person may be told of (COL-034). */
export type NotificationKind = 'mention' | 'reply' | 'resolution' | 'round';
export type Cadence = 'at_once' | 'daily' | 'never';
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'mention',
  'reply',
  'resolution',
  'round',
];

/** Each kind's cadence where a person has chosen none (TH-F). */
export const DEFAULT_CADENCES: Readonly<Record<NotificationKind, Cadence>> = {
  mention: 'at_once',
  reply: 'at_once',
  resolution: 'daily',
  // Named as a reviewer (RR-H): told at once.
  round: 'at_once',
};

/** How long a notification is kept (TH-H; COL-062). */
export const NOTIFICATIONS_KEPT_DAYS = 90;

/** What a digest counts (COL-035, COL-053): how many of each kind, and where, by identifier alone. */
export interface DigestCounts {
  readonly mention: number;
  readonly reply: number;
  readonly resolution: number;
  /** Rounds one was named on (RR-H); absent from a digest folded before 0079, which counts none. */
  readonly round?: number;
  readonly threads: readonly string[];
  /** The rounds named, by identifier; absent before 0079. */
  readonly rounds?: readonly string[];
  readonly artifacts: readonly string[];
}

/** A notification as its recipient holds it (COL-063): identifiers, never the text (COL-036). */
export interface StoredNotification {
  readonly id: string;
  readonly kind: NotificationKind | 'digest' | 'budget';
  readonly actor: { readonly id: string; readonly name: string | null } | null;
  readonly thread: string | null;
  /** A round's notification names it (RR-H). */
  readonly round: string | null;
  readonly artifact: string | null;
  readonly counts: DigestCounts | null;
  /** A budget's notification says how much (G6-D); null on every other. */
  readonly budget: BudgetCounts | null;
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
    .where(notDeletedAs('a'))
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

/** Those of `recipients` from outside, where `thread` is internal: none where it is not. */
async function outsideOf(
  trx: TenantTransaction,
  thread: string,
  recipients: readonly string[],
): Promise<ReadonlySet<string>> {
  if (recipients.length === 0 || !(await internalHeld(trx))) return new Set();
  const internal = await trx
    .selectFrom('thread_internal')
    .select('thread_id')
    .where('thread_id', '=', thread)
    .executeTakeFirst();
  if (!internal) return new Set();
  const rows = await trx
    .selectFrom('principal')
    .select('id')
    .where('id', 'in', [...recipients])
    .where('kind', '=', 'external')
    .execute();
  return new Set(rows.map((row) => row.id));
}

/**
 * Tells each recipient of an act on a thread, in the act's transaction (TH-G): but its actor, each
 * only where they may read what the thread is on, decided now (TH-E), and by their cadence - a
 * notification at once, an event held for the day's digest, or nothing. Answers those who may not read
 * it, who are told nothing, for the author's composer to say so (COL-015), and those it told.
 */
export async function tell(
  trx: TenantTransaction,
  input: {
    readonly kind: NotificationKind;
    readonly actor: string;
    /** What it is about: a thread, or a round (RR-H). */
    readonly thread?: string;
    readonly round?: string;
    readonly artifact: string;
    readonly recipients: readonly string[];
  },
): Promise<{ readonly untold: string[]; readonly told: string[] }> {
  const untold: string[] = [];
  const told: string[] = [];
  // An internal thread tells nobody from outside, as it shows them nothing (COL-038; R13-D).
  const kept =
    input.thread === undefined
      ? new Set<string>()
      : await outsideOf(trx, input.thread, [...new Set(input.recipients)]);
  for (const recipient of new Set(input.recipients)) {
    if (recipient === input.actor) continue;
    if (
      kept.has(recipient) ||
      !(await readableOf(trx, recipient, [input.artifact])).has(input.artifact)
    ) {
      untold.push(recipient);
      continue;
    }
    const cadence = (await cadencesOf(trx, recipient))[input.kind];
    if (cadence === 'never') continue;
    const row = {
      recipient,
      kind: input.kind,
      actor: input.actor,
      thread_id: input.thread ?? null,
      // Named only for a round, so a schema before 0079 is never asked for the column.
      ...(input.round === undefined ? {} : { round_id: input.round }),
      artifact_id: input.artifact,
    };
    if (cadence === 'at_once') {
      await trx.insertInto('notification').values(row).execute();
      await notifyTenant(trx, { kind: 'inbox', recipient });
    } else await trx.insertInto('notification_held').values(row).execute();
    told.push(recipient);
  }
  return { untold, told };
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
  // A thread made internal after somebody from outside was told of it is no longer theirs to see
  // (COL-038; the R13 plan, R13-D).
  const outside =
    (
      await trx
        .selectFrom('principal')
        .select('kind')
        .where('id', '=', recipient)
        .executeTakeFirst()
    )?.kind === 'external' && (await internalHeld(trx));
  const keptFromOutside = sql<boolean>`n.thread_id is not null and exists (
    select 1 from thread_internal i where i.thread_id = n.thread_id)`;
  let query = trx
    .selectFrom('notification as n')
    .leftJoin('principal as p', 'p.id', 'n.actor')
    .select([
      'n.id',
      'n.kind',
      'n.actor',
      'p.display_name',
      'p.kind as actor_kind',
      'n.thread_id',
      // Through the row whole: a schema before 0079 has no such column.
      sql<string | null>`to_jsonb(n) ->> 'round_id'`.as('round_id'),
      'n.artifact_id',
      'n.counts',
      'n.at',
      'n.read_at',
    ])
    .where('n.recipient', '=', recipient);
  if (outside) query = query.where(sql<boolean>`not (${keptFromOutside})`);
  if (input.unread) query = query.where('n.read_at', 'is', null);
  if (input.after !== undefined) {
    query = query.where(sql<boolean>`(${at}, n.id) < (${input.after.at}, ${input.after.id}::uuid)`);
  }
  const rows = await query.orderBy(at, 'desc').orderBy('n.id', 'desc').limit(input.limit).execute();
  const count = await trx
    .selectFrom('notification as n')
    .select((eb) => eb.fn.countAll<string>().as('unread'))
    .where('n.recipient', '=', recipient)
    .where('n.read_at', 'is', null)
    .$if(outside, (counted) => counted.where(sql<boolean>`not (${keptFromOutside})`))
    .executeTakeFirstOrThrow();
  return {
    notifications: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      actor: row.actor === null ? null : personView(row.actor, row.display_name, row.actor_kind),
      thread: row.thread_id,
      round: row.round_id,
      artifact: row.artifact_id,
      counts: row.kind === 'budget' ? null : (row.counts as DigestCounts | null),
      budget: row.kind === 'budget' ? (row.counts as BudgetCounts) : null,
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
    .returning([
      'recipient',
      'kind',
      'thread_id',
      'artifact_id',
      sql<string | null>`to_jsonb(notification_held) ->> 'round_id'`.as('round_id'),
    ])
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
    // Nor anything of a thread made internal since, to somebody from outside (COL-038; the R13 final
    // review): the thread is no longer theirs to be told of.
    const keptFrom = new Set<string>();
    for (const thread of new Set(
      rows.flatMap((row) => (row.thread_id === null ? [] : [row.thread_id])),
    )) {
      for (const each of await outsideOf(trx, thread, [recipient])) {
        if (each === recipient) keptFrom.add(thread);
      }
    }
    const kept = rows.filter(
      (row) =>
        readable.has(row.artifact_id) && (row.thread_id === null || !keptFrom.has(row.thread_id)),
    );
    if (kept.length === 0) continue;
    const counts: DigestCounts = {
      mention: kept.filter((row) => row.kind === 'mention').length,
      reply: kept.filter((row) => row.kind === 'reply').length,
      resolution: kept.filter((row) => row.kind === 'resolution').length,
      round: kept.filter((row) => row.kind === 'round').length,
      threads: [...new Set(kept.flatMap((row) => (row.thread_id === null ? [] : [row.thread_id])))],
      rounds: [...new Set(kept.flatMap((row) => (row.round_id === null ? [] : [row.round_id])))],
      artifacts: [...new Set(kept.map((row) => row.artifact_id))],
    };
    await trx
      .insertInto('notification')
      .values({ recipient, kind: 'digest', counts: JSON.stringify(counts), at: boundary })
      .execute();
    await notifyTenant(trx, { kind: 'inbox', recipient });
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
