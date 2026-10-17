import { sql } from 'kysely';
import { loadReadableSet } from './access-facts.js';
import { deletedAmong } from './deletion.js';
import { enqueueJob } from './queue.js';
import { mayReadArtifact } from './queryDefinitions.js';
import type { TenantTransaction } from './tables.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type JobState = 'accepted' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** An error's shape, but its trace (API-043; the R3 plan, R3-D). */
export interface JobFailure {
  readonly code: string;
  readonly message: string;
  readonly rule?: string;
}

/** What an impact report did, finished or cancelled: the depths it walked of those asked. */
export interface ImpactOutcome {
  readonly depthsWalked: number;
  readonly depthsAsked: number;
  readonly reached: number;
  readonly cut: boolean;
}

/** What a cohort's run did, finished or cancelled: its rows made and failed of those it took (R7-E). */
export interface CohortOutcome {
  readonly made: number;
  readonly failed: number;
  readonly of: number;
  /** What it did at a failed row, and the row it stopped at, if it did (TPL-047). */
  readonly onFailure?: 'continue' | 'stop';
  readonly stoppedAt?: number | null;
}

/** The kinds of job the API takes (the R3 plan; the R7 plan, R7-A). */
export type ApiJobKind = 'impact_report' | 'cohort';

/** One job as its requester reads it (API-041). */
export interface StoredJob {
  readonly id: string;
  readonly kind: ApiJobKind;
  readonly subject: string;
  /** An impact report's depth, or the rows a cohort's run takes. */
  readonly parameters: { readonly depth?: number; readonly rows?: number };
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly state: JobState;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly progress: { readonly done: number; readonly of: number; readonly unit: string } | null;
  readonly cancelRequested: boolean;
  readonly failure: JobFailure | null;
  readonly outcome: ImpactOutcome | CohortOutcome | null;
  readonly result: { readonly key: string; readonly sha256: string; readonly bytes: number } | null;
}

interface Row {
  id: string;
  kind: string;
  subject_id: string;
  parameters: unknown;
  requested_by: string;
  requested_at: Date;
  state: string;
  started_at: Date | null;
  finished_at: Date | null;
  progress: unknown;
  cancel_requested_at: Date | null;
  failure: unknown;
  outcome: unknown;
  object_key: string | null;
  sha256: string | null;
  bytes: string | number | null;
}

const COLUMNS = sql`id, kind, subject_id, parameters, requested_by, requested_at, state, started_at,
  finished_at, progress, cancel_requested_at, failure, outcome, object_key, sha256, bytes`;

function stored(row: Row): StoredJob {
  return {
    id: row.id,
    kind: row.kind as ApiJobKind,
    subject: row.subject_id,
    parameters: row.parameters as StoredJob['parameters'],
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    state: row.state as JobState,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    progress: (row.progress ?? null) as StoredJob['progress'],
    cancelRequested: row.cancel_requested_at !== null,
    failure: (row.failure ?? null) as JobFailure | null,
    outcome: (row.outcome ?? null) as StoredJob['outcome'],
    result:
      row.object_key === null
        ? null
        : { key: row.object_key, sha256: row.sha256 ?? '', bytes: Number(row.bytes ?? 0) },
  };
}

/**
 * An impact report submitted (REL-032, REL-050; the R3 plan, R3-B): the job at once, accepted, and
 * queued in the same transaction, so the worker meets it exactly when it exists. The caller has
 * decided `by` may read the subject.
 */
export async function submitImpactReport(
  trx: TenantTransaction,
  input: { readonly by: string; readonly subject: string; readonly depth: number },
): Promise<StoredJob> {
  const { rows } = await sql<Row>`
    insert into api_job (kind, subject_id, parameters, requested_by)
    values ('impact_report', ${input.subject}, ${JSON.stringify({ depth: input.depth })}::jsonb,
            ${input.by})
    returning ${COLUMNS}`.execute(trx);
  const job = stored(rows[0]!);
  await enqueueJob(trx, 'impact_report', job.id);
  return job;
}

/** A job, to its requester alone: anybody else reads nothing (R3-B). */
export async function readJob(
  trx: TenantTransaction,
  id: string,
  by: string,
): Promise<StoredJob | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`
    select ${COLUMNS} from api_job where id = ${id} and requested_by = ${by}`.execute(trx);
  return rows[0] && stored(rows[0]);
}

export type CancelAnswer =
  | { readonly answer: 'missing' }
  | { readonly answer: 'finished'; readonly job: StoredJob }
  | { readonly answer: 'cancelled' | 'cancelling'; readonly job: StoredJob };

