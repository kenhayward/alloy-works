import type {
  DocumentParams,
  PublicationList,
  PublicationListQuery,
  PublicationBindingList,
  PublicationParams,
  PublicationRequestParams,
  PublicationRequestView,
  PublicationSummary as PublicationSummaryView,
  PublicationView,
  RequestPreviewBody,
  RequestPublicationBody,
  SharedOutputFormat,
} from '@alloy-works/api-contract';
import { cursorFor, pageAsked } from './listing.js';
import {
  listPublications,
  listReadablePublications,
  loadFacts,
  readsOnlyShares,
  recordSharedAccess,
  supersession,
  publicationBindings,
  readDocument,
  readPublication,
  flaggedCited,
  placedBy,
  readPublicationRequest,
  requestPublication,
  type PublicationRequestAnswer,
  type PublishRefusal,
  type PublicationSummary,
  type StoredPublicationRequest,
  type Tenant,
  type TenantDatabase,
  type TenantTransaction,
} from '@alloy-works/db';
import { decide, readOutline, walkOutline } from '@alloy-works/domain';
import type { ObjectStores, TenantStore } from '@alloy-works/objects';
import type { FastifyRequest } from 'fastify';
import { authoriseAt, callerOf, notFound, scopesOf, type Authorised } from './access.js';
import { versionView } from './components.js';
import { definitionReader } from './data/bindings.js';
import { storageUnavailable } from './errors.js';
import type { SessionPrincipal } from './sessions.js';
import { refused } from './wire-codes.js';

/** Five minutes: long enough to follow a link, short enough that a copy is worth little. */
export const DOWNLOAD_SECONDS = 300;

/**
 * A request as the API shows it, copied, because the store's answers are read-only. A done preview
 * that has not expired, by this service's clock, carries two links to its PDF, each signed for
 * `DOWNLOAD_SECONDS` as a publication's are (PV-F): `view`, with no file name, which a browser shows
 * in place, and `download`, which saves it under the request's id - never the document's title, since
 * the link reaches the store's logs. Once it has expired it carries none, and needs no store: the
 * sweep will have removed the bytes, or soon will. `store` is asked for only where there are links
 * to sign.
 */
async function requestView(
  request: StoredPublicationRequest,
  store: () => Promise<TenantStore>,
  warnings: PublicationRequestView['warnings'] = [],
): Promise<PublicationRequestView> {
  const lasting =
    request.preview && request.preview.expiresAt.getTime() > Date.now() ? request.preview : null;
  let preview: PublicationRequestView['preview'] = null;
  if (lasting) {
    const kept = await store();
    preview = {
      view: await kept.signedLink(lasting.key, DOWNLOAD_SECONDS),
      download: await kept.signedLink(lasting.key, DOWNLOAD_SECONDS, `${request.id}-preview.pdf`),
      expiresAt: lasting.expiresAt.toISOString(),
    };
  }
  return {
    id: request.id,
    document: request.documentId,
    // A range's request is never answered here (`getPublicationRequest` refuses it), so a publish or
    // a preview.
    kind: request.kind === 'range' ? 'preview' : request.kind,
    state: request.state,
    failures: request.failures.map((each) => ({ ...each })),
    warnings,
    publication: request.publication,
    preview,
  };
}

/**
 * What does not stop a publish (XR-G): the retracted and corrected sources cited by what the document
 * places, counted, whoever may read them.
 */
async function sourceWarnings(
  trx: TenantTransaction,
  documentId: string,
): Promise<PublicationRequestView['warnings']> {
  const flagged = await flaggedCited(trx, await placedBy(trx, documentId));
  return (['retracted', 'corrected'] as const).flatMap((flag) => {
    const count = flagged.filter((each) => each.outcome === flag).length;
    return count === 0 ? [] : [{ code: `source_${flag}` as const, count }];
  });
}

/** No store is needed for a request just made: it is queued, so it has no PDF to link to. */
const noStore = (): Promise<TenantStore> => {
  throw new Error('A request just made has no preview to link to');
};

/** A publication as a listing shows it, copied for the same reason. */
const summaryView = (publication: PublicationSummary): PublicationSummaryView => ({
  id: publication.id,
  document: publication.documentId,
  version: { ...publication.documentVersion },
  title: publication.title,
  publisher: { ...publication.publisher },
  publishedAt: publication.publishedAt.toISOString(),
  approval: publication.approval,
  baseline: publication.baseline,
  formats: [...publication.formats],
});

