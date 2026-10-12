import {
  labelFor,
  readOutline,
  roundSummary,
  walkOutline,
  type RoundAct,
  type RoundSummary,
} from '@alloy-works/domain';
import { sql } from 'kysely';
import { AUDIT_LOG_KEPT, labelled, labels, recordEvent } from './audit.js';
import { tell } from './inbox.js';
import type { TenantTransaction } from './tables.js';
import { latestVersion, readVersion } from './versions.js';

/** How many reviewers a round may name (RR-B). */
export const ROUND_REVIEWERS_MAX = 50;

/**
 * **A review round as stored** (collaboration.md, Review rounds; the RR plan, RR-A): its document,
 * title, scope, due date, baseline, the version it was opened on, its reviewers, every act in order,
 * and its closing; each reviewer's state derived (`roundSummary`).
 */
export interface StoredRound {
  readonly id: string;
  readonly document: string;
  readonly title: string;
  /** Outline nodes, each with what is beneath it; empty for the whole document. */
  readonly scope: readonly string[];
  readonly dueAt: Date;
  readonly baseline: string | null;
  readonly madeAgainst: string;
  readonly openedBy: string;
  readonly openedAt: Date;
  readonly reviewers: readonly string[];
  readonly acts: readonly (RoundAct & { readonly version: string | null })[];
  readonly closed: { readonly by: string; readonly at: Date } | null;
  readonly summary: RoundSummary;
}

export type OpenAnswer =
  | { readonly answer: 'opened'; readonly round: StoredRound }
  | { readonly answer: 'document.missing' }
  | { readonly answer: 'baseline.missing' }
  | { readonly answer: 'scope.invalid'; readonly nodes: readonly string[] }
  | { readonly answer: 'reviewers.invalid'; readonly reviewers: readonly string[] };

