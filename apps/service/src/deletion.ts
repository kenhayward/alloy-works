import type {
  DeletedView,
  DeletionParams,
  DeletionRefusalView,
  DeletionView,
} from '@alloy-works/api-contract';
import {
  deleteArtifact,
  deletionOf,
  undeleteArtifact,
  type DeletionRefusal,
  type TenantTransaction,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { refused } from './wire-codes.js';

/** A refusal as the wire lists it. */
function refusalView(refusal: DeletionRefusal): DeletionRefusalView {
  switch (refusal.reason) {
    case 'held':
      return { code: 'held' };
    case 'locked':
      return { code: 'locked', holder: { ...refusal.holder } };
    default:
      return {
        code: refusal.reason,
        named: refusal.named.map((each) => ({ ...each })),
        unreadable: refusal.unreadable,
      };
  }
}

/**
 * Deleting, undeleting and what remains (lifecycle.md; the DL plan, Task 1), each decided on
 * `retire`. Each route its own kind: anything else at its address is absent. Undelete and what
 * remains reach a deleted one (`readsDeleted`); deleting the deleted is answered 410 by `authorise`.
 */
export function deletionHandlers() {
  const ofKind = async (trx: TenantTransaction, request: FastifyRequest, kind: string) => {
    const { id } = request.params as DeletionParams;
    const row = await trx
      .selectFrom('artifact')
      .select('kind')
      .where('id', '=', id)
      .executeTakeFirst();
    if (row?.kind !== kind) throw notFound();
    return id;
  };
  const remains =
    (kind: 'component' | 'document') =>
    async (request: FastifyRequest, { trx, principalId }: Authorised): Promise<DeletionView> => {
      const id = await ofKind(trx, request, kind);
      const state = await deletionOf(trx, id, principalId);
      if (!state) throw notFound();
      return {
        kind: state.kind,
        deleted: state.deleted,
        remains: { ...state.remains },
        refusals: state.refusals.map(refusalView),
      };
    };
  const deleting =
    (kind: 'component' | 'document') =>
    async (request: FastifyRequest, { trx, principalId }: Authorised): Promise<DeletedView> => {
      const id = await ofKind(trx, request, kind);
      const answer = await deleteArtifact(trx, id, principalId);
      if (!answer) throw notFound();
      if (answer.answer === 'refused') {
        throw refused(409, 'deletion.refused', `This ${kind} cannot be deleted while it is used.`, {
          refusals: answer.refusals.map(refusalView),
        });
      }
      return { deleted: true };
    };
  const undeleting =
    (kind: 'component' | 'document') =>
    async (request: FastifyRequest, { trx, principalId }: Authorised): Promise<DeletedView> => {
      const id = await ofKind(trx, request, kind);
      if (!(await undeleteArtifact(trx, id, principalId))) throw notFound();
      return { deleted: false };
    };
  return {
    getComponentDeletion: remains('component'),
    deleteComponent: deleting('component'),
    undeleteComponent: undeleting('component'),
    getDocumentDeletion: remains('document'),
    deleteDocument: deleting('document'),
    undeleteDocument: undeleting('document'),
  };
}