/**
 * Publishing a document, following the request, and reading what was published
 * (docs/design/publishing.md, "Routes"). Nothing here is put on the stream: a request is followed by
 * its requester through `GET /v1/publication-requests/{id}`, so no event about a document reaches a
 * viewer who may not read it (issue #147, decision G).
 */
/** Each section of a document's latest outline by its title's words, to name one in a refusal. */
async function sectionTitles(
  trx: TenantTransaction,
  id: string,
): Promise<ReadonlyMap<string, string>> {
  const document = await readDocument(trx, id);
  const read =
    document &&
    readOutline(document.version.content, { artifact: id, version: document.version.id });
  const titles = new Map<string, string>();
  if (!read?.ok) return titles;
  walkOutline(read.outline.nodes, (node) => {
    if (node.type !== 'section') return;
    titles.set(
      node.id,
      node.title
        .map((inline) => (inline.type === 'text' ? inline.value : ''))
        .join('')
        .trim(),
    );
  });
  return titles;
}

/**
 * What a publish or a preview asked for is answered with (docs/design/publishing.md, "Routes"): the
 * request made, or its refusal in the words the document page shows. One mapping for both, since a
 * preview is refused exactly as a publish is (PUB-006, PV-B), in `trx`, the transaction its permission
 * was decided in.
 */
async function answered(
  trx: TenantTransaction,
  id: string,
  answer: PublicationRequestAnswer,
): Promise<PublicationRequestView> {
  if (answer.answer !== 'requested') return refusePublish(trx, id, answer);
  const made = await readPublicationRequest(trx, answer.request.id);
  if (!made) throw new Error(`The request ${answer.request.id} was not recorded`);
  return requestView(made, noStore, await sourceWarnings(trx, made.documentId));
}

/** A request just recorded, as its view: what a publish, a preview or a baseline's publish answers. */
export async function requestedView(
  trx: TenantTransaction,
  requestId: string,
): Promise<PublicationRequestView> {
  const made = await readPublicationRequest(trx, requestId);
  if (!made) throw new Error(`The request ${requestId} was not recorded`);
  return requestView(made, noStore, await sourceWarnings(trx, made.documentId));
}

/**
 * A refusal before anything is recorded, a publish's or a baseline's (BL-A), in the words the page
 * shows at the door.
 */