/**
 * A cancel (API-042; R3-C): an accepted job is cancelled at once, having done nothing; a running one
 * is asked to stop, which it does at its next step; a finished one is refused. Each an update guarded
 * by the state it changes, so a cancel racing the worker's start or finish takes one or the other.
 */
export async function cancelJob(
  trx: TenantTransaction,
  id: string,
  by: string,
): Promise<CancelAnswer> {
  const job = await readJob(trx, id, by);
  if (!job) return { answer: 'missing' };
  const nothing: ImpactOutcome | CohortOutcome =
    job.kind === 'cohort'
      ? { made: 0, failed: 0, of: job.parameters.rows ?? 0 }
      : { depthsWalked: 0, depthsAsked: job.parameters.depth ?? 0, reached: 0, cut: false };
  const { rows: cancelled } = await sql<Row>`
    update api_job
       set state = 'cancelled', finished_at = now(), cancel_requested_at = now(),
           outcome = ${JSON.stringify(nothing)}::jsonb
     where id = ${id} and state = 'accepted'
    returning ${COLUMNS}`.execute(trx);
  if (cancelled[0]) return { answer: 'cancelled', job: stored(cancelled[0]) };
  const { rows: asked } = await sql<Row>`
    update api_job set cancel_requested_at = coalesce(cancel_requested_at, now())
     where id = ${id} and state = 'running'
    returning ${COLUMNS}`.execute(trx);
  if (asked[0]) return { answer: 'cancelling', job: stored(asked[0]) };
  return { answer: 'finished', job: (await readJob(trx, id, by))! };
}

/**
 * The worker's start of an attempt: running, from its first start; undefined where it is cancelled or
 * finished already, which a retry or a cancel before it ran leaves nothing to do for.
 */
export async function startJob(trx: TenantTransaction, id: string): Promise<StoredJob | undefined> {
  if (!UUID.test(id)) return undefined;
  const { rows } = await sql<Row>`
    update api_job
       set state = 'running', started_at = coalesce(started_at, now()), progress = null
     where id = ${id} and state in ('accepted', 'running')
    returning ${COLUMNS}`.execute(trx);
  return rows[0] && stored(rows[0]);
}

/** How far a running job has got; whether it may go on, false where a cancel was asked for. */
export async function progressJob(
  trx: TenantTransaction,
  id: string,
  progress: { readonly done: number; readonly of: number; readonly unit: string },
): Promise<boolean> {
  const { rows } = await sql<{ cancel_requested_at: Date | null }>`
    update api_job set progress = ${JSON.stringify(progress)}::jsonb
     where id = ${id} and state = 'running'
    returning cancel_requested_at`.execute(trx);
  return rows[0] !== undefined && rows[0].cancel_requested_at === null;
}

/** A running job finished, its result kept; or stopped where a cancel was asked for meanwhile. */
export async function finishJob(
  trx: TenantTransaction,
  id: string,
  outcome: ImpactOutcome | CohortOutcome,
  kept: { readonly key: string; readonly sha256: string; readonly bytes: number } | null,
): Promise<StoredJob | undefined> {
  const { rows } = await sql<Row>`
    update api_job
       set state = case when cancel_requested_at is null and ${kept !== null} then 'succeeded'
                        else 'cancelled' end,
           finished_at = now(),
           outcome = ${JSON.stringify(outcome)}::jsonb,
           object_key = case when cancel_requested_at is null then ${kept?.key ?? null} end,
           sha256 = case when cancel_requested_at is null then ${kept?.sha256 ?? null} end,
           bytes = case when cancel_requested_at is null then ${kept?.bytes ?? null}::bigint end
     where id = ${id} and state = 'running'
    returning ${COLUMNS}`.execute(trx);
  return rows[0] && stored(rows[0]);
}

/** A job failed for good, its error kept in an error's shape (API-043; R3-D). */
export async function failJob(
  trx: TenantTransaction,
  id: string,
  failure: JobFailure,
): Promise<void> {
  if (!UUID.test(id)) return;
  await sql`
    update api_job set state = 'failed', finished_at = now(), failure = ${JSON.stringify(failure)}::jsonb
     where id = ${id} and state in ('accepted', 'running')`.execute(trx);
}

/**
 * Whether a job's requester may read its subject still, as it runs: access may have gone since they
 * asked, and a report is the requester's reading of it (the R3 final review).
 */
export async function mayStillRead(
  trx: TenantTransaction,
  by: string,
  id: string,
): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const row = await trx
    .selectFrom('artifact')
    .select(['id', 'space_id'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row || row.space_id === null || (await deletedAmong(trx, [id])).has(id)) return false;
  const readable = await loadReadableSet(trx, by);
  return readable !== undefined && mayReadArtifact(readable, { id, spaceId: row.space_id });
}
