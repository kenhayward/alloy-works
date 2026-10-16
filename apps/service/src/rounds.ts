import type {
  CompleteReviewBody,
  OpenRoundBody,
  RoundList,
  RoundParams,
  RoundView,
} from '@alloy-works/api-contract';
import {
  personView,
  actOnRound,
  closeRound,
  loadFacts,
  openRound,
  readRound,
  readVersion,
  resolveOccurrences,
  roundsOf,
  type ActAnswer,
  type StoredRound,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, readOutline } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refused } from './wire-codes.js';

/** Whether a person may review a document now: comment or suggest on it (IAM-081's test; RR-C). */
async function mayReview(
  trx: TenantTransaction,
  principal: string,
  document: string,
): Promise<boolean> {
  const facts = await loadFacts(trx, principal, { kind: 'artifact', id: document });
  return (
    facts !== undefined && (decide('comment', facts).allowed || decide('suggest', facts).allowed)
  );
}

/**
 * The components a round covers, by the version it opened on (RR-B): each a reference node in its
 * scope, or beneath one; every reference where the scope is the whole document.
 */
async function coveredNodes(
  trx: TenantTransaction,
  document: string,
  version: string,
  scope: readonly string[],
) {
  const stored = await readVersion(trx, version);
  const read = stored && readOutline(stored.content, { artifact: document, version });
  if (!read || !read.ok) return undefined;
  const covered = new Set<string>();
  const within = (nodes: readonly (typeof read.outline.nodes)[number][], inScope: boolean) => {
    for (const node of nodes) {
      const here = inScope || scope.length === 0 || scope.includes(node.id);
      if (here) covered.add(node.id);
      within(node.children, here);
    }
  };
  within(read.outline.nodes, false);
  return { outline: read.outline, covered };
}

/** Whether a person may read every component the round covers (RR-B), at the version it opens on. */
async function readsAllCovered(
  trx: TenantTransaction,
  principal: string,
  covered: NonNullable<Awaited<ReturnType<typeof coveredNodes>>>,
): Promise<boolean> {
  const outcomes = await resolveOccurrences(trx, covered.outline, principal);
  return outcomes.every((each) => !covered.covered.has(each.node) || each.outcome === 'resolved');
}

/**
 * **A round as its reader sees it** (RR-D, RR-E): each reviewer by state, whether they may still
 * review, and the threads and suggestions they made on the document since it opened that the reader
 * may read; whether everybody has reviewed; and what the reader may do.
 */
async function viewOf(
  trx: TenantTransaction,
  round: StoredRound,
  reader: string,
  mayEdit: boolean,
): Promise<RoundView> {
  const people = [
    ...new Set([...round.reviewers, round.openedBy, ...(round.closed ? [round.closed.by] : [])]),
  ];
  const names = new Map(
    (
      await trx
        .selectFrom('principal')
        .select(['id', 'display_name', 'kind'])
        .where('id', 'in', people)
        .execute()
    ).map((row) => [row.id, row] as const),
  );
  const who = (id: string) =>
    personView(id, names.get(id)?.display_name ?? null, names.get(id)?.kind ?? null);
  // What the reviewers' feedback is counted on (RR-D; the RR final review, 5): the document and each
  // component the round covers, at the version it opened on, that the reader may read now.
  const covered = await coveredNodes(trx, round.document, round.madeAgainst, round.scope);
  const readable = new Set<string>([round.document]);
  if (covered !== undefined) {
    for (const each of await resolveOccurrences(trx, covered.outline, reader)) {
      if (each.outcome === 'resolved' && covered.covered.has(each.node)) {
        readable.add(each.component);
      }
    }
  }
  const on = [...readable];
  const until = round.closed?.at ?? new Date('9999-12-31T00:00:00.000Z');
  const threads = await trx
    .selectFrom('thread')
    .select(['created_by'])
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('on_id', 'in', on)
    .where('created_by', 'in', round.reviewers)
    .where('created_at', '>=', round.openedAt)
    .where('created_at', '<=', until)
    .groupBy('created_by')
    .execute();
  const suggestions = await trx
    .selectFrom('suggestion')
    .select(['made_by'])
    .select((eb) => eb.fn.countAll<string>().as('count'))
    .where('component_id', 'in', on)
    .where('made_by', 'in', round.reviewers)
    .where('made_at', '>=', round.openedAt)
    .where('made_at', '<=', until)
    .groupBy('made_by')
    .execute();
  const counted = (rows: readonly { readonly count: string }[], pick: (row: never) => string) =>
    new Map(rows.map((row) => [pick(row as never), Number(row.count)]));
  const threadCounts = counted(threads, (row: { created_by: string }) => row.created_by);
  const suggestionCounts = counted(suggestions, (row: { made_by: string }) => row.made_by);
  const reviewers: RoundView['reviewers'] = [];
  for (const each of round.summary.reviewers) {
    reviewers.push({
      person: who(each.reviewer),
      state: each.state,
      ...(each.state === 'complete' ? { outcome: each.outcome, at: each.at } : {}),
      mayReview: await mayReview(trx, each.reviewer, round.document),
      threads: threadCounts.get(each.reviewer) ?? 0,
      suggestions: suggestionCounts.get(each.reviewer) ?? 0,
    });
  }
  return {
    id: round.id,
    document: round.document,
    title: round.title,
    scope: [...round.scope],
    dueAt: round.dueAt.toISOString(),
    baseline: round.baseline,
    madeAgainst: round.madeAgainst,
    openedBy: who(round.openedBy),
    openedAt: round.openedAt.toISOString(),
    closed:
      round.closed === null
        ? null
        : { by: who(round.closed.by), at: round.closed.at.toISOString() },
    reviewers,
    complete: round.summary.complete,
    of: round.summary.of,
    everybody: round.summary.everybody,
    mayClose: mayEdit && round.closed === null,
    reviewing:
      round.closed === null &&
      reviewers.some((each) => each.person.id === reader && each.mayReview),
  };
}