export async function refusePublish(
  trx: TenantTransaction,
  id: string,
  answer: PublishRefusal,
): Promise<never> {
  switch (answer.answer) {
    // A component's id authorises cleanly - `authorise` never looks at the kind - and is then not
    // a document.
    case 'document.missing':
      throw notFound();
    // Naming the current version (API-037) by its heading: its outline names components the
    // caller may not read, so it is never carried here (IAM-073), unlike the outline route's
    // refusal.
    case 'version.precondition':
      throw refused(
        409,
        'version.precondition',
        'This document has a newer version than the one this page opened.',
        { current: versionView(answer.current) },
      );
    case 'format.unsupported':
      // The contract refuses an empty or repeated formats list at the door (PUB-014); the store's
      // own defence against a caller that skips the contract answers `formats: []`, which would
      // read as nonsense joined into a sentence.
      if (answer.formats.length === 0) {
        throw new Error('A format refusal named no format: the contract should have refused it');
      }
      throw refused(
        400,
        'format.unsupported',
        `The layout this document is published under does not make ${answer.formats.join(', ')}.`,
      );
    // Nothing of where it cites a page: the requester is told what to add, which answers it.
    case 'page_reference.without_pdf':
      throw refused(
        400,
        'page_reference.without_pdf',
        'This document refers to a page, and only the PDF has the pages it refers to. Publish it as a PDF as well.',
      );
    // A document made from a template, held to it (templates.md, TE-H): each refusal names what the
    // author is to put right, since the page shows a refusal at the door in its own words.
    case 'section.required':
      throw refused(
        400,
        'section.required',
        `This document is missing ${answer.sections.length === 1 ? 'a section' : 'sections'} its template requires: ${answer.sections.map((each) => each.title).join(', ')}.`,
        { sections: answer.sections },
      );
    case 'component.required':
      throw refused(
        400,
        'component.required',
        `This document is missing ${answer.components.length === 1 ? 'a component' : 'components'} its template requires, removed with no reason given.`,
        { components: answer.components.map((each) => ({ key: each.key })) },
      );
    case 'metadata.invalid': {
      const titles = await sectionTitles(trx, id);
      const said = answer.failures.map((each) =>
        each.node === null
          ? each.detail
          : `${each.detail} in ${titles.get(each.node) ?? 'a section'}`,
      );
      throw refused(
        400,
        'metadata.invalid',
        `This document's values do not satisfy its template: ${said.join('; ')}.`,
        { failures: answer.failures },
      );
    }
    case 'template.unresolved':
      throw refused(
        400,
        'values.unresolved',
        "This document's template names a schema or field that no longer resolves, so its values cannot be checked.",
        { unresolved: answer.unresolved },
      );
    case 'layout.language':
      throw refused(
        400,
        'layout.language',
        `This document is in ${answer.document}, and its layout is written in ${answer.layout}. It can be published only under a layout in its own language.`,
      );
    // REU-027: a profile naming what no axis declares, each named.
    case 'profile.invalid':
      throw refused(
        400,
        'profile.invalid',
        `This profile names what no condition axis declares: ${answer.unknown.join(', ')}.`,
        { unknown: answer.unknown },
      );
    // TPL-051: an axis the template requires the profile to set, each named.
    case 'profile.incomplete':
      throw refused(
        400,
        'profile.incomplete',
        `Its template requires the profile to set ${answer.axes.join(', ')}, which it does not.`,
        { axes: answer.axes },
      );
    // Each binding with no result in this document, by its node, and why (B3-C; DAT-087).
    case 'binding.unresolved': {
      const said = answer.bindings.map(
        (each) =>
          `${each.binding} (${each.reason === 'never' ? 'never resolved' : 'changed since it was resolved'})`,
      );
      throw refused(
        400,
        'binding.unresolved',
        `This document holds ${said.length === 1 ? 'a value' : 'values'} with no result to print: ${said.join(', ')}. Resolve ${said.length === 1 ? 'it' : 'them'} in this document first.`,
        { attribution: 'product', document: id, bindings: answer.bindings },
      );
    }
  }
}

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
        ...(body.profile === undefined ? {} : { profile: body.profile }),
      });
      return answered(trx, id, answer);
    },

    /**
     * A preview (publishing.md, "Preview"): `read` was decided on the document by `authorise`, in
     * `trx`, as `publish` is for a publish (PV-B), and the request is decided and recorded here in that
     * same transaction, as a publish's is. The PDF alone (PV-C), so the body names no format.
     */
    requestPreview: async (
      request: FastifyRequest,
      { trx, principalId }: Authorised,
    ): Promise<PublicationRequestView> => {
      const { id } = request.params as DocumentParams;
      const body = request.body as RequestPreviewBody;
      const answer = await requestPublication(trx, {
        documentId: id,
        version: body.version,
        formats: ['pdf'],
        requester: principalId,
        kind: 'preview',
        ...(body.profile === undefined ? {} : { profile: body.profile }),
      });
      return answered(trx, id, answer);
    },

    /**
     * The requester's alone: a failure's place is for the person who asked, and a preview's PDF is
     * theirs to see (PV-F), and anybody else is answered as if there were no such request - never 403,
     * which would say one exists.
     */
    getPublicationRequest: async (request: FastifyRequest): Promise<PublicationRequestView> => {
      const { id } = request.params as PublicationRequestParams;
      const principal = principalOf(request);
      const tenant = tenantOf(request);
      return db.withTenant(tenant, async (trx) => {
        const found = await readPublicationRequest(trx, id);
        // A range preview's request records its inputs and nothing to read here: its pages are
        // the range preview's own (the R22 plan, R22-B).
        if (!found || found.requestedBy !== principal.principalId || found.kind === 'range') {
          throw notFound();
        }
        // A preview's pages are the document's, so its asker must still read the document at every
        // answer, as a publication is read on its own grants at every answer: losing `read` stops the
        // links at the next request, not at the hour's end (W10.2's review). Refused as if there
        // were no such request, as the document itself is.
        if (found.kind === 'preview') {
          await authoriseAt(trx, callerOf(request), 'read', {
            kind: 'artifact',
            id: found.documentId,
          });
        }
        // Asked for only where a preview lasts, after the requester is known: anybody else is
        // answered as if there were no request, store or none.
        return requestView(
          found,
          async () => {
            if (!objects) throw storageUnavailable();
            return objects.forTenant(trx, tenant);
          },
          await sourceWarnings(trx, found.documentId),
        );
      });
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
      const query = request.query as PublicationListQuery;
      const asked = pageAsked('publications', query);
      const filter = {
        ...(query.spaces === undefined ? {} : { spaces: query.spaces.split(',') }),
        ...(query.documents === undefined ? {} : { documents: query.documents.split(',') }),
      };
      const listed = await listPublications(trx, id, principalId, asked, filter);
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map(summaryView),
        next: cursorFor('publications', asked.sort, asked.order, listed.snapshot, listed.next),
        total: listed.total,
        facets: {
          spaces: listed.facets.spaces.map(
            (each: { value: string; label: string; count: number }) => ({ ...each }),
          ),
          documents: listed.facets.documents.map(
            (each: { value: string; label: string; count: number }) => ({ ...each }),
          ),
        },
      };
    },

    /** Every publication the caller may read, of every document (interface slice 10). */
    listPublicationsEverywhere: async (request: FastifyRequest): Promise<PublicationList> => {
      const query = request.query as PublicationListQuery;
      const asked = pageAsked('publications', query);
      const filter = {
        ...(query.spaces === undefined ? {} : { spaces: query.spaces.split(',') }),
        ...(query.documents === undefined ? {} : { documents: query.documents.split(',') }),
      };
      const listed = await db.withTenant(tenantOf(request), (trx) =>
        listReadablePublications(trx, principalOf(request).principalId, asked, filter),
      );
      if (!listed) throw new Error('A signed-in principal is not in its own tenant');
      return {
        items: listed.items.map(summaryView),
        next: cursorFor('publications', asked.sort, asked.order, listed.snapshot, listed.next),
        total: listed.total,
        facets: {
          spaces: listed.facets.spaces.map(
            (each: { value: string; label: string; count: number }) => ({ ...each }),
          ),
          documents: listed.facets.documents.map(
            (each: { value: string; label: string; count: number }) => ({ ...each }),
          ),
        },
      };
    },

    /**
     * `read` was decided on the publication artifact itself, so a grant on its document reaches none
     * of it (decision D). A document's or a component's id authorises, and is then no publication. Each
     * output's link is signed for five minutes and saves the bytes as `{id}.pdf` or `{id}.docx`: never
     * the title, because the link's query string reaches the store's logs. Each is served as the type
     * its bytes were kept as, its format's (`OUTPUT_CONTENT_TYPES`). Only the PDF has a link that shows
     * it in place: a browser saves a Word document whatever the link says.
     *
     * Somebody from outside the organisation is given no signed link at all (the R17 plan, R17-E):
     * each is the service's own address, decided at every request, so a revoked share fetches
     * nothing more; and their opening it is recorded (PUB-060). Whether it is superseded is said to
     * everybody, the newer one named only where the caller may read it (PUB-059).
     */
    getPublication: async (
      request: FastifyRequest,
      { trx, facts, principalId }: Authorised,
    ): Promise<PublicationView> => {
      const { id } = request.params as PublicationParams;
      const publication = await readPublication(trx, id);
      if (!publication) throw notFound();
      if (!objects) throw storageUnavailable();
      const kept = await objects.forTenant(trx, tenantOf(request));
      const outside = facts.principal.kind === 'external';
      // Shared this alone: no provenance.json, which names datasets and people (the final review).
      const sharesOnly = outside && (await readsOnlyShares(trx, principalId));
      const outputs = sharesOnly
        ? publication.outputs.filter((each) => each.format !== 'provenance')
        : publication.outputs;
      const served = (format: SharedOutputFormat) => `/v1/publications/${id}/outputs/${format}`;
      const store = {
        signedLink: (key: string, seconds: number, name?: string) => {
          if (!outside) return kept.signedLink(key, seconds, name);
          const output = publication.outputs.find((each) => each.key === key);
          return Promise.resolve(
            output ? served(output.format as SharedOutputFormat) : served('verapdf'),
          );
        },
      };
      const { superseded, newer } = await supersession(trx, id);
      const readsNewer =
        newer !== null &&
        (await loadFacts(trx, principalId, { kind: 'artifact', id: newer }).then(
          (loaded) =>
            loaded !== undefined &&
            decide('read', { ...loaded, scopes: scopesOf(request) }).allowed,
        ));
      await recordSharedAccess(trx, { publication: id, output: null, principal: principalId });
      return {
        ...summaryView(publication),
        superseded,
        newer: readsNewer ? newer : null,
        engine: publication.engine && { ...publication.engine },
        template: publication.template && { ...publication.template },
        pipeline: publication.pipelineVersion,
        outputs: await Promise.all(
          outputs.map(async (output) => {
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
                  // them. None for somebody from outside, whose bytes are saved, never shown.
                  view: outside ? null : await store.signedLink(output.key, DOWNLOAD_SECONDS),
                  // What veraPDF found, once the check that follows the recording has run (W14.1).
                  check: output.check && {
                    checker: output.check.checker,
                    checkerVersion: output.check.checkerVersion,
                    profile: output.check.profile,
                    compliant: output.check.compliant,
                    failedRules: output.check.failedRules.map((rule) => ({ ...rule })),
                    // veraPDF's whole report, kept by its hash as the PDF is, and saved as the
                    // publication's id: never the title, which would reach the store's logs.
                    report: {
                      bytes: output.check.report.bytes,
                      sha256: output.check.report.sha256,
                      download: await store.signedLink(
                        output.check.report.key,
                        DOWNLOAD_SECONDS,
                        `${publication.id}-verapdf.json`,
                      ),
                    },
                    checkedAt: output.check.checkedAt.toISOString(),
                  },
                  // Where it stands, the check first: a check recorded after the sweep gave up
                  // on it - one queued by hand - is what stands.
                  checkState:
                    output.check !== null
                      ? output.check.compliant
                        ? ('passed' as const)
                        : ('failed' as const)
                      : output.checkGaveUp
                        ? ('gave_up' as const)
                        : ('pending' as const),
                }
              : output.format === 'docx'
                ? {
                    ...common,
                    format: 'docx' as const,
                    standard: null,
                    producer: 'word' as const,
                    report: output.report.map((entry) => ({ ...entry })),
                    view: null,
                  }
                : {
                    ...common,
                    // `provenance.json` (B3-G), saved as such: redacted for every reader.
                    download: await store.signedLink(
                      output.key,
                      DOWNLOAD_SECONDS,
                      `${publication.id}-provenance.json`,
                    ),
                    format: 'provenance' as const,
                    standard: null,
                    producer: 'pipeline' as const,
                    report: [] as [],
                    view: null,
                  };
          }),
        ),
      };
    },

    /**
     * The values a publication printed (B3; DAT-042): `read` was decided on the publication, as for
     * the publication itself, and each binding's SQL, connection and column sources are given only
     * where the caller may read its query definition, decided here in the same transaction.
     */
    getPublicationBindings: async (
      request: FastifyRequest,
      { trx, facts, principalId }: Authorised,
    ): Promise<PublicationBindingList> => {
      const { id } = request.params as PublicationParams;
      // Bindings name datasets and authors: never to somebody shared the publication alone (R17-I).
      if (facts.principal.kind === 'external' && (await readsOnlyShares(trx, principalId))) {
        throw notFound();
      }
      if (!(await readPublication(trx, id))) throw notFound();
      const reads = definitionReader(trx, callerOf(request));
      const bindings: PublicationBindingList['bindings'] = [];
      for (const each of await publicationBindings(trx, id)) {
        const p = each.dataset.provenance;
        const disclosed = await reads(p.queryDefinition.artifact);
        bindings.push({
          node: each.node,
          binding: each.binding,
          dataset: {
            id: each.dataset.id,
            name: each.dataset.name,
            version: each.datasetVersion,
            number: each.dataset.number,
          },
          result: {
            queryDefinition: { ...p.queryDefinition },
            parameters: { ...p.parameters },
            at: p.at,
            durationMs: p.durationMs,
            rowCount: p.rowCount,
            checksum: p.checksum,
            columns: p.columns.map((column) => ({
              name: column.name,
              type: { ...column.type },
              ...(disclosed ? { from: { ...column.from } } : {}),
            })),
            ...(disclosed ? { ran: { ...p.ran } } : {}),
            // None for a stored result's query (R21-A).
            ...(disclosed && p.connection ? { connection: { ...p.connection } } : {}),
            images: { ...p.images },
          },
          revisions: each.revisions.map((revision) => ({
            id: revision.id,
            cell:
              revision.cell === null ? null : { ...revision.cell, key: { ...revision.cell.key } },
            value: revision.value,
            by: { ...revision.by },
            at: revision.at,
            reason: revision.reason,
          })),
        });
      }
      return { bindings };
    },
  };
}
