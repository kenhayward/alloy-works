import type {
  DocumentParams,
  PublicationRequestParams,
  PublicationRequestView,
  RequestPublicationBody,
} from '@alloy-works/api-contract';
import {
  readPublicationRequest,
  requestPublication,
  type StoredPublicationRequest,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { AppError } from './errors.js';
import type { SessionPrincipal } from './sessions.js';
import { wireCode } from './wire-codes.js';

/** A request as the API shows it, copied, because the store's answers are read-only. */
const requestView = (request: StoredPublicationRequest): PublicationRequestView => ({
  id: request.id,
  document: request.documentId,
  state: request.state,
  failures: request.failures.map((each) => ({ ...each })),
  publication: request.publication,
});

/**
 * Publishing a document, and following the request (docs/design/publishing.md, "Routes"). Nothing here
 * is put on the stream: a request is followed by its requester through
 * `GET /v1/publication-requests/{id}`, so no event about a document reaches a viewer who may not read
 * it (issue #147, decision G).
 */
export function publishingHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
) {
  return {
    /**
     * `publish` was decided on the document by `authorise`, in `trx`, under the access epoch's shared
     * lock - and everything else is decided and recorded here, **in that same transaction**: every
     * occurrence resolved as this publisher, the request, and its job. So no grant can change between
     * the decision to let them publish and what their read resolved to (IAM-063). Never a
     * `db.withTenant` of its own here, which would decide the read in a later transaction than the
     * permission.
     */
    requestPublication: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<PublicationRequestView> => {
      const { id } = request.params as DocumentParams;
      const body = request.body as RequestPublicationBody;
      const answer = await requestPublication(trx, {
        documentId: id,
        version: body.version,
        formats: body.formats,
        requester: principalId,
      });
      switch (answer.answer) {
        // A component's id authorises cleanly - `authorise` never looks at the kind - and is then not
        // a document.
        case 'document.missing':
          throw notFound();
        // By its code alone: the current version's outline names components the caller may not read,
        // so it is never carried here (IAM-073), unlike the outline route's refusal.
        case 'version.precondition':
          throw new AppError(
            409,
            wireCode('version.precondition'),
            'This document has a newer version than the one this page opened.',
          );
        case 'format.unsupported':
          throw new AppError(
            400,
            wireCode('format.unsupported'),
            'This document can be published as PDF only.',
          );
        case 'requested': {
          const made = await readPublicationRequest(trx, answer.request.id);
          if (!made) throw new Error(`The request ${answer.request.id} was not recorded`);
          return requestView(made);
        }
      }
    },

    /**
     * The requester's alone: a failure's place is for the person who asked, and anybody else is
     * answered as if there were no such request - never 403, which would say one exists.
     */
    getPublicationRequest: async (request: FastifyRequest): Promise<PublicationRequestView> => {
      const { id } = request.params as PublicationRequestParams;
      const principal = principalOf(request);
      const found = await db.withTenant(tenantOf(request), (trx) =>
        readPublicationRequest(trx, id),
      );
      if (!found || found.requestedBy !== principal.principalId) throw notFound();
      return requestView(found);
    },
  };
}