const mayEditOn = (authorised: Authorised) => decide('edit', authorised.facts).allowed;

/** A reviewer's act refused, in the wire's words; one not reviewing is not found (RR-C). */
function actRefused(answer: Exclude<ActAnswer, { answer: 'done' }>): never {
  switch (answer.answer) {
    case 'round.missing':
    case 'not.reviewer':
      throw notFound();
    case 'round.closed':
      throw refused(409, 'round.closed', 'The round is closed, and takes nothing more.');
    case 'review.complete':
      throw refused(
        409,
        'review.complete',
        'You have completed your review already. Reopen it to change how.',
      );
    case 'review.not_complete':
      throw refused(409, 'review.not_complete', 'You have not completed your review.');
  }
}

/**
 * Review rounds (collaboration.md, Review rounds; the RR plan, Task 2): each route decided by
 * `authorise` on the round's document. A reviewer acts only while they may review it (RR-C).
 */
export function roundHandlers() {
  const act =
    (what: 'started' | 'completed' | 'reopened') =>
    async (request: FastifyRequest, authorised: Authorised): Promise<RoundView> => {
      const { trx, principalId } = authorised;
      const { id } = request.params as RoundParams;
      const round = await readRound(trx, id);
      if (!round || !(await mayReview(trx, principalId, round.document))) throw notFound();
      const body = request.body as CompleteReviewBody | undefined;
      const answer = await actOnRound(trx, {
        round: id,
        reviewer: principalId,
        act: what,
        ...(what === 'completed' && body !== undefined ? { outcome: body.outcome } : {}),
      });
      if (answer.answer !== 'done') actRefused(answer);
      return viewOf(trx, answer.round, principalId, mayEditOn(authorised));
    };

  return {
    openRound: async (request: FastifyRequest, authorised: Authorised): Promise<RoundView> => {
      const { trx, principalId } = authorised;
      const { id } = request.params as { id: string };
      const body = request.body as OpenRoundBody;
      const dueAt = new Date(body.dueAt);
      if (!(dueAt.getTime() > Date.now())) {
        throw refused(400, 'round.due_invalid', 'A round is due after now.');
      }
      const answer = await openRound(trx, {
        document: id,
        title: body.title,
        scope: body.scope ?? [],
        dueAt,
        baseline: body.baseline ?? null,
        reviewers: body.reviewers,
        by: principalId,
        // Each reviewer may review it and read all it covers, at the version it opens on (RR-B),
        // decided before anything is recorded or anybody told (the RR final review, 7).
        unable: async (madeAgainst, scope) => {
          const covered = await coveredNodes(trx, id, madeAgainst, scope);
          let count = 0;
          for (const reviewer of new Set(body.reviewers)) {
            const may =
              covered !== undefined &&
              (await mayReview(trx, reviewer, id)) &&
              (await readsAllCovered(trx, reviewer, covered));
            if (!may) count += 1;
          }
          return count;
        },
      });
      if (answer.answer === 'document.missing') throw notFound();
      if (answer.answer === 'baseline.missing') {
        throw refused(400, 'round.baseline_missing', 'No such baseline of this document.');
      }
      if (answer.answer === 'scope.invalid') {
        throw refused(400, 'round.scope_invalid', 'The document has no such section.', {
          nodes: [...answer.nodes],
        });
      }
      const refusedReviewers = (count: number) =>
        refused(
          400,
          'round.reviewers_invalid',
          `${count} of those named may not review this: a reviewer is a person who may comment on or suggest to the document, and read all it covers.`,
          { count },
        );
      if (answer.answer === 'reviewers.invalid') {
        throw refusedReviewers(Math.max(answer.reviewers.length, 1));
      }
      if (answer.answer === 'reviewers.unable') throw refusedReviewers(answer.count);
      return viewOf(trx, answer.round, principalId, mayEditOn(authorised));
    },

    listRounds: async (request: FastifyRequest, authorised: Authorised): Promise<RoundList> => {
      const { trx, principalId } = authorised;
      const { id } = request.params as { id: string };
      const rounds = await roundsOf(trx, id);
      const views: RoundView[] = [];
      for (const round of rounds) {
        views.push(await viewOf(trx, round, principalId, mayEditOn(authorised)));
      }
      return { rounds: views };
    },

    getRound: async (request: FastifyRequest, authorised: Authorised): Promise<RoundView> => {
      const { trx, principalId } = authorised;
      const round = await readRound(trx, (request.params as RoundParams).id);
      if (!round) throw notFound();
      return viewOf(trx, round, principalId, mayEditOn(authorised));
    },

    closeRound: async (request: FastifyRequest, authorised: Authorised): Promise<RoundView> => {
      const { trx, principalId } = authorised;
      const answer = await closeRound(trx, {
        round: (request.params as RoundParams).id,
        by: principalId,
      });
      if (answer.answer !== 'closed') throw notFound();
      return viewOf(trx, answer.round, principalId, mayEditOn(authorised));
    },

    startReview: act('started'),
    completeReview: act('completed'),
    reopenReview: act('reopened'),
  };
}
