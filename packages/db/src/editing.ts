import {
  canonicalise,
  canonicaliseValues,
  parseContentDocument,
  type ContentDocument,
  type MetadataValues,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import type { TenantTransaction } from './tables.js';
import { sha256Hex } from './version-digest.js';
import { latestVersion, type StoredVersion } from './versions.js';

/**
 * How long a lock lasts without an accepted iteration (COL-008): provisionally fifteen minutes, as
 * component-editor.md's open question has it. A product constant until a tenant setting exists (the
 * editor plan's decision 7).
 */
export const LOCK_PERIOD_MINUTES = 15;

/** How long an iteration is kept after it is written (VER-003). VER-Q01 has no number; this is one. */
export const ITERATION_RETENTION_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Who holds a component, from which editing session, until when. */
export interface LockState {
  readonly holder: string;
  /** The holder's name as their provider last gave it, for naming them in a refusal. */
  readonly holderName: string | null;
  readonly session: string;
  readonly expiresAt: Date;
}

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
  | { readonly answer: 'lock.required' };

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
  /** The latest sequence again, with different content. */
  | { readonly answer: 'iteration.conflict'; readonly latest: number }
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  | { readonly answer: 'artifact.missing' };

/**
 * Serialises every write to one component's lock, iterations and versions, in the caller's
 * transaction: the key `recordVersion` takes, and Postgres' transaction advisory locks are re-entrant,
 * so a cut that takes it here and again inside `recordVersion` waits for nothing.
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

/** The unexpired lock on a component, or undefined when nobody holds it. */
export async function readLock(
  trx: TenantTransaction,
  artifactId: string,
): Promise<LockState | undefined> {
  if (!UUID.test(artifactId)) return undefined;
  const row = await trx
    .selectFrom('component_lock as l')
    .innerJoin('principal as p', 'p.id', 'l.principal_id')
    .select(['l.principal_id', 'p.display_name', 'l.session_id', 'l.expires_at'])
    .where('l.artifact_id', '=', artifactId)
    .where('l.expires_at', '>', sql<Date>`clock_timestamp()`)
    .executeTakeFirst();
  return (
    row && {
      holder: row.principal_id,
      holderName: row.display_name,
      session: row.session_id,
      expiresAt: row.expires_at,
    }
  );
}

/** The lock, when this session holds it; the refusal otherwise. */
export async function holding(
  trx: TenantTransaction,
  session: EditingSession,
): Promise<LockState | HolderRefusal> {
  const lock = await readLock(trx, session.artifactId);
  if (!lock) return { answer: 'lock.required' };
  if (lock.holder !== session.principal || lock.session !== session.session) {
    return { answer: 'lock.held', lock };
  }
  return lock;
}

export const isRefusal = (held: LockState | HolderRefusal): held is HolderRefusal =>
  'answer' in held;

const lockExpiry = () =>
  sql<Date>`clock_timestamp() + make_interval(mins => ${LOCK_PERIOD_MINUTES})`;

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
    expires_at: lockExpiry(),
  };
  await trx
    .insertInto('component_lock')
    .values({ artifact_id: input.artifactId, ...claim })
    .onConflict((conflict) => conflict.column('artifact_id').doUpdateSet(claim))
    .execute();
  return { answer: 'claimed', lock: (await readLock(trx, input.artifactId))! };
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
}

/**
 * Saves an iteration (component-editor.md, "Saving"), in the caller's transaction: the lock checked
 * first, then the version the session opened from, then the sequence rules - a higher sequence is
 * accepted and extends the lock (COL-008); the latest again with the same content is answered as it
 * was, making no second row; with different content it is a conflict; a lower one is stale.
 *
 * The iteration records the metadata values of the version it opened from, because nothing in this
 * slice edits a value: the metadata panel's plan adds values to what a session sends.
 */
export async function saveIteration(
  trx: TenantTransaction,
  input: NewIteration,
): Promise<IterationAnswer> {
  if (!(await isComponent(trx, input.artifactId))) return { answer: 'artifact.missing' };
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new Error(`An iteration's sequence is a whole number from 1, not ${input.sequence}`);
  }
  await serialise(trx, input.artifactId);
  const lock = await holding(trx, input);
  if (isRefusal(lock)) return lock;
  const current = await latestVersion(trx, input.artifactId);
  if (!current) return { answer: 'artifact.missing' };
  if (current.id !== input.openedFrom) return { answer: 'version.precondition', current };

  const content = parseContentDocument(input.content);
  const digest = iterationDigest(content, current.values);
  const latest = await trx
    .selectFrom('iteration')
    .select(['sequence', 'digest'])
    .where('artifact_id', '=', input.artifactId)
    .where('session_id', '=', input.session)
    .orderBy('sequence', 'desc')
    .limit(1)
    .executeTakeFirst();
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
      expires_at: sql<Date>`clock_timestamp() + make_interval(days => ${ITERATION_RETENTION_DAYS})`,
      content: JSON.stringify(content),
      metadata_values: JSON.stringify(current.values),
      digest,
    })
    .execute();
  await trx
    .updateTable('component_lock')
    .set({ expires_at: lockExpiry() })
    .where('artifact_id', '=', input.artifactId)
    .execute();
  const extended = await readLock(trx, input.artifactId);
  if (!extended) throw new Error(`The lock on ${input.artifactId} was extended and is not there`);
  return { answer: 'accepted', sequence: input.sequence, repeated: false, lock: extended };
}