/** Takes the round's lock to the end of the transaction (RR-F), as a thread's acts do. */
async function lockRound(trx: TenantTransaction, round: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`alloy-works:round:${round}`}, 0))`.execute(
    trx,
  );
}

async function recordRoundEvent(
  trx: TenantTransaction,
  kind: 'round.opened' | 'round.closed' | 'review.completed' | 'review.reopened',
  round: string,
  detail: Readonly<Record<string, unknown>>,
): Promise<void> {
  const row = await trx
    .selectFrom('review_round as r')
    .innerJoin('artifact_version as v', 'v.id', 'r.made_against')
    .innerJoin('artifact as a', 'a.id', 'r.document_id')
    .leftJoin('space as s', 's.id', 'a.space_id')
    .select([
      'r.document_id',
      'r.made_against',
      'v.content',
      'a.space_id',
      's.name as space_name',
      AUDIT_LOG_KEPT.as('logged'),
    ])
    .where('r.id', '=', round)
    .executeTakeFirstOrThrow();
  if (row.logged === false) return;
  await recordEvent(
    trx,
    {
      kind,
      subject: { kind: 'document', id: row.document_id, version: row.made_against },
      space: row.space_id,
      detail: { round, ...detail },
    },
    labels(
      labelled(
        'subject',
        labelFor('document', row.content as Record<string, unknown>),
        row.document_id,
      ),
      labelled('space', row.space_name, row.space_id),
    ),
  );
}

/**
 * **Opens a round** (COL-028; RR-A, RR-B): on the document's latest version, or on a baseline of it,
 * which its reviewers read (COL-031); its scope's nodes each in that version's outline; its reviewers
 * people, not services or external principals (COL-059 is T4's). Whether the opener may and each
 * reviewer may review is the caller's to have decided. Each reviewer is told (RR-H).
 */
export async function openRound(
  trx: TenantTransaction,
  input: {
    readonly document: string;
    readonly title: string;
    readonly scope: readonly string[];
    readonly dueAt: Date;
    readonly baseline: string | null;
    readonly reviewers: readonly string[];
    readonly by: string;
  },
): Promise<OpenAnswer> {
  let against: string;
  if (input.baseline !== null) {
    const baseline = await trx
      .selectFrom('baseline')
      .select(['document_id', 'document_version_id'])
      .where('id', '=', input.baseline)
      .executeTakeFirst();
    if (!baseline || baseline.document_id !== input.document) return { answer: 'baseline.missing' };
    against = baseline.document_version_id;
  } else {
    const latest = await latestVersion(trx, input.document);
    if (!latest || latest.kind !== 'document') return { answer: 'document.missing' };
    against = latest.id;
  }
  const version = await readVersion(trx, against);
  const read =
    version && readOutline(version.content, { artifact: input.document, version: against });
  if (!read || !read.ok) return { answer: 'document.missing' };
  const nodes = new Set<string>();
  walkOutline(read.outline.nodes, (node) => nodes.add(node.id));
  const unknown = input.scope.filter((each) => !nodes.has(each));
  if (unknown.length > 0) return { answer: 'scope.invalid', nodes: unknown };
  const reviewers = [...new Set(input.reviewers)];
  const people = new Set(
    reviewers.length === 0
      ? []
      : (
          await trx
            .selectFrom('principal')
            .select('id')
            .where('id', 'in', reviewers)
            .where('kind', '=', 'user')
            .execute()
        ).map((row) => row.id),
  );
  const refused = reviewers.filter((each) => !people.has(each));
  if (reviewers.length === 0 || reviewers.length > ROUND_REVIEWERS_MAX || refused.length > 0) {
    return { answer: 'reviewers.invalid', reviewers: refused };
  }
  const made = await trx
    .insertInto('review_round')
    .values({
      document_id: input.document,
      title: input.title.normalize('NFC').trim(),
      scope: [...new Set(input.scope)],
      due_at: input.dueAt,
      baseline_id: input.baseline,
      made_against: against,
      opened_by: input.by,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx
    .insertInto('review_round_reviewer')
    .values(reviewers.map((principal_id) => ({ round_id: made.id, principal_id })))
    .execute();
  await recordRoundEvent(trx, 'round.opened', made.id, {
    reviewers: reviewers.length,
    ...(input.baseline === null ? {} : { baseline: input.baseline }),
  });
  await tell(trx, {
    kind: 'round',
    actor: input.by,
    round: made.id,
    artifact: input.document,
    recipients: reviewers,
  });
  return { answer: 'opened', round: (await readRound(trx, made.id))! };
}

/** A round by its identifier, whole, or undefined where there is none. */
export async function readRound(
  trx: TenantTransaction,
  id: string,
): Promise<StoredRound | undefined> {
  const [round] = await roundsWhere(trx, { id });
  return round;
}

/** A document's rounds, newest first. */
export async function roundsOf(trx: TenantTransaction, document: string): Promise<StoredRound[]> {
  return roundsWhere(trx, { document });
}

async function roundsWhere(
  trx: TenantTransaction,
  where: { readonly id: string } | { readonly document: string },
): Promise<StoredRound[]> {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const asked = 'id' in where ? where.id : where.document;
  if (!UUID.test(asked)) return [];
  const rows = await trx
    .selectFrom('review_round')
    .selectAll()
    .where('id' in where ? 'id' : 'document_id', '=', asked)
    .orderBy('opened_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const reviewers = await trx
    .selectFrom('review_round_reviewer')
    .select(['round_id', 'principal_id'])
    .where('round_id', 'in', ids)
    .orderBy('principal_id')
    .execute();
  const events = await trx
    .selectFrom('review_round_event')
    .selectAll()
    .where('round_id', 'in', ids)
    .orderBy('id')
    .execute();
  return rows.map((row) => {
    const named = reviewers
      .filter((each) => each.round_id === row.id)
      .map((each) => each.principal_id);
    const own = events.filter((each) => each.round_id === row.id);
    const acts = own.flatMap((each) =>
      each.act === 'closed'
        ? []
        : [
            {
              reviewer: each.principal_id,
              act: each.act,
              ...(each.outcome === null ? {} : { outcome: each.outcome }),
              at: new Date(each.at).toISOString(),
              version: each.version_id,
            },
          ],
    );
    const closing = own.find((each) => each.act === 'closed');
    return {
      id: row.id,
      document: row.document_id,
      title: row.title,
      scope: row.scope,
      dueAt: new Date(row.due_at),
      baseline: row.baseline_id,
      madeAgainst: row.made_against,
      openedBy: row.opened_by,
      openedAt: new Date(row.opened_at),
      reviewers: named,
      acts,
      closed: closing === undefined ? null : { by: closing.principal_id, at: new Date(closing.at) },
      summary: roundSummary(named, acts),
    };
  });
}

export type ActAnswer =
  | { readonly answer: 'done'; readonly round: StoredRound }
  | { readonly answer: 'round.missing' }
  | { readonly answer: 'round.closed' }
  | { readonly answer: 'not.reviewer' }
  | { readonly answer: 'review.complete' }
  | { readonly answer: 'review.not_complete' };

/**
 * **A reviewer's act** (COL-029, COL-032, COL-057; RR-D, RR-F), under the round's lock and on an open
 * round alone: **Start**, once (again is answered as done); a completion, saying how, refused where they
 * are complete - reopen to change it - and recorded with the document's latest version (COL-050); a
 * reopening, of a completion alone. Whether the reviewer may still review is the caller's to decide.
 */
export async function actOnRound(
  trx: TenantTransaction,
  input: {
    readonly round: string;
    readonly reviewer: string;
    readonly act: 'started' | 'completed' | 'reopened';
    readonly outcome?: 'commented' | 'nothing_to_say';
  },
): Promise<ActAnswer> {
  await lockRound(trx, input.round);
  const round = await readRound(trx, input.round);
  if (!round) return { answer: 'round.missing' };
  if (round.closed !== null) return { answer: 'round.closed' };
  if (!round.reviewers.includes(input.reviewer)) return { answer: 'not.reviewer' };
  const state = round.summary.reviewers.find((each) => each.reviewer === input.reviewer)!.state;
  if (input.act === 'started' && state !== 'not_started') return { answer: 'done', round };
  if (input.act === 'completed' && state === 'complete') return { answer: 'review.complete' };
  if (input.act === 'reopened' && state !== 'complete') return { answer: 'review.not_complete' };
  const version =
    input.act === 'completed' ? ((await latestVersion(trx, round.document))?.id ?? null) : null;
  await trx
    .insertInto('review_round_event')
    .values({
      round_id: input.round,
      act: input.act,
      principal_id: input.reviewer,
      outcome: input.act === 'completed' ? (input.outcome ?? 'commented') : null,
      version_id: version,
    })
    .execute();
  if (input.act === 'completed') {
    await recordRoundEvent(trx, 'review.completed', input.round, {
      outcome: input.outcome ?? 'commented',
    });
  } else if (input.act === 'reopened') {
    await recordRoundEvent(trx, 'review.reopened', input.round, {});
  }
  return { answer: 'done', round: (await readRound(trx, input.round))! };
}

/** **Closes a round** (RR-C, RR-F): once, under its lock; a second closing answers the first. */
export async function closeRound(
  trx: TenantTransaction,
  input: { readonly round: string; readonly by: string },
): Promise<
  { readonly answer: 'closed'; readonly round: StoredRound } | { readonly answer: 'round.missing' }
> {
  await lockRound(trx, input.round);
  const round = await readRound(trx, input.round);
  if (!round) return { answer: 'round.missing' };
  if (round.closed !== null) return { answer: 'closed', round };
  await trx
    .insertInto('review_round_event')
    .values({
      round_id: input.round,
      act: 'closed',
      principal_id: input.by,
      outcome: null,
      version_id: null,
    })
    .execute();
  await recordRoundEvent(trx, 'round.closed', input.round, {});
  return { answer: 'closed', round: (await readRound(trx, input.round))! };
}
