import {
  canonicalise,
  canonicaliseValues,
  parseContentDocument,
  type ContentDocument,
  type MetadataFailure,
  type MetadataValues,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { componentFieldsNow, unstorableValues } from './component-values.js';
import type { TenantTransaction } from './tables.js';
import { sha256Hex } from './version-digest.js';
import { latestVersion, type StoredVersion } from './versions.js';

/**
 * How long a lock lasts without activity unless an administrator changes it (COL-008): fifteen
 * minutes, the default of `editing_policy.lock_release_minutes` (0069; collaboration.md).
 */
export const LOCK_PERIOD_MINUTES = 15;

/**
 * The window a tenant starts with (VER-004): how many days an iteration is kept after the next version
 * is cut from its component. VER-Q01 has no number; this is one. The tenant's own is `editing_policy`'s
 * (0037), whose column default this must equal, and which the sweep reads when it runs (retention.ts):
 * nothing is decided at insert, when the cut has not happened.
 */
export const ITERATION_RETENTION_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Who holds a component, from which editing session, until when. */
export interface LockState {
  readonly holder: string;
  /** The holder's name as their provider last gave it, for naming them in a refusal. */
  readonly holderName: string | null;
  readonly session: string;
  readonly expiresAt: Date;
  /** When the holder last claimed or saved (collaboration.md, CL-A). */
  readonly activeAt: Date;
  /** When somebody else may first ask for it: the take period after `activeAt` (COL-046). */
  readonly takeableAt: Date;
  /** Somebody's ask to take it, and when the holder's grace to keep it ends (COL-047). */
  readonly taking: {
    readonly by: string;
    readonly byName: string | null;
    readonly session: string;
    readonly until: Date;
  } | null;
  /** The session it was taken from, whose next save is told so (COL-045). */
  readonly takenFrom: string | null;
}

/** How long a holder has to keep a lock once somebody asks for it (COL-047; collaboration.md, CL-B). */
export const TAKE_GRACE_MS = 60_000;

/** How long after its grace an ask still stands, for the asker's window to come back and take it. */
export const TAKE_ASK_LASTS_MS = 60_000;

/** One principal's one editing session on one component: what every write in a session carries. */
export interface EditingSession {
  readonly artifactId: string;
  readonly principal: string;
  readonly session: string;
}

/** A write refused because the caller's session does not hold the lock. */
export type HolderRefusal =
  /** Somebody else holds it, or this principal from another session (API-039). */
  | { readonly answer: 'lock.held'; readonly lock: LockState }
  /** Nobody holds it: never claimed, released, or expired. */
  | { readonly answer: 'lock.required' }
  /** Somebody took it from this very session (COL-045): who has it now. */
  | { readonly answer: 'lock.taken'; readonly lock: LockState };

export type LockClaimAnswer =
  | { readonly answer: 'claimed'; readonly lock: LockState }
  | { readonly answer: 'lock.held'; readonly lock: LockState }
  | { readonly answer: 'artifact.missing' };

export type IterationAnswer =
  | {
      readonly answer: 'accepted';
      readonly sequence: number;
      /** True when this sequence had been accepted already, with the same content: no second row. */
      readonly repeated: boolean;
      readonly lock: LockState;
    }
  | HolderRefusal
  /** A lower sequence than the latest accepted: a whole snapshot never replaces a newer one. */
  | { readonly answer: 'iteration.stale'; readonly latest: number }
  /** A value that cannot be stored honestly with the component (MET-033, MET-038), each named. */
  | { readonly answer: 'values.invalid'; readonly failures: readonly MetadataFailure[] }
  /** The latest sequence again, with different content. */
  | { readonly answer: 'iteration.conflict'; readonly latest: number }
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  | { readonly answer: 'artifact.missing' };

/**
 * Serialises every write to one component's lock, iterations and versions, in the caller's
 * transaction: the key `recordVersion` takes, and Postgres' transaction advisory locks are re-entrant,
 * so a cut that takes it here and again inside `recordVersion` waits for nothing.
 *
 * Every write to `component_lock` takes this first, with no exception. The one-holder invariant rests
 * on it, not on the table's own constraints: the runtime role keeps its default `update` and `delete`
 * grants on `component_lock` (unlike `iteration`, which has them revoked), and the primary key on
 * `artifact_id` stops two rows for one component but not two callers each believing they hold it from
 * a read taken before the other's write. A caller that reads or writes `component_lock` without calling
 * this first can observe, or leave, a lock silently moved or overwritten underneath it.
 */
export async function serialise(trx: TenantTransaction, artifactId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:artifact:${artifactId}`}, 0))`.execute(
    trx,
  );
}

/** Whether this tenant holds a component by that id. */
export async function isComponent(trx: TenantTransaction, artifactId: string): Promise<boolean> {
  if (!UUID.test(artifactId)) return false;
  const row = await trx
    .selectFrom('artifact')
    .select('id')
    .where('id', '=', artifactId)
    .where('kind', '=', 'component')
    .executeTakeFirst();
  return row !== undefined;
}

/** The live locks on these components, each with its holder, its activity and any ask for it. */
async function lockRows(trx: TenantTransaction, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return trx
    .selectFrom('component_lock as l')
    .innerJoin('principal as p', 'p.id', 'l.principal_id')
    .leftJoin('principal as t', 't.id', 'l.taking_by')
    .select([
      'l.artifact_id',
      'l.principal_id',
      'p.display_name',
      'l.session_id',
      'l.expires_at',
      'l.active_at',
      'l.taking_by',
      't.display_name as taking_name',
      'l.taking_session',
      'l.taking_until',
      'l.taken_from',
      // An ask past its last moment is no ask (the PL final review, finding 7): nothing clears it.
      sql<boolean>`l.taking_until is not null and l.taking_until + make_interval(secs => ${TAKE_ASK_LASTS_MS / 1000}) > clock_timestamp()`.as(
        'taking_stands',
      ),
      sql<Date>`l.active_at + make_interval(mins => (select lock_take_minutes from editing_policy))`.as(
        'takeable_at',
      ),
    ])
    .where('l.artifact_id', 'in', [...ids])
    .where('l.expires_at', '>', sql<Date>`clock_timestamp()`)
    .execute();
}

function lockOf(row: Awaited<ReturnType<typeof lockRows>>[number]): LockState {
  return {
    holder: row.principal_id,
    holderName: row.display_name,
    session: row.session_id,
    expiresAt: row.expires_at,
    activeAt: row.active_at,
    takeableAt: row.takeable_at,
    taking:
      !row.taking_stands ||
      row.taking_by === null ||
      row.taking_session === null ||
      row.taking_until === null
        ? null
        : {
            by: row.taking_by,
            byName: row.taking_name,
            session: row.taking_session,
            until: row.taking_until,
          },
    takenFrom: row.taken_from,
  };
}

/** The unexpired lock on a component, or undefined when nobody holds it. */
export async function readLock(
  trx: TenantTransaction,
  artifactId: string,
): Promise<LockState | undefined> {
  if (!UUID.test(artifactId)) return undefined;
  const [row] = await lockRows(trx, [artifactId]);
  return row && lockOf(row);
}

/** The live lock on each of many artifacts, in one query; an artifact nobody holds is absent. */
export async function readLocks(
  trx: TenantTransaction,
  artifactIds: readonly string[],
): Promise<Map<string, LockState>> {
  const ids = [...new Set(artifactIds.filter((id) => UUID.test(id)))];
  const rows = await lockRows(trx, ids);
  return new Map(rows.map((row) => [row.artifact_id, lockOf(row)]));
}

/** The lock, when this session holds it; the refusal otherwise. */
export async function holding(
  trx: TenantTransaction,
  session: EditingSession,
): Promise<LockState | HolderRefusal> {
  const lock = await readLock(trx, session.artifactId);
  if (!lock) return { answer: 'lock.required' };
  if (lock.holder !== session.principal || lock.session !== session.session) {
    // Taken from this very session (COL-045): it is told who has it, not merely that somebody does.
    if (lock.takenFrom === session.session) return { answer: 'lock.taken', lock };
    return { answer: 'lock.held', lock };
  }
  return lock;
}

export const isRefusal = (held: LockState | HolderRefusal): held is HolderRefusal =>
  'answer' in held;

/** When a lock active now is free: the tenant's release period on (COL-008). */
const lockExpiry = () =>
  sql<Date>`clock_timestamp() + make_interval(mins => (select lock_release_minutes from editing_policy))`;

/**
 * Claims a component's lock for an editing session (COL-005), or answers who holds it. A lock held by
 * somebody else refuses; one held by the same principal from another session refuses too, unless `move`
 * says to continue here, which moves it (component-editor.md, "Two windows, one author"). Claiming again
 * from the session already holding it extends it.
 */
export async function claimLock(
  trx: TenantTransaction,
  input: EditingSession & { readonly move?: boolean },
): Promise<LockClaimAnswer> {
  if (!(await isComponent(trx, input.artifactId))) return { answer: 'artifact.missing' };
  await serialise(trx, input.artifactId);
  const held = await readLock(trx, input.artifactId);
  if (
    held &&
    (held.holder !== input.principal || (held.session !== input.session && !input.move))
  ) {
    return { answer: 'lock.held', lock: held };
  }
  const claim = {
    principal_id: input.principal,
    session_id: input.session,
    claimed_at: sql<Date>`clock_timestamp()`,
    // A claim, a reload's or Recovery's from the holding session included, is activity (CL-A), and
    // ends any ask for it (COL-047).
    active_at: sql<Date>`clock_timestamp()`,
    expires_at: lockExpiry(),
    taking_by: null,
    taking_session: null,
    taking_until: null,
    // Whom it was taken from matters only while the taker holds it: a claim anew forgets it.
    taken_from: held !== undefined && held.session === input.session ? held.takenFrom : null,
  };
  await trx
    .insertInto('component_lock')
    .values({ artifact_id: input.artifactId, ...claim })
    .onConflict((conflict) => conflict.column('artifact_id').doUpdateSet(claim))
    .execute();
  return { answer: 'claimed', lock: (await readLock(trx, input.artifactId))! };
}

/**
 * The latest iteration a session has saved of a component, its sequence and digest: what `saveIteration`
 * judges the next one against. Filtered by principal as well as session, for the same reason cutVersion
 * is (promotion.ts): a session id is chosen by the client and is not unique per principal, so a session
 * id reused by a second principal must judge its own sequence alone, never against the first
 * principal's.
 */
function latestAccepted(trx: TenantTransaction, session: EditingSession) {
  return trx
    .selectFrom('iteration')
    .select(['sequence', 'digest'])
    .where('artifact_id', '=', session.artifactId)
    .where('principal_id', '=', session.principal)
    .where('session_id', '=', session.session)
    .orderBy('sequence', 'desc')
    .limit(1)
    .executeTakeFirst();
}

/**
 * The latest sequence the service has accepted from one editing session, or null where it has none
 * (component-editor.md, "Undo across a reload"): read as `saveIteration` reads it, so a reload continues
 * from exactly the number the next save is judged against. The session's own, whatever version each
 * iteration was opened from, since a session's sequence runs on across a cut.
 */
export async function latestSequence(
  trx: TenantTransaction,
  session: EditingSession,
): Promise<number | null> {
  if (!UUID.test(session.artifactId) || !UUID.test(session.session)) return null;
  return (await latestAccepted(trx, session))?.sequence ?? null;
}

/**
 * What one editing session holds of a component now, for a binding read from it (the B2 plan, B2-C):
 * the content of its latest iteration, only where that session, of that principal, holds the lock now
 * and the iteration was opened from the component's latest version - otherwise undefined, as for any
 * other session, a lapsed lock or an iteration opened before the latest cut.
 */
export async function sessionContent(
  trx: TenantTransaction,
  session: EditingSession,
): Promise<{ readonly content: unknown; readonly openedFrom: string } | undefined> {
  if (!UUID.test(session.artifactId) || !UUID.test(session.session)) return undefined;
  const lock = await holding(trx, session);
  if (isRefusal(lock)) return undefined;
  const latest = await trx
    .selectFrom('iteration')
    .select(['content', 'opened_from'])
    .where('artifact_id', '=', session.artifactId)
    .where('principal_id', '=', session.principal)
    .where('session_id', '=', session.session)
    .orderBy('sequence', 'desc')
    .limit(1)
    .executeTakeFirst();
  const current = await latestVersion(trx, session.artifactId);
  if (!latest || !current || latest.opened_from !== current.id) return undefined;
  return { content: latest.content, openedFrom: latest.opened_from };
}

/** SHA-256 over an iteration's canonical content and values, in the version digest's own rules. */
export function iterationDigest(content: ContentDocument, values: MetadataValues): string {
  return sha256Hex(`{"content":${canonicalise(content)},"values":${canonicaliseValues(values)}}`);
}

export interface NewIteration extends EditingSession {
  readonly sequence: number;
  /** The version the session opened from, which must still be the latest. */
  readonly openedFrom: string;
  readonly content: ContentDocument;
  /**
   * The component's values, whole, as the session holds them (definitions.md, "A component's"). Absent,
   * the values of the version the session opened from, as they stood before a session sent any.
   */
  readonly values?: MetadataValues;
}

/**
 * Saves an iteration (component-editor.md, "Saving"), in the caller's transaction: the lock checked
 * first, then the version the session opened from, then the sequence rules - a higher sequence is
 * accepted and extends the lock (COL-008); the latest again with the same content is answered as it
 * was, making no second row; with different content it is a conflict; a lower one is stale.
 *
 * The iteration records the values the session sends, whole, checked against the component's fields at
 * the current definitions: what cannot be stored honestly is refused, and everything else is saved.
 */
export async function saveIteration(
  trx: TenantTransaction,
  input: NewIteration,
): Promise<IterationAnswer> {
  if (!(await isComponent(trx, input.artifactId))) return { answer: 'artifact.missing' };
  // 2147483647 is the largest value the column's `integer` type holds: bounded here, before an insert
  // ever reaches Postgres, whose refusal for it would name a type rather than what a caller sent.
  if (!Number.isInteger(input.sequence) || input.sequence < 1 || input.sequence > 2147483647) {
    throw new Error(
      `An iteration's sequence is a whole number from 1 to 2147483647, not ${input.sequence}`,
    );
  }
  await serialise(trx, input.artifactId);
  const lock = await holding(trx, input);
  if (isRefusal(lock)) return lock;
  const current = await latestVersion(trx, input.artifactId);
  if (!current) return { answer: 'artifact.missing' };
  if (current.id !== input.openedFrom) return { answer: 'version.precondition', current };

  const content = parseContentDocument(input.content);
  const values = input.values ?? current.values;
  if (input.values !== undefined) {
    const { effective } = await componentFieldsNow(trx, current);
    const failures = await unstorableValues(trx, effective, values);
    if (failures.length > 0) return { answer: 'values.invalid', failures };
  }
  const digest = iterationDigest(content, values);
  const latest = await latestAccepted(trx, input);
  if (latest && input.sequence < latest.sequence) {
    return { answer: 'iteration.stale', latest: latest.sequence };
  }
  if (latest && input.sequence === latest.sequence) {
    if (latest.digest !== digest) return { answer: 'iteration.conflict', latest: latest.sequence };
    return { answer: 'accepted', sequence: input.sequence, repeated: true, lock };
  }
  await trx
    .insertInto('iteration')
    .values({
      artifact_id: input.artifactId,
      principal_id: input.principal,
      session_id: input.session,
      sequence: input.sequence,
      opened_from: current.id,
      created_at: sql<Date>`clock_timestamp()`,
      content: JSON.stringify(content),
      metadata_values: JSON.stringify(values),
      digest,
    })
    .execute();
  await trx
    .updateTable('component_lock')
    // An iteration not seen before is activity (CL-A): the lock is free a release period from now.
    // ... and ends any ask for it (COL-047): the holder kept it.
    .set({
      active_at: sql<Date>`clock_timestamp()`,
      expires_at: lockExpiry(),
      taking_by: null,
      taking_session: null,
      taking_until: null,
    })
    .where('artifact_id', '=', input.artifactId)
    .execute();
  const extended = await readLock(trx, input.artifactId);
  if (!extended) throw new Error(`The lock on ${input.artifactId} was extended and is not there`);
  return { answer: 'accepted', sequence: input.sequence, repeated: false, lock: extended };
}

export type TakeAnswer =
  /** Taken: the lock is the asker's session's now. */
  | { readonly answer: 'taken'; readonly lock: LockState; readonly from: LockState }
  /**
   * Asked, or asked already: the holder has until then to keep it, and the asker asks again after
   * `retryAfterMs` - by the database's clock, so the asker's own clock cannot ask too soon or too late
   * (the PL final review, finding 1).
   */
  | { readonly answer: 'asked'; readonly lock: LockState; readonly retryAfterMs: number }
  /** Nobody holds it: claim it instead. */
  | { readonly answer: 'lock.free' }
  /** The asker holds it already, from this or another of their windows: Continue here. */
  | { readonly answer: 'lock.own'; readonly lock: LockState }
  /** The holder is active within the take period: askable from `takeableAt`. */
  | { readonly answer: 'lock.active'; readonly lock: LockState }
  /** Somebody else has asked, and their ask stands. */
  | { readonly answer: 'lock.taking'; readonly lock: LockState }
  | { readonly answer: 'artifact.missing' };

/**
 * **Taking a lock from an idle holder** (COL-009, COL-046, COL-047; collaboration.md, Taking): asked
 * first, the holder told at once and given a grace of `TAKE_GRACE_MS` in which any activity keeps it;
 * asked again by the same session once the grace has passed with the holder still idle, the lock is
 * that session's. Decided under `serialise`, so a save in the last moment either keeps the lock or is
 * refused `lock.taken`. The caller records `lock.taken` on `taken`.
 */
export async function takeLock(trx: TenantTransaction, input: EditingSession): Promise<TakeAnswer> {
  if (!(await isComponent(trx, input.artifactId))) return { answer: 'artifact.missing' };
  await serialise(trx, input.artifactId);
  const lock = await readLock(trx, input.artifactId);
  if (!lock) return { answer: 'lock.free' };
  if (lock.holder === input.principal) return { answer: 'lock.own', lock };
  const { rows } = await sql<{ now: Date }>`select clock_timestamp() as now`.execute(trx);
  const now = rows[0]!.now.getTime();
  const ask = lock.taking;
  const askStands = ask !== null && now < ask.until.getTime() + TAKE_ASK_LASTS_MS;
  if (askStands && (ask.by !== input.principal || ask.session !== input.session)) {
    return { answer: 'lock.taking', lock };
  }
  if (askStands && now < ask.until.getTime()) {
    return { answer: 'asked', lock, retryAfterMs: ask.until.getTime() - now };
  }
  if (askStands) {
    // The grace has passed with the holder idle: any activity would have ended the ask (CL-A).
    await trx
      .updateTable('component_lock')
      .set({
        principal_id: input.principal,
        session_id: input.session,
        claimed_at: sql<Date>`clock_timestamp()`,
        active_at: sql<Date>`clock_timestamp()`,
        expires_at: lockExpiry(),
        taking_by: null,
        taking_session: null,
        taking_until: null,
        taken_from: lock.session,
      })
      .where('artifact_id', '=', input.artifactId)
      .execute();
    return { answer: 'taken', lock: (await readLock(trx, input.artifactId))!, from: lock };
  }
  if (now < lock.takeableAt.getTime()) return { answer: 'lock.active', lock };
  await trx
    .updateTable('component_lock')
    .set({
      taking_by: input.principal,
      taking_session: input.session,
      taking_until: sql<Date>`clock_timestamp() + make_interval(secs => ${TAKE_GRACE_MS / 1000})`,
    })
    .where('artifact_id', '=', input.artifactId)
    .execute();
  return {
    answer: 'asked',
    lock: (await readLock(trx, input.artifactId))!,
    retryAfterMs: TAKE_GRACE_MS,
  };
}
