import type {
  MoveAnswer,
  MoveBody,
  MoveParams,
  MovePreviewAnswer,
} from '@alloy-works/api-contract';
import {
  loadFacts,
  moveToSpace,
  previewMove,
  type MoveSkip,
  type SpaceMoveRefusal,
  type TenantTransaction,
} from '@alloy-works/db';
import { administerOrAbove, decide, type Level } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { callerOf, forbidden, hiddenBy, notFound, refusedBy, type Authorised } from './access.js';
import { refused } from './wire-codes.js';

/**
 * Whether the caller may move into this space (MV-C): `create` or `administer` there, because no
 * starter role holds both. By `loadFacts`, not `authoriseAt`: this route holds the epoch for a change,
 * and `authoriseAt` would declare its transaction deciding-only.
 */
async function decideTarget(
  trx: TenantTransaction,
  request: FastifyRequest,
  to: string,
): Promise<void> {
  const caller = callerOf(request);
  const target: Level = { kind: 'space', id: to };
  const loaded = await loadFacts(trx, caller.principalId, target);
  if (!loaded) throw notFound();
  const facts = { ...loaded, scopes: caller.scopes };
  const creating = decide('create', facts);
  if (creating.allowed || administerOrAbove(facts).allowed) return;
  if (!decide('read', facts).allowed) throw hiddenBy(facts, target);
  throw refusedBy(forbidden('create'), creating, facts, target, false);
}

function refusal(answer: SpaceMoveRefusal): Error {
  switch (answer.answer) {
    case 'artifact.missing':
      return notFound();
    case 'artifact.archived':
      return refused(
        409,
        'artifact.archived',
        'It is archived, and does not move until unarchived.',
      );
    case 'artifact.not_movable':
      return refused(409, 'artifact.not_movable', 'This does not move by itself.');
    case 'asset.uploading':
      return refused(409, 'asset.uploading', 'A replacement for this image is on its way.');
    case 'space.moved':
      return refused(409, 'space.moved', 'It is no longer in the space you read it in.');
    case 'space.archived':
      return refused(409, 'space.archived', 'That space is archived.');
    case 'held':
      return refused(409, 'artifact.held', 'A hold stops this moving.');
    case 'kept':
      return refused(409, 'artifact.kept', 'A retention keep stops this moving.', {
        until: answer.until.toISOString(),
      });
    case 'move.too_large':
      return refused(409, 'move.too_large', 'This is too much to move at once.');
  }
}

/** The handlers that move content between spaces (moving.md), `administer` on it already decided. */
export function movingHandlers() {
  return {
    moveToSpace: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<MoveAnswer> => {
      const { id } = request.params as MoveParams;
      const { from, to, also } = request.body as MoveBody;
      await decideTarget(trx, request, to);
      const answer = await moveToSpace(trx, {
        artifactId: id,
        from,
        to,
        by: principalId,
        scopes: facts.scopes,
        also,
      });
      if (answer.answer === 'unchanged') return { changed: false, ...NOTHING };
      if (answer.answer !== 'changed') throw refusal(answer);
      return { changed: true, ...counted(answer) };
    },

    previewMoveToSpace: async (
      request: FastifyRequest,
      { trx, principalId, facts }: Authorised,
    ): Promise<MovePreviewAnswer> => {
      const { id } = request.params as MoveParams;
      const { from, to, also } = request.body as MoveBody;
      await decideTarget(trx, request, to);
      const answer = await previewMove(trx, {
        artifactId: id,
        from,
        to,
        by: principalId,
        scopes: facts.scopes,
        also,
      });
      if (answer.answer === 'unchanged') {
        return { changed: false, ...NOTHING, consequences: NO_CONSEQUENCES };
      }
      if (answer.answer !== 'previewed') throw refusal(answer);
      return { changed: true, ...counted(answer), consequences: answer.consequences };
    },
  };
}

const counted = (answer: {
  readonly moved: readonly string[];
  readonly skipped: readonly MoveSkip[];
  readonly grantsEnded: number;
  readonly sharesKept: number;
}) => ({
  moved: [...answer.moved],
  skipped: [...answer.skipped],
  grantsEnded: answer.grantsEnded,
  sharesKept: answer.sharesKept,
});

const NOTHING = { moved: [], skipped: [], grantsEnded: 0, sharesKept: 0 };
const NO_CONSEQUENCES = {
  citations: 0,
  terms: 0,
  imagesStaying: 0,
  bound: 0,
  usingTemplate: 0,
  openRounds: 0,
  delivered: 0,
};
