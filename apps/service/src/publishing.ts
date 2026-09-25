import type {
  DocumentParams,
  PublicationList,
  PublicationParams,
  PublicationRequestParams,
  PublicationRequestView,
  PublicationSummary as PublicationSummaryView,
  PublicationView,
  RequestPublicationBody,
} from '@alloy-works/api-contract';
import {
  listPublications,
  listReadablePublications,
  readDocument,
  readPublication,
  readPublicationRequest,
  requestPublication,
  type PublicationSummary,
  type StoredPublicationRequest,
  type Tenant,
  type TenantDatabase,
} from '@alloy-works/db';
import type { ObjectStores } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { notFound, type Authorised } from './access.js';
import { AppError, storageUnavailable } from './errors.js';
import type { SessionPrincipal } from './sessions.js';
import { wireCode } from './wire-codes.js';

/** Five minutes: long enough to follow a link, short enough that a copy is worth little. */
export const DOWNLOAD_SECONDS = 300;

/** A request as the API shows it, copied, because the store's answers are read-only. */
const requestView = (request: StoredPublicationRequest): PublicationRequestView => ({
  id: request.id,
  document: request.documentId,
  state: request.state,
  failures: request.failures.map((each) => ({ ...each })),
  publication: request.publication,
});

/** A publication as a listing shows it, copied for the same reason. */
const summaryView = (publication: PublicationSummary): PublicationSummaryView => ({
  id: publication.id,
  document: publication.documentId,
  version: { ...publication.documentVersion },
  title: publication.title,
  publisher: { ...publication.publisher },
  publishedAt: publication.publishedAt.toISOString(),
  approval: publication.approval,
  formats: [...publication.formats],
});

/**
 * Publishing a document, following the request, and reading what was published
 * (docs/design/publishing.md, "Routes"). Nothing here is put on the stream: a request is followed by
 * its requester through `GET /v1/publication-requests/{id}`, so no event about a document reaches a
 * viewer who may not read it (issue #147, decision G).
 */
export function publishingHandlers(
  db: TenantDatabase,
  tenantOf: (request: FastifyRequest) => Tenant,
  principalOf: (request: FastifyRequest) => SessionPrincipal,
  objects: ObjectStores | undefined,
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
          // The contract refuses an empty or repeated formats list at the door (PUB-014); the store's
          // own defence against a caller that skips the contract answers `formats: []`, which would
          // read as nonsense joined into a sentence.
          if (answer.formats.length === 0) {
            throw new Error(
              'A format refusal named no format: the contract should have refused it',
            );
          }
          throw new AppError(
            400,
            wireCode('format.unsupported'),
            `The layout this document is published under does not make ${answer.formats.join(', ')}.`,
          );
        // Nothing of where it cites a page: the requester is told what to add, which answers it.
        case 'page_reference.without_pdf':
          throw new AppError(
            400,
            wireCode('page_reference.without_pdf'),
            'This document refers to a page, and only the PDF has the pages it refers to. Publish it as a PDF as well.',
          );
        case 'layout.language':
          throw new AppError(
            400,
            wireCode('layout.language'),
            `This document is in ${answer.document}, and its layout is written in ${answer.layout}. It can be published only under a layout in its own language.`,
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

    /**
     * `read` was decided on the document; each publication is then listed only where it may be read
     * itself, in the query (decision D). A component's or a publication's id authorises cleanly -
     * `authorise` never looks at the kind - and is then no document, answered as none (finding 16).
     */
    listPublications: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<PublicationList> => {
      const { id } = request.params as DocumentParams;
      if (!(await readDocument(trx, id))) throw notFound();
      const listed = await listPublications(trx, id, principalId);
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return { items: listed.map(summaryView) };
    },

    /** Every publication the caller may read, of every document (interface slice 10). */
    listPublicationsEverywhere: async (request: FastifyRequest): Promise<PublicationList> => {
      const listed = await db.withTenant(tenantOf(request), (trx) =>
        listReadablePublications(trx, principalOf(request).principalId),
      );
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return { items: listed.map(summaryView) };
    },

    /**
     * `read` was decided on the publication artifact itself, so a grant on its document reaches none
     * of it (decision D). A document's or a component's id authorises, and is then no publication. Each
     * output's link is signed for five minutes and saves the bytes as `{id}.pdf` or `{id}.docx`: never
     * the title, because the link's query string reaches the store's logs. Each is served as the type
     * its bytes were kept as, its format's (`OUTPUT_CONTENT_TYPES`). Only the PDF has a link that shows
     * it in place: a browser saves a Word document whatever the link says.
     */
    getPublication: async (
      request: FastifyRequest,
      { trx }: Authorised,
    ): Promise<PublicationView> => {
      const { id } = request.params as PublicationParams;
      const publication = await readPublication(trx, id);
      if (!publication) throw notFound();
      if (!objects) throw storageUnavailable();
      const store = await objects.forTenant(trx, tenantOf(request));
      return {
        ...summaryView(publication),
        engine: publication.engine && { ...publication.engine },
        template: publication.template && { ...publication.template },
        pipeline: publication.pipelineVersion,
        outputs: await Promise.all(
          publication.outputs.map(async (output) => {
            const common = {
              bytes: output.bytes,
              sha256: output.sha256,
              producerVersion: output.producerVersion,
              download: await store.signedLink(
                output.key,
                DOWNLOAD_SECONDS,
                `${publication.id}.${output.format}`,
              ),
            };
            return output.format === 'pdf'
              ? {
                  ...common,
                  format: 'pdf' as const,
                  standard: 'ua-1' as const,
                  producer: 'typst' as const,
                  report: [] as [],
                  // Signed with no name, and so no `attachment`: stored as application/pdf, the
                  // bytes open in the browser's own viewer, which is how the publication page shows
                  // them.
                  view: await store.signedLink(output.key, DOWNLOAD_SECONDS),
                }
              : {
                  ...common,
                  format: 'docx' as const,
                  standard: null,
                  producer: 'word' as const,
                  report: output.report.map((entry) => ({ ...entry })),
                  view: null,
                };
          }),
        ),
      };
    },
  };
}
