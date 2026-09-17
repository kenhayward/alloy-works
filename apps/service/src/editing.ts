import type {
  ClaimBody,
  ComponentParams,
  CutAnswer,
  CutBody,
  IterationBody,
  IterationParams,
  ReleaseQuery,
} from '@alloy-works/api-contract';
import {
  claimLock,
  cutVersion,
  latestVersion,
  releaseLock,
  saveIteration,
  type HolderRefusal,
  type StoredVersion,
} from '@alloy-works/db';
import { parseContentDocument, type ContentDocument } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { lockView, versionView } from './components.js';
import { AppError } from './errors.js';
import { wireCode } from './wire-codes.js';

/** Every refusal a session's write can meet from the store. */
type Refusal =
  | HolderRefusal
  | { readonly answer: 'version.precondition'; readonly current: StoredVersion }
  | { readonly answer: 'iteration.stale' | 'iteration.conflict'; readonly latest: number }
  | { readonly answer: 'artifact.missing' };

/**
 * A refusal in the one error shape, with its members (component-editor.md, "The API"). Three refusals
 * stay apart: an unreadable component is 404 and an author without `edit` is 403, both decided before a
 * handler runs; a component somebody else holds is `lock_held`, which names them and when they are
 * expected to release it, and says nothing about permission (API-039). Every code crossing here is put
 * through `wireCode`: the store answers dotted, the wire spells it with an underscore (decision F).
 */
function refuse(refusal: Refusal): AppError {
  switch (refusal.answer) {
    case 'lock.held':
      return new AppError(
        409,
        wireCode('lock.held'),
        'This component is being edited in another session.',
        undefined,
        {
          holder: { id: refusal.lock.holder, name: refusal.lock.holderName },
          expectedRelease: refusal.lock.expiresAt.toISOString(),
        },
      );
    case 'lock.required':
      return new AppError(
        409,
        wireCode('lock.required'),
        'This session does not hold the lock on this component.',
      );
    case 'version.precondition':
      return new AppError(
        409,
        wireCode('version.precondition'),
        'This component has a newer version than the one this session opened.',
        undefined,
        { current: versionView(refusal.current) },
      );
    case 'iteration.stale':
      return new AppError(
        409,
        wireCode('iteration.stale'),
        'A later save from this session has already been accepted.',
        undefined,
        { latest: refusal.latest },
      );
    case 'iteration.conflict':
      return new AppError(
        409,
        wireCode('iteration.conflict'),
        'This save repeats an accepted one with different content.',
        undefined,
        { latest: refusal.latest },
      );
    case 'artifact.missing':
      return notFound();
  }
}

/**
 * The handlers for writing in an editing session. Each runs in the transaction `edit` was decided in.
 * None changes a fact a decision reads - a lock, an iteration and a version are not grants, roles,
 * memberships, a principal's kind or an artifact's space - so none takes the access epoch for update,
 * and the shared lock the decision took first is never upgraded (the editor plan's decision 4).
 */
export function editingHandlers() {
  return {
    claimLock: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const { id } = request.params as ComponentParams;
      const body = request.body as ClaimBody;
      const answer = await claimLock(trx, {
        artifactId: id,
        principal: principalId,
        session: body.session,
        ...(body.move === undefined ? {} : { move: body.move }),
      });
      if (answer.answer !== 'claimed') throw refuse(answer);
      return { lock: lockView(answer.lock, principalId) };
    },

    saveIteration: async (request: FastifyRequest, { trx, principalId }: Authorised) => {
      const params = request.params as IterationParams;
      const body = request.body as IterationBody;
      let content: ContentDocument;
      try {
        content = parseContentDocument(body.content);
      } catch {
        // A fixed message: what failed to parse is the author's content, and never goes back as prose.
        throw new AppError(
          400,
          wireCode('content.invalid'),
          'The content is not a document this product can store.',
        );
      }
      const answer = await saveIteration(trx, {
        artifactId: params.id,
        principal: principalId,
        session: params.session,
        sequence: Number(params.sequence),
        openedFrom: body.openedFrom,
        content,
      });
      if (answer.answer !== 'accepted') throw refuse(answer);
      return { sequence: answer.sequence, lock: lockView(answer.lock, principalId) };
    },

    cutVersion: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<CutAnswer> => {
      const { id } = request.params as ComponentParams;
      const body = request.body as CutBody;
      const answer = await cutVersion(trx, {
        artifactId: id,
        principal: principalId,
        session: body.session,
        openedFrom: body.openedFrom,
        ...(body.note === undefined ? {} : { note: body.note }),
      });
      if (answer.answer === 'recorded') {
        return { outcome: 'cut', version: versionView(answer.version) };
      }
      if (answer.answer === 'version.unchanged') {
        return { outcome: 'unchanged', version: versionView(answer.current) };
      }
      throw refuse(answer);
    },

    releaseLock: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<CutAnswer> => {
      const { id } = request.params as ComponentParams;
      const query = request.query as ReleaseQuery;
      const answer = await releaseLock(trx, {
        artifactId: id,
        principal: principalId,
        session: query.session,
        openedFrom: query.openedFrom,
      });
      if (answer.answer !== 'released') throw refuse(answer);
      if (answer.version) return { outcome: 'cut', version: versionView(answer.version) };
      const current = await latestVersion(trx, id);
      if (!current) throw notFound();
      return { outcome: 'unchanged', version: versionView(current) };
    },
  };
}
