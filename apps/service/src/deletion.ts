import type {
  DeletedList,
  DeletedListQuery,
  DeletedView,
  DeletionParams,
  DeletionRefusalView,
  DeletionView,
} from '@alloy-works/api-contract';
import {
  deleteArtifact,
  deletionOf,
  listDeleted,
  loadFactsFor,
  undeleteArtifact,
  type DeletionRefusal,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide } from '@alloy-works/domain';
import type { FastifyRequest } from 'fastify';
import { notFound, scopesOf, type Authorised } from './access.js';
import { cursorFor, pageAsked } from './listing.js';
import type { SessionPrincipal } from './sessions.js';
import { refused } from './wire-codes.js';
import { languageOf } from './listing.js';

/** A refusal as the wire lists it. */
function refusalView(refusal: DeletionRefusal): DeletionRefusalView {
  switch (refusal.reason) {
    case 'held':
      return { code: 'held' };
    case 'kept':
      return { code: 'kept', until: refusal.until.toISOString() };
    case 'locked':
      return { code: 'locked', holder: { ...refusal.holder }, yours: refusal.yours };
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

/**
 * The Deleted listing (the DL plan, DL-H): the deleted the caller may read but for the tombstone,
 * filtered by the readable set inside its query, each saying whether the caller may undelete it -
 * `retire` decided per row from one read of the facts, masked by the request's token.
 */
export function deletedListingHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    listDeleted: async (request: FastifyRequest): Promise<DeletedList> => {
      const query = request.query as DeletedListQuery;
      const asked = pageAsked('deleted', query, languageOf(request));
      const principal = principalOf(request).principalId;
      const scopes = scopesOf(request);
      return db.withTenant(tenantOf(request), async (trx) => {
        const page = await listDeleted(
          trx,
          principal,
          asked,
          query.kind === undefined ? {} : { kind: query.kind },
        );
        if (!page) throw new Error('A signed-in principal is not in its own tenant');
        const facts = await loadFactsFor(
          trx,
          principal,
          page.items.map((each) => each.id),
        );
        const mayRetire = (id: string) => {
          const known = facts.get(id);
          return (
            known !== undefined &&
            decide('retire', { ...known, ...(scopes === undefined ? {} : { scopes }) }).allowed
          );
        };
        return {
          items: page.items.map((item) => ({
            id: item.id,
            kind: item.kind,
            title: item.title,
            space: { ...item.space },
            deletedBy: { ...item.deletedBy },
            deletedAt: item.deletedAt.toISOString(),
            mayUndelete: mayRetire(item.id),
          })),
          next: cursorFor(
            'deleted',
            asked.sort,
            asked.order,
            page.snapshot,
            page.next,
            asked.language,
          ),
          total: page.total,
        };
      });
    },
  };
}
